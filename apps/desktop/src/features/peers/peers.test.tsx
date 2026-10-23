import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkOverview, NodeWithStatus, PeerSummary } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';
import { runningNode } from '@/testing/fixtures';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { PeersPage } = await import('./peers-page');

const basePeer: PeerSummary = {
  id: 7,
  address: '203.0.113.7:8333',
  network: 'ipv4',
  inbound: false,
  connectionType: 'outbound-full-relay',
  transport: 'v2',
  userAgent: '/Satoshi:31.1.0/',
  protocolVersion: 70016,
  services: ['NETWORK', 'WITNESS'],
  pingSeconds: 0.042,
  bytesSent: 1000,
  bytesReceived: 2000,
  connectedSince: 1_761_040_000,
  relaysTransactions: true,
  permissions: [],
};

const PEERS: PeerSummary[] = [
  basePeer,
  {
    ...basePeer,
    id: 8,
    address: '127.0.0.1:52000',
    network: 'onion',
    inbound: true,
    connectionType: 'inbound',
    transport: 'v1',
  },
];

const NETWORK: NetworkOverview = {
  networkActive: true,
  connectionsIn: 1,
  connectionsOut: 1,
  networks: [
    { name: 'ipv4', reachable: true, limited: false },
    { name: 'onion', reachable: true, limited: false, proxy: '127.0.0.1:9050' },
    { name: 'i2p', reachable: false, limited: false },
  ],
  localAddresses: [],
  added: [],
  banned: [{ address: '198.51.100.0/24', bannedUntil: 1_761_086_400, createdAt: 1_761_000_000 }],
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'nodes.peers':
        return Promise.resolve(PEERS);
      case 'nodes.network':
        return Promise.resolve(NETWORK);
      case 'nodes.peers.history':
        return Promise.resolve([]);
      default:
        return method.startsWith('nodes.peers.')
          ? Promise.resolve({ done: true })
          : Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Network & peers', () => {
  it('shows which networks are reachable and how peers are connected', async () => {
    await renderPage(<PeersPage node={runningNode} />);
    expect(await screen.findByText('Through 127.0.0.1:9050')).toBeDefined();
    expect(screen.getByText(/does not accept incoming ones/)).toBeDefined();
    const table = await screen.findByRole('table', { name: /Locations are never guessed/ });
    expect(within(table).getByText('Encrypted (v2)')).toBeDefined();
    expect(within(table).getByText('Unencrypted (v1)')).toBeDefined();
    // Incoming Tor peers arrive from 127.0.0.1: banning that would block all of them.
    expect(within(table).getByRole('button', { name: 'Ban 127.0.0.1:52000' })).toHaveProperty('disabled', true);
  });

  it('disconnects and bans peers only after confirmation', async () => {
    const user = userEvent.setup();
    await renderPage(<PeersPage node={runningNode} />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect 203.0.113.7:8333' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.peers.disconnect', { nodeId: 'node-1', peerId: 7 });

    await user.click(screen.getByRole('button', { name: 'Ban 203.0.113.7:8333' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.selectOptions(within(dialog).getByLabelText('For'), 'week');
    await user.click(within(dialog).getByRole('button', { name: 'Ban' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.peers.ban', {
      nodeId: 'node-1',
      target: '203.0.113.7:8333',
      durationSeconds: 7 * 86_400,
      confirmed: true,
    });
  });

  it('adds manual connections and lifts bans', async () => {
    const user = userEvent.setup();
    await renderPage(<PeersPage node={runningNode} />);
    await user.type(await screen.findByLabelText('Address'), 'node.example:8333');
    await user.click(screen.getByRole('button', { name: 'Keep connected' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.peers.connect', {
      nodeId: 'node-1',
      address: 'node.example:8333',
      keep: true,
    });
    await user.click(await screen.findByRole('button', { name: 'Lift ban' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.peers.unban', { nodeId: 'node-1', target: '198.51.100.0/24' });
  });

  it('explains that peers appear once the node runs', async () => {
    const stopped: NodeWithStatus = { ...runningNode, status: { ...runningNode.status, state: 'stopped' } };
    await renderPage(<PeersPage node={stopped} />);
    expect(await screen.findByText(/appear while the node is running/)).toBeDefined();
  });
});
