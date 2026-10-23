import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { LightningConnectionWithStatus, OrchestratorEvent } from '@btcortex/contracts';
import { certificateFingerprint, findLocalLnd } from '@btcortex/integration-lnd';
import { LightningService } from '../../apps/orchestrator/src/lightning/lightning-service';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { SettingsStore } from '../../apps/orchestrator/src/persistence/settings';
import {
  addInvoice,
  connectPeers,
  findTestLnd,
  fund,
  mine,
  openChannel,
  payInvoice,
  startLndNode,
  waitFor,
  waitForRoute,
} from './support/lnd-node';
import type { LndNode } from './support/lnd-node';
import { findTestBitcoind, removeTestRoot, startRegtestNode } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// BTCortex's Lightning connections against real LND nodes on regtest
// (specification sections 11 and 31.1): alice pays carol through bob, bob
// pays alice back, and BTCortex reads all three with read-only macaroons.
// Nothing here touches a real network or real funds.

const bitcoindPath = findTestBitcoind();
const lndPath = findTestLnd();

describe.skipIf(!bitcoindPath || !lndPath)('Lightning with real LND nodes on regtest', () => {
  let root: string;
  let bitcoind: RegtestNode;
  let alice: LndNode;
  let bob: LndNode;
  let carol: LndNode;
  let database: DatabaseSync;
  let lightning: LightningService;
  const secrets = new Map<string, string>();
  const events: OrchestratorEvent[] = [];
  const connections = new Map<string, LightningConnectionWithStatus>();
  // Undone in reverse order, whatever failed along the way.
  const cleanup: (() => unknown)[] = [];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-lightning-'));
    bitcoind = await startRegtestNode(bitcoindPath ?? '');
    cleanup.push(() => bitcoind.stop());
    await bitcoind.client.call('createwallet', ['miner']);
    await mine(bitcoind, 101);
    // Alice is laid out as an LND installed for this Windows user, to be found by BTCortex.
    const started = await Promise.allSettled([
      startLndNode(lndPath ?? '', bitcoind, 'alice', { localAppData: join(root, 'Local') }),
      startLndNode(lndPath ?? '', bitcoind, 'bob'),
      startLndNode(lndPath ?? '', bitcoind, 'carol'),
    ]);
    for (const result of started) {
      if (result.status === 'fulfilled') cleanup.push(() => result.value.stop());
    }
    const failed = started.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    [alice, bob, carol] = started.map((result) => (result as PromiseFulfilledResult<LndNode>).value) as [
      LndNode,
      LndNode,
      LndNode,
    ];
    await fund(bitcoind, alice, 1);
    await fund(bitcoind, bob, 1);
    await connectPeers(alice, bob);
    await connectPeers(bob, carol);
    await openChannel(alice, bob, 1_000_000);
    await openChannel(bob, carol, 800_000, 100_000);
    await mine(bitcoind, 6);
    await waitForRoute(alice, carol, 25_000);
    await payInvoice(alice, await addInvoice(carol, 25_000, 'Through bob'));
    await payInvoice(bob, await addInvoice(alice, 5_000, 'Bob pays alice'));
    await addInvoice(alice, 1_234, 'Never paid');

    const logger = new StructuredLogger([new MemorySink(5000)], 'debug');
    database = openDatabase({ file: join(root, 'btcortex.db'), migrations, logger });
    cleanup.push(() => {
      database.close();
    });
    lightning = new LightningService({
      settings: new SettingsStore(database),
      vault: {
        store: (_purpose, plaintext) => {
          const id = `secret-${String(secrets.size + 1)}`;
          secrets.set(id, plaintext);
          return Promise.resolve(id);
        },
        reveal: (id) => Promise.resolve(secrets.get(id) ?? ''),
        remove: (id) => secrets.delete(id),
      },
      paths: { root },
      logger,
      publish: (event) => events.push(event),
      findLocal: () => findLocalLnd({ env: { LOCALAPPDATA: join(root, 'Local') } }),
    });
    cleanup.push(() => {
      lightning.shutdown();
    });
  }, 300_000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) {
      try {
        await step();
      } catch {
        // Keep undoing the rest.
      }
    }
    removeTestRoot(root);
  }, 120_000);

  it('finds the LND installed for this user, with its network, address and macaroons, and only reads', async () => {
    const local = await lightning.detectLocal();
    expect(local).toMatchObject({
      implementation: 'lnd',
      directory: join(root, 'Local', 'Lnd'),
      network: 'regtest',
      restAddress: alice.restAddress,
      tlsCertificateFound: true,
      running: true,
      connectionId: null,
    });
    expect(local?.macaroons).toEqual([
      { kind: 'readonly', access: 'read-only' },
      { kind: 'invoice', access: 'invoices' },
      { kind: 'admin', access: 'admin' },
    ]);
  });

  it('connects to it with the read-only macaroon, which stays in the vault', async () => {
    const added = await lightning.add({ name: 'Alice', source: { kind: 'local', macaroon: 'readonly' } });
    connections.set('alice', added);
    expect(added.connection).toMatchObject({
      name: 'Alice',
      implementation: 'lnd',
      restAddress: alice.restAddress,
      via: 'direct',
      local: true,
      certificateFingerprint: certificateFingerprint(alice.tlsCertificate),
      macaroon: { access: 'read-only' },
    });
    expect(added.status).toMatchObject({
      state: 'ready',
      alias: 'alice',
      network: 'regtest',
      version: '0.21.4-beta',
      walletState: 'SERVER_ACTIVE',
      activeChannels: 1,
    });
    // The macaroon is in the vault only: neither the settings nor what the interface receives hold it.
    const readonly = alice.macaroon('readonly');
    expect([...secrets.values()]).toContain(readonly);
    const stored = database.prepare("SELECT value FROM settings WHERE key = 'lightning'").get();
    expect(String(stored?.['value'])).toContain(added.connection.id);
    expect(String(stored?.['value'])).not.toContain(readonly);
    expect(JSON.stringify(lightning.list())).not.toContain(readonly);
    expect((await lightning.detectLocal())?.connectionId).toBe(added.connection.id);
  });

  it('refuses a macaroon that can move funds until the user accepts it, and then warns about it', async () => {
    const source = {
      kind: 'files' as const,
      restAddress: bob.restAddress,
      tlsCertificatePath: bob.tlsCertificatePath,
      macaroonPath: bob.macaroonPath('admin'),
    };
    await expect(lightning.add({ name: 'Bob (admin)', source })).rejects.toMatchObject({
      error: { code: 'lightning.spending-macaroon' },
    });
    const added = await lightning.add({ name: 'Bob (admin)', source, acceptSpendingMacaroon: true });
    expect(added.connection.macaroon.access).toBe('admin');
    const dashboard = await lightning.dashboard(added.connection.id);
    expect(dashboard.warnings.map((warning) => warning.code)).toContain('admin-macaroon');
    const secretsBefore = secrets.size;
    lightning.remove(added.connection.id);
    expect(secrets.size).toBe(secretsBefore - 1);
    expect(lightning.list().map((entry) => entry.connection.name)).toEqual(['Alice']);
  });

  it('reads the routing node: channels and their liquidity, peers, fees earned and forwards', async () => {
    const added = await lightning.add({
      name: 'Bob',
      source: {
        kind: 'files',
        restAddress: bob.restAddress,
        tlsCertificatePath: bob.tlsCertificatePath,
        macaroonPath: bob.macaroonPath('readonly'),
      },
    });
    connections.set('bob', added);
    const dashboard = await lightning.dashboard(added.connection.id);
    expect(dashboard.unavailable).toEqual([]);
    expect(dashboard.info).toMatchObject({ alias: 'bob', network: 'regtest', syncedToChain: true });
    expect(dashboard.channels).toHaveLength(2);
    const toAlice = dashboard.channels.find((channel) => channel.remotePubkey === alice.pubkey);
    const toCarol = dashboard.channels.find((channel) => channel.remotePubkey === carol.pubkey);
    expect(toAlice).toMatchObject({
      capacitySats: 1_000_000,
      initiator: false,
      active: true,
      baseFeeMsat: 1000,
      feePpm: 1,
    });
    expect(toCarol).toMatchObject({ capacitySats: 800_000, initiator: true, active: true });
    expect(dashboard.peers.map((peer) => peer.pubkey).sort()).toEqual([alice.pubkey, carol.pubkey].sort());
    expect(dashboard.routing).toMatchObject({ feesDaySats: 1, forwards30Days: 1, forwardedSats30Days: 25_000 });
    expect(dashboard.routing.recentForwards[0]).toMatchObject({
      amountInSats: 25_001,
      amountOutSats: 25_000,
      feeMsat: 1025,
    });
    expect(dashboard.graph).toMatchObject({ nodes: 3, channels: 2 });
    expect(dashboard.watchtowers).toEqual({ clientActive: false, towers: 0, activeTowers: 0 });
    // Almost all of the channel from alice is on alice's side: bob can hardly send through it.
    const lowOutbound = dashboard.warnings.find((warning) => warning.code === 'low-outbound');
    expect(lowOutbound?.channelIds).toEqual([toAlice?.id]);
    expect(dashboard.warnings.map((warning) => warning.code)).toContain('no-channel-backup');
  });

  it('reads invoices and payments, and never passes on their preimages', async () => {
    const dashboard = await lightning.dashboard(connections.get('alice')?.connection.id ?? '');
    expect(dashboard.invoices.map((invoice) => [invoice.memo, invoice.state, invoice.paidSats])).toEqual([
      ['Never paid', 'OPEN', 0],
      ['Bob pays alice', 'SETTLED', 5_000],
    ]);
    expect(dashboard.payments).toEqual([
      expect.objectContaining({
        status: 'SUCCEEDED',
        valueSats: 25_000,
        feeMsat: 1025,
        destination: carol.pubkey,
        hops: 2,
      }),
    ]);
    const payments = (await alice.admin.get('/v1/payments')) as { payments: { payment_preimage: string }[] };
    const invoices = (await alice.admin.get('/v1/invoices')) as { invoices: { r_preimage: string }[] };
    const shown = JSON.stringify(dashboard);
    for (const { payment_preimage: preimage } of payments.payments) expect(shown).not.toContain(preimage);
    for (const { r_preimage: preimage } of invoices.invoices) {
      expect(shown).not.toContain(preimage);
      expect(shown).not.toContain(Buffer.from(preimage, 'base64').toString('hex'));
    }
  });

  it('saves a channel backup that LND itself accepts', async () => {
    const connectionId = connections.get('bob')?.connection.id ?? '';
    const record = await lightning.saveChannelBackup(connectionId);
    expect(record).toMatchObject({ channels: 2 });
    expect(record.path.startsWith(join(root, 'backups', 'lightning'))).toBe(true);
    const backup = readFileSync(record.path);
    expect(backup.length).toBe(record.bytes);
    await expect(
      bob.admin.post('/v1/channels/backup/verify', {
        multi_chan_backup: { multi_chan_backup: backup.toString('base64') },
      }),
    ).resolves.toBeDefined();
    const dashboard = await lightning.dashboard(connectionId);
    expect(dashboard.backup).toEqual(record);
    expect(dashboard.warnings.map((warning) => warning.code)).not.toContain('no-channel-backup');
  });

  it('connects through an lndconnect address', async () => {
    const certificate = carol.tlsCertificate.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const uri = `lndconnect://${carol.restAddress}?cert=${Buffer.from(certificate, 'base64').toString('base64url')}&macaroon=${Buffer.from(carol.macaroon('readonly'), 'hex').toString('base64url')}`;
    const added = await lightning.add({ name: 'Carol', source: { kind: 'lndconnect', uri } });
    connections.set('carol', added);
    expect(added.status).toMatchObject({ state: 'ready', alias: 'carol' });
    await expect(lightning.add({ name: 'Carol again', source: { kind: 'lndconnect', uri } })).rejects.toMatchObject({
      error: { code: 'lightning.duplicate' },
    });
  });

  it('says when the macaroon is another node’s, the certificate is not the node’s, or the node is down', async () => {
    await expect(
      lightning.add({
        name: 'Wrong macaroon',
        source: {
          kind: 'files',
          restAddress: alice.restAddress,
          tlsCertificatePath: alice.tlsCertificatePath,
          macaroonPath: bob.macaroonPath('readonly'),
        },
      }),
    ).rejects.toMatchObject({ error: { code: 'lightning.macaroon-rejected' } });
    await expect(
      lightning.add({
        name: 'Wrong certificate',
        source: {
          kind: 'files',
          restAddress: alice.restAddress,
          tlsCertificatePath: bob.tlsCertificatePath,
          macaroonPath: alice.macaroonPath('readonly'),
        },
      }),
    ).rejects.toMatchObject({ error: { code: 'lightning.certificate-mismatch' } });

    const carolId = connections.get('carol')?.connection.id ?? '';
    await carol.stop();
    const status = await lightning.refresh(carolId);
    expect(status).toMatchObject({ state: 'unreachable', error: { code: 'lightning.unreachable' }, alias: 'carol' });
    await waitFor(
      () => Promise.resolve(events),
      (seen) =>
        seen.some(
          (event) =>
            event.type === 'lightning.status' &&
            event.payload.connectionId === carolId &&
            event.payload.state === 'unreachable',
        ),
      'the status event',
      10_000,
    );
  });

  it('forgets a node and deletes its macaroon, keeping the saved backups', async () => {
    const bobConnection = connections.get('bob')?.connection.id ?? '';
    const backup = (await lightning.dashboard(bobConnection)).backup;
    const before = secrets.size;
    lightning.remove(bobConnection);
    expect(secrets.size).toBe(before - 1);
    expect(
      lightning
        .list()
        .map((entry) => entry.connection.name)
        .sort(),
    ).toEqual(['Alice', 'Carol']);
    expect(existsSync(backup?.path ?? '')).toBe(true);
  });
});
