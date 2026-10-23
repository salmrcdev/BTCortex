import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBootstrapStatus } from './bootstrap';
import {
  connectAuthenticated,
  parseArguments,
  parseProtocolInfo,
  TorControlConnection,
  TorControlError,
  TorIdentityError,
} from './control';
import type { ControlEvent } from './control';
import { probeControlPort } from './detect';

// A fake tor that speaks the real control protocol: PROTOCOLINFO before
// authentication, the SAFECOOKIE challenge with real HMACs, data blocks with
// dot-stuffing and asynchronous 650 events between replies.

const SERVER_TO_CONTROLLER = 'Tor safe cookie authentication server-to-controller hash';
const SERVICE_A = 'a'.repeat(56);
const SERVICE_B = 'b'.repeat(56);
const KEY = `ED25519-V3:${Buffer.alloc(64, 7).toString('base64')}`;
const CONTROLLER_TO_SERVER = 'Tor safe cookie authentication controller-to-server hash';

interface FakeTorOptions {
  cookie: Buffer;
  cookieFile: string;
  /** Answers the challenge without knowing the cookie. */
  impostor?: boolean;
  /** Never answers GETINFO. */
  silent?: boolean;
}

function hmac(key: string, ...parts: Buffer[]): Buffer {
  return createHmac('sha256', key).update(Buffer.concat(parts)).digest();
}

function fakeTor(options: FakeTorOptions): { server: Server; received: string[] } {
  const received: string[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = '';
    let authenticated = false;
    let clientNonce = Buffer.alloc(0);
    const serverNonce = randomBytes(32);
    const send = (...lines: string[]) => socket.write(lines.map((line) => `${line}\r\n`).join(''));
    const handle = (line: string) => {
      received.push(line);
      const [command, ...rest] = line.split(' ');
      if (command === 'PROTOCOLINFO') {
        send(
          '250-PROTOCOLINFO 1',
          `250-AUTH METHODS=COOKIE,SAFECOOKIE COOKIEFILE="${options.cookieFile.replace(/\\/g, '\\\\')}"`,
          '250-VERSION Tor="0.4.9.14"',
          '250 OK',
        );
      } else if (command === 'AUTHCHALLENGE') {
        clientNonce = Buffer.from(rest[1] ?? '', 'hex');
        const key = options.impostor ? randomBytes(32) : options.cookie;
        const serverHash = hmac(SERVER_TO_CONTROLLER, key, clientNonce, serverNonce);
        send(
          `250 AUTHCHALLENGE SERVERHASH=${serverHash.toString('hex').toUpperCase()} SERVERNONCE=${serverNonce.toString('hex').toUpperCase()}`,
        );
      } else if (command === 'AUTHENTICATE') {
        const expected = hmac(CONTROLLER_TO_SERVER, options.cookie, clientNonce, serverNonce).toString('hex');
        if (rest[0]?.toLowerCase() === expected) {
          authenticated = true;
          send('250 OK');
        } else {
          send('515 Authentication failed: Safecookie response did not match expected value.');
          socket.end();
        }
      } else if (!authenticated) {
        send('514 Authentication required.');
        socket.end();
      } else if (command === 'GETINFO' && rest[0] === 'onions/detached') {
        send('250+onions/detached=', SERVICE_A, SERVICE_B, '.', '250 OK');
      } else if (command === 'ADD_ONION') {
        const known = rest[0] !== 'NEW:ED25519-V3';
        send(`250-ServiceID=${known ? SERVICE_B : SERVICE_A}`, ...(known ? [] : [`250-PrivateKey=${KEY}`]), '250 OK');
      } else if (command === 'DEL_ONION' && rest[0] !== SERVICE_A) {
        send('552 Unknown Onion Service id');
      } else if (command === 'GETINFO') {
        if (options.silent) return;
        send(
          '250-version=0.4.9.14',
          '250+config-text=',
          'SocksPort 127.0.0.1:9050',
          '..a line that starts with a dot',
          '.',
          '250-status/bootstrap-phase=NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"',
          '250 OK',
        );
      } else if (command === 'SETEVENTS') {
        send(
          '250 OK',
          '650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=50 TAG=loading_descriptors SUMMARY="Loading relay descriptors"',
        );
      } else if (command === 'SIGNAL' && rest[0] === 'BOGUS') {
        send('552 Unrecognized signal code "BOGUS"');
      } else if (command === 'QUIT') {
        send('250 closing connection');
        socket.end();
      } else {
        send('250 OK');
      }
    };
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\r\n');
      while (index !== -1) {
        handle(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  return { server, received };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe('tor control connection', () => {
  let root: string;
  let cookieFile: string;
  const cookie = randomBytes(32);
  const servers: Server[] = [];
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-tor-control-'));
    cookieFile = join(root, 'data', 'control_auth_cookie');
  });
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
    rmSync(root, { recursive: true, force: true });
  });

  const start = async (options: Partial<FakeTorOptions> = {}) => {
    const fake = fakeTor({ cookie, cookieFile, ...options });
    servers.push(fake.server);
    return { port: await listen(fake.server), received: fake.received };
  };

  const writeCookie = (value: Buffer = cookie) => {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(cookieFile, value);
  };

  it('authenticates with SAFECOOKIE, reads values and data blocks, and delivers events between replies', async () => {
    writeCookie();
    const { port, received } = await start();
    const connection = await connectAuthenticated(port, cookieFile);
    // The cookie itself never crosses the socket.
    expect(received.some((line) => line.includes(cookie.toString('hex')))).toBe(false);

    const info = await connection.getInfo(['version', 'config-text', 'status/bootstrap-phase']);
    expect(info.get('version')).toBe('0.4.9.14');
    expect(info.get('config-text')).toBe('SocksPort 127.0.0.1:9050\n.a line that starts with a dot');
    expect(parseBootstrapStatus(info.get('status/bootstrap-phase') ?? '')).toMatchObject({
      progress: 100,
      tag: 'done',
      summary: 'Done',
    });

    const events: ControlEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.setEvents(['STATUS_CLIENT']);
    await connection.signal('NEWNYM');
    expect(events).toEqual([
      expect.objectContaining({
        type: 'STATUS_CLIENT',
        body: 'NOTICE BOOTSTRAP PROGRESS=50 TAG=loading_descriptors SUMMARY="Loading relay descriptors"',
      }),
    ]);
    connection.close();
    expect(connection.closed).toBe(true);
  });

  it('stops at once when the program on the port cannot prove it knows the cookie', async () => {
    writeCookie();
    const { port, received } = await start({ impostor: true });
    await expect(connectAuthenticated(port, cookieFile)).rejects.toThrow(/does not know the control cookie/);
    // Nothing derived from the cookie was sent to it.
    expect(received.some((line) => line.startsWith('AUTHENTICATE'))).toBe(false);
  });

  it('refuses a tor that uses a different cookie file, so another tor on the port is never taken for BTCortex’s', async () => {
    writeCookie();
    const { port } = await start({ cookieFile: join(root, 'elsewhere', 'control_auth_cookie') });
    await expect(connectAuthenticated(port, cookieFile)).rejects.toBeInstanceOf(TorIdentityError);
  });

  it('refuses a cookie of the wrong length', async () => {
    writeCookie(randomBytes(16));
    const { port } = await start();
    await expect(connectAuthenticated(port, cookieFile)).rejects.toThrow(/not 32 bytes/);
  });

  it('turns error replies into TorControlError and keeps the connection usable', async () => {
    writeCookie();
    const { port } = await start();
    const connection = await connectAuthenticated(port, cookieFile);
    // @ts-expect-error -- an invalid signal on purpose
    const refused = connection.signal('BOGUS');
    await expect(refused).rejects.toBeInstanceOf(TorControlError);
    await expect(refused).rejects.toMatchObject({ status: 552 });
    await expect(connection.getInfo(['version'])).resolves.toBeInstanceOf(Map);
    await expect(connection.command('GETINFO version\r\nSIGNAL HALT')).rejects.toThrow(/single line/);
    connection.close();
  });

  it('gives up a connection whose reply does not arrive in time', async () => {
    writeCookie();
    const { port } = await start({ silent: true });
    const connection = await connectAuthenticated(port, cookieFile, { commandTimeoutMs: 200 });
    await expect(connection.getInfo(['version'])).rejects.toThrow(/did not answer "GETINFO" in time/);
    expect(connection.closed).toBe(true);
  });

  it('recognises tor by PROTOCOLINFO alone, and nothing else as tor', async () => {
    const { port } = await start();
    expect(await probeControlPort(port)).toMatchObject({ torVersion: '0.4.9.14', methods: ['COOKIE', 'SAFECOOKIE'] });

    const web = createServer((socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    servers.push(web);
    expect(await probeControlPort(await listen(web))).toBeUndefined();
  });

  it('publishes onion services that outlive the connection, and stops them', async () => {
    writeCookie();
    const { port, received } = await start();
    const control = await connectAuthenticated(port, cookieFile);
    // A new identity comes back with its key, so the same address can be published again later.
    expect(await control.addOnion([{ virtual: 50001, target: '127.0.0.1:60401' }])).toEqual({
      serviceId: SERVICE_A,
      privateKey: KEY,
    });
    expect(await control.addOnion([{ virtual: 50001, target: '127.0.0.1:60401' }], KEY)).toEqual({
      serviceId: SERVICE_B,
    });
    expect(received).toContain('ADD_ONION NEW:ED25519-V3 Flags=Detach Port=50001,127.0.0.1:60401');
    expect(received).toContain(`ADD_ONION ${KEY} Flags=Detach,DiscardPK Port=50001,127.0.0.1:60401`);
    expect(await control.detachedOnions()).toEqual([SERVICE_A, SERVICE_B]);
    await control.delOnion(SERVICE_A);
    await expect(control.delOnion(SERVICE_B)).rejects.toBeInstanceOf(TorControlError);
    // Nothing but loopback targets and well-formed keys reach tor.
    await expect(control.addOnion([{ virtual: 50001, target: '192.168.1.5:50001' }])).rejects.toThrow(/loopback/);
    await expect(control.addOnion([{ virtual: 50001, target: '127.0.0.1:1' }], 'RSA1024:abc')).rejects.toThrow(
      /malformed/,
    );
    await expect(control.delOnion('not-an-id')).rejects.toThrow(/malformed/);
    control.close();
  });

  it('cannot connect where nothing listens', async () => {
    const unused = createServer();
    const port = await listen(unused);
    await new Promise((resolve) => unused.close(resolve));
    await expect(TorControlConnection.connect(port, { timeoutMs: 2000 })).rejects.toThrow();
  });
});

describe('control-port text', () => {
  it('reads quoted values with C escapes, as tor writes Windows paths', () => {
    const { positional, keywords } = parseArguments(
      'NOTICE BOOTSTRAP PROGRESS=5 SUMMARY="Connecting to a \\"relay\\"" PATH="C:\\\\Users\\\\Dev\\\\1st" OCT="\\101"',
    );
    expect(positional).toEqual(['NOTICE', 'BOOTSTRAP']);
    expect(keywords.get('SUMMARY')).toBe('Connecting to a "relay"');
    expect(keywords.get('PATH')).toBe('C:\\Users\\Dev\\1st');
    expect(keywords.get('OCT')).toBe('A');
  });

  it('parses PROTOCOLINFO', () => {
    expect(
      parseProtocolInfo({
        status: 250,
        lines: [
          { status: 250, text: 'PROTOCOLINFO 1' },
          { status: 250, text: 'AUTH METHODS=NULL' },
          { status: 250, text: 'VERSION Tor="0.4.8.1"' },
          { status: 250, text: 'OK' },
        ],
      }),
    ).toEqual({ methods: ['NULL'], torVersion: '0.4.8.1' });
  });

  it('parses bootstrap problem reports', () => {
    expect(
      parseBootstrapStatus(
        'WARN BOOTSTRAP PROGRESS=10 TAG=conn_done SUMMARY="Connected to a relay" WARNING="Connection refused" REASON=CONNECTREFUSED COUNT=12 RECOMMENDATION=warn HOST=ABCD HOSTADDR=192.0.2.1:443',
      ),
    ).toEqual({
      progress: 10,
      tag: 'conn_done',
      summary: 'Connected to a relay',
      severity: 'WARN',
      warning: 'Connection refused',
      reason: 'CONNECTREFUSED',
      host: 'ABCD',
      recommendation: 'warn',
      count: 12,
    });
    expect(parseBootstrapStatus('NOTICE CIRCUIT_ESTABLISHED')).toBeUndefined();
    expect(parseBootstrapStatus('NOTICE BOOTSTRAP PROGRESS=101 TAG=x SUMMARY="x"')).toBeUndefined();
  });
});
