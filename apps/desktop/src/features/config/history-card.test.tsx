import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeConfigHistory, NodeConfigVersionDetail } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { HistoryCard } = await import('./history-card');

const VERSION_ID = 'bitcoin.conf.btcortex-2026-10-23T12-34-56-789Z-0a1b2c3d.bak';

let history: NodeConfigHistory;
const DETAIL: NodeConfigVersionDetail = {
  id: VERSION_ID,
  replacedAt: '2026-10-23T12:34:56.789Z',
  text: 'chain=regtest\ndbcache=450\nrpcauth=alice:[hidden value 1]\nrest=1\n',
  changes: [
    { key: 'dbcache', current: ['800'], version: ['450'], secret: false },
    { key: 'rest', current: null, version: ['1'], secret: false },
    { key: 'rpcauth', current: null, version: null, secret: true },
  ],
  risky: ['rest'],
};

beforeEach(() => {
  history = { versions: [{ id: VERSION_ID, replacedAt: '2026-10-23T12:34:56.789Z', bytes: 1_234 }], kept: 10 };
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'nodes.config.history':
        return Promise.resolve(history);
      case 'nodes.config.version':
        return Promise.resolve(DETAIL);
      case 'nodes.config.restore':
        return Promise.resolve({
          revision: 'r2',
          restartRequired: true,
          backup: 'C:\\x.bak',
          changedKeys: ['dbcache', 'rest'],
        });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Earlier versions of bitcoin.conf', () => {
  it('compares a version with the file now, never showing a secret value', async () => {
    const user = userEvent.setup();
    await renderPage(<HistoryCard nodeId="node-1" revision="r1" blocked={false} />);
    await user.click(await screen.findByRole('button', { name: 'Compare' }));
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('dbcache');
    expect(rows[1]?.textContent).toContain('800');
    expect(rows[1]?.textContent).toContain('450');
    expect(rows[2]?.textContent).toContain('Needs confirmation');
    expect(rows[3]?.textContent).toContain('Hidden');
    expect(screen.getByText(/rpcauth=alice:\[hidden value 1\]/)).toBeDefined();
  });

  it('restores a version only after risky settings are accepted', async () => {
    const user = userEvent.setup();
    await renderPage(<HistoryCard nodeId="node-1" revision="r1" blocked={false} />);
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore…' })).toHaveProperty('disabled', false);
    });
    await user.click(screen.getByRole('button', { name: 'Restore…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/the file as it is now is kept as an earlier version/)).toBeDefined();
    const confirm = within(dialog).getByRole('button', { name: 'Restore' });
    expect(confirm).toHaveProperty('disabled', true);
    await user.click(within(dialog).getByRole('checkbox', { name: /I accept what rest changes/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.config.restore', {
      nodeId: 'node-1',
      versionId: VERSION_ID,
      revision: 'r1',
      acceptedRisks: ['rest'],
    });
  });

  it('waits for unsaved edits, and says when there is nothing kept yet', async () => {
    const view = await renderPage(<HistoryCard nodeId="node-1" revision="r1" blocked />);
    expect(await screen.findByText('Save or discard your edits first.')).toBeDefined();
    expect(await screen.findByRole('button', { name: 'Restore…' })).toHaveProperty('disabled', true);
    view.unmount();
    history = { versions: [], kept: 10 };
    await renderPage(<HistoryCard nodeId="node-1" revision="r1" blocked={false} />);
    expect(await screen.findByText(/No earlier version yet/)).toBeDefined();
  });
});
