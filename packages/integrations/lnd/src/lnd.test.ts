import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:https';
import type { Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { connect as connectTcp } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseChannelBalance,
  parseChannels,
  parseFeeReport,
  parseForwards,
  parseInfo,
  parseInvoices,
  parsePayments,
  parsePeers,
  parsePendingChannels,
  parseWalletBalance,
} from './api';
import { parseLndConnectUri } from './lndconnect';
import { findLocalLnd, parseLndConfig } from './local';
import { describeMacaroon, MacaroonFormatError } from './macaroon';
import { lndReleaseFromAssets, parseLndVersion } from './release';
import {
  certificateFingerprint,
  LndRestClient,
  LndRestError,
  LndTransportError,
  parseRestAddress,
  toRestError,
} from './rest';

const testing = (name: string) => readFileSync(join(import.meta.dirname, 'testing', name), 'utf8');
// Real answers of LND 0.21.4-beta on regtest; see the fixture's note.
const LND = JSON.parse(testing('lnd-0.21.4-regtest.json')) as Record<string, unknown> & {
  macaroons: { admin: string; readonly: string; invoice: string };
  errors: Record<string, unknown>;
  tlsCertificate: string;
};

describe('REST addresses', () => {
  it('reads the forms people paste, defaulting to port 8080', () => {
    expect(parseRestAddress('127.0.0.1:8080')).toEqual({ host: '127.0.0.1', port: 8080 });
    expect(parseRestAddress(' https://node.local:8443/ ')).toEqual({ host: 'node.local', port: 8443 });
    expect(parseRestAddress('[::1]:8080')).toEqual({ host: '::1', port: 8080 });
    expect(parseRestAddress('abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion')).toMatchObject({
      port: 8080,
    });
    expect(() => parseRestAddress('http://127.0.0.1:8080')).toThrow(/HTTPS only/);
    expect(() => parseRestAddress('127.0.0.1:99999')).toThrow(/not a REST address/);
    expect(() => parseRestAddress('')).toThrow(/not a REST address/);
  });
});

describe('macaroons', () => {
  it('tells LND’s three macaroons apart by what they allow', () => {
    const admin = describeMacaroon(LND.macaroons.admin);
    expect(admin.access).toBe('admin');
    expect(admin.location).toBe('lnd');
    expect(admin.permissions).toContainEqual({ entity: 'offchain', actions: ['read', 'write'] });
    expect(describeMacaroon(LND.macaroons.readonly).access).toBe('read-only');
    const invoice = describeMacaroon(LND.macaroons.invoice);
    expect(invoice.access).toBe('invoices');
    expect(invoice.permissions).toContainEqual({ entity: 'invoices', actions: ['read', 'write'] });
  });

  it('reads first-party caveats, such as an expiry', () => {
    const bytes = Buffer.from(LND.macaroons.readonly, 'hex');
    // The caveat list ends 35 bytes from the end: its end marker, then the signature field (type, length, 32 bytes).
    const caveat = Buffer.from('time-before 2030-01-01T00:00:00Z');
    const withCaveat = Buffer.concat([
      bytes.subarray(0, bytes.length - 35),
      Buffer.from([2, caveat.length]),
      caveat,
      Buffer.from([0]),
      bytes.subarray(bytes.length - 35),
    ]);
    const summary = describeMacaroon(withCaveat);
    expect(summary.caveats).toEqual(['time-before 2030-01-01T00:00:00Z']);
    expect(summary.expiresAt).toBe('2030-01-01T00:00:00.000Z');
    expect(summary.access).toBe('read-only');
  });

  it('refuses what is not an LND macaroon', () => {
    expect(() => describeMacaroon('zz')).toThrow(MacaroonFormatError);
    expect(() => describeMacaroon('0201')).toThrow(MacaroonFormatError);
    expect(() => describeMacaroon(LND.macaroons.admin.slice(0, 100))).toThrow(MacaroonFormatError);
  });
});

describe('LND’s errors', () => {
  it('are told apart, so the cause can be explained', () => {
    expect(toRestError(500, LND.errors['noMacaroon']).kind).toBe('auth');
    expect(toRestError(500, LND.errors['wrongMacaroon']).kind).toBe('auth');
    expect(toRestError(500, LND.errors['permissionDenied']).kind).toBe('permission');
    expect(toRestError(500, { code: 2, message: 'wallet locked, unlock it to enable full RPC access' }).kind).toBe(
      'locked',
    );
    expect(toRestError(404, {}).kind).toBe('not-found');
    expect(toRestError(503, {}).message).toBe('LND answered HTTP 503.');
  });
});

describe('LND’s answers', () => {
  it('give the node’s identity, network and synchronisation', () => {
    const info = parseInfo(LND['getinfo']);
    expect(info).toMatchObject({
      version: '0.21.4-beta',
      alias: 'alice',
      network: 'regtest',
      blockHeight: 125,
      syncedToChain: true,
      syncedToGraph: true,
      activeChannels: 1,
      pendingChannels: 1,
      peers: 2,
    });
    expect(info.pubkey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(info.features.find((feature) => feature.bit === 0)).toEqual({
      bit: 0,
      name: 'data-loss-protect',
      required: true,
    });
  });

  it('give balances in whole satoshis', () => {
    expect(parseWalletBalance(LND['walletBalance'])).toEqual({
      confirmedSats: 98_999_671,
      unconfirmedSats: 0,
      lockedSats: 0,
      reservedForAnchorsSats: 20_000,
    });
    expect(parseChannelBalance(LND['channelBalance'])).toMatchObject({
      localSats: 976_528,
      remoteSats: 20_001,
      pendingOpenRemoteSats: 296_530,
    });
  });

  it('give channels with their liquidity and traffic', () => {
    const [toAlice, toCarol] = parseChannels(LND['channels']);
    expect(toAlice).toMatchObject({
      id: '125344325632000',
      active: true,
      initiator: false,
      capacitySats: 1_000_000,
      localSats: 20_001,
      remoteSats: 976_528,
      receivedSats: 25_001,
      sentSats: 5_000,
      commitmentType: 'ANCHORS',
      pendingHtlcs: [],
    });
    expect(toCarol).toMatchObject({ initiator: true, capacitySats: 800_000, localSats: 671_530, remoteSats: 125_000 });
  });

  it('give pending channels, how close they are and who opened them', () => {
    const pending = parsePendingChannels(LND['pendingChannels']);
    expect(pending.limboSats).toBe(0);
    expect(pending.channels).toEqual([
      expect.objectContaining({
        kind: 'opening',
        capacitySats: 300_000,
        remoteSats: 296_530,
        initiator: 'remote',
        confirmationsUntilActive: 1,
      }),
    ]);
  });

  it('give peers, fees earned and forwards', () => {
    expect(parsePeers(LND['peers'])[0]).toMatchObject({ inbound: true, satsReceived: 25_001, pingMicros: null });
    const fees = parseFeeReport(LND['fees']);
    expect(fees).toMatchObject({ daySats: 1, weekSats: 1, monthSats: 1 });
    expect(fees.channels[0]).toMatchObject({ baseFeeMsat: 1000, feePpm: 1 });
    expect(parseForwards(LND['forwarding'])).toEqual([
      expect.objectContaining({
        channelIn: '125344325632000',
        channelOut: '125344325697536',
        amountInSats: 25_001,
        amountOutSats: 25_000,
        feeMsat: 1025,
        at: '2026-10-23T05:40:36.694Z',
      }),
    ]);
  });

  it('give invoices and payments without their secrets', () => {
    const invoices = parseInvoices(LND['invoices']);
    expect(invoices.map((invoice) => [invoice.memo, invoice.state, invoice.paidSats])).toEqual([
      ['Bob pays alice', 'SETTLED', 5_000],
      ['Never paid', 'OPEN', 0],
    ]);
    expect(invoices[0]?.paymentHash).toMatch(/^[0-9a-f]{64}$/);
    const payments = parsePayments(LND['payments']);
    expect(payments[0]).toMatchObject({ status: 'SUCCEEDED', valueSats: 25_000, feeMsat: 1025, hops: 2 });
    expect(payments[0]?.destination).toMatch(/^0[23][0-9a-f]{64}$/);
    // Preimages prove payment and can settle an invoice: they never leave the parser.
    const raw = JSON.stringify([LND['invoices'], LND['payments']]);
    const preimages = [...raw.matchAll(/"(?:r_preimage|payment_preimage)": ?"([^"]+)"/g)].map((match) => match[1]);
    expect(preimages.length).toBeGreaterThan(0);
    const parsed = JSON.stringify([invoices, payments]);
    for (const preimage of preimages) {
      expect(parsed).not.toContain(preimage);
      expect(parsed).not.toContain(Buffer.from(preimage ?? '', 'base64').toString('hex'));
    }
  });
});

describe('LND releases', () => {
  const base = 'https://github.com/lightningnetwork/lnd/releases/download/v0.21.4-beta/';
  const asset = (name: string) => ({ name, browser_download_url: `${base}${name}` });
  const signers = ['bhandras', 'boris', 'georgetsagk', 'gijswijs', 'roasbeef', 'suheb', 'ViktorT-11', 'ziggie1984'];
  const assets = [
    asset('manifest-v0.21.4-beta.txt'),
    asset('lnd-windows-amd64-v0.21.4-beta.zip'),
    ...signers.map((signer) => asset(`manifest-${signer}-v0.21.4-beta.sig`)),
    asset('manifest-mallory-v0.21.4-beta.sig'),
    asset('manifest-roasbeef-v0.21.4-beta.sig.ots'),
  ];

  it('collect the signatures of pinned signers only', () => {
    const release = lndReleaseFromAssets('0.21.4-beta', assets);
    expect(release.signatureUrls).toHaveLength(8);
    expect(release.signatureUrls.some((url) => url.includes('mallory'))).toBe(false);
    expect(release.archiveName).toBe('lnd-windows-amd64-v0.21.4-beta.zip');
    expect(release.root).toBe('lnd-windows-amd64-v0.21.4-beta');
  });

  it('refuse files outside the release and releases with too few signers', () => {
    const moved = assets.map((entry) =>
      entry.name.endsWith('.zip') ? { ...entry, browser_download_url: 'https://example.org/lnd.zip' } : entry,
    );
    expect(() => lndReleaseFromAssets('0.21.4-beta', moved)).toThrow(/unexpected address/);
    const few = assets.filter(
      (entry) => !['boris', 'suheb', 'gijswijs', 'georgetsagk'].some((s) => entry.name.includes(s)),
    );
    expect(() => lndReleaseFromAssets('0.21.4-beta', few)).toThrow(/5 are required/);
    expect(() => lndReleaseFromAssets('0.21.4', assets)).toThrow(/not an LND release/);
  });

  it('read the version lnd reports', () => {
    expect(parseLndVersion('lnd version 0.21.4-beta commit=v0.21.4-beta\n')).toBe('0.21.4-beta');
    expect(parseLndVersion('something else')).toBeUndefined();
  });
});

describe('an LND on this computer', () => {
  const root = 'C:\\Users\\Ada\\AppData\\Local\\Lnd';
  const chain = `${root}\\data\\chain\\bitcoin`;

  it('is found with its REST address, network and macaroons, least powerful first', () => {
    const files = new Map([
      [
        `${root}\\lnd.conf`,
        '[Application Options]\nrestlisten=0.0.0.0:8081\n; norest=1\n[Bitcoin]\nbitcoin.mainnet=true\n',
      ],
      [`${root}\\tls.cert`, ''],
      [`${chain}\\mainnet`, ''],
      [`${chain}\\mainnet\\admin.macaroon`, ''],
      [`${chain}\\mainnet\\readonly.macaroon`, ''],
    ]);
    const found = findLocalLnd({
      env: { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' },
      exists: (path) => path === root || files.has(path),
      read: (path) => files.get(path) ?? '',
    });
    expect(found).toMatchObject({
      network: 'mainnet',
      networks: ['mainnet'],
      restAddress: '127.0.0.1:8081',
      tlsCertificateFound: true,
      configFile: `${root}\\lnd.conf`,
    });
    expect(found?.macaroons.map((macaroon) => macaroon.kind)).toEqual(['readonly', 'admin']);
  });

  it('knows when REST is switched off, and finds the network from the data alone', () => {
    const files = new Map([
      [`${root}\\lnd.conf`, 'norest=1\n'],
      [`${chain}\\regtest`, ''],
    ]);
    const found = findLocalLnd({
      env: { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' },
      exists: (path) => path === root || files.has(path),
      read: (path) => files.get(path) ?? '',
    });
    expect(found).toMatchObject({ restAddress: null, network: 'regtest', tlsCertificateFound: false, macaroons: [] });
    expect(findLocalLnd({ env: { LOCALAPPDATA: 'C:\\Nowhere' }, exists: () => false })).toBeUndefined();
  });

  it('reads lnd.conf keys whatever their section, keeping repeats', () => {
    const config = parseLndConfig('restlisten=a:1\n# comment\n[Other]\nrestlisten = b:2\nnoseedbackup\n');
    expect(config.get('restlisten')).toEqual(['a:1', 'b:2']);
    expect(config.get('noseedbackup')).toEqual(['true']);
  });
});

describe('lndconnect addresses', () => {
  const base64url = (text: string) => Buffer.from(text, 'base64').toString('base64url');
  const der = LND.tlsCertificate.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const macaroon = Buffer.from(LND.macaroons.readonly, 'hex').toString('base64url');

  it('carry the address, the certificate and the macaroon', () => {
    const details = parseLndConnectUri(`lndconnect://192.168.1.4:8080?cert=${base64url(der)}&macaroon=${macaroon}`);
    expect(details).toMatchObject({
      restAddress: '192.168.1.4:8080',
      macaroon: LND.macaroons.readonly,
      grpcPort: false,
    });
    expect(certificateFingerprint(details.tlsCertificate ?? '')).toBe(certificateFingerprint(LND.tlsCertificate));
  });

  it('flag LND’s gRPC port and work without a certificate', () => {
    const details = parseLndConnectUri(`lndconnect://node.example.org:10009?macaroon=${macaroon}`);
    expect(details).toMatchObject({ grpcPort: true, restAddress: 'node.example.org:10009' });
    expect(details.tlsCertificate).toBeUndefined();
    expect(() => parseLndConnectUri('lndconnect://host:8080')).toThrow(/no macaroon/);
    expect(() => parseLndConnectUri('https://host:8080')).toThrow(/lndconnect/);
  });
});

describe('the REST client', () => {
  const key = testing('server-key.pem');
  const certificate = testing('server-cert.pem');
  const otherCertificate = testing('other-cert.pem');
  let server: Server | undefined;
  let requests: { method: string; url: string; macaroon: string | undefined; body: string }[] = [];

  afterEach(async () => {
    requests = [];
    await new Promise<void>((resolveClose) => {
      if (!server) {
        resolveClose();
        return;
      }
      server.closeAllConnections();
      server.close(() => {
        resolveClose();
      });
    });
    server = undefined;
  });

  async function serve(
    respond: (
      method: string,
      url: string,
      reply: (status: number, body: string) => void,
      write: (chunk: string) => void,
    ) => void,
  ): Promise<number> {
    server = createServer({ key, cert: certificate }, (request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      request.on('end', () => {
        const macaroon = request.headers['grpc-metadata-macaroon'];
        requests.push({
          method: request.method ?? '',
          url: request.url ?? '',
          macaroon: typeof macaroon === 'string' ? macaroon : undefined,
          body,
        });
        respond(
          request.method ?? '',
          request.url ?? '',
          (status, text) => {
            response.writeHead(status, { 'Content-Type': 'application/json' });
            response.end(text);
          },
          (chunk) => {
            if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'application/json' });
            response.write(chunk);
          },
        );
      });
    });
    await new Promise<void>((resolveListen) => server?.listen(0, '127.0.0.1', resolveListen));
    return (server.address() as AddressInfo).port;
  }

  const client = (
    port: number,
    tlsCertificate = certificate,
    extra: Partial<ConstructorParameters<typeof LndRestClient>[0]> = {},
  ) =>
    new LndRestClient({
      endpoint: { host: '127.0.0.1', port },
      tlsCertificate,
      macaroon: 'abcd',
      timeoutMs: 2_000,
      ...extra,
    });

  it('talks to the node holding the given certificate, with the macaroon and the query', async () => {
    const port = await serve((_method, _url, reply) => {
      reply(200, '{"state":"SERVER_ACTIVE"}');
    });
    expect(await client(port).get('/v1/invoices', { reversed: true, skip: undefined })).toEqual({
      state: 'SERVER_ACTIVE',
    });
    expect(requests).toEqual([{ method: 'GET', url: '/v1/invoices?reversed=true', macaroon: 'abcd', body: '' }]);
  });

  it('refuses any other certificate before sending anything', async () => {
    const port = await serve((_method, _url, reply) => {
      reply(200, '{}');
    });
    const failure = await client(port, otherCertificate)
      .get('/v1/getinfo')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LndTransportError);
    expect((failure as LndTransportError).failure).toBe('certificate');
    expect(requests).toEqual([]);
  });

  it('accepts the given certificate whatever name the node is reached by, through a custom connection', async () => {
    const port = await serve((_method, _url, reply) => {
      reply(200, '{"ok":true}');
    });
    const onion = new LndRestClient({
      endpoint: { host: 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion', port: 8080 },
      tlsCertificate: certificate,
      macaroon: 'abcd',
      connect: () =>
        new Promise((resolveSocket, reject) => {
          const socket = connectTcp(port, '127.0.0.1', () => {
            resolveSocket(socket);
          });
          socket.once('error', reject);
        }),
    });
    expect(await onion.post('/v1/switch', { num_max_events: 1 })).toEqual({ ok: true });
    expect(requests[0]).toMatchObject({ method: 'POST', body: '{"num_max_events":1}' });
  });

  it('reports LND’s errors, answers that are not JSON, and silence', async () => {
    const port = await serve((_method, url, reply) => {
      if (url === '/denied') reply(500, '{"code":2,"message":"permission denied","details":[]}');
      else if (url === '/html') reply(200, '<html></html>');
      // '/silent' never answers.
    });
    await expect(client(port).get('/denied')).rejects.toMatchObject({ kind: 'permission', status: 500, grpcCode: 2 });
    await expect(client(port).get('/denied')).rejects.toBeInstanceOf(LndRestError);
    await expect(client(port).get('/html')).rejects.toMatchObject({ failure: 'protocol' });
    await expect(client(port, certificate, { timeoutMs: 200 }).get('/silent')).rejects.toMatchObject({
      failure: 'timeout',
    });
  });

  it('follows a stream until the call is complete', async () => {
    const port = await serve((_method, _url, _reply, write) => {
      write('{"result":{"status":"IN_FLIGHT"}}\n');
      setTimeout(() => {
        write('{"result":{"status":"SUCCEEDED","fee_msat":"1025"}}\n');
      }, 50);
    });
    const result = await client(port).stream('/v2/router/send', { payment_request: 'lnbcrt1' }, (message) =>
      ['SUCCEEDED', 'FAILED'].includes((message as { status: string }).status),
    );
    expect(result).toEqual({ status: 'SUCCEEDED', fee_msat: '1025' });
  });

  it('says when nothing listens, or something other than HTTPS does', async () => {
    const closed = await serve((_method, _url, reply) => {
      reply(200, '{}');
    });
    await new Promise<void>((resolveClose) =>
      server?.close(() => {
        resolveClose();
      }),
    );
    server = undefined;
    await expect(client(closed).get('/v1/getinfo')).rejects.toMatchObject({ failure: 'unreachable' });

    const plain = createHttpServer((_request, response) => {
      response.end('{}');
    });
    await new Promise<void>((resolveListen) => plain.listen(0, '127.0.0.1', resolveListen));
    try {
      const port = (plain.address() as AddressInfo).port;
      await expect(client(port).get('/v1/getinfo')).rejects.toMatchObject({ failure: 'protocol' });
    } finally {
      plain.closeAllConnections();
      await new Promise<void>((resolveClose) =>
        plain.close(() => {
          resolveClose();
        }),
      );
    }
  });
});
