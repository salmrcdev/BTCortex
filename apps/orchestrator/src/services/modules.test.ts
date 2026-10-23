import { describe, expect, it } from 'vitest';
import type { ElectrumOverview, NodeWithStatus, ServiceState, TorStatus } from '@btcortex/contracts';
import { electrumModule, nodeModule, torModule, torRequirement } from './modules';
import type { ServiceAdapter } from './service-adapter';

const adapter = (id: string): ServiceAdapter => ({
  id,
  status: 'integration-tested',
  level: 'fully-managed',
  capabilities: ['start', 'stop'],
  route: null,
  state: (): Promise<ServiceState> =>
    Promise.resolve({ installed: true, versions: [], running: 0, health: 'unknown', summary: '' }),
});

const node = (id: string, execution: 'managed' | 'external', state: string, initialBlockDownload = false) =>
  ({
    profile: {
      id,
      name: `Node ${id}`,
      implementation: 'bitcoin-core',
      network: 'regtest',
      execution,
      dataDirectory: execution === 'managed' ? `C:\\BTCortex\\nodes\\${id}` : null,
      rpcEndpoint: 'http://127.0.0.1:18443',
      authentication: { kind: execution === 'managed' ? 'cookie' : 'password' },
    },
    status: {
      nodeId: id,
      state,
      checkedAt: '2026-10-23T12:00:00.000Z',
      snapshot: { blockchain: { blocks: 101, initialBlockDownload, verificationProgress: 0.42 } },
    },
  }) as unknown as NodeWithStatus;

describe('the modules BTCortex orchestrates', () => {
  it('reads what a node needs of tor from its routing', () => {
    expect(torRequirement({ mode: 'tor-only', onionService: false })).toMatchObject({ id: 'tor', hard: true });
    expect(torRequirement({ mode: 'off', onionService: true })).toMatchObject({
      hard: true,
      reason: 'publishes its onion service through Tor',
    });
    expect(torRequirement({ mode: 'onion-peers', onionService: false })).toMatchObject({ hard: false });
    expect(torRequirement({ mode: 'off', onionService: false })).toBeNull();
    expect(torRequirement(null)).toBeNull();
  });

  it('offers only what fits a node: lifecycle for those BTCortex runs, nothing for others', async () => {
    const calls: string[] = [];
    const module = nodeModule({
      adapter: adapter('bitcoin-core'),
      implementation: 'bitcoin-core',
      name: 'Bitcoin Core',
      nodes: () => [
        node('a', 'managed', 'running', true),
        node('b', 'external', 'running'),
        node('c', 'managed', 'stopped'),
      ],
      privacy: (nodeId) =>
        nodeId === 'a'
          ? Promise.resolve({ mode: 'all-traffic', onionService: false })
          : Promise.reject(new Error('no file')),
      lifecycle: {
        start: (nodeId) => Promise.resolve(void calls.push(`start ${nodeId}`)),
        stop: (nodeId) => Promise.resolve(void calls.push(`stop ${nodeId}`)),
        restart: (nodeId) => Promise.resolve(void calls.push(`restart ${nodeId}`)),
      },
    });
    const [a, b, c] = await module.instances();
    expect(a).toMatchObject({
      id: 'node:a',
      state: 'running',
      health: 'working',
      summary: 'Synchronising: 42 %, block 101.',
      actions: ['stop', 'restart'],
      requires: [{ id: 'tor', hard: true }],
      logSources: ['node:a:debug', 'node:a:console'],
    });
    expect(b).toMatchObject({ actions: [], requires: [], logSources: [] });
    expect(b?.summary).toMatch(/does not start or stop this node/);
    expect(c).toMatchObject({ state: 'stopped', health: 'inactive', actions: ['start'] });
    await module.run?.('node:c', 'start');
    expect(calls).toEqual(['start c']);
    expect(module.permissions).toContain('processes');
    expect(module.updates).toBe('bitcoin-core');
  });

  it('ties each Electrum server to its node, and to tor when it has an onion service', async () => {
    const calls: string[] = [];
    const module = electrumModule({
      adapter: adapter('fulcrum'),
      overview: () =>
        Promise.resolve({
          installed: null,
          servers: [
            {
              nodeId: 'a',
              nodeName: 'Node a',
              state: 'ready',
              server: { height: 101, clients: 2 },
              remoteAccess: { enabled: true },
            },
            { nodeId: 'b', nodeName: 'Node b', state: 'not-set-up', remoteAccess: { enabled: false } },
            { nodeId: 'c', nodeName: 'Node c', state: 'stopped', remoteAccess: { enabled: false } },
          ],
        } as unknown as ElectrumOverview),
      lifecycle: {
        start: (nodeId) => Promise.resolve(void calls.push(`start ${nodeId}`)),
        stop: (nodeId) => Promise.resolve(void calls.push(`stop ${nodeId}`)),
      },
    });
    const servers = await module.instances();
    expect(servers.map((server) => server.id)).toEqual(['electrum:a', 'electrum:c']);
    expect(servers[0]).toMatchObject({
      state: 'running',
      health: 'healthy',
      actions: ['stop', 'restart'],
      requires: [
        { id: 'node:a', hard: true },
        { id: 'tor', hard: false },
      ],
    });
    expect(servers[1]).toMatchObject({ actions: ['start'], requires: [{ id: 'node:c' }] });
    await module.run?.('electrum:a', 'restart');
    expect(calls).toEqual(['stop a', 'start a']);
  });

  it('offers tor’s lifecycle once it is installed', async () => {
    const status = (state: TorStatus['state'], progress = 100) =>
      ({ state, bootstrap: { progress, summary: '', tag: '' } }) as unknown as TorStatus;
    const make = (current: TorStatus) =>
      torModule({
        adapter: adapter('tor'),
        status: () => Promise.resolve(current),
        lifecycle: { start: () => Promise.resolve(), stop: () => Promise.resolve(), restart: () => Promise.resolve() },
      });
    expect((await make(status('not-installed')).instances())[0]).toMatchObject({ actions: [], health: 'inactive' });
    expect((await make(status('running', 40)).instances())[0]).toMatchObject({
      health: 'working',
      summary: 'Connecting to the Tor network: 40 %.',
      actions: ['stop', 'restart'],
      logSources: ['tor'],
    });
    expect((await make(status('stopped')).instances())[0]?.actions).toEqual(['start']);
  });
});
