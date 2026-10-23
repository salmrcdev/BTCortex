import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LightningConnectionWithStatus,
  NodeWithStatus,
  PaymentServerWithStatus,
  RemoteExplorerWithStatus,
} from '@btcortex/contracts';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { RemotePage, hostOf, reachOf } = await import('./remote-page');

const ONION = `${'b'.repeat(56)}.onion`;

const remoteNode: NodeWithStatus = {
  ...runningNode,
  profile: {
    ...runningNode.profile,
    id: 'n2',
    name: 'Home server',
    execution: 'external',
    runtimeVersion: null,
    dataDirectory: null,
    rpcEndpoint: 'http://192.168.1.20:8332',
  },
};

const lightning = (id: string, restAddress: string, local: boolean): LightningConnectionWithStatus =>
  ({
    connection: {
      id,
      name: local ? 'Local LND' : 'Remote LND',
      implementation: 'lnd',
      restAddress,
      via: restAddress.includes('.onion') ? 'tor' : 'direct',
      certificateFingerprint: null,
      certificateExpiresAt: null,
      macaroon: { access: 'read-only', permissions: [], caveats: [] },
      local,
      createdAt: '2026-10-22T08:00:00.000Z',
    },
    status: { connectionId: id, state: 'ready', alias: 'bob', checkedAt: '2026-10-23T12:00:00.000Z' },
  }) as unknown as LightningConnectionWithStatus;

const shop: PaymentServerWithStatus = {
  server: {
    id: 'p1',
    kind: 'btcpay',
    name: 'Shop',
    url: 'https://pay.example.com',
    via: 'direct',
    addedAt: '2026-10-22T08:00:00.000Z',
  },
  status: {
    serverId: 'p1',
    state: 'online',
    checkedAt: '2026-10-23T12:00:00.000Z',
    version: '2.4.5',
    onion: null,
    chains: [],
    error: null,
    unreachableSince: null,
  },
};

// A mempool instance on the same computer as the node: both go in one card.
const homeExplorer: RemoteExplorerWithStatus = {
  explorer: {
    id: 'x1',
    name: 'Home mempool',
    url: 'http://192.168.1.20:3006',
    apiUrl: 'http://192.168.1.20:3006/api',
    kind: 'mempool',
    via: 'direct',
    network: 'mainnet',
    nodeId: null,
    addedAt: '2026-10-23T12:00:00.000Z',
  },
  status: {
    state: 'online',
    network: 'mainnet',
    height: 968_000,
    blocksBehind: null,
    checkedAt: '2026-10-23T12:00:00.000Z',
    error: null,
    unreachableSince: null,
  },
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'nodes.list':
        return Promise.resolve([runningNode, remoteNode]);
      case 'lightning.list':
        return Promise.resolve([lightning('c1', `${ONION}:8080`, false), lightning('c2', '127.0.0.1:8080', true)]);
      case 'payments.list':
        return Promise.resolve([shop]);
      case 'electrum.remote.list':
        return Promise.resolve([]);
      case 'explorers.remote.list':
        return Promise.resolve([homeExplorer]);
      case 'remote.test':
        return Promise.resolve(
          params['kind'] === 'bitcoin-node'
            ? {
                ok: true,
                latencyMs: 12,
                detail: 'Answered as /Satoshi:31.1.0/ with 10 peers.',
                testedAt: '2026-10-23T12:00:00.000Z',
              }
            : { ok: false, latencyMs: null, detail: 'Nothing answers.', testedAt: '2026-10-23T12:00:00.000Z' },
        );
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Remote infrastructure', () => {
  it('groups the services on other computers by computer, with how each is reached and what BTCortex may do', async () => {
    await renderPage(<RemotePage />);
    const home = (await screen.findByRole('heading', { name: '192.168.1.20' })).closest('section');
    if (!home) throw new Error('The host card is missing.');
    expect(within(home).getByText('Local network')).toBeDefined();
    expect(within(home).getByRole('link', { name: 'Home server' })).toBeDefined();
    expect(within(home).getByText(/BTCortex cannot start, stop or reconfigure it/)).toBeDefined();
    expect(within(home).getByRole('link', { name: 'Home mempool' })).toBeDefined();
    expect(within(home).getByText('Block explorer')).toBeDefined();
    expect(within(home).getByText(/Its Esplora API, which needs no credentials/)).toBeDefined();
    const onion = screen.getByRole('heading', { name: ONION }).closest('section');
    if (!onion) throw new Error('The onion host card is missing.');
    expect(within(onion).getByText('Through Tor')).toBeDefined();
    expect(within(onion).getByText(/A read-only macaroon/)).toBeDefined();
    const internet = screen.getByRole('heading', { name: 'pay.example.com' }).closest('section');
    if (!internet) throw new Error('The BTCPay host card is missing.');
    expect(within(internet).getByText('Over the internet')).toBeDefined();
    // What runs on this computer is not remote.
    expect(screen.queryByRole('link', { name: 'My Bitcoin node' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Local LND' })).toBeNull();
    expect(screen.getByText(/does not log in to other computers/)).toBeDefined();
  });

  it('tests a connection and reports the round trip or the failure', async () => {
    const user = userEvent.setup();
    await renderPage(<RemotePage />);
    const home = (await screen.findByRole('heading', { name: '192.168.1.20' })).closest('section');
    if (!home) throw new Error('The host card is missing.');
    // The node first, then the explorer on the same computer.
    const [nodeTest, explorerTest] = within(home).getAllByRole('button', { name: 'Test the connection' });
    if (!nodeTest || !explorerTest) throw new Error('A test button is missing.');
    await user.click(nodeTest);
    expect(callOrchestrator).toHaveBeenCalledWith(
      'remote.test',
      { kind: 'bitcoin-node', id: 'n2' },
      { timeoutMs: 90_000 },
    );
    expect(await within(home).findByText('Answered in 12 ms')).toBeDefined();
    await user.click(explorerTest);
    expect(callOrchestrator).toHaveBeenCalledWith('remote.test', { kind: 'explorer', id: 'x1' }, { timeoutMs: 90_000 });
    const internet = screen.getByRole('heading', { name: 'pay.example.com' }).closest('section');
    if (!internet) throw new Error('The BTCPay host card is missing.');
    await user.click(within(internet).getByRole('button', { name: 'Test the connection' }));
    expect(await within(internet).findByText('No answer')).toBeDefined();
    expect(within(internet).getByText('Nothing answers.')).toBeDefined();
  });

  it('works out hosts and how they are reached', () => {
    expect(hostOf('http://192.168.1.20:8332')).toBe('192.168.1.20');
    expect(hostOf('[fd00::5]:8080')).toBe('fd00::5');
    expect(hostOf('Node.Example:10009')).toBe('node.example');
    expect(reachOf(ONION)).toBe('tor');
    expect(reachOf('10.0.0.5')).toBe('local-network');
    expect(reachOf('pay.example.com')).toBe('internet');
  });
});
