import { describe, expect, it } from 'vitest';
import type {
  ElectrumOverview,
  LightningConnectionWithStatus,
  NodePrivacy,
  NodeWithStatus,
  SparrowStatus,
  TorStatus,
} from '@btcortex/contracts';
import { TopologyService } from './topology-service';

function node(options: {
  id: string;
  state: NodeWithStatus['status']['state'];
  endpoint?: string;
  password?: boolean;
  peers?: number;
}): NodeWithStatus {
  return {
    profile: {
      id: options.id,
      name: `Node ${options.id}`,
      implementation: 'bitcoin-core',
      network: 'signet',
      execution: 'managed',
      runtimeVersion: '31.1',
      dataDirectory: 'D:\\Bitcoin',
      rpcEndpoint: options.endpoint ?? 'http://127.0.0.1:38332',
      authentication: options.password
        ? { kind: 'password', username: 'me', secretId: 's1' }
        : { kind: 'cookie', cookieFile: 'D:\\Bitcoin\\signet\\.cookie' },
    },
    status: {
      nodeId: options.id,
      state: options.state,
      checkedAt: '2026-10-23T08:00:00.000Z',
      ...(options.state === 'running'
        ? {
            snapshot: {
              blockchain: { initialBlockDownload: false },
              network: { subversion: '/Satoshi:31.1.0/', connections: options.peers ?? 8, networkActive: true },
            },
          }
        : {}),
    },
  } as unknown as NodeWithStatus;
}

const TOR = {
  state: 'running',
  installed: { version: '15.0.26', torVersion: '0.4.9.14', verifiedAt: '2026-10-01T00:00:00.000Z' },
  bootstrap: { progress: 100 },
  ports: { socks: 9050, applicationSocks: 9052, control: 9054 },
} as unknown as TorStatus;

describe('network topology', () => {
  it('draws the real chain from Sparrow through Fulcrum and the node to Tor, and Lightning beside it', async () => {
    const service = new TopologyService({
      nodes: () => [node({ id: 'a', state: 'running' })],
      privacy: () =>
        Promise.resolve({ mode: 'tor-only', onionService: true, onionAddress: 'abc.onion:38333' } as NodePrivacy),
      tor: () => Promise.resolve(TOR),
      electrum: () =>
        Promise.resolve({
          installed: null,
          servers: [
            {
              nodeId: 'a',
              nodeName: 'Node a',
              state: 'ready',
              runningVersion: '2.1.4',
              ports: { electrum: 60601, admin: 50100, stats: 50150 },
              server: { clients: 2 },
              remoteAccess: { enabled: true, onion: { host: 'xyz.onion' } },
            },
          ],
        } as unknown as ElectrumOverview),
      sparrow: {
        summary: () => Promise.resolve({ installed: '2.3.1', running: true }),
        status: (_nodeId, via) =>
          Promise.resolve({
            installed: { version: '2.3.1' },
            running: true,
            connection: { usesThisNode: via === 'electrum' },
          } as unknown as SparrowStatus),
      },
      lightning: () => [
        {
          connection: {
            id: 'c1',
            name: 'LND',
            restAddress: 'abc.onion:8080',
            via: 'tor',
            macaroon: { access: 'read-only' },
          },
          status: { state: 'ready', alias: 'bob', version: '0.21.4-beta commit=x', activeChannels: 2, peers: 3 },
        } as unknown as LightningConnectionWithStatus,
      ],
      version: '0.1.0',
      now: () => new Date('2026-10-23T08:00:00.000Z'),
    });
    const topology = await service.topology();
    expect(topology.elements.map((element) => `${String(element.layer)}:${element.id}`).sort()).toEqual([
      '0:btcortex',
      '0:sparrow',
      '1:electrum:a',
      '1:lightning:c1',
      '2:node:a',
      '3:tor',
      '4:lightning-network',
      '4:tor-network',
    ]);
    const links = topology.links.map((link) => [
      link.from,
      link.to,
      link.protocol,
      link.port,
      link.protection,
      link.active,
    ]);
    expect(links).toEqual(
      expect.arrayContaining([
        ['btcortex', 'node:a', 'RPC', 38332, 'loopback', true],
        ['node:a', 'tor', 'SOCKS5', 9050, 'loopback', true],
        ['tor', 'tor-network', 'Tor', null, 'tor', true],
        ['tor', 'node:a', 'Onion service', null, 'tor', true],
        ['electrum:a', 'node:a', 'RPC', 38332, 'loopback', true],
        ['tor', 'electrum:a', 'Onion service', 60601, 'tor', true],
        ['sparrow', 'electrum:a', 'Electrum protocol', 60601, 'loopback', true],
        ['btcortex', 'lightning:c1', 'REST', 8080, 'tor', true],
        ['lightning:c1', 'lightning-network', 'Lightning P2P', 9735, 'unknown', true],
      ]),
    );
    // Tor only: the node never reaches the Bitcoin network directly.
    expect(topology.links.some((link) => link.to === 'bitcoin-network')).toBe(false);
    expect(topology.elements.find((element) => element.id === 'electrum:a')?.detail).toBe(
      'Fulcrum 2.1.4 · ready · 2 wallets',
    );
  });

  it('shows direct connections, stopped nodes and passwords sent in clear as they are', async () => {
    const service = new TopologyService({
      nodes: () => [
        node({ id: 'a', state: 'stopped' }),
        node({ id: 'b', state: 'running', endpoint: 'http://192.168.1.20:38332', password: true, peers: 1 }),
      ],
      privacy: () => Promise.reject(new Error('not on this computer')),
      tor: () => Promise.reject(new Error('no tor')),
      electrum: () => Promise.resolve({ installed: null, servers: [] }),
      sparrow: {
        summary: () => Promise.resolve({ installed: null, running: false }),
        status: () => Promise.reject(new Error('not installed')),
      },
      lightning: () => [],
      version: '0.1.0',
    });
    const topology = await service.topology();
    const link = (from: string, protocol: string) =>
      topology.links.find((candidate) => candidate.from === from && candidate.protocol === protocol);
    expect(link('node:a', 'Bitcoin P2P')).toMatchObject({ active: false, port: 38333 });
    expect(topology.elements.find((element) => element.id === 'node:a')?.health).toBe('inactive');
    expect(link('node:b', 'Bitcoin P2P')).toMatchObject({ active: true, detail: '1 peer in all' });
    expect(topology.links.find((candidate) => candidate.to === 'node:b')).toMatchObject({
      protection: 'clear',
      detail: 'Signed in with a password',
    });
    expect(topology.elements.find((element) => element.id === 'bitcoin-network')?.health).toBe('healthy');
    expect(topology.elements.some((element) => element.kind === 'tor')).toBe(false);
  });

  it('draws the I2P router only for nodes that use it, and says when it does not answer', async () => {
    let available = true;
    const service = new TopologyService({
      nodes: () => [node({ id: 'a', state: 'running' }), node({ id: 'b', state: 'running' })],
      privacy: (nodeId) => Promise.resolve({ mode: 'off', onionService: false, i2p: nodeId === 'a' } as NodePrivacy),
      tor: () => Promise.resolve(TOR),
      i2p: () =>
        Promise.resolve({
          available,
          samAddress: '127.0.0.1:7656',
          samVersion: available ? '3.3' : null,
          program: available ? 'i2pd' : null,
          runningWithoutSam: null,
          checkedAt: '2026-10-23T08:00:00.000Z',
          error: null,
        }),
      electrum: () => Promise.resolve({ installed: null, servers: [] }),
      sparrow: {
        summary: () => Promise.resolve({ installed: null, running: false }),
        status: () => Promise.reject(new Error('not installed')),
      },
      lightning: () => [],
      version: '0.1.0',
    });
    const topology = await service.topology();
    expect(topology.elements.find((element) => element.id === 'i2p-router')).toMatchObject({
      layer: 3,
      detail: 'i2pd · SAM 3.3',
      health: 'healthy',
    });
    const links = topology.links.map((link) => [link.from, link.to, link.protocol, link.port, link.protection]);
    expect(links).toEqual(
      expect.arrayContaining([
        ['node:a', 'i2p-router', 'SAM', 7656, 'loopback'],
        ['i2p-router', 'i2p-network', 'I2P', null, 'i2p'],
      ]),
    );
    expect(topology.links.some((link) => link.from === 'node:b' && link.to === 'i2p-router')).toBe(false);

    available = false;
    const without = await service.topology();
    expect(without.elements.find((element) => element.id === 'i2p-router')).toMatchObject({
      detail: 'Not answering',
      health: 'failed',
    });
    expect(without.links.find((link) => link.from === 'node:a' && link.to === 'i2p-router')?.active).toBe(false);
  });
});
