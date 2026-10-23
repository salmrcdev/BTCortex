import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LightningConnectionWithStatus,
  LightningDashboard,
  LightningStatus,
  LocalLightningNode,
} from '@btcortex/contracts';
import { OrchestratorError } from '@/lib/orchestrator';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { LightningPage } = await import('./lightning-page');

const BOB = '02ea685eb96b581aedf27c544287874db0c5eaf8bbf7a627591a4a6ec3c10f0c1e';
const ALICE = '028289594c3877c139ddd5bcba4de51a5c788b45e67f1f2e2ad2662b2511c9e8d3';
const CAROL = '02bef60534d3f98d8a15b462234292e8cabdb3c538d928ccceab00e05ed7bb87f7';

const LOCAL: LocalLightningNode = {
  implementation: 'lnd',
  directory: 'C:\\Users\\Ada\\AppData\\Local\\Lnd',
  network: 'mainnet',
  restAddress: '127.0.0.1:8080',
  tlsCertificateFound: true,
  macaroons: [
    { kind: 'readonly', access: 'read-only' },
    { kind: 'admin', access: 'admin' },
  ],
  connectionId: null,
  running: true,
};

function status(state: LightningStatus['state']): LightningStatus {
  return {
    connectionId: 'conn-1',
    state,
    checkedAt: '2026-10-23T06:00:00.000Z',
    walletState: state === 'locked' ? 'LOCKED' : 'SERVER_ACTIVE',
    alias: state === 'locked' ? null : 'bob',
    pubkey: state === 'locked' ? null : BOB,
    network: 'mainnet',
    version: '0.21.4-beta',
    blockHeight: 950_123,
    syncedToChain: true,
    syncedToGraph: true,
    activeChannels: 2,
    inactiveChannels: 0,
    pendingChannels: 0,
    peers: 2,
  };
}

const CONNECTION: LightningConnectionWithStatus = {
  connection: {
    id: 'conn-1',
    name: 'Bob',
    implementation: 'lnd',
    restAddress: '192.168.1.20:8080',
    via: 'direct',
    certificateFingerprint: 'AB:CD',
    certificateExpiresAt: '2027-10-23T08:00:00.000Z',
    macaroon: { access: 'read-only', permissions: [], caveats: [] },
    local: false,
    createdAt: '2026-10-23T05:00:00.000Z',
  },
  status: status('ready'),
};

const DASHBOARD: LightningDashboard = {
  connection: CONNECTION.connection,
  status: CONNECTION.status,
  info: {
    pubkey: BOB,
    alias: 'bob',
    color: '#3399ff',
    version: '0.21.4-beta',
    commitHash: '390b2d2b',
    network: 'mainnet',
    blockHeight: 950_123,
    blockHash: 'f'.repeat(64),
    bestHeaderAt: '2026-10-23T05:59:00.000Z',
    syncedToChain: true,
    syncedToGraph: true,
    uris: [],
    features: [],
  },
  balances: {
    onChain: { confirmedSats: 98_999_671, unconfirmedSats: 0, lockedSats: 0, reservedForAnchorsSats: 20_000 },
    channels: {
      localSats: 691_531,
      remoteSats: 1_101_528,
      unsettledLocalSats: 0,
      unsettledRemoteSats: 0,
      pendingOpenLocalSats: 0,
      pendingOpenRemoteSats: 0,
    },
  },
  channels: [
    {
      id: '125344325632000',
      channelPoint: `${'4'.repeat(64)}:0`,
      remotePubkey: ALICE,
      peerAlias: 'alice',
      active: true,
      private: false,
      initiator: false,
      capacitySats: 1_000_000,
      localSats: 20_001,
      remoteSats: 976_528,
      localReserveSats: 10_000,
      remoteReserveSats: 10_000,
      commitFeeSats: 2811,
      unsettledSats: 0,
      sentSats: 5000,
      receivedSats: 25_001,
      pendingHtlcs: [],
      commitmentType: 'ANCHORS',
      csvDelay: 144,
      uptimeSeconds: 3600,
      lifetimeSeconds: 3600,
      baseFeeMsat: 1000,
      feePpm: 1,
    },
  ],
  pending: { limboSats: 0, channels: [] },
  peers: [
    {
      pubkey: ALICE,
      alias: 'alice',
      address: '127.0.0.1:61588',
      inbound: true,
      bytesSent: 5809,
      bytesReceived: 4789,
      satsSent: 5000,
      satsReceived: 25_001,
      pingMicros: 1500,
      syncType: 'ACTIVE_SYNC',
      flapCount: 0,
    },
  ],
  routing: {
    feesDaySats: 1,
    feesWeekSats: 1,
    feesMonthSats: 1,
    forwards30Days: 1,
    forwardedSats30Days: 25_000,
    recentForwards: [
      {
        at: '2026-10-23T05:40:36.694Z',
        channelIn: '125344325632000',
        channelOut: '125344325697536',
        peerAliasIn: 'alice',
        peerAliasOut: 'carol',
        amountInSats: 25_001,
        amountOutSats: 25_000,
        feeMsat: 1025,
      },
    ],
  },
  invoices: [
    {
      paymentHash: 'a'.repeat(64),
      memo: 'Coffee',
      valueSats: 5000,
      paidSats: 5000,
      state: 'SETTLED',
      createdAt: '2026-10-23T05:40:36.000Z',
      settledAt: '2026-10-23T05:40:37.000Z',
      expiresAt: '2026-10-24T05:40:36.000Z',
      private: false,
      keysend: false,
    },
  ],
  payments: [
    {
      paymentHash: 'b'.repeat(64),
      valueSats: 25_000,
      feeMsat: 1025,
      status: 'SUCCEEDED',
      createdAt: '2026-10-23T05:40:36.000Z',
      failureReason: null,
      destination: CAROL,
      hops: 2,
    },
  ],
  graph: { nodes: 3, channels: 2, capacitySats: 1_800_000 },
  watchtowers: { clientActive: false, towers: 0, activeTowers: 0 },
  backup: null,
  warnings: [
    {
      code: 'low-outbound',
      severity: 'info',
      message: '1 channel has less than a tenth of its capacity on this node’s side, so it can hardly send.',
      channelIds: ['125344325632000'],
    },
    {
      code: 'no-channel-backup',
      severity: 'warning',
      message: 'BTCortex has not saved a backup of this node’s channels yet.',
    },
  ],
  unavailable: [],
};

let connections: LightningConnectionWithStatus[];
let local: LocalLightningNode | null;
let addFailures: Error[];

beforeEach(() => {
  connections = [];
  local = LOCAL;
  addFailures = [];
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: unknown) => {
    switch (method) {
      case 'lightning.list':
        return Promise.resolve(connections);
      case 'lightning.detectLocal':
        return Promise.resolve(local);
      case 'lightning.add': {
        const failure = addFailures.shift();
        if (failure) return Promise.reject(failure);
        connections = [CONNECTION];
        return Promise.resolve({
          ...CONNECTION,
          connection: { ...CONNECTION.connection, name: (params as { name: string }).name },
        });
      }
      case 'lightning.dashboard':
        return Promise.resolve(DASHBOARD);
      case 'lightning.saveChannelBackup':
        return Promise.resolve({
          path: 'C:\\backups\\channel.backup',
          savedAt: '2026-10-23T06:00:00.000Z',
          channels: 1,
          bytes: 400,
        });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Lightning', () => {
  it('connects the LND found on this computer in one click, with its read-only macaroon', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage(<LightningPage search={{}} />);
    expect(await screen.findByText(/BTCortex found LND in/)).toBeDefined();
    expect(screen.getAllByText('readonly.macaroon · Read-only').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Connect with the read-only macaroon' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'lightning.add',
      { name: 'LND on this computer', source: { kind: 'local', macaroon: 'readonly' } },
      { timeoutMs: 120_000 },
    );
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ connection: 'conn-1' });
    });
  });

  it('names each file button after its field, with the file chosen so far', async () => {
    local = null;
    const user = userEvent.setup();
    await renderPage(<LightningPage search={{}} />);
    await user.click(await screen.findByRole('radio', { name: /Address and files/ }));
    const certificate = screen.getByRole('button', { name: 'TLS certificate (tls.cert) Choose…' });
    expect(certificate.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Macaroon file Choose…' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Choose…' })).toBeNull();
  });

  it('asks before keeping a macaroon that can move funds, after saying a read-only one is enough', async () => {
    local = null;
    addFailures = [
      new OrchestratorError(-32010, 'refused', {
        code: 'lightning.spending-macaroon',
        message: 'This macaroon can move the node’s funds. BTCortex only reads.',
        component: 'Lightning (LND)',
        dataRisk: 'none',
        recoveryActions: [],
      }),
    ];
    const user = userEvent.setup();
    await renderPage(<LightningPage search={{}} />);
    await user.type(await screen.findByLabelText('Name'), 'Remote node');
    await user.click(screen.getByRole('radio', { name: /lndconnect address/ }));
    await user.click(screen.getByLabelText('lndconnect address'));
    await user.paste('lndconnect://node.example.org:8080?macaroon=AgEDbG5k');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/can move the node’s funds/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Use it anyway' }));
    await waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith(
        'lightning.add',
        {
          name: 'Remote node',
          source: { kind: 'lndconnect', uri: 'lndconnect://node.example.org:8080?macaroon=AgEDbG5k' },
          acceptSpendingMacaroon: true,
        },
        { timeoutMs: 120_000 },
      );
    });
  });

  it('shows the node’s money, warnings and channel backup, and saves the backup on request', async () => {
    connections = [CONNECTION];
    const user = userEvent.setup();
    await renderPage(<LightningPage search={{ connection: 'conn-1' }} />);
    expect(await screen.findByText('Can send')).toBeDefined();
    expect(screen.getByText('691,531 sats')).toBeDefined();
    expect(screen.getByText('1,101,528 sats')).toBeDefined();
    expect(screen.getByText(/can hardly send/)).toBeDefined();
    expect(screen.getByText('BTCortex has not saved a backup of these channels yet.')).toBeDefined();
    expect(screen.getByText(/watchtower client is off/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Save channel backup' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'lightning.saveChannelBackup',
      { connectionId: 'conn-1' },
      { timeoutMs: 90_000 },
    );
  });

  it('lists channels with their liquidity and fees, payments without secrets, and forwards', async () => {
    connections = [CONNECTION];
    const user = userEvent.setup();
    const { router } = await renderPage(<LightningPage search={{ connection: 'conn-1', tab: 'channels' }} />);
    expect(await screen.findByText('1,000 msat + 1 ppm')).toBeDefined();
    expect(screen.getByRole('meter', { name: 'Share of alice’s channel on this node’s side' })).toBeDefined();
    await user.click(screen.getByRole('tab', { name: 'Payments' }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ connection: 'conn-1', tab: 'payments' });
    });
  });

  it('shows payments and routing in their tabs', async () => {
    connections = [CONNECTION];
    const { unmount } = await renderPage(<LightningPage search={{ connection: 'conn-1', tab: 'payments' }} />);
    expect(await screen.findByText('Succeeded')).toBeDefined();
    expect(screen.getByText('1.025 sats')).toBeDefined();
    expect(screen.getByText('Coffee')).toBeDefined();
    expect(screen.getByText(/never leave BTCortex’s orchestrator/)).toBeDefined();
    unmount();
    await renderPage(<LightningPage search={{ connection: 'conn-1', tab: 'routing' }} />);
    expect(await screen.findByText('alice → carol')).toBeDefined();
    expect(screen.getByText('25,000 sats forwarded')).toBeDefined();
  });

  it('explains a locked wallet instead of asking for its password', async () => {
    connections = [{ ...CONNECTION, status: status('locked') }];
    await renderPage(<LightningPage search={{}} />);
    expect(await screen.findByText(/BTCortex never asks for the wallet password/)).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('lightning.dashboard', expect.anything(), expect.anything());
  });
});
