import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverlays } from '@/stores/overlays';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';
import { initialiseI18n } from '@/i18n';
import { Breadcrumbs } from './breadcrumbs';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { CommandPalette, looksLikeChainData } = await import('./command-palette');

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) =>
    method === 'nodes.list' ? Promise.resolve([runningNode]) : Promise.reject(new Error(`unexpected ${method}`)),
  );
  act(() => {
    useOverlays.getState().show('palette');
  });
});

describe('Command palette', () => {
  it('finds pages and goes to the chosen one', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage(<CommandPalette />);
    const field = await screen.findByRole('combobox', { name: 'Go to or search' });
    await user.type(field, 'monit');
    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toBe('Monitoring');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/monitoring');
    expect(useOverlays.getState().open).toBeNull();
  });

  it('moves through the results with the arrow keys and finds node sections', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage(<CommandPalette />);
    const field = await screen.findByRole('combobox', { name: 'Go to or search' });
    await user.type(field, 'my bitcoin');
    await screen.findByRole('option', { name: 'My Bitcoin node › Network & peers' });
    const group = screen.getByRole('group', { name: 'Nodes' });
    expect(within(group).getAllByRole('option')[0]?.textContent).toBe('My Bitcoin node');
    await user.keyboard('{ArrowDown}');
    const selected = screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent).toBe('My Bitcoin node › Network & peers');
    expect(field.getAttribute('aria-activedescendant')).toBe(selected?.id);
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/nodes/node-1/peers');
  });

  it('offers to look up a block, transaction or address in the explorer', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage(<CommandPalette />);
    await user.type(await screen.findByRole('combobox', { name: 'Go to or search' }), '101');
    expect(screen.getAllByRole('option')[0]?.textContent).toBe('Look up “101” in the explorer');
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/explorer');
    expect(router.state.location.search).toEqual({ q: '101' });
  });

  it('says when nothing matches, with suggestions', async () => {
    const user = userEvent.setup();
    await renderPage(<CommandPalette />);
    await user.type(await screen.findByRole('combobox', { name: 'Go to or search' }), 'zzz qqq');
    expect(screen.getByText('Nothing matches “zzz qqq”.')).toBeDefined();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('recognises what the explorer can look up', () => {
    expect(looksLikeChainData('840000')).toBe(true);
    expect(looksLikeChainData('0'.repeat(64))).toBe(true);
    expect(looksLikeChainData('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
    expect(looksLikeChainData('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080')).toBe(true);
    expect(looksLikeChainData('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe(true);
    expect(looksLikeChainData('monitoring')).toBe(false);
    expect(looksLikeChainData('peers 2')).toBe(false);
  });
});

describe('Breadcrumbs', () => {
  it('names the trail and marks the current page', async () => {
    await initialiseI18n();
    await renderPage(
      <Breadcrumbs
        trail={[
          <Link key="nodes" to="/nodes">
            Bitcoin nodes
          </Link>,
        ]}
        current="My Bitcoin node"
      />,
    );
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Bitcoin nodes' }).getAttribute('href')).toBe('/nodes');
    expect(within(trail).getByText('My Bitcoin node').getAttribute('aria-current')).toBe('page');
  });
});
