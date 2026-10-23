import { describe, expect, it } from 'vitest';
import { BitcoinRpcError } from '@btcortex/bitcoin-rpc';
import type { BitcoinRpcClient, PeerInfo } from '@btcortex/bitcoin-rpc';
import type { NodeWithStatus } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { banTarget, PeerService } from './peer-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');

function peer(id: number, addr: string, network = 'ipv4'): PeerInfo {
  return {
    id,
    addr,
    network,
    services: '0000000000000c09',
    servicesnames: ['NETWORK', 'WITNESS'],
    relaytxes: true,
    lastsend: 0,
    lastrecv: 0,
    bytessent: 100,
    bytesrecv: 200,
    conntime: 1_761_040_000,
    timeoffset: 0,
    version: 70016,
    subver: '/Satoshi:31.1.0/',
    inbound: false,
    connection_type: 'outbound-full-relay',
    permissions: [],
  };
}

function setUp() {
  let peers: PeerInfo[] = [peer(1, '203.0.113.7:8333'), peer(2, 'abcdefghijklmnop.onion:8333', 'onion')];
  const calls: [string, unknown][] = [];
  let failure: Error | undefined;
  const client = {
    getPeerInfo: () => Promise.resolve(peers),
    getNetworkInfo: () =>
      Promise.resolve({
        networkactive: true,
        connections_in: 0,
        connections_out: 2,
        networks: [
          { name: 'ipv4', limited: false, reachable: true, proxy: '', proxy_randomize_credentials: false },
          {
            name: 'onion',
            limited: false,
            reachable: true,
            proxy: '127.0.0.1:9050',
            proxy_randomize_credentials: true,
          },
        ],
        localaddresses: [],
      }),
    call: (method: string, params?: unknown) => {
      calls.push([method, params]);
      if (failure) return Promise.reject(failure);
      if (method === 'getaddednodeinfo') return Promise.resolve([{ addednode: 'node.example:8333', connected: false }]);
      if (method === 'listbanned') {
        return Promise.resolve([
          { address: '198.51.100.0/24', ban_created: 1_761_000_000, banned_until: 1_761_086_400 },
        ]);
      }
      return Promise.resolve(null);
    },
  } as unknown as BitcoinRpcClient;
  const node = {
    profile: { id: 'node-1', name: 'Home', implementation: 'bitcoin-core' },
    status: { state: 'running' },
  } as NodeWithStatus;
  let now = Date.parse('2026-10-21T12:00:00Z');
  const service = new PeerService({
    nodes: { get: () => node, list: () => [node], rpc: () => client },
    logger,
    now: () => new Date((now += 60_000)),
  });
  return {
    service,
    calls,
    setPeers: (next: PeerInfo[]) => {
      peers = next;
    },
    fail: (error: Error) => {
      failure = error;
    },
  };
}

describe('banTarget', () => {
  it('removes ports and brackets but keeps subnets', () => {
    expect(banTarget('203.0.113.7:8333')).toBe('203.0.113.7');
    expect(banTarget('[2001:db8::1]:8333')).toBe('2001:db8::1');
    expect(banTarget('2001:db8::1')).toBe('2001:db8::1');
    expect(banTarget('abcdefghijklmnop.onion:8333')).toBe('abcdefghijklmnop.onion');
    expect(banTarget('198.51.100.0/24')).toBe('198.51.100.0/24');
  });
});

describe('PeerService', () => {
  it('describes the networks, manual peers and bans', async () => {
    const { service } = setUp();
    expect(await service.network('node-1')).toEqual({
      networkActive: true,
      connectionsIn: 0,
      connectionsOut: 2,
      networks: [
        { name: 'ipv4', reachable: true, limited: false },
        { name: 'onion', reachable: true, limited: false, proxy: '127.0.0.1:9050' },
      ],
      localAddresses: [],
      added: [{ address: 'node.example:8333', connected: false }],
      banned: [{ address: '198.51.100.0/24', bannedUntil: 1_761_086_400, createdAt: 1_761_000_000 }],
    });
  });

  it('records connections and disconnections after a first baseline', async () => {
    const { service, setPeers } = setUp();
    await service.peers('node-1');
    expect(service.history('node-1')).toEqual([]);
    setPeers([peer(2, 'abcdefghijklmnop.onion:8333', 'onion'), peer(3, '192.0.2.4:8333')]);
    await service.peers('node-1');
    const [connected, disconnected] = service.history('node-1');
    expect(connected).toMatchObject({ kind: 'connected', peerId: 3, address: '192.0.2.4:8333' });
    expect(disconnected).toMatchObject({ kind: 'disconnected', peerId: 1, network: 'ipv4' });
    expect(disconnected?.durationSeconds).toBeGreaterThan(0);
  });

  it('bans without the port, and refuses bans that would isolate the node', async () => {
    const { service, calls } = setUp();
    await service.ban('node-1', '203.0.113.7:8333', 86_400);
    expect(calls.at(-1)).toEqual(['setban', ['203.0.113.7', 'add', 86_400]]);
    for (const target of ['127.0.0.1:53000', '[::1]:8333', '0.0.0.0/0', '10.0.0.0/0']) {
      await expect(service.ban('node-1', target, 3600)).rejects.toMatchObject({ error: { code: 'peers.ban-refused' } });
    }
  });

  it('turns Bitcoin Core’s refusals into plain explanations', async () => {
    const { service, fail } = setUp();
    fail(new BitcoinRpcError(-23, 'Error: Node already added', 'addnode'));
    await expect(service.connect('node-1', 'node.example:8333', true)).rejects.toMatchObject({
      error: { code: 'peers.refused', message: 'Node already added', dataRisk: 'none' },
    });
  });
});
