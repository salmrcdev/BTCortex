import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo, Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { NodeConfigDocument, NodeWithStatus } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { containsPrivateKey, DevToolsService } from './devtools-service';

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function node(network: string, implementation = 'bitcoin-core'): NodeWithStatus {
  return {
    profile: { id: 'n1', name: 'Test node', implementation, network, execution: 'managed', runtimeVersion: '31.1' },
    status: { nodeId: 'n1', state: 'running', checkedAt: '2026-10-23T08:00:00.000Z' },
  } as unknown as NodeWithStatus;
}

function setUp(
  answers: Record<string, (params: unknown[]) => unknown>,
  options: { network?: string; config?: string; implementation?: string } = {},
) {
  const calls: [string, unknown[]][] = [];
  const service = new DevToolsService({
    nodes: {
      get: () => node(options.network ?? 'regtest', options.implementation),
      rpc: () => ({
        call: <T>(method: string, params: unknown[] | Record<string, unknown>) => {
          const list = Array.isArray(params) ? params : [];
          calls.push([method, list]);
          const answer = answers[method];
          if (!answer) return Promise.reject(new Error(`Method not found: ${method}`));
          return Promise.resolve(answer(list) as T);
        },
      }),
    },
    config: {
      get: () =>
        Promise.resolve({
          path: 'D:\\node\\bitcoin.conf',
          exists: options.config !== undefined,
          editable: true,
          text: options.config ?? '',
          revision: 'r',
          restartRequired: false,
          commandLine: [],
        } satisfies NodeConfigDocument),
    },
    socksPort: () => undefined,
    logger: new StructuredLogger([new MemorySink()], 'debug'),
  });
  return { service, calls };
}

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe('private keys', () => {
  it('spots extended and WIF private keys, and leaves public keys and addresses alone', () => {
    expect(
      containsPrivateKey(
        'wpkh(xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi/0/*)',
      ),
    ).toBe(true);
    expect(containsPrivateKey('combo(L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1)')).toBe(true);
    expect(containsPrivateKey('pkh(5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ)')).toBe(true);
    expect(
      containsPrivateKey(
        'wpkh([d34db33f/84h/0h/0h]xpub6DJ2dNUysrn5Vt36jH2KLBT2i1auw1tTSSomg8PhqNiUtx8QX2SvC9nrHu81fT41fvDUnhMjEzQgXnQjKEu3oaqMSzhSrHMxyyoEAmUHQbY/0/*)',
      ),
    ).toBe(false);
    expect(containsPrivateKey('addr(1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2)')).toBe(false);
    expect(containsPrivateKey('addr(bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq)')).toBe(false);
  });
});

describe('developer tools', () => {
  it('sums up a PSBT the node decoded and analysed', async () => {
    const { service, calls } = setUp({
      decodepsbt: () => ({
        tx: {
          txid: 'aa'.repeat(32),
          version: 2,
          locktime: 0,
          vin: [{ txid: 'bb'.repeat(32), vout: 1 }],
          vout: [{ value: 0.5, scriptPubKey: { address: 'bcrt1qpayee', hex: '0014aa' } }],
        },
        inputs: [{ witness_utxo: { amount: 0.5001 } }],
        fee: 0.0001,
      }),
      analyzepsbt: () => ({
        inputs: [{ has_utxo: true, is_final: false, missing: { signatures: ['ab'] }, next: 'signer' }],
        estimated_vsize: 110,
        estimated_feerate: 0.00090909,
        fee: 0.0001,
        next: 'signer',
      }),
    });
    const hex = Buffer.from('psbt\xff', 'latin1').toString('hex') + '0000';
    const analysis = await service.psbt('n1', hex);
    // A hexadecimal PSBT is passed to the node as base64.
    expect(calls[0]?.[1][0]).toBe(Buffer.from(hex, 'hex').toString('base64'));
    expect(analysis).toMatchObject({
      txid: 'aa'.repeat(32),
      inputs: [
        {
          outpoint: `${'bb'.repeat(32)}:1`,
          amountSats: 50_010_000,
          final: false,
          missing: ['1 signature(s)'],
          next: 'signer',
        },
      ],
      outputs: [{ address: 'bcrt1qpayee', amountSats: 50_000_000 }],
      feeSats: 10_000,
      estimatedVsize: 110,
      estimatedFeeRateSatPerVb: 90.91,
      next: 'signer',
    });
    await expect(service.psbt('n1', 'not a psbt at all')).rejects.toThrow(/This is not a PSBT/);
  });

  it('checks descriptors and derives addresses, refusing private keys before the node sees them', async () => {
    const { service, calls } = setUp({
      getdescriptorinfo: () => ({
        descriptor: 'wpkh(tpubD6NzVbkrYhZ4X/0/*)#abcdefgh',
        checksum: 'abcdefgh',
        isrange: true,
        issolvable: true,
        hasprivatekeys: false,
      }),
      deriveaddresses: (params) => {
        const [from, to] = params[1] as [number, number];
        return Array.from({ length: to - from + 1 }, (_, index) => `bcrt1qaddress${String(index)}`);
      },
    });
    const analysis = await service.descriptor('n1', 'wpkh(tpubD6NzVbkrYhZ4X/0/*)', 3);
    expect(analysis).toMatchObject({ checksum: 'abcdefgh', isRange: true, addressesError: null });
    expect(analysis.addresses).toEqual([
      { index: 0, address: 'bcrt1qaddress0' },
      { index: 1, address: 'bcrt1qaddress1' },
      { index: 2, address: 'bcrt1qaddress2' },
    ]);
    calls.length = 0;
    await expect(
      service.descriptor(
        'n1',
        'wpkh(tprv8ZgxMBicQKsPd7Uf69XL1XwhmjHopUGep8GuEiJDZmbQz6o58LninorQAfcKZWARbtRtfnLcJ5MQ2AtHcQJCCRUcMRvmDUjyEmNUWwx8UbK/0/*)',
        3,
      ),
    ).rejects.toThrow(/never handles private keys/);
    expect(calls).toEqual([]);
  });

  it('generates blocks on regtest only, to an anyone-can-spend output unless given an address', async () => {
    const { service, calls } = setUp({
      getdescriptorinfo: () => ({
        descriptor: 'raw(51)#8lvh9jxk',
        checksum: '8lvh9jxk',
        isrange: false,
        issolvable: true,
        hasprivatekeys: false,
      }),
      generatetodescriptor: (params) =>
        Array.from({ length: params[0] as number }, (_, index) => `hash${String(index)}`),
      getblockcount: () => 102,
    });
    expect(await service.mine('n1', 2, undefined)).toEqual({ hashes: ['hash0', 'hash1'], height: 102 });
    expect(calls.find(([method]) => method === 'generatetodescriptor')?.[1]).toEqual([2, 'raw(51)#8lvh9jxk']);
    const signet = setUp({}, { network: 'signet' });
    await expect(signet.service.mine('n1', 1, undefined)).rejects.toThrow(/only on regtest/);
  });

  it('lists a node’s protocol features by kind of rule, from what the node reports', async () => {
    const answers = {
      getnetworkinfo: () => ({
        version: 310100,
        subversion: '/Satoshi:31.1.0/',
        localservicesnames: ['NETWORK', 'WITNESS', 'P2P_V2'],
      }),
      getdeploymentinfo: () => ({ deployments: { taproot: { type: 'buried', active: true, height: 709_632 } } }),
      getindexinfo: () => ({ txindex: { synced: true } }),
      getchainstates: () => ({ chainstates: [{}] }),
    };
    const { service } = setUp(answers, { config: 'privatebroadcast=1\n' });
    const { features, version } = await service.features('n1');
    expect(version).toBe('31.1.0');
    const feature = (id: string) => features.find((candidate) => candidate.id === id);
    expect(feature('deployment.taproot')).toMatchObject({
      category: 'consensus',
      state: 'on',
      detail: 'Active since block 709,632 (buried deployment).',
    });
    expect(feature('bip324')).toMatchObject({ category: 'implementation', state: 'on' });
    expect(feature('compact-filters')?.state).toBe('off');
    expect(feature('txindex')?.state).toBe('on');
    expect(feature('cluster-mempool')).toMatchObject({ category: 'relay-policy', state: 'on' });
    expect(feature('private-broadcast')?.state).toBe('on');
    expect(feature('ipc-mining')).toMatchObject({ category: 'experimental', state: 'unavailable' });
    expect(new Set(features.map((candidate) => candidate.category))).toEqual(
      new Set(['consensus', 'relay-policy', 'wallet-policy', 'experimental', 'implementation']),
    );

    const knots = setUp(
      {
        ...answers,
        getnetworkinfo: () => ({
          version: 290100,
          subversion: '/Satoshi:29.1.0/Knots:20250903/',
          localservicesnames: [],
        }),
      },
      { implementation: 'bitcoin-knots' },
    );
    const knotsFeatures = (await knots.service.features('n1')).features;
    expect(knotsFeatures.find((candidate) => candidate.id === 'cluster-mempool')?.state).toBe('unavailable');
    expect(knotsFeatures.find((candidate) => candidate.id === 'op-return')?.detail).toBe(
      'Bitcoin Knots relays at most 83 bytes by default.',
    );
  });

  it('probes endpoints: an Electrum server, a web server, an RPC interface, a closed port', async () => {
    const { service } = setUp({});
    const electrumPort = await listen(
      createServer((socket) => {
        socket.on('data', () => {
          socket.write(`${JSON.stringify({ id: 1, result: ['Fulcrum 2.1.4', '1.4'] })}\n`);
        });
      }),
    );
    const electrum = await service.probe({
      kind: 'electrum',
      host: '127.0.0.1',
      port: electrumPort,
      tls: false,
      viaTor: false,
    });
    expect(electrum.reachable).toBe(true);
    expect(electrum.answer).toContain('Fulcrum 2.1.4');
    expect(electrum.steps.map((step) => [step.name, step.ok])).toEqual([
      ['Connection', true],
      ['Answer', true],
    ]);

    const web = createHttpServer((request, response) => {
      response.writeHead(request.method === 'POST' ? 401 : 200, { Server: 'test' });
      response.end('ok');
    });
    servers.push(web);
    const webPort = await new Promise<number>((resolve) => {
      web.listen(0, '127.0.0.1', () => {
        resolve((web.address() as AddressInfo).port);
      });
    });
    const http = await service.probe({
      kind: 'http',
      host: 'localhost',
      port: webPort,
      tls: false,
      viaTor: false,
      path: '/status',
    });
    expect(http.steps[0]?.name).toBe('Name lookup');
    expect(http.steps.at(-1)?.detail).toBe('The server answered HTTP/1.1 200 OK.');
    const rpc = await service.probe({
      kind: 'bitcoin-rpc',
      host: '127.0.0.1',
      port: webPort,
      tls: false,
      viaTor: false,
    });
    expect(rpc.steps.at(-1)?.detail).toBe(
      'Bitcoin Core’s RPC interface answered and asks for credentials (none were sent).',
    );

    const closed = await listen(createServer());
    servers.pop()?.close();
    const refused = await service.probe({ kind: 'tcp', host: '127.0.0.1', port: closed, tls: false, viaTor: false });
    expect(refused.reachable).toBe(false);
    expect(refused.steps[0]).toMatchObject({ name: 'Connection', ok: false });

    await expect(
      service.probe({ kind: 'tcp', host: 'abcdefghijklmnop.onion', port: 80, tls: false, viaTor: false }),
    ).rejects.toThrow(/through Tor/);
  });
});
