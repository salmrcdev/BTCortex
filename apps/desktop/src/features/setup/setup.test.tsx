import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '@btcortex/contracts';
import { jobKeys } from '@/features/nodes/queries';
import { plan } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { SetupPage } = await import('./setup-page');

const queuedJob: Job = {
  id: 'job-1',
  kind: 'bitcoin-core.setup',
  title: 'Set up Bitcoin Core (Mainnet)',
  state: 'running',
  progress: { stage: 'downloading', message: 'Downloading bitcoin-31.1-win64.zip.', fraction: 0.5 },
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:05.000Z',
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    if (method === 'setup.plan') return Promise.resolve(plan);
    if (method === 'setup.start') return Promise.resolve({ jobId: 'job-1' });
    if (method === 'jobs.get') return Promise.resolve(queuedJob);
    return Promise.reject(new Error(`unexpected ${method}`));
  });
});

describe('SetupPage', () => {
  it('walks from choice to plan to a single approval', async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderPage(<SetupPage />);

    // Step 1: sensible defaults are preselected.
    expect(await screen.findByRole('radio', { name: /Mainnet/ })).toHaveProperty('ariaChecked', 'true');
    await user.click(screen.getByRole('button', { name: 'Review the plan' }));

    // Step 2: the plan explains what will happen before anything changes.
    expect(await screen.findByText('Install Bitcoin Core 31.1 from bitcoincore.org')).toBeDefined();
    expect(screen.getByText(/signatures from at least three independent builders/)).toBeDefined();
    expect(screen.getByText(/Electrum servers cannot use this node/)).toBeDefined();
    expect(screen.getByText(/Roaming\\Bitcoin — left untouched/)).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith(
      'setup.plan',
      { network: 'mainnet', usage: 'wallet-backend' },
      { timeoutMs: 60_000 },
    );
    expect(callOrchestrator).not.toHaveBeenCalledWith('setup.start', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Install and start' }));
    expect(callOrchestrator).toHaveBeenCalledWith('setup.start', {
      name: 'My Bitcoin node',
      network: 'mainnet',
      usage: 'wallet-backend',
    });

    // Step 3: live progress from job events.
    expect(await screen.findByText('Setting up Bitcoin Core')).toBeDefined();
    expect(await screen.findByRole('progressbar')).toBeDefined();
    act(() => {
      queryClient.setQueryData(jobKeys.detail('job-1'), {
        ...queuedJob,
        state: 'succeeded',
        result: { nodeId: 'node-1' },
      });
    });
    expect(await screen.findByRole('link', { name: 'Open the node' })).toBeDefined();
  });

  it('sets up Bitcoin Knots only once the user agrees to its chain, and without an Electrum server', async () => {
    callOrchestrator.mockImplementation((method: string, params?: { implementation?: string }) => {
      const knots = params?.implementation === 'bitcoin-knots';
      if (method === 'setup.plan') {
        return Promise.resolve({
          ...plan,
          implementation: knots ? 'bitcoin-knots' : 'bitcoin-core',
          differentChain: knots,
          version: knots ? '29.4.2.knots20260508' : '31.1',
        });
      }
      if (method === 'setup.start') return Promise.resolve({ jobId: 'job-1' });
      if (method === 'jobs.get') return Promise.resolve({ ...queuedJob, kind: 'bitcoin-knots.setup' });
      return Promise.reject(new Error(`unexpected ${method}`));
    });
    const user = userEvent.setup();
    await renderPage(<SetupPage />);
    // Bitcoin Core is preselected; Knots must be chosen.
    expect(await screen.findByRole('radio', { name: /Bitcoin Core.*Recommended/ })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    await user.click(screen.getByRole('radio', { name: /Bitcoin Knots/ }));
    expect(screen.queryByRole('radio', { name: /Node with an Electrum server/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review the plan' }));

    expect(await screen.findByText('Install Bitcoin Knots 29.4.2.knots20260508 from bitcoinknots.org')).toBeDefined();
    expect(screen.getByText(/Luke Dashjr’s among them/)).toBeDefined();
    expect(screen.getByText(/BLAKE2b proof of work and the BIP110 rules/)).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith(
      'setup.plan',
      { network: 'mainnet', usage: 'wallet-backend', implementation: 'bitcoin-knots' },
      { timeoutMs: 60_000 },
    );
    const approve = screen.getByRole('button', { name: 'Install and start' });
    expect(approve).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('checkbox', { name: /this node follows the Bitcoin Knots chain/ }));
    await user.click(approve);
    expect(callOrchestrator).toHaveBeenCalledWith('setup.start', {
      name: 'My Bitcoin node',
      network: 'mainnet',
      usage: 'wallet-backend',
      implementation: 'bitcoin-knots',
      acceptDifferentChain: true,
    });
    expect(await screen.findByText('Setting up Bitcoin Knots')).toBeDefined();
  });

  it('says so when a retry after a failed set-up cannot start', async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderPage(<SetupPage />);
    await user.click(await screen.findByRole('button', { name: 'Review the plan' }));
    await user.click(await screen.findByRole('button', { name: 'Install and start' }));
    expect(await screen.findByText('Setting up Bitcoin Core')).toBeDefined();
    act(() => {
      queryClient.setQueryData(jobKeys.detail('job-1'), {
        ...queuedJob,
        state: 'failed',
        error: {
          code: 'installation.download-failed',
          message: 'The download did not finish.',
          component: 'bitcoin-core',
          dataRisk: 'none',
          recoveryActions: [],
        },
      });
    });
    callOrchestrator.mockImplementation((method: string) =>
      method === 'setup.start'
        ? Promise.reject(new Error('Another set-up is running.'))
        : Promise.resolve(method === 'setup.plan' ? plan : queuedJob),
    );
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Another set-up is running.')).toBeDefined();
  });

  it('requires a node name', async () => {
    const user = userEvent.setup();
    await renderPage(<SetupPage />);
    const name = await screen.findByLabelText('Node name');
    await user.clear(name);
    expect(screen.getByText('Give the node a name.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Review the plan' })).toHaveProperty('disabled', true);
  });
});
