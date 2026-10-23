import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecurityOverview } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { SecurityPage } = await import('./security-page');

const OVERVIEW: SecurityOverview = {
  checkedAt: '2026-10-23T08:00:00.000Z',
  counts: { critical: 1, warning: 0, info: 0, ok: 1 },
  findings: [
    {
      id: 'node.rpc-exposed:a',
      area: 'nodes',
      severity: 'critical',
      subject: 'Main node',
      title: 'RPC is open to any address',
      detail: 'rpcallowip=0.0.0.0/0 lets other computers reach the RPC interface.',
      action: 'Remove the non-local rpcbind and rpcallowip entries.',
      route: '/nodes/a/configuration',
    },
    {
      id: 'computer.firewall',
      area: 'computer',
      severity: 'ok',
      subject: 'This computer',
      title: 'Windows Firewall is on',
      detail: 'It is on for every network profile.',
      action: null,
      route: null,
    },
  ],
  controls: [
    { id: 'verified-downloads', title: 'Verified downloads', detail: 'Signatures checked.', state: 'active' },
    { id: 'signed-releases', title: 'Signed BTCortex releases', detail: 'Not code-signed yet.', state: 'planned' },
  ],
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockResolvedValue(OVERVIEW);
});

describe('Security centre', () => {
  it('counts the findings, groups them with what to do, and lists BTCortex’s own controls', async () => {
    const user = userEvent.setup();
    await renderPage(<SecurityPage />);
    expect(await screen.findByText('RPC is open to any address')).toBeDefined();
    expect(screen.getByText('Critical', { selector: 'p' }).nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Remove the non-local rpcbind and rpcallowip entries.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('#/nodes/a/configuration');
    expect(screen.getByRole('heading', { name: 'This computer' })).toBeDefined();
    const controls = screen.getByRole('heading', { name: 'How BTCortex protects you' }).closest('section');
    if (!controls) throw new Error('The controls card is missing.');
    expect(within(controls).getByText('Not yet')).toBeDefined();
    expect(within(controls).getByText('In place')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(callOrchestrator).toHaveBeenCalledTimes(2);
  });
});
