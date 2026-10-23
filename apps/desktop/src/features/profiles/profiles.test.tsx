import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentPlan, DeploymentProfile, DeploymentRecord, Job, ProfilesOverview } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { ProfilesPage } = await import('./profiles-page');
const { ProfilePage } = await import('./profile-page');

const BASIC: DeploymentProfile = {
  id: 'basic-node',
  letter: 'A',
  title: 'Basic Bitcoin full node',
  summary: 'Bitcoin Core with a configuration suited to this computer.',
  available: true,
  needsDockerOrWsl2: false,
  components: [
    { component: 'bitcoin-core', kind: 'installs', required: true, chosenByDefault: true },
    { component: 'tor', kind: 'installs', required: false, chosenByDefault: false },
    { component: 'monitoring', kind: 'built-in', required: true, chosenByDefault: true },
    { component: 'backups', kind: 'later', required: true, chosenByDefault: true },
  ],
};

const LIGHTNING: DeploymentProfile = {
  id: 'lightning',
  letter: 'E',
  title: 'Lightning node',
  summary: 'Bitcoin Core with a Lightning implementation beside it.',
  available: false,
  unavailableReason: 'BTCortex connects to an LND node you run, but does not install or run one yet.',
  needsDockerOrWsl2: false,
  components: [
    { component: 'bitcoin-core', kind: 'installs', required: true, chosenByDefault: true },
    {
      component: 'lightning',
      kind: 'unavailable',
      required: false,
      chosenByDefault: false,
      unavailableReason: 'Not installed by BTCortex yet.',
    },
  ],
};

const RECORD: DeploymentRecord = {
  id: 'd1',
  jobId: 'job-1',
  profileId: 'basic-node',
  network: 'signet',
  nodeId: 'n1',
  nodeName: 'Home node',
  startedAt: '2026-10-23T08:00:00.000Z',
  finishedAt: '2026-10-23T08:05:00.000Z',
  steps: [
    {
      component: 'bitcoin-core',
      title: 'Set up Home node',
      state: 'done',
      message: 'Set up and started.',
      route: '/nodes/n1',
    },
    {
      component: 'backups',
      title: 'Backups',
      state: 'needs-attention',
      message: 'Choose a backup folder, ideally on another disk.',
      route: '/backups',
    },
  ],
};

function plan(choices: DeploymentPlan['choices']): DeploymentPlan {
  return {
    choices,
    node: { name: 'Home node', existing: false, dataDirectory: 'C:\\BTCortex\\nodes\\signet-1' },
    feasible: true,
    blockers: [],
    warnings: ['The data would be on a hard disk.'],
    steps: [
      { component: 'bitcoin-core', title: 'Set up Home node', detail: 'Bitcoin Core 31.1 for Signet.', state: 'to-do' },
      { component: 'monitoring', title: 'Monitoring', detail: 'Part of BTCortex.', state: 'built-in' },
    ],
    downloads: [
      {
        component: 'bitcoin-core',
        name: 'Bitcoin Core',
        version: '31.1',
        bytes: 55_000_000,
        verification: 'Signed by at least three of Bitcoin Core’s builders',
      },
    ],
    storage: {
      volume: 'C:\\',
      kind: 'hdd',
      freeBytes: 500_000_000_000,
      totalBytes: 1_000_000_000_000,
      items: [{ label: 'Blocks', bytes: 24_000_000_000 }],
      neededBytes: 29_000_000_000,
    },
    memory: {
      totalBytes: 8 * 1024 ** 3,
      items: [{ label: 'Bitcoin Core’s database cache (dbcache)', bytes: 1024 ** 3 }],
      recommendedBytes: 3 * 1024 ** 3,
    },
    processors: { logical: 4, recommended: 2 },
    ports: [{ port: 38332, purpose: 'Bitcoin Core’s RPC interface', reach: 'this-computer' }],
    dependencies: [],
    privacy: ['Other nodes see this computer’s IP address.'],
    security: ['Every program is installed only after its signatures have been verified.'],
    impact: [],
    needsDockerOrWsl2: false,
  };
}

let overview: ProfilesOverview;

beforeEach(() => {
  overview = { profiles: [BASIC, LIGHTNING], deployments: [RECORD] };
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'profiles.overview':
        return Promise.resolve(overview);
      case 'profiles.plan':
        return Promise.resolve(plan(params as DeploymentPlan['choices']));
      case 'profiles.deploy':
        overview = {
          ...overview,
          deployments: [
            {
              ...RECORD,
              id: 'd2',
              jobId: 'job-2',
              finishedAt: null,
              steps: [{ ...RECORD.steps[0]!, state: 'running', message: null }],
            },
          ],
        };
        return Promise.resolve({ jobId: 'job-2', deploymentId: 'd2' });
      case 'jobs.get':
        return Promise.resolve({
          id: 'job-2',
          kind: 'profile.deploy',
          title: 'Deploy profile A',
          state: 'running',
          progress: { stage: 'bitcoin-core', message: 'Set up Home node: Downloading Bitcoin Core', fraction: 0.4 },
          createdAt: '2026-10-23T08:00:00.000Z',
          updatedAt: '2026-10-23T08:00:00.000Z',
        } satisfies Job);
      case 'nodes.list':
        return Promise.resolve([]);
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Deployment profiles', () => {
  it('lists every profile, says which cannot be deployed yet and why, and shows past deployments', async () => {
    await renderPage(<ProfilesPage />);
    expect(await screen.findByText('Basic Bitcoin full node')).toBeDefined();
    expect(
      screen.getByText('BTCortex connects to an LND node you run, but does not install or run one yet.'),
    ).toBeDefined();
    expect(screen.getByText('Not available yet: Lightning.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Customise and review' }).getAttribute('href')).toBe(
      '/profiles/basic-node',
    );
    expect(screen.getByText('Set up Home node')).toBeDefined();
    expect(screen.getByText('Choose a backup folder, ideally on another disk.')).toBeDefined();
    expect(screen.getAllByRole('link', { name: 'Open' }).map((link) => link.getAttribute('href'))).toEqual([
      '#/nodes/n1',
      '#/backups',
    ]);
  });

  it('customises a profile, reviews its plan and deploys it after confirmation', async () => {
    const user = userEvent.setup();
    await renderPage(<ProfilePage profileId="basic-node" />, '/profiles/basic-node');
    expect(await screen.findByRole('heading', { name: 'Profile A · Basic Bitcoin full node' })).toBeDefined();
    // Required parts cannot be left out; Tor is optional and brings its own choices.
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Bitcoin Core/ }).disabled).toBe(true);
    expect(screen.queryByText('How the node uses Tor')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /^Tor/ }));
    expect(screen.getByText('How the node uses Tor')).toBeDefined();
    await user.click(screen.getByRole('radio', { name: /Signet/ }));
    await user.clear(screen.getByLabelText('Name of the new node'));
    await user.type(screen.getByLabelText('Name of the new node'), 'Home node');
    await user.click(screen.getByRole('button', { name: 'Review the plan' }));

    expect(await screen.findByText('Bitcoin Core 31.1 for Signet.')).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith(
      'profiles.plan',
      {
        profileId: 'basic-node',
        network: 'signet',
        components: ['tor'],
        target: { kind: 'new', name: 'Home node' },
        tor: { mode: 'tor-only', onionService: true, privateBroadcast: true },
      },
      { timeoutMs: 90_000 },
    );
    expect(screen.getByText('The data would be on a hard disk.')).toBeDefined();
    expect(screen.getByText('No Docker and no WSL2: everything runs natively on Windows.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Deploy…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/The node’s connections change \(Tor only\)/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Deploy now' }));
    await waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith('profiles.deploy', expect.objectContaining({ confirmed: true }), {
        timeoutMs: 90_000,
      });
    });
    expect(await screen.findByText('Deploying profile A')).toBeDefined();
    expect(await screen.findByText('Set up Home node: Downloading Bitcoin Core')).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
  });

  it('explains a profile that cannot be deployed instead of offering it', async () => {
    await renderPage(<ProfilePage profileId="lightning" />, '/profiles/lightning');
    expect(
      await screen.findByText('BTCortex connects to an LND node you run, but does not install or run one yet.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Review the plan' })).toBeNull();
  });
});
