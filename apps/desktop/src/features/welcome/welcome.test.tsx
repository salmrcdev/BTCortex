import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentPlan, DeploymentProfile, EnvironmentReport, ProfilesOverview } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return {
    ...actual,
    isDesktopRuntime: () => true,
    callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown,
  };
});

const { WelcomePage, webViewVersion } = await import('./welcome-page');

const profile = (id: DeploymentProfile['id'], letter: string, title: string): DeploymentProfile => ({
  id,
  letter,
  title,
  summary: `${title} summary.`,
  available: true,
  needsDockerOrWsl2: false,
  components: [
    { component: 'bitcoin-core', kind: 'installs', required: true, chosenByDefault: true },
    { component: 'monitoring', kind: 'built-in', required: true, chosenByDefault: true },
  ],
});

const OVERVIEW: ProfilesOverview = {
  profiles: [
    profile('basic-node', 'A', 'Basic Bitcoin full node'),
    profile('private-wallet', 'B', 'Private Bitcoin wallet infrastructure'),
    profile('privacy-node', 'C', 'Privacy-focused Bitcoin node'),
    profile('explorer', 'D', 'Full Bitcoin explorer'),
  ],
  deployments: [],
};

const REPORT: EnvironmentReport = {
  checkedAt: '2026-10-23T09:00:00.000Z',
  checks: [
    {
      id: 'system.windows',
      area: 'system',
      state: 'warning',
      title: 'Windows 10 22H2 (build 19045)',
      detail: 'Microsoft ended support for Windows 10 on 14 October 2025.',
    },
    { id: 'storage.space', area: 'storage', state: 'ok', title: '3 TB free on C:\\', detail: 'Room for everything.' },
    {
      id: 'virtualisation',
      area: 'virtualisation',
      state: 'ok',
      title: 'WSL2 not installed; Docker not installed',
      detail: 'Not needed.',
    },
  ],
  software: [{ id: 'electrum', name: 'Electrum', location: 'C:\\Program Files\\Electrum' }],
  connectableNodes: 0,
  recommendation: {
    profileId: 'private-wallet',
    reason: 'There is room for the whole blockchain and an Electrum server.',
  },
};

function plan(choices: DeploymentPlan['choices']): DeploymentPlan {
  return {
    choices,
    node: { name: 'My Bitcoin node', existing: false, dataDirectory: 'C:\\BTCortex\\nodes\\mainnet-1' },
    feasible: true,
    blockers: [],
    warnings: [],
    steps: [
      { component: 'bitcoin-core', title: 'Set up My Bitcoin node', detail: 'Bitcoin Core 31.1.', state: 'to-do' },
    ],
    downloads: [],
    storage: { volume: 'C:\\', kind: 'ssd', freeBytes: 3e12, totalBytes: 4e12, items: [], neededBytes: 1e12 },
    memory: { totalBytes: 16 * 1024 ** 3, items: [], recommendedBytes: 4 * 1024 ** 3 },
    processors: { logical: 8, recommended: 2 },
    ports: [],
    dependencies: [],
    privacy: [],
    security: [],
    impact: [],
    needsDockerOrWsl2: false,
  };
}

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'onboarding.environment':
        return Promise.resolve(REPORT);
      case 'onboarding.complete':
        return Promise.resolve({ completedAt: '2026-10-23T09:05:00.000Z', mode: params['mode'], suggested: false });
      case 'profiles.overview':
        return Promise.resolve(OVERVIEW);
      case 'profiles.plan':
        return Promise.resolve(plan(params as DeploymentPlan['choices']));
      case 'nodes.list':
        return Promise.resolve([]);
      case 'nodes.discover':
        return Promise.resolve([]);
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('First-run guide', () => {
  it('checks the computer, recommends a set-up and shows its plan before anything happens', async () => {
    const user = userEvent.setup();
    await renderPage(<WelcomePage />);
    expect((await screen.findByRole('radio', { name: /Let BTCortex recommend/ })).getAttribute('aria-checked')).toBe(
      'true',
    );
    // Nothing is checked before the person asks.
    expect(callOrchestrator).not.toHaveBeenCalledWith('onboarding.environment', expect.anything(), expect.anything());
    await user.click(screen.getByRole('button', { name: 'Check this computer' }));
    const results = await screen.findByRole('list', { name: 'Results of the checks' });
    expect(within(results).getByText('Windows 10 22H2 (build 19045)')).toBeDefined();
    expect(within(results).getByText('WSL2 not installed; Docker not installed')).toBeDefined();
    expect(screen.getByText('C:\\Program Files\\Electrum')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const recommended = await screen.findByRole('radio', { name: /Private Bitcoin wallet infrastructure/ });
    expect(recommended.getAttribute('aria-checked')).toBe('true');
    expect(within(recommended).getByText('Recommended')).toBeDefined();
    // A beginner chooses between three; the explorer stays in advanced mode.
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: /Basic Bitcoin full node/ }));
    await user.click(screen.getByRole('button', { name: 'See the plan' }));
    expect(await screen.findByText('Set up My Bitcoin node')).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith(
      'profiles.plan',
      expect.objectContaining({ profileId: 'basic-node', network: 'mainnet' }),
      expect.anything(),
    );
    expect(callOrchestrator).not.toHaveBeenCalledWith('profiles.deploy', expect.anything(), expect.anything());
  });

  it('lets advanced users pick any profile and customise it', async () => {
    const user = userEvent.setup();
    await renderPage(<WelcomePage />);
    await user.click(await screen.findByRole('radio', { name: /Choose every detail/ }));
    await user.click(screen.getByRole('button', { name: 'Check this computer' }));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await screen.findByRole('radio', { name: /Full Bitcoin explorer/ });
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Customise' }));
    expect(await screen.findByRole('group', { name: 'Network' })).toBeDefined();
  });

  it('can be skipped at any step', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage(<WelcomePage />, '/welcome');
    await user.click(await screen.findByRole('button', { name: 'Skip the guide' }));
    expect(callOrchestrator).toHaveBeenCalledWith('onboarding.complete', { mode: null });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('reads the WebView2 version from the window', () => {
    expect(
      webViewVersion(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.3400.12',
      ),
    ).toBe('155.0.3400.12');
    expect(webViewVersion('Mozilla/5.0 jsdom')).toBeUndefined();
  });
});
