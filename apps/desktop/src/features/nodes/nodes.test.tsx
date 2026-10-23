import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredNode, ElectrumServerStatus, NodeWithStatus, SparrowStatus } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';
import { runningNode, sparrowFixedOnTestnet4, sparrowNotConnected, sparrowUsingPublicServer } from '@/testing/fixtures';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { NodesPage } = await import('./nodes-page');
const { NodeDetailPage } = await import('./node-detail-page');

/** Answers the orchestrator calls a node page makes. */
function respondWith(node: NodeWithStatus, sparrow: SparrowStatus = sparrowNotConnected) {
  return (method: string) => {
    switch (method) {
      case 'nodes.get':
        return Promise.resolve(node);
      case 'nodes.peers':
        return Promise.resolve([]);
      case 'apps.sparrow.status':
        return Promise.resolve(sparrow);
      case 'apps.sparrow.connect':
        return Promise.resolve({ jobId: 'job-sparrow' });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  };
}

beforeEach(() => {
  callOrchestrator.mockReset();
});

describe('NodesPage', () => {
  it('explains what a node is and offers set-up when none exists', async () => {
    callOrchestrator.mockResolvedValue([]);
    await renderPage(<NodesPage />);
    expect(await screen.findByText('No node yet')).toBeDefined();
    const setUp = screen.getByRole('link', { name: /Set up Bitcoin Core/ });
    expect(setUp.getAttribute('href')).toContain('/nodes/setup');
  });

  it('summarises each node with its network, state and progress', async () => {
    callOrchestrator.mockResolvedValue([runningNode]);
    await renderPage(<NodesPage />);
    const card = await screen.findByRole('link', { name: 'Open My Bitcoin node' });
    expect(within(card).getByText('Mainnet')).toBeDefined();
    expect(within(card).getByText('Synchronising')).toBeDefined();
    expect(within(card).getByText('612,345')).toBeDefined();
    expect(within(card).getByRole('progressbar', { name: 'Verification progress' }).getAttribute('aria-valuenow')).toBe(
      '42.2',
    );
  });
});

describe('Bitcoin Core found on this computer', () => {
  const found: DiscoveredNode[] = [
    {
      dataDirectory: 'C:\\Users\\Dev\\AppData\\Roaming\\Bitcoin',
      network: 'mainnet',
      source: 'roaming-app-data',
      running: true,
      hasChainData: true,
      walletFiles: 2,
      program: 'bitcoind',
      rpcServer: 'on',
      rpcEndpoint: 'http://127.0.0.1:8332',
      authentication: 'cookie',
    },
    {
      dataDirectory: 'D:\\Bitcoin',
      network: 'testnet4',
      source: 'registry',
      running: true,
      hasChainData: true,
      walletFiles: 0,
      program: 'bitcoin-qt',
      rpcServer: 'off',
      rpcEndpoint: 'http://127.0.0.1:48332',
      authentication: 'cookie',
    },
    {
      dataDirectory: 'E:\\Bitcoin',
      network: 'signet',
      source: 'registry',
      running: true,
      hasChainData: false,
      walletFiles: 0,
      program: 'bitcoind',
      rpcServer: 'on',
      rpcEndpoint: 'http://127.0.0.1:38332',
      authentication: 'password-in-config',
    },
    {
      dataDirectory: 'F:\\Bitcoin',
      network: 'regtest',
      source: 'registry',
      running: true,
      hasChainData: true,
      walletFiles: 0,
      program: 'bitcoind',
      rpcServer: 'on',
      rpcEndpoint: 'http://127.0.0.1:18443',
      authentication: 'cookie',
      registeredAs: 'node-9',
    },
  ];

  beforeEach(() => {
    callOrchestrator.mockImplementation((method: string) => {
      switch (method) {
        case 'nodes.list':
          return Promise.resolve([]);
        case 'nodes.discover':
          return Promise.resolve(found);
        case 'nodes.connectDiscovered':
          return Promise.resolve(runningNode.profile);
        default:
          return Promise.reject(new Error(`unexpected ${method}`));
      }
    });
  });

  it('connects a running node with one click, using what BTCortex found itself', async () => {
    const user = userEvent.setup();
    await renderPage(<NodesPage />);
    expect(await screen.findByRole('heading', { name: 'Found on this computer' })).toBeDefined();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    const [mainnet] = cards;
    if (!mainnet) throw new Error('Expected a card for the mainnet node.');
    expect(within(mainnet).getByText('2 wallet files', { exact: false })).toBeDefined();
    await user.click(within(mainnet).getByRole('button', { name: 'Connect' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'nodes.connectDiscovered',
      {
        dataDirectory: 'C:\\Users\\Dev\\AppData\\Roaming\\Bitcoin',
        network: 'mainnet',
        name: 'Bitcoin Core (Mainnet)',
        useConfiguredPassword: false,
      },
      { timeoutMs: 60_000 },
    );
  });

  it('explains what is missing instead of failing', async () => {
    const user = userEvent.setup();
    await renderPage(<NodesPage />);
    const [, window, withPassword] = await screen.findAllByRole('listitem');
    if (!window || !withPassword) throw new Error('Expected three cards.');
    expect(within(window).getByText('Running in Bitcoin Core’s window')).toBeDefined();
    expect(within(window).getByText(/tick “Enable RPC server”/)).toBeDefined();
    expect(within(window).getByRole('button', { name: 'Connect' })).toHaveProperty('disabled', true);

    await user.click(within(withPassword).getByRole('button', { name: 'Connect using its configured password' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'nodes.connectDiscovered',
      expect.objectContaining({ network: 'signet', useConfiguredPassword: true }),
      { timeoutMs: 60_000 },
    );
  });
});

describe('A node on another computer', () => {
  beforeEach(() => {
    callOrchestrator.mockImplementation((method: string) => {
      switch (method) {
        case 'nodes.list':
          return Promise.resolve([]);
        case 'nodes.discover':
          return Promise.resolve([]);
        case 'nodes.connectExisting':
          return Promise.resolve(runningNode.profile);
        default:
          return Promise.reject(new Error(`unexpected ${method}`));
      }
    });
  });

  it('tests and connects it with an RPC user name and password', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage(<NodesPage />);
    await user.click(await screen.findByRole('button', { name: 'Connect a node on another computer' }));
    await user.type(screen.getByLabelText('Name'), 'Home server');
    await user.selectOptions(screen.getByLabelText('Network'), 'signet');
    expect(screen.getByPlaceholderText('http://192.168.1.20:38332')).toBeDefined();
    await user.type(screen.getByLabelText('RPC address'), 'http://192.168.1.20:38332/');
    await user.type(screen.getByLabelText('RPC user name'), 'monitor');
    await user.type(screen.getByLabelText('RPC password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Test and connect' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'nodes.connectExisting',
      {
        name: 'Home server',
        network: 'signet',
        rpcEndpoint: 'http://192.168.1.20:38332',
        authentication: { kind: 'password', username: 'monitor', password: 'correct horse' },
      },
      { timeoutMs: 60_000 },
    );
    expect(router.state.location.pathname).toBe(`/nodes/${runningNode.profile.id}`);
  });

  it('keeps the button off until the address is a web address and every field is filled', async () => {
    const user = userEvent.setup();
    await renderPage(<NodesPage />);
    await user.click(await screen.findByRole('button', { name: 'Connect a node on another computer' }));
    await user.type(screen.getByLabelText('Name'), 'Home server');
    await user.type(screen.getByLabelText('RPC address'), '192.168.1.20:8332');
    await user.type(screen.getByLabelText('RPC user name'), 'monitor');
    await user.type(screen.getByLabelText('RPC password'), 'secret');
    expect(screen.getByRole('button', { name: 'Test and connect' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('RPC address').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('NodeDetailPage', () => {
  beforeEach(() => {
    callOrchestrator.mockImplementation(respondWith(runningNode));
  });

  it('shows synchronisation figures with the estimate labelled as an estimate', async () => {
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    expect(await screen.findByRole('heading', { name: 'My Bitcoin node' })).toBeDefined();
    expect(screen.getByText('Estimate: about 5 h 20 min')).toBeDefined();
    expect(screen.getByText('42.17%')).toBeDefined();
    expect(screen.getByText(/keeps about 19.5 GiB of recent blocks/)).toBeDefined();
    // The mempool view never claims to represent the whole network.
    expect(screen.getByText(/not a view of the whole network/)).toBeDefined();
    expect(screen.getByRole('meter', { name: 'Memory used' })).toBeDefined();
  });

  it('asks for confirmation before stopping the node', async () => {
    const user = userEvent.setup();
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Stop My Bitcoin node?')).toBeDefined();
    expect(within(dialog).getByText('Mainnet')).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('nodes.stop', expect.anything());

    await user.click(within(dialog).getByRole('button', { name: 'Stop node' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.stop', { nodeId: 'node-1', confirmed: true });
  });

  it('does not claim a size for a node pruned by hand, which has none', async () => {
    const snapshot = runningNode.status.snapshot;
    if (!snapshot) throw new Error('The fixture has a snapshot.');
    const { pruneTargetBytes: _target, ...blockchain } = snapshot.blockchain;
    callOrchestrator.mockImplementation(
      respondWith({ ...runningNode, status: { ...runningNode.status, snapshot: { ...snapshot, blockchain } } }),
    );
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    expect(await screen.findByText(/old blocks are deleted only when asked to/)).toBeDefined();
    expect(screen.queryByText(/keeps about/)).toBeNull();
  });

  it('marks values as stale when the node stops answering', async () => {
    callOrchestrator.mockImplementation(
      respondWith({
        ...runningNode,
        status: { ...runningNode.status, state: 'unreachable', checkedAt: '2026-10-21T10:05:00.000Z' },
      }),
    );
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    expect(await screen.findByText(/Showing the last known values/)).toBeDefined();
    expect(screen.getByText('Unreachable')).toBeDefined();
  });

  it('never offers to stop a node BTCortex did not set up, such as one on another computer', async () => {
    callOrchestrator.mockImplementation(
      respondWith({ ...runningNode, profile: { ...runningNode.profile, execution: 'external' } }),
    );
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    expect((await screen.findAllByText('My Bitcoin node')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('offers to stop, never to remove, a managed node whose bitcoind runs without answering', async () => {
    callOrchestrator.mockImplementation(
      respondWith({
        ...runningNode,
        status: {
          ...runningNode.status,
          state: 'unreachable',
          processRunning: true,
          checkedAt: '2026-10-21T10:05:00.000Z',
        },
      }),
    );
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
  });

  it('says before removing a node that its Electrum server goes with it, and where the index stays', async () => {
    const external: NodeWithStatus = { ...runningNode, profile: { ...runningNode.profile, execution: 'external' } };
    const server: ElectrumServerStatus = {
      nodeId: 'node-1',
      nodeName: 'My Bitcoin node',
      network: 'mainnet',
      state: 'ready',
      enabled: true,
      dataDirectory: 'D:\\Bitcoin-electrum',
      ports: { electrum: 50001, admin: 50100, stats: 50150 },
      indexing: null,
      server: null,
      indexBytes: 180e9,
      connection: null,
      // Access through Tor is off, but the address is kept for when it is turned on again.
      remoteAccess: { enabled: false, onion: null, addressKept: true },
      runningVersion: '2.1.4',
      pid: 4321,
      startedAt: '2026-10-23T01:00:00.000Z',
      recentLines: [],
    };
    const answer = respondWith(external);
    callOrchestrator.mockImplementation((method: string) => {
      if (method === 'electrum.overview') return Promise.resolve({ installed: null, servers: [server] });
      if (method === 'nodes.remove') {
        return Promise.resolve({ removed: true, dataDirectoryKept: null, electrumIndexKept: 'D:\\Bitcoin-electrum' });
      }
      return answer(method);
    });
    const user = userEvent.setup();
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    await user.click(await screen.findByRole('button', { name: /Remove/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Mainnet')).toBeDefined();
    expect(await within(dialog).findByText(/Its Electrum server is removed with it/)).toBeDefined();
    expect(within(dialog).getByText(/Its onion address is withdrawn for good/)).toBeDefined();
    expect(within(dialog).getByText(/it stays in D:\\Bitcoin-electrum/)).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'nodes.remove',
      { nodeId: 'node-1', confirmed: true },
      { timeoutMs: 120_000 },
    );
  });
});

describe('Sparrow on the node page', () => {
  it('connects Sparrow with one action and explains the pruning limit', async () => {
    const user = userEvent.setup();
    callOrchestrator.mockImplementation(respondWith(runningNode));
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    expect(await screen.findByText(/Sparrow can find transactions only from the blocks it still has/)).toBeDefined();
    expect(screen.getByText(/Sparrow is not installed yet/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Use Sparrow with this node' }));
    expect(callOrchestrator).toHaveBeenCalledWith('apps.sparrow.connect', {
      nodeId: 'node-1',
      replaceExistingServer: false,
      resetStartupNetwork: false,
    });
  });

  it('asks before replacing a server the user chose', async () => {
    const user = userEvent.setup();
    callOrchestrator.mockImplementation(respondWith(runningNode, sparrowUsingPublicServer));
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    await user.click(await screen.findByRole('button', { name: 'Use Sparrow with this node' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/ssl:\/\/electrum\.blockstream\.info:50002/)).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('apps.sparrow.connect', expect.anything());
    await user.click(within(dialog).getByRole('button', { name: 'Use this node' }));
    expect(callOrchestrator).toHaveBeenCalledWith('apps.sparrow.connect', {
      nodeId: 'node-1',
      replaceExistingServer: true,
      resetStartupNetwork: false,
    });
  });

  it('asks before changing the network Sparrow always starts on', async () => {
    const user = userEvent.setup();
    callOrchestrator.mockImplementation(respondWith(runningNode, sparrowFixedOnTestnet4));
    await renderPage(<NodeDetailPage nodeId="node-1" />);
    await user.click(await screen.findByRole('button', { name: 'Use Sparrow with this node' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'Sparrow is set to always start on Testnet4. It will start on Mainnet for this node instead.',
      ),
    ).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Use this node' }));
    expect(callOrchestrator).toHaveBeenCalledWith('apps.sparrow.connect', {
      nodeId: 'node-1',
      replaceExistingServer: false,
      resetStartupNetwork: true,
    });
  });
});
