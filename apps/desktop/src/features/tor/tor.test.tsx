import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { I2pRouterStatus, Job, NodePrivacy, TorStatus } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';
import { runningNode } from '@/testing/fixtures';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { TorPage } = await import('./tor-page');
const { NodePrivacyPage } = await import('./node-privacy-page');

const RUNNING: TorStatus = {
  state: 'running',
  installed: { version: '15.0.26', torVersion: '0.4.9.14', verifiedAt: '2026-10-23T01:00:00.000Z' },
  runningVersion: '15.0.26',
  autoStart: true,
  ports: { socks: 9050, applicationSocks: 9052, control: 9054 },
  bootstrap: { progress: 100, summary: 'Done', tag: 'done', stalled: false },
  circuitEstablished: true,
  networkLiveness: 'up',
  versionStatus: 'recommended',
  startedAt: '2026-10-23T01:05:00.000Z',
  traffic: { readBytes: 5 * 1024 ** 2, writtenBytes: 1024 ** 2 },
  pid: 4242,
  recentLines: [{ time: '2026-10-23T01:05:10.000Z', severity: 'info', message: 'Bootstrapped 100% (done): Done' }],
  external: [
    { kind: 'tor-browser', socksPort: 9150, controlPort: 9151, torVersion: '0.4.9.14', unauthenticated: false },
  ],
  usedBy: [{ id: 'node-1', name: 'My Bitcoin node', running: true, kind: 'node' }],
};

const PRIVACY: NodePrivacy = {
  mode: 'off',
  onionService: false,
  onionAddress: null,
  privateBroadcast: false,
  privateBroadcastSupported: true,
  manageable: true,
  networks: [
    { name: 'ipv4', reachable: true, proxy: '' },
    { name: 'onion', reachable: false, proxy: '' },
  ],
  restartRequired: false,
  i2p: false,
};

const NO_ROUTER: I2pRouterStatus = {
  available: false,
  samAddress: '127.0.0.1:7656',
  samVersion: null,
  program: null,
  runningWithoutSam: null,
  checkedAt: new Date().toISOString(),
  error: null,
};
const I2PD: I2pRouterStatus = { ...NO_ROUTER, available: true, samVersion: '3.3', program: 'i2pd' };

const installJob: Job = {
  id: 'job-9',
  kind: 'tor.install',
  title: 'Set up Tor',
  state: 'running',
  progress: { stage: 'downloading', message: 'Downloading.', fraction: 0.5 },
  createdAt: '2026-10-23T10:00:00.000Z',
  updatedAt: '2026-10-23T10:00:05.000Z',
};

let torStatus: TorStatus;
let privacy: NodePrivacy;
let router: I2pRouterStatus;

beforeEach(() => {
  torStatus = RUNNING;
  privacy = PRIVACY;
  router = NO_ROUTER;
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'tor.status':
        return Promise.resolve(torStatus);
      case 'tor.install':
        return Promise.resolve({ jobId: 'job-9' });
      case 'jobs.get':
        return Promise.resolve(installJob);
      case 'tor.stop':
        return Promise.resolve({ ...torStatus, state: 'stopped', pid: null });
      case 'nodes.privacy':
        return Promise.resolve(privacy);
      case 'nodes.privacy.configure':
        return Promise.resolve({ changedKeys: ['proxy', 'onion', 'onlynet'], restarting: true });
      case 'i2p.status':
        return Promise.resolve(router);
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Tor & Privacy', () => {
  it('offers to set up Tor with verification, and shows the installation as a job', async () => {
    torStatus = {
      ...RUNNING,
      state: 'not-installed',
      installed: null,
      runningVersion: null,
      bootstrap: null,
      pid: null,
    };
    const user = userEvent.setup();
    await renderPage(<TorPage />);
    expect(
      await screen.findByText(/checks the Tor Project’s signatures on the download and on its checksums/),
    ).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Set up Tor' }));
    expect(callOrchestrator).toHaveBeenCalledWith('tor.install', {});
    expect(await screen.findByText('Checking the Tor Project’s signatures')).toBeDefined();
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('shows the connection, the ports, the nodes that use Tor and other software’s tor', async () => {
    await renderPage(<TorPage />);
    expect(await screen.findByText('Connected to the Tor network')).toBeDefined();
    expect(screen.getByText('127.0.0.1:9050')).toBeDefined();
    expect(screen.getByText('127.0.0.1:9054')).toBeDefined();
    expect(screen.getByRole('link', { name: 'My Bitcoin node' })).toBeDefined();
    expect(screen.getByText('Tor Browser')).toBeDefined();
    expect(screen.getByText('Bootstrapped 100% (done): Done')).toBeDefined();
    expect(screen.getByText('Recommended')).toBeDefined();
  });

  it('asks before stopping Tor while nodes route through it', async () => {
    const user = userEvent.setup();
    await renderPage(<TorPage />);
    await user.click(await screen.findByRole('button', { name: 'Stop Tor' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/My Bitcoin node/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Stop Tor' }));
    expect(callOrchestrator).toHaveBeenCalledWith('tor.stop', {}, { timeoutMs: 30_000 });
  });

  it('explains a connection problem with what to do about it', async () => {
    torStatus = {
      ...RUNNING,
      state: 'starting',
      circuitEstablished: false,
      bootstrap: {
        progress: 10,
        summary: 'Finishing handshake with a relay',
        tag: 'conn_done',
        stalled: false,
        problem: { warning: 'Connection refused', reason: 'CONNECTREFUSED', count: 12 },
      },
    };
    await renderPage(<TorPage />);
    expect(await screen.findByText('Connecting to the Tor network: 10 %')).toBeDefined();
    expect(screen.getByRole('progressbar')).toHaveProperty('ariaValueText', '10 %: Finishing handshake with a relay');
    expect(screen.getByText(/keeps tor from reaching the Tor network \(Connection refused\)/)).toBeDefined();
  });
});

describe('I2P', () => {
  it('says where to get a router when none runs, and finds one when asked to check again', async () => {
    const user = userEvent.setup();
    await renderPage(<TorPage />);
    expect(await screen.findByText('No I2P router is running on this computer')).toBeDefined();
    expect(screen.getByRole('link', { name: /^i2pd/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /The Java I2P router/ })).toBeDefined();
    router = I2PD;
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(callOrchestrator).toHaveBeenCalledWith('i2p.status', { refresh: true }, { timeoutMs: 30_000 });
    expect(await screen.findByText('i2pd answers on 127.0.0.1:7656 (SAM 3.3)')).toBeDefined();
  });

  it('explains how to turn on the Java router’s SAM bridge', async () => {
    router = { ...NO_ROUTER, runningWithoutSam: 'java-i2p' };
    await renderPage(<TorPage />);
    expect(await screen.findByText(/running with its SAM bridge off/)).toBeDefined();
    expect(screen.getByText('http://127.0.0.1:7657/configclients')).toBeDefined();
  });

  it('lets a node use I2P only once a router answers, and asks first', async () => {
    const user = userEvent.setup();
    const { unmount } = await renderPage(<NodePrivacyPage node={runningNode} />);
    const unavailable = await screen.findByRole('checkbox', { name: /Also connect to I2P peers/ });
    expect(unavailable).toHaveProperty('disabled', true);
    expect(screen.getByText(/Needs an I2P router running on this computer/)).toBeDefined();
    unmount();

    router = I2PD;
    await renderPage(<NodePrivacyPage node={runningNode} />);
    expect(await screen.findByText(/Through i2pd on this computer/)).toBeDefined();
    await user.click(screen.getByRole('checkbox', { name: /Also connect to I2P peers/ }));
    await user.click(screen.getByRole('button', { name: 'Review the change…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/also connects to I2P peers/)).toBeDefined();
    // The node already connects directly, so nothing says it does so again.
    expect(within(dialog).queryByText(/connects directly again/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Apply and restart' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'nodes.privacy.configure',
      {
        nodeId: 'node-1',
        change: { mode: 'off', onionService: false, privateBroadcast: false, i2p: true },
        confirmed: true,
      },
      { timeoutMs: 120_000 },
    );
  });

  it('warns when a node uses I2P but the router no longer answers', async () => {
    privacy = { ...PRIVACY, i2p: true };
    await renderPage(<NodePrivacyPage node={runningNode} />);
    expect(await screen.findByText(/No I2P router answers on 127\.0\.0\.1:7656 now/)).toBeDefined();
    // Turning I2P off stays possible.
    expect(screen.getByRole('checkbox', { name: /Also connect to I2P peers/ })).toHaveProperty('disabled', false);
  });
});

describe('Node privacy', () => {
  it('states what each choice hides and what stays visible, and applies one only after confirmation', async () => {
    const user = userEvent.setup();
    await renderPage(<NodePrivacyPage node={runningNode} />);
    // The node connects directly now, and that option is selected.
    const [direct] = await screen.findAllByRole('radio');
    expect(direct?.getAttribute('aria-checked')).toBe('true');
    expect(direct?.textContent).toContain('Current');
    const review = screen.getByRole('button', { name: 'Review the change…' });
    expect(review).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('radio', { name: /Only through Tor, onion peers only/ }));
    await user.click(screen.getByRole('checkbox', { name: /Accept connections through an onion service/ }));
    await user.click(screen.getByRole('checkbox', { name: /Send this node’s transactions privately/ }));
    await user.click(review);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/may find few peers at first/)).toBeDefined();
    expect(within(dialog).getByText(/gets an onion address/)).toBeDefined();
    expect(within(dialog).getByText(/Tor starts before the node/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Apply and restart' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'nodes.privacy.configure',
      {
        nodeId: 'node-1',
        change: { mode: 'tor-only', onionService: true, privateBroadcast: true, i2p: false },
        confirmed: true,
      },
      { timeoutMs: 120_000 },
    );
  });

  it('shows the onion address once Bitcoin Core has published it', async () => {
    privacy = {
      ...PRIVACY,
      mode: 'tor-only',
      onionService: true,
      onionAddress: 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion',
    };
    await renderPage(<NodePrivacyPage node={runningNode} />);
    expect(await screen.findByText('abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion')).toBeDefined();
  });

  it('asks to set up Tor before a node can use it', async () => {
    torStatus = { ...RUNNING, state: 'not-installed', installed: null };
    const user = userEvent.setup();
    await renderPage(<NodePrivacyPage node={runningNode} />);
    await user.click(await screen.findByRole('radio', { name: /Every connection through Tor/ }));
    expect(await screen.findByText(/Tor is not set up yet/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Review the change…' })).toHaveProperty('disabled', true);
  });

  it('only shows the routing of a node BTCortex did not set up', async () => {
    privacy = {
      ...PRIVACY,
      mode: 'custom',
      manageable: false,
      readOnlyReason: 'BTCortex changes how a node connects only for nodes it set up.',
    };
    await renderPage(<NodePrivacyPage node={runningNode} />);
    expect(await screen.findByText('BTCortex changes how a node connects only for nodes it set up.')).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
