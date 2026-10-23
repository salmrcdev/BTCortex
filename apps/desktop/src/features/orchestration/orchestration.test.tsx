import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Orchestration, OrchestrationPlan, ServiceInstance } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { OrchestrationPage } = await import('./orchestration-page');

const service = (
  change: Partial<ServiceInstance> & Pick<ServiceInstance, 'id' | 'name' | 'moduleId'>,
): ServiceInstance => ({
  route: null,
  state: 'running',
  health: 'healthy',
  summary: 'Running.',
  actions: ['stop', 'restart'],
  requires: [],
  requiredBy: [],
  logSources: [],
  ...change,
});

const OVERVIEW: Orchestration = {
  modules: [
    {
      id: 'tor',
      name: 'Tor',
      status: 'integration-tested',
      level: 'fully-managed',
      capabilities: ['start', 'stop'],
      permissions: ['processes', 'files', 'network', 'tor'],
      dependencies: [],
      documentation: { document: 'PRIVACY_AND_TOR', section: '' },
      updates: 'tor',
      route: '/tor',
    },
    {
      id: 'bitcoin-core',
      name: 'Bitcoin Core',
      status: 'verified-on-windows',
      level: 'fully-managed',
      capabilities: ['start', 'stop'],
      permissions: ['processes', 'node-rpc'],
      dependencies: [{ id: 'tor', optional: true, reason: 'Routes a node’s connections through Tor when chosen.' }],
      documentation: { document: 'NODE_MANAGEMENT', section: '' },
      updates: 'bitcoin-core',
      route: '/nodes',
    },
  ],
  instances: [
    service({
      id: 'tor',
      name: 'Tor',
      moduleId: 'tor',
      route: '/tor',
      requiredBy: ['node:a', 'electrum:a'],
      logSources: ['tor'],
    }),
    service({
      id: 'node:a',
      name: 'Main node',
      moduleId: 'bitcoin-core',
      route: '/nodes/a',
      requires: [{ id: 'tor', hard: true, reason: 'routes its connections through Tor' }],
      requiredBy: ['electrum:a'],
    }),
    service({
      id: 'electrum:a',
      name: 'Electrum server of Main node',
      moduleId: 'fulcrum',
      requires: [
        { id: 'node:a', hard: true, reason: 'reads the blockchain from its node' },
        { id: 'tor', hard: false, reason: 'is reached by wallets elsewhere through its onion service' },
      ],
    }),
  ],
};

const STOP_TOR: OrchestrationPlan = {
  target: 'tor',
  action: 'stop',
  steps: [
    { instanceId: 'electrum:a', name: 'Electrum server of Main node', action: 'stop' },
    { instanceId: 'node:a', name: 'Main node', action: 'stop' },
    { instanceId: 'tor', name: 'Tor', action: 'stop' },
  ],
  consequences: ['Spare node reaches onion peers through Tor: that stops until Tor runs again.'],
  blocked: null,
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: { target?: string }) => {
    switch (method) {
      case 'services.overview':
        return Promise.resolve(OVERVIEW);
      case 'services.plan':
        return Promise.resolve(
          params.target === 'tor'
            ? STOP_TOR
            : {
                target: params.target,
                action: 'restart',
                steps: [],
                consequences: [],
                blocked: 'Main node cannot restart now. It is still starting.',
              },
        );
      case 'services.run':
        return Promise.resolve({ plan: STOP_TOR, done: ['electrum:a', 'node:a', 'tor'], overview: OVERVIEW });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('service orchestration', () => {
  it('shows each service with what it needs and what needs it, and the modules behind them', async () => {
    await renderPage(<OrchestrationPage />);
    expect(await screen.findByText('Needs Tor: it routes its connections through Tor.')).toBeDefined();
    expect(
      screen.getByText('Uses Tor when it runs: it is reached by wallets elsewhere through its onion service.'),
    ).toBeDefined();
    expect(screen.getByText('Needed by Main node and Electrum server of Main node.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Logs' }).getAttribute('href')).toContain('source=tor');
    expect(screen.getByText('run programs, write its own files, use the network and run Tor')).toBeDefined();
    expect(screen.getByText('tor (optional)')).toBeDefined();
    // Nothing is stopped, so there is nothing to start everything of.
    expect(screen.getByRole('button', { name: 'Start everything…' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the plan in order before stopping anything, and runs it once confirmed', async () => {
    const user = userEvent.setup();
    await renderPage(<OrchestrationPage />);
    const [stopTor] = await screen.findAllByRole('button', { name: 'Stop…' });
    if (!stopTor) throw new Error('No stop button.');
    await user.click(stopTor);
    expect(callOrchestrator).toHaveBeenCalledWith('services.plan', { target: 'tor', action: 'stop' });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Stop Tor?')).toBeDefined();
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Stop Electrum server of Main node', 'Stop Main node', 'Stop Tor']);
    expect(within(dialog).getByText(/Spare node reaches onion peers/)).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('services.run', expect.anything(), expect.anything());
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'services.run',
      { target: 'tor', action: 'stop', confirmed: true },
      { timeoutMs: 180_000 },
    );
  });

  it('says why something cannot be done, offering nothing to confirm', async () => {
    const user = userEvent.setup();
    await renderPage(<OrchestrationPage />);
    const restarts = await screen.findAllByRole('button', { name: 'Restart…' });
    const restartNode = restarts[1];
    if (!restartNode) throw new Error('No restart button for the node.');
    await user.click(restartNode);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Main node cannot restart now. It is still starting.')).toBeDefined();
    expect(within(dialog).queryByRole('button', { name: 'Restart' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDefined();
  });
});
