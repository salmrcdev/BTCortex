import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectrumOverview, ElectrumServerStatus, ElectrumSetupPlan, Job } from '@btcortex/contracts';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { ElectrumPage } = await import('./electrum-page');

const NOT_SET_UP: ElectrumServerStatus = {
  nodeId: 'node-1',
  nodeName: 'My Bitcoin node',
  network: 'mainnet',
  state: 'not-set-up',
  enabled: false,
  dataDirectory: null,
  ports: null,
  indexing: null,
  server: null,
  indexBytes: null,
  connection: null,
  remoteAccess: { enabled: false, onion: null },
  runningVersion: null,
  pid: null,
  startedAt: null,
  recentLines: [],
};

const ONION = `${'a'.repeat(56)}.onion`;

const READY: ElectrumServerStatus = {
  ...NOT_SET_UP,
  state: 'ready',
  enabled: true,
  dataDirectory: 'D:\\BTCortex\\nodes\\mainnet-1-electrum',
  ports: { electrum: 50001, admin: 50100, stats: 50150 },
  server: { version: 'Fulcrum 2.1.4', height: 950_123, clients: 2, uptime: '3.2 hours', memoryBytes: 900 * 1024 ** 2 },
  indexBytes: 180e9,
  connection: {
    host: '127.0.0.1',
    port: 50001,
    protocol: 'tcp',
    server: '127.0.0.1:50001:t',
    url: 'tcp://127.0.0.1:50001',
  },
  runningVersion: '2.1.4',
  pid: 4321,
  startedAt: '2026-10-23T01:00:00.000Z',
  recentLines: [{ time: '2026-10-23T03:04:02.414Z', severity: 'info', message: 'Block height 950123, up-to-date' }],
};

const PLAN: ElectrumSetupPlan = {
  nodeId: 'node-1',
  dataDirectory: 'D:\\BTCortex\\nodes\\mainnet-1-electrum',
  volume: { root: 'D:\\', totalBytes: 2e12, freeBytes: 900e9, kind: 'ssd', bus: 'NVMe', model: 'Example SSD' },
  indexBytesEstimate: 210e9,
  transactionIndexBytesEstimate: 70e9,
  nodeChanges: [
    { key: 'txindex', value: '1' },
    { key: 'zmqpubhashblock', value: 'tcp://127.0.0.1:28332' },
  ],
  restartsNode: true,
  installsFulcrum: true,
  blockers: [],
  warnings: [{ code: 'transaction-index', message: 'Bitcoin Core first builds its transaction index.' }],
};

const setUpJob: Job = {
  id: 'job-7',
  kind: 'electrum.setup',
  title: 'Set up an Electrum server for My Bitcoin node',
  state: 'running',
  progress: { stage: 'verifying-signatures', message: 'Checking the signatures on the Fulcrum 2.1.4 checksums.' },
  createdAt: '2026-10-23T10:00:00.000Z',
  updatedAt: '2026-10-23T10:00:05.000Z',
};

let servers: ElectrumServerStatus[];
let plan: ElectrumSetupPlan;

beforeEach(() => {
  servers = [NOT_SET_UP];
  plan = PLAN;
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'electrum.overview':
        return Promise.resolve({
          installed: servers.some((server) => server.state !== 'not-set-up')
            ? { version: '2.1.4', verifiedAt: '2026-10-23T00:00:00.000Z' }
            : null,
          servers,
        } satisfies ElectrumOverview);
      case 'electrum.plan':
        return Promise.resolve({
          ...plan,
          ...(typeof params['dataDirectory'] === 'string' ? { dataDirectory: params['dataDirectory'] } : {}),
        });
      case 'electrum.setUp':
        return Promise.resolve({ jobId: 'job-7' });
      case 'jobs.get':
        return Promise.resolve(setUpJob);
      case 'electrum.stop':
        return Promise.resolve({ ...READY, state: 'stopped', enabled: false, pid: null, server: null });
      case 'electrum.remove':
        return Promise.resolve({ deletedBytes: 180e9, keptDirectory: null });
      case 'nodes.list':
        return Promise.resolve([runningNode]);
      case 'apps.sparrow.status':
        return Promise.resolve({
          installed: { version: '2.4.2', verifiedAt: '2026-10-22T10:00:00.000Z' },
          running: false,
          settingsFound: true,
          connection: {
            usesThisNode: false,
            otherServer: { serverType: 'BITCOIN_CORE', server: 'http://127.0.0.1:8332' },
          },
        });
      case 'apps.sparrow.connect':
        return Promise.resolve({ jobId: 'job-8' });
      case 'apps.electrum.status':
        return Promise.resolve({
          installed: null,
          application: { version: '4.7.2', directory: 'C:\\Program Files\\Electrum' },
          opens: 'application',
          latest: '4.8.2',
          applicationOutdated: true,
          running: false,
          server: '127.0.0.1:50001:t',
        });
      case 'apps.electrum.open':
        return Promise.resolve({ jobId: 'job-9' });
      case 'electrum.remoteAccess':
        return Promise.resolve({ ...READY, remoteAccess: { enabled: true, onion: null } });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Electrum servers', () => {
  it('shows what a set-up involves before anything changes, then runs it as a job', async () => {
    const user = userEvent.setup();
    await renderPage(<ElectrumPage />);
    await user.click(await screen.findByRole('button', { name: 'Set up an Electrum server' }));
    const plan = await screen.findByRole('region', { name: 'Before it is set up' });
    expect(within(plan).getByText('D:\\BTCortex\\nodes\\mainnet-1-electrum')).toBeDefined();
    expect(within(plan).getByText('txindex=1')).toBeDefined();
    expect(within(plan).getByText('zmqpubhashblock=tcp://127.0.0.1:28332')).toBeDefined();
    expect(within(plan).getByText('The node restarts once to apply them.')).toBeDefined();
    expect(within(plan).getByText(/its author’s signature is checked/)).toBeDefined();
    expect(within(plan).getByText(/first builds its transaction index/)).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('electrum.setUp', expect.anything());

    await user.click(within(plan).getByRole('button', { name: 'Set up the server' }));
    expect(callOrchestrator).toHaveBeenCalledWith('electrum.setUp', {
      nodeId: 'node-1',
      dataDirectory: 'D:\\BTCortex\\nodes\\mainnet-1-electrum',
      confirmed: true,
    });
    expect(await screen.findByText('Checking the author’s signature')).toBeDefined();
  });

  it('cannot be set up while something prevents it, and says what', async () => {
    plan = {
      ...PLAN,
      blockers: [{ code: 'disk-space', message: 'The index needs about 252 GB, but D:\\ has 90 GB free.' }],
    };
    const user = userEvent.setup();
    await renderPage(<ElectrumPage />);
    await user.click(await screen.findByRole('button', { name: 'Set up an Electrum server' }));
    expect(await screen.findByText(/D:\\ has 90 GB free/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Set up the server' })).toHaveProperty('disabled', true);
  });

  it('explains why a pruned node cannot have one', async () => {
    servers = [{ ...NOT_SET_UP, unavailableReason: 'pruned' }];
    await renderPage(<ElectrumPage />);
    expect(await screen.findByText(/keeps only recent blocks \(it is pruned\)/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Set up an Electrum server' })).toBeNull();
  });

  it('follows indexing with its progress and the steps already done', async () => {
    servers = [
      {
        ...READY,
        state: 'indexing',
        progress: 0.42,
        server: null,
        indexing: { indexedHeight: 400_000, targetHeight: 950_000, blocksPerSecond: 85.3 },
      },
    ];
    await renderPage(<ElectrumPage />);
    expect(await screen.findByText('Indexing the blocks (42%)')).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('42.0%: block 400,000 of 950,000');
    expect(screen.getByText('85.3 blocks a second at the moment')).toBeDefined();
    const steps = screen.getByRole('list', { name: 'Progress' });
    expect(within(steps).getByText('Blocks indexed').closest('li')?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText(/Wallets can connect when indexing is finished/)).toBeDefined();
  });

  it('tells each wallet how to connect once ready, with values to copy', async () => {
    servers = [READY];
    await renderPage(<ElectrumPage />);
    expect(await screen.findByText('Ready for wallets')).toBeDefined();
    expect(screen.getAllByText('127.0.0.1:50001:t').length).toBeGreaterThan(0);
    expect(screen.getByText('tcp://127.0.0.1:50001')).toBeDefined();
    expect(screen.getByText(/Private Electrum: URL 127\.0\.0\.1, port 50001, with SSL off/)).toBeDefined();
    expect(screen.getByText(/Custom Electrum server: 127\.0\.0\.1:50001:t/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy: Server' })).toBeDefined();
    // The version that runs, and how many wallets use it.
    expect(screen.getByText('2.1.4')).toBeDefined();
    expect(screen.getByText('Wallets connected').nextElementSibling?.textContent).toBe('2');
    expect(screen.getByText('Block height 950123, up-to-date')).toBeDefined();
  });

  it('sets Sparrow up for the server, with consent to replace the server Sparrow uses now', async () => {
    servers = [READY];
    const user = userEvent.setup();
    await renderPage(<ElectrumPage />);
    await user.click(await screen.findByRole('button', { name: 'Use Sparrow with this server' }));
    expect(callOrchestrator).toHaveBeenCalledWith('apps.sparrow.status', { nodeId: 'node-1', via: 'electrum' });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/It will use this Electrum server instead/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Use this server' }));
    expect(callOrchestrator).toHaveBeenCalledWith('apps.sparrow.connect', {
      nodeId: 'node-1',
      replaceExistingServer: true,
      resetStartupNetwork: false,
      via: 'electrum',
    });
  });

  it('opens the Electrum installed on this computer with the server, and says it is outdated', async () => {
    servers = [READY];
    const user = userEvent.setup();
    await renderPage(<ElectrumPage />);
    expect(
      await screen.findByText('Opens the Electrum 4.7.2 installed on this computer, with your wallets.'),
    ).toBeDefined();
    expect(screen.getByText(/Electrum 4\.8\.2 is available: its updates fix security issues/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Open Electrum with this server' }));
    expect(callOrchestrator).toHaveBeenCalledWith('apps.electrum.open', { nodeId: 'node-1' });
  });

  it('makes the server reachable through Tor only after saying what that means', async () => {
    servers = [READY];
    const user = userEvent.setup();
    await renderPage(<ElectrumPage />);
    await user.click(await screen.findByRole('button', { name: 'Allow access through Tor…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Anyone who learns the onion address can use the server/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Allow access' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'electrum.remoteAccess',
      { nodeId: 'node-1', enabled: true, confirmed: true },
      { timeoutMs: 120_000 },
    );
  });

  it('shows the onion address to enter or scan on other devices', async () => {
    servers = [
      {
        ...READY,
        remoteAccess: {
          enabled: true,
          onion: {
            host: ONION,
            port: 50001,
            server: `${ONION}:50001:t`,
            url: `tcp://${ONION}:50001`,
            qr: { size: 21, rows: Array.from({ length: 21 }, () => '1'.repeat(21)) },
          },
        },
      },
    ];
    await renderPage(<ElectrumPage />);
    expect(await screen.findByText('Reachable through Tor')).toBeDefined();
    expect(screen.getByText(`${ONION}:50001:t`)).toBeDefined();
    expect(screen.getByRole('img', { name: 'QR code of the server’s onion address' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Turn off access through Tor' })).toBeDefined();
  });

  it('asks before stopping a server wallets are using', async () => {
    servers = [READY];
    const user = userEvent.setup();
    await renderPage(<ElectrumPage />);
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('2 wallets are connected to it and will lose their connection.')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Stop the server' }));
    expect(callOrchestrator).toHaveBeenCalledWith('electrum.stop', { nodeId: 'node-1' }, { timeoutMs: 60_000 });
  });

  it('deletes the index only when asked to', async () => {
    servers = [READY];
    const user = userEvent.setup();
    await renderPage(<ElectrumPage />);
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('checkbox', { name: /Also delete the index/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove the server' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'electrum.remove',
      { nodeId: 'node-1', deleteIndex: true, confirmed: true },
      { timeoutMs: 120_000 },
    );
  });
});
