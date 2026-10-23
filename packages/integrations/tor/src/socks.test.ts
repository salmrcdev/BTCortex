import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { connectThroughSocks, SocksError } from './socks';

// A minimal SOCKS5 proxy in the test: it records what the client asks for and
// either answers like tor, refuses, or relays an echo service.

interface Seen {
  methods: number[];
  username?: string;
  addressType?: number;
  host?: string;
  port?: number;
}

let proxy: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolveClose) => {
    if (!proxy) {
      resolveClose();
      return;
    }
    proxy.close(() => {
      resolveClose();
    });
  });
  proxy = undefined;
});

async function startProxy(reply: number, seen: Seen): Promise<number> {
  proxy = createServer((client: Socket) => {
    let stage = 'greeting';
    let buffer = Buffer.alloc(0);
    client.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting' && buffer.length >= 2 && buffer.length >= 2 + (buffer[1] ?? 0)) {
        seen.methods = [...buffer.subarray(2, 2 + (buffer[1] ?? 0))];
        buffer = buffer.subarray(2 + (buffer[1] ?? 0));
        const method = seen.methods.includes(2) ? 2 : 0;
        client.write(Buffer.from([5, method]));
        stage = method === 2 ? 'auth' : 'request';
      }
      if (stage === 'auth' && buffer.length >= 2) {
        const length = buffer[1] ?? 0;
        if (buffer.length < 2 + length + 1) return;
        seen.username = buffer.subarray(2, 2 + length).toString('utf8');
        const passwordLength = buffer[2 + length] ?? 0;
        if (buffer.length < 3 + length + passwordLength) return;
        buffer = buffer.subarray(3 + length + passwordLength);
        client.write(Buffer.from([1, 0]));
        stage = 'request';
      }
      if (stage === 'request' && buffer.length >= 5) {
        seen.addressType = buffer[3] ?? 0;
        const nameLength = buffer[4] ?? 0;
        if (seen.addressType === 3) {
          if (buffer.length < 5 + nameLength + 2) return;
          seen.host = buffer.subarray(5, 5 + nameLength).toString('utf8');
          seen.port = buffer.readUInt16BE(5 + nameLength);
        } else if (seen.addressType === 1) {
          if (buffer.length < 10) return;
          seen.host = [...buffer.subarray(4, 8)].join('.');
          seen.port = buffer.readUInt16BE(8);
        }
        client.write(Buffer.from([5, reply, 0, 1, 0, 0, 0, 0, 0, 0]));
        stage = 'relay';
        buffer = Buffer.alloc(0);
        return;
      }
      if (stage === 'relay') {
        client.write(Buffer.concat([Buffer.from('echo:'), buffer]));
        buffer = Buffer.alloc(0);
      }
    });
    client.on('error', () => undefined);
  });
  await new Promise<void>((resolveListen) => proxy?.listen(0, '127.0.0.1', resolveListen));
  return (proxy.address() as AddressInfo).port;
}

describe('connectThroughSocks', () => {
  it('hands the name to the proxy unresolved, isolates the stream, and relays the connection', async () => {
    const seen: Seen = { methods: [] };
    const port = await startProxy(0, seen);
    const onion = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion';
    const socket = await connectThroughSocks(
      { host: onion, port: 8080 },
      { proxyPort: port, isolation: 'btcortex-lightning-1' },
    );
    expect(seen).toMatchObject({
      methods: [2],
      username: 'btcortex-lightning-1',
      addressType: 3,
      host: onion,
      port: 8080,
    });
    const echoed = new Promise<string>((resolveData) => {
      socket.once('data', (chunk: Buffer) => {
        resolveData(chunk.toString('utf8'));
      });
    });
    socket.write('hello');
    expect(await echoed).toBe('echo:hello');
    socket.destroy();
  });

  it('sends IP addresses as addresses, without authentication when no isolation is asked for', async () => {
    const seen: Seen = { methods: [] };
    const port = await startProxy(0, seen);
    const socket = await connectThroughSocks({ host: '10.0.0.7', port: 9735 }, { proxyPort: port });
    expect(seen).toMatchObject({ methods: [0], addressType: 1, host: '10.0.0.7', port: 9735 });
    socket.destroy();
  });

  it('explains what tor could not do, and when the proxy is not there', async () => {
    const port = await startProxy(0xf0, { methods: [] });
    const failure = await connectThroughSocks({ host: 'missing.onion', port: 80 }, { proxyPort: port }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SocksError);
    expect((failure as SocksError).message).toMatch(/descriptor not found/);
    expect((failure as SocksError).reply).toBe(0xf0);

    await new Promise<void>((resolveClose) =>
      proxy?.close(() => {
        resolveClose();
      }),
    );
    proxy = undefined;
    await expect(connectThroughSocks({ host: 'x.onion', port: 80 }, { proxyPort: port })).rejects.toThrow(
      /could not be reached/,
    );
  });
});
