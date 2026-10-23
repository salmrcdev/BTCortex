import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectrumServerStatus, NodeWithStatus } from '@btcortex/contracts';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { WalletsPage } = await import('./wallets-page');

const SERVER: ElectrumServerStatus = {
  nodeId: 'node-1',
  nodeName: 'My Bitcoin node',
  network: 'mainnet',
  state: 'ready',
  enabled: true,
  dataDirectory: 'D:\\BTCortex\\nodes\\mainnet-1-electrum',
  ports: { electrum: 50001, admin: 50100, stats: 50150 },
  indexing: null,
  server: null,
  indexBytes: null,
  connection: {
    host: '127.0.0.1',
    port: 50001,
    protocol: 'tcp',
    server: '127.0.0.1:50001:t',
    url: 'tcp://127.0.0.1:50001',
  },
  remoteAccess: { enabled: false, onion: null },
  runningVersion: '2.1.4',
  pid: 4321,
  startedAt: '2026-10-23T01:00:00.000Z',
  recentLines: [],
};

let servers: ElectrumServerStatus[] = [];
let nodes: NodeWithStatus[] = [runningNode];

beforeEach(() => {
  servers = [];
  nodes = [runningNode];
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'nodes.list':
        return Promise.resolve(nodes);
      case 'electrum.overview':
        return Promise.resolve({ installed: null, servers });
      case 'apps.sparrow.status':
        return Promise.resolve({
          installed: { version: '2.4.2', verifiedAt: '2026-10-22T10:00:00.000Z' },
          running: false,
          settingsFound: true,
          connection: { usesThisNode: true },
        });
      case 'apps.electrum.status':
        return Promise.resolve({
          installed: null,
          application: { version: '4.7.2', directory: 'C:\\Program Files\\Electrum' },
          opens: 'application',
          latest: '4.7.2',
          applicationOutdated: false,
          running: false,
          server: servers.length > 0 ? '127.0.0.1:50001:t' : null,
        });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Wallets', () => {
  it('connects Sparrow to the node itself while there is no Electrum server', async () => {
    await renderPage(<WalletsPage />);
    expect(await screen.findByText(/This node has no Electrum server/)).toBeDefined();
    expect(await screen.findByRole('heading', { name: 'Sparrow Wallet' })).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith('apps.sparrow.status', { nodeId: 'node-1' });
    expect(screen.getByRole('link', { name: 'Open Hardware wallets' }).getAttribute('href')).toBe('/hardware');
    expect(screen.getByText(/set one up for this node first/)).toBeDefined();
  });

  it('uses the Electrum server once it is ready, for Sparrow and the other wallets', async () => {
    servers = [SERVER];
    await renderPage(<WalletsPage />);
    expect(await screen.findByText(/Trezor Suite, Specter, Nunchuk and mobile wallets/)).toBeDefined();
    await vi.waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith('apps.sparrow.status', { nodeId: 'node-1', via: 'electrum' });
    });
    expect(screen.queryByText(/This node has no Electrum server/)).toBeNull();
  });

  it('warns that a Bitcoin Knots node on its own chain shows wallets a chain Bitcoin Core rejects', async () => {
    const snapshot = runningNode.status.snapshot;
    if (!snapshot) throw new Error('The fixture has no snapshot.');
    nodes = [
      {
        ...runningNode,
        profile: { ...runningNode.profile, implementation: 'bitcoin-knots' },
        status: {
          ...runningNode.status,
          snapshot: {
            ...snapshot,
            network: { ...snapshot.network, version: 290402, subversion: '/Satoshi:29.4.2/Knots:20260508/' },
          },
        },
      },
    ];
    await renderPage(<WalletsPage />);
    expect(await screen.findByText(/follows a chain Bitcoin Core rejects/)).toBeDefined();
  });
});
