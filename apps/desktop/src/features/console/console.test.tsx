import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RpcCatalogueEntry } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';
import { runningNode } from '@/testing/fixtures';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { ConsolePage } = await import('./console-page');

const CATALOGUE: RpcCatalogueEntry[] = [
  { name: 'getblockcount', category: 'Blockchain', risk: 'read', secret: false },
  { name: 'savemempool', category: 'Blockchain', risk: 'state', secret: false },
  { name: 'setnetworkactive', category: 'Network', risk: 'dangerous', secret: false },
  { name: 'createwallet', category: 'Wallet', risk: 'state', secret: true },
  { name: 'stop', category: 'Control', risk: 'dangerous', secret: false, blockedReason: 'Use Stop in BTCortex.' },
];

function rpcCalls(): Record<string, unknown>[] {
  return callOrchestrator.mock.calls
    .filter(
      ([method, params]) => method === 'nodes.rpc.call' && (params as { method: string }).method !== 'listwallets',
    )
    .map(([, params]) => params as Record<string, unknown>);
}

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: { method?: string }) => {
    switch (method) {
      case 'nodes.rpc.catalogue':
        return Promise.resolve(CATALOGUE);
      case 'nodes.rpc.help':
        return Promise.resolve({
          text: `${params.method ?? ''}\n\nReturns the height of the most-work fully-validated chain.`,
        });
      case 'nodes.rpc.statistics':
        return Promise.resolve([{ method: 'getblockchaininfo', calls: 12, errors: 0, averageMs: 3.5, maxMs: 9 }]);
      case 'nodes.rpc.call':
        return Promise.resolve({ result: params.method === 'listwallets' ? [] : 612345, durationMs: 4 });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('RPC console', () => {
  it('lists methods by category with their risks and shows the node’s help', async () => {
    const user = userEvent.setup();
    await renderPage(<ConsolePage node={runningNode} />);
    const blockchain = await screen.findByRole('region', { name: 'Blockchain' });
    expect(within(blockchain).getByText('Changes state')).toBeDefined();
    expect(screen.getByText('Not available here')).toBeDefined();
    await user.click(within(blockchain).getByRole('button', { name: /getblockcount/ }));
    expect(await screen.findByText(/most-work fully-validated chain/)).toBeDefined();
    expect(screen.getByLabelText('Command')).toHaveProperty('value', 'getblockcount ');
    expect(screen.getByText('getblockchaininfo')).toBeDefined();
  });

  it('runs read methods and shows the result', async () => {
    const user = userEvent.setup();
    await renderPage(<ConsolePage node={runningNode} />);
    await screen.findByRole('region', { name: 'Blockchain' });
    await user.type(screen.getByLabelText('Command'), 'getblockcount{Enter}');
    expect(await within(screen.getByRole('log')).findByText('612345')).toBeDefined();
    expect(rpcCalls()).toEqual([{ nodeId: 'node-1', method: 'getblockcount', params: [], confirmed: false }]);
  });

  it('runs wallet methods on the default wallet, whose name is empty, apart from no wallet at all', async () => {
    const answers = callOrchestrator.getMockImplementation();
    callOrchestrator.mockImplementation((method: string, params: { method?: string }) =>
      method === 'nodes.rpc.call' && params.method === 'listwallets'
        ? Promise.resolve({ result: ['', 'savings'], durationMs: 2 })
        : (answers?.(method, params) as Promise<unknown>),
    );
    const user = userEvent.setup();
    await renderPage(<ConsolePage node={runningNode} />);
    const wallet = await screen.findByLabelText('Wallet');
    await screen.findByRole('option', { name: 'Default wallet' });
    await user.selectOptions(wallet, 'Default wallet');
    await user.type(screen.getByLabelText('Command'), 'getblockcount{Enter}');
    await within(screen.getByRole('log')).findByText('612345');
    await user.selectOptions(wallet, 'None (node methods)');
    await user.type(screen.getByLabelText('Command'), 'getblockcount{Enter}');
    await waitFor(() => {
      expect(within(screen.getByRole('log')).getAllByText('612345')).toHaveLength(2);
    });
    expect(rpcCalls()).toEqual([
      { nodeId: 'node-1', method: 'getblockcount', params: [], wallet: '', confirmed: false },
      { nodeId: 'node-1', method: 'getblockcount', params: [], confirmed: false },
    ]);
  });

  it('says when the help or the statistics cannot be loaded, instead of loading for ever', async () => {
    const answers = callOrchestrator.getMockImplementation();
    callOrchestrator.mockImplementation((method: string, params: { method?: string }) =>
      method === 'nodes.rpc.help' || method === 'nodes.rpc.statistics'
        ? Promise.reject(new Error('The node did not answer.'))
        : (answers?.(method, params) as Promise<unknown>),
    );
    const user = userEvent.setup();
    await renderPage(<ConsolePage node={runningNode} />);
    expect(await screen.findByText('The statistics could not be loaded')).toBeDefined();
    const blockchain = await screen.findByRole('region', { name: 'Blockchain' });
    await user.click(within(blockchain).getByRole('button', { name: /getblockcount/ }));
    expect(await screen.findByText('The node’s help for this method could not be loaded')).toBeDefined();
  });

  it('keeps read-only mode, refuses blocked methods and explains syntax errors without calling the node', async () => {
    const user = userEvent.setup();
    await renderPage(<ConsolePage node={runningNode} />);
    await screen.findByRole('region', { name: 'Blockchain' });
    const command = screen.getByLabelText('Command');
    await user.type(command, 'savemempool{Enter}');
    expect(await screen.findByText(/Switch read-only mode off/)).toBeDefined();
    await user.clear(command);
    await user.type(command, 'stop{Enter}');
    expect(await screen.findByText(/stop is not available here/)).toBeDefined();
    await user.clear(command);
    await user.type(command, 'GetBlockCount{Enter}');
    expect(await screen.findByText(/lower-case letters and digits/)).toBeDefined();
    expect(rpcCalls()).toEqual([]);
  });

  it('asks before dangerous methods and hides secret parameters', async () => {
    const user = userEvent.setup();
    await renderPage(<ConsolePage node={runningNode} />);
    await screen.findByRole('region', { name: 'Blockchain' });
    await user.click(screen.getByRole('checkbox', { name: /Read-only mode/ }));
    const command = screen.getByLabelText('Command');

    await user.type(command, 'setnetworkactive false{Enter}');
    const dialog = await screen.findByRole('alertdialog');
    expect(rpcCalls()).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Run it' }));
    expect(rpcCalls()).toEqual([{ nodeId: 'node-1', method: 'setnetworkactive', params: [false], confirmed: true }]);

    await user.type(command, 'createwallet "watch-only" true true{Enter}');
    expect(await screen.findByText('› createwallet [parameters hidden]')).toBeDefined();
    expect(within(screen.getByRole('log')).queryByText(/watch-only/)).toBeNull();
  });
});
