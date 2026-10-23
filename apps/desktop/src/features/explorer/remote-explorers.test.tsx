import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteExplorerTest, RemoteExplorerWithStatus } from '@btcortex/contracts';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { OpenInExplorers, RemoteExplorers } = await import('./remote-explorers');

const TXID = 'ab'.repeat(32);
const TESTED: RemoteExplorerTest = {
  reachable: true,
  apiUrl: 'http://umbrel.local:3006/api',
  genesisHash: '00'.repeat(32),
  network: 'mainnet',
  height: 968_000,
  error: null,
};
const entry = (id: string, network: 'mainnet' | 'signet', nodeId: string | null): RemoteExplorerWithStatus => ({
  explorer: {
    id,
    name: `Explorer ${id}`,
    url: `http://${id}.local:3006`,
    apiUrl: `http://${id}.local:3006/api`,
    kind: 'mempool',
    via: 'direct',
    network,
    nodeId,
    addedAt: '2026-10-23T12:00:00.000Z',
  },
  status: {
    state: 'online',
    network,
    height: 968_000,
    blocksBehind: nodeId === null ? null : 3,
    checkedAt: '2026-10-23T12:01:00.000Z',
    error: null,
    unreachableSince: null,
  },
});

let listed: RemoteExplorerWithStatus[] = [];

beforeEach(() => {
  listed = [];
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'explorers.remote.list':
        return Promise.resolve(listed);
      case 'explorers.remote.test':
        return Promise.resolve(TESTED);
      case 'explorers.remote.add':
        return Promise.resolve([entry('umbrel', 'mainnet', 'node-1')]);
      case 'explorers.remote.open':
        return Promise.resolve({ opened: true, url: `http://umbrel.local:3006/tx/${TXID}` });
      case 'nodes.list':
        return Promise.resolve([runningNode]);
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('block explorers on other computers', () => {
  it('tests an explorer before adding it, then says how far behind the node it is', async () => {
    const user = userEvent.setup();
    await renderPage(<RemoteExplorers />);
    await user.type(await screen.findByLabelText('Address'), 'http://umbrel.local:3006');
    await user.selectOptions(screen.getByLabelText('Shows the chain of'), 'node-1');
    await user.click(screen.getByRole('button', { name: 'Test the explorer' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'explorers.remote.test',
      { url: 'http://umbrel.local:3006', kind: 'mempool', via: 'direct' },
      { timeoutMs: 90_000 },
    );
    expect(await screen.findByText('It answered, on Mainnet at block 968,000.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Add the explorer' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'explorers.remote.add',
      { url: 'http://umbrel.local:3006', kind: 'mempool', via: 'direct', name: 'umbrel.local:3006', nodeId: 'node-1' },
      { timeoutMs: 90_000 },
    );
    expect(await screen.findByText('Answering, at block 968,000: 3 blocks behind the node')).toBeDefined();
    expect(screen.getByText(/An explorer learns what you open in it/)).toBeDefined();
  });

  it('offers the explorers that show the node’s chain, and opens a page in the browser', async () => {
    const user = userEvent.setup();
    // For this node; for no node on its network; for no node on another network.
    listed = [entry('mine', 'mainnet', 'node-1'), entry('any', 'mainnet', null), entry('signet', 'signet', null)];
    await renderPage(<OpenInExplorers nodeId="node-1" page={{ kind: 'transaction', txid: TXID }} />);
    const mine = await screen.findByRole('button', { name: /Explorer mine/ });
    expect(screen.getByRole('button', { name: /Explorer any/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Explorer signet/ })).toBeNull();
    await user.click(mine);
    expect(callOrchestrator).toHaveBeenCalledWith('explorers.remote.open', {
      id: 'mine',
      page: { kind: 'transaction', txid: TXID },
    });
  });

  it('copies the page’s address for an explorer reached through Tor instead of opening the browser', async () => {
    const user = userEvent.setup();
    const url = `https://mempool.example/tx/${TXID}`;
    const viaTor = entry('tor', 'mainnet', 'node-1');
    listed = [{ ...viaTor, explorer: { ...viaTor.explorer, via: 'tor' } }];
    const answers = callOrchestrator.getMockImplementation();
    callOrchestrator.mockImplementation((method: string, ...rest: unknown[]) =>
      method === 'explorers.remote.open'
        ? Promise.resolve({ opened: false, url })
        : (answers?.(method, ...rest) as Promise<unknown>),
    );
    await renderPage(<OpenInExplorers nodeId="node-1" page={{ kind: 'transaction', txid: TXID }} />);
    await user.click(
      await screen.findByRole('button', { name: /^Explorer tor\s*\(copies the address, for Tor Browser\)$/ }),
    );
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(url);
    });
  });
});
