import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { parse as parsePath, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { BitcoinConfig, maskSecrets } from '@btcortex/bitcoin-config';
import { AppFailure, BackupRunSchema, BackupScheduleSchema, RestoreOutcomeSchema } from '@btcortex/contracts';
import type {
  AppError,
  BackupItem,
  BackupOverview,
  BackupRun,
  BackupSchedule,
  BackupSettings,
  BackupVerification,
  LightningConnectionWithStatus,
  NodeProfile,
  NotBackedUp,
  RestoreOutcome,
  RestorePreview,
} from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import type { JobManager, JobProgressReporter } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import { localDataDirectory } from '../nodes/local-files';
import type { NodeConfigService } from '../nodes/config-service';
import type { NodeManager } from '../nodes/node-manager';
import type { SettingsStore } from '../persistence/settings';
import { electrumWalletsFolder } from '../platform/paths';
import type { AppPaths } from '../platform/paths';
import type { SecretVault } from '../vault/vault';
import {
  applyRetention,
  BackupFormatError,
  listBackups,
  readBackupFile,
  readManifest,
  summarise,
  unlockBackup,
  verifyBackup,
  WrongPassphraseError,
  writeBackup,
} from './archive';
import type { BackupItemData, Manifest } from './archive';

// The backup centre (specification section 22). Items are kept apart by kind:
// configuration (BTCortex's settings and node profiles, each node's
// bitcoin.conf), wallets (consistent copies made by Bitcoin Core with
// backupwallet), public descriptors, LND channel backups and the credentials
// in the vault. Wallets and credentials go only into encrypted backups;
// without a passphrase, bitcoin.conf is saved with its passwords left out.
// Blockchain data and indexes are not backed up, because they can be
// downloaded or rebuilt, and seeds never pass through BTCortex at all.
// Restoring puts back a managed node's bitcoin.conf through the configuration
// service's checks, and wallets through Bitcoin Core's restorewallet.

const COMPONENT = 'Backups';
const SETTINGS_KEY = 'backups';
const SCHEDULE_CHECK_MS = 10 * 60 * 1000;
const WALLET_RPC_TIMEOUT_MS = 10 * 60 * 1000;
/** restorewallet rescans the chain from the wallet's birth, which can take a long time. */
const RESTORE_RPC_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const ONION_ADDRESSES_LEFT_OUT =
  'The onion addresses of the Electrum servers are left out: anyone who has one can use the server. Only encrypted backups keep them.';

/**
 * The Electrum servers' settings without their onion addresses, which give
 * access to a server, for backups without a passphrase.
 */
function withoutOnionAddresses(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { servers?: unknown }).servers)) {
    return value;
  }
  const servers = (value as { servers: unknown[] }).servers.map((server) => {
    if (typeof server !== 'object' || server === null) return server;
    const { onion } = server as { onion?: unknown };
    if (typeof onion !== 'object' || onion === null) return server;
    const { serviceId: _leftOut, ...rest } = onion as Record<string, unknown>;
    return { ...server, onion: rest };
  });
  return { ...value, servers };
}

/** Plain explanations for the file system errors a backup folder runs into. */
const FILE_SYSTEM_PROBLEMS: Partial<Record<string, string>> = {
  ENOSPC: 'The destination is full.',
  EACCES: 'BTCortex may not write to the destination folder.',
  EPERM: 'BTCortex may not write to the destination folder.',
  EROFS: 'The destination is read-only.',
  ENOENT: 'The folder cannot be reached: check that its drive is connected and the path is right.',
  ENOTDIR: 'The folder cannot be reached: check that its drive is connected and the path is right.',
};

const StoredSettingsSchema = z.object({
  destination: z.string().nullable(),
  retention: z.number().int().min(1).max(100),
  schedule: BackupScheduleSchema,
  passphraseSecretId: z.string().nullable(),
  lastRun: BackupRunSchema.nullable(),
  lastRestore: RestoreOutcomeSchema.nullable(),
});
type StoredSettings = z.infer<typeof StoredSettingsSchema>;

const DEFAULT_SETTINGS: StoredSettings = {
  destination: null,
  retention: 10,
  schedule: { everyHours: 0, encrypted: false },
  passphraseSecretId: null,
  lastRun: null,
  lastRestore: null,
};

const NOT_BACKED_UP: NotBackedUp[] = [
  {
    kind: 'blockchain',
    title: 'Blockchain data',
    description:
      'Blocks and the chain state are not backed up: a node downloads them again from the network and verifies them itself.',
  },
  {
    kind: 'index',
    title: 'Indexes',
    description:
      'The transaction index, block filters and Electrum server indexes are not backed up: they are rebuilt from the blocks.',
  },
  {
    kind: 'seed',
    title: 'Recovery phrases and hardware wallets',
    description:
      'BTCortex never sees seeds, so it cannot back them up: keep their backups yourself. A configuration backup alone never recovers funds.',
  },
];

const README = `BTCortex backup
===============

This folder was written by BTCortex. manifest.json lists every file with its
SHA-256, so BTCortex (Backups > Verify) can check that nothing changed.

What each kind of item is
-------------------------
- configuration: BTCortex's settings and node profiles (JSON) and each node's
  bitcoin.conf. Without a passphrase, passwords in bitcoin.conf are left out.
  A configuration backup alone never recovers funds.
- wallet: a copy of a Bitcoin Core wallet made by the node itself
  (backupwallet). It holds the wallet's private keys unless it is watch-only.
- descriptors: a wallet's public descriptors. They let a wallet be watched
  again; they cannot spend.
- channel: an LND static channel backup. Together with the LND node's seed it
  recovers the funds in its channels.
- credentials: passwords, macaroons and onion-service keys BTCortex kept.

Encrypted backups
-----------------
When manifest.json has an "encryption" entry, every file ends in .enc and is
AES-256-GCM under a key derived from the passphrase with scrypt. Restore
through BTCortex (Backups > Restore), which asks for the passphrase.

Restoring by hand
-----------------
- bitcoin.conf: copy it into the node's data folder while the node is stopped.
- Wallets: bitcoin-cli restorewallet "<name>" "<path to the file>".
- Channel backups: restore LND from its seed, then
  lncli restorechanbackup --multi_file <path to the file>.
`;

export interface BackupServiceOptions {
  settings: SettingsStore;
  vault: Pick<SecretVault, 'store' | 'reveal' | 'remove' | 'list'>;
  nodes: Pick<NodeManager, 'list' | 'get' | 'rpc'>;
  config: Pick<NodeConfigService, 'get' | 'save'>;
  profiles: () => NodeProfile[];
  lightning: {
    list: () => LightningConnectionWithStatus[];
    channelBackup: (connectionId: string) => Promise<{ backup: Uint8Array; channelPoints: number }>;
  };
  jobs: JobManager;
  paths: Pick<AppPaths, 'root' | 'temporary'>;
  logger: Logger;
  version: string;
  now?: () => Date;
  /** Shows a folder in File Explorer; replaced in tests. */
  reveal?: (path: string) => void;
}

function revealInExplorer(path: string): void {
  if (process.platform !== 'win32') return;
  spawn('explorer.exe', ['/select,', path], { detached: true, stdio: 'ignore' }).unref();
}

/** Wallet ids carry the name encoded, since the default wallet's name is empty. */
const walletLabel = (name: string) => (name === '' ? 'Default wallet' : `Wallet “${name}”`);

function volumeOf(path: string): string {
  return parsePath(resolve(path)).root.toLowerCase();
}

export class BackupService {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly options: BackupServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private failure(code: string, message: string, extra: Partial<AppError> = {}): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [], ...extra });
  }

  // Settings

  private stored(): StoredSettings {
    return this.options.settings.get(SETTINGS_KEY, StoredSettingsSchema) ?? DEFAULT_SETTINGS;
  }

  private save(change: Partial<StoredSettings>): StoredSettings {
    const next = { ...this.stored(), ...change };
    this.options.settings.set(SETTINGS_KEY, next);
    return next;
  }

  private publicSettings(stored: StoredSettings): BackupSettings {
    return {
      destination: stored.destination,
      retention: stored.retention,
      schedule: stored.schedule,
      passphraseStored: stored.passphraseSecretId !== null,
      lastRun: stored.lastRun,
    };
  }

  /** The settings and the last run, without reading anything else; for monitoring. */
  settings(): BackupSettings {
    return this.publicSettings(this.stored());
  }

  async configure(change: {
    destination?: string | null | undefined;
    retention?: number | undefined;
    schedule?: BackupSchedule | undefined;
    passphrase?: string | undefined;
    forgetPassphrase?: true | undefined;
  }): Promise<BackupSettings> {
    let stored = this.stored();
    if (change.destination !== undefined && change.destination !== null) {
      const destination = resolve(change.destination);
      // Windows paths are not case-sensitive.
      const comparable = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
      const root = comparable(resolve(this.options.paths.root));
      if (comparable(destination) === root || comparable(destination).startsWith(`${root}${sep}`)) {
        throw this.failure(
          'backups.destination-inside-data',
          'Backups cannot go into BTCortex’s own data folder. Choose a folder elsewhere, ideally on another disk.',
        );
      }
      await mkdir(destination, { recursive: true });
    }
    if (change.forgetPassphrase && stored.passphraseSecretId !== null) {
      this.options.vault.remove(stored.passphraseSecretId);
      stored = this.save({ passphraseSecretId: null });
    }
    if (change.passphrase !== undefined) {
      if (stored.passphraseSecretId !== null) this.options.vault.remove(stored.passphraseSecretId);
      const secretId = await this.options.vault.store('Passphrase for scheduled backups', change.passphrase);
      stored = this.save({ passphraseSecretId: secretId });
    }
    const schedule = change.schedule ?? stored.schedule;
    if (schedule.encrypted && stored.passphraseSecretId === null) {
      throw this.failure(
        'backups.passphrase-needed',
        'Encrypted scheduled backups need a passphrase that BTCortex keeps for them.',
      );
    }
    stored = this.save({
      ...(change.destination === undefined
        ? {}
        : { destination: change.destination === null ? null : resolve(change.destination) }),
      ...(change.retention === undefined ? {} : { retention: change.retention }),
      schedule,
    });
    this.options.logger.info('Backup settings changed', {
      destination: stored.destination,
      retention: stored.retention,
      everyHours: stored.schedule.everyHours,
      encrypted: stored.schedule.encrypted,
    });
    return this.publicSettings(stored);
  }

  // What can be backed up

  async inventory(): Promise<BackupItem[]> {
    const items: BackupItem[] = [
      {
        id: 'btcortex.settings',
        kind: 'configuration',
        title: 'BTCortex settings and node profiles',
        component: 'BTCortex',
        description:
          'How BTCortex is set up: its nodes, Electrum servers, Tor, Lightning connections and backup settings. Secrets are not in it; they are the credentials item. Without a passphrase, the Electrum servers’ onion addresses are left out, because they give access to the servers.',
        secret: false,
        available: true,
      },
    ];
    for (const { profile, status } of this.options.nodes.list()) {
      const local = localDataDirectory(profile);
      items.push({
        id: `node.${profile.id}.config`,
        kind: 'configuration',
        title: 'bitcoin.conf',
        component: profile.name,
        description:
          'The node’s configuration file. Without a passphrase, the passwords in it are left out of the backup.',
        secret: false,
        available: local !== undefined && existsSync(configFilePath(local)),
        ...(local === undefined
          ? { unavailableReason: 'The node runs on another computer, so its bitcoin.conf is not here.' }
          : existsSync(configFilePath(local))
            ? {}
            : { unavailableReason: 'The node has no bitcoin.conf.' }),
      });
      if (local === undefined) {
        items.push({
          id: `node.${profile.id}.wallets`,
          kind: 'wallet',
          title: 'Wallets',
          component: profile.name,
          description: 'Bitcoin Core wallets.',
          secret: true,
          available: false,
          unavailableReason: 'The node runs on another computer; back its wallets up there.',
        });
        continue;
      }
      if (status.state !== 'running') {
        items.push({
          id: `node.${profile.id}.wallets`,
          kind: 'wallet',
          title: 'Wallets',
          component: profile.name,
          description: 'Bitcoin Core wallets.',
          secret: true,
          available: false,
          unavailableReason: 'The node must be running, so that Bitcoin Core makes consistent copies of its wallets.',
        });
        continue;
      }
      const wallets = await this.options.nodes
        .rpc(profile.id)
        .call<string[]>('listwallets')
        .catch(() => [] as string[]);
      for (const name of wallets) {
        const descriptors = await this.options.nodes
          .rpc(profile.id)
          .call<{ descriptors?: boolean }>('getwalletinfo', [], { wallet: name })
          .then((info) => info.descriptors === true)
          .catch(() => false);
        const encoded = encodeURIComponent(name);
        items.push({
          id: `node.${profile.id}.wallet.${encoded}`,
          kind: 'wallet',
          title: walletLabel(name),
          component: profile.name,
          description:
            'A consistent copy made by Bitcoin Core (backupwallet). It holds the wallet’s private keys unless the wallet is watch-only.',
          secret: true,
          available: true,
        });
        items.push({
          id: `node.${profile.id}.descriptors.${encoded}`,
          kind: 'descriptors',
          title: `${walletLabel(name)}: public descriptors`,
          component: profile.name,
          description: 'What lets the wallet be watched again elsewhere. Descriptors cannot spend.',
          secret: false,
          available: descriptors,
          ...(descriptors ? {} : { unavailableReason: 'This is a legacy wallet, which has no descriptors.' }),
        });
      }
      if (wallets.length === 0) {
        items.push({
          id: `node.${profile.id}.wallets`,
          kind: 'wallet',
          title: 'Wallets',
          component: profile.name,
          description: 'Bitcoin Core wallets.',
          secret: true,
          available: false,
          unavailableReason:
            'No wallet is loaded in the node. Wallets that are not loaded cannot be copied consistently.',
        });
      }
    }
    for (const { connection, status } of this.options.lightning.list()) {
      items.push({
        id: `lightning.${connection.id}.channels`,
        kind: 'channel',
        title: 'Static channel backup',
        component: status.alias ?? connection.name,
        description:
          'LND’s backup of every channel, encrypted by LND with a key from the node’s seed. With that seed it recovers the channels’ funds.',
        secret: false,
        available: status.state === 'ready' || status.state === 'syncing',
        ...(status.state === 'ready' || status.state === 'syncing'
          ? {}
          : { unavailableReason: 'The node does not answer right now.' }),
      });
    }
    const secrets = this.options.vault.list().filter((secret) => secret.id !== this.stored().passphraseSecretId);
    items.push({
      id: 'btcortex.credentials',
      kind: 'credentials',
      title: 'Credentials kept by BTCortex',
      component: 'BTCortex',
      description:
        'RPC passwords of nodes on other computers, LND macaroons and onion-service keys. They are protected by Windows on this computer only, so a backup is the only copy that works elsewhere.',
      secret: true,
      available: secrets.length > 0,
      ...(secrets.length > 0 ? {} : { unavailableReason: 'BTCortex keeps no credentials yet.' }),
    });
    return items;
  }

  async overview(): Promise<BackupOverview> {
    const stored = this.stored();
    const backups = stored.destination === null ? [] : await listBackups(stored.destination).catch(() => []);
    return {
      items: await this.inventory(),
      notBackedUp: [
        ...NOT_BACKED_UP,
        {
          kind: 'electrum-wallets',
          title: 'Wallets of the Electrum BTCortex installed',
          description: `Wallets made or opened in the Electrum copy that BTCortex installed are kept in ${electrumWalletsFolder(this.options.paths)} and are not backed up here: back them up from Electrum, and keep their seeds.`,
        },
      ],
      settings: this.publicSettings(stored),
      backups: backups.map(({ path, manifest }) => summarise(path, manifest)),
      sameDiskAsData: stored.destination !== null && volumeOf(stored.destination) === volumeOf(this.options.paths.root),
      lastRestore: stored.lastRestore,
    };
  }

  // Making a backup

  private async collect(id: string, encrypted: boolean): Promise<BackupItemData> {
    if (id === 'btcortex.settings') {
      const document = {
        exportedAt: this.now().toISOString(),
        appVersion: this.options.version,
        settings: this.options.settings
          .entries()
          .map((entry) =>
            encrypted || entry.key !== 'electrum' ? entry : { ...entry, value: withoutOnionAddresses(entry.value) },
          ),
        nodeProfiles: this.options.profiles(),
        ...(encrypted ? {} : { leftOut: ONION_ADDRESSES_LEFT_OUT }),
      };
      return {
        id,
        kind: 'configuration',
        title: 'BTCortex settings and node profiles',
        component: 'BTCortex',
        source: { onionAddressesLeftOut: encrypted ? 'no' : 'yes' },
        files: [{ name: 'btcortex-settings.json', contents: Buffer.from(`${JSON.stringify(document, null, 2)}\n`) }],
      };
    }
    if (id === 'btcortex.credentials') {
      const exclude = this.stored().passphraseSecretId;
      const secrets = [];
      for (const secret of this.options.vault.list()) {
        if (secret.id === exclude) continue;
        secrets.push({ id: secret.id, purpose: secret.purpose, value: await this.options.vault.reveal(secret.id) });
      }
      return {
        id,
        kind: 'credentials',
        title: 'Credentials kept by BTCortex',
        component: 'BTCortex',
        source: {},
        files: [{ name: 'credentials.json', contents: Buffer.from(`${JSON.stringify(secrets, null, 2)}\n`) }],
      };
    }
    const nodeMatch = /^node\.([^.]+)\.(config|wallet|descriptors)(?:\.(.*))?$/.exec(id);
    if (nodeMatch) {
      const [, nodeId = '', part, encoded = ''] = nodeMatch;
      const { profile } = this.options.nodes.get(nodeId);
      const local = localDataDirectory(profile);
      if (part === 'config') {
        if (local === undefined) throw new Error('The node runs on another computer.');
        const text = await readFile(configFilePath(local), 'utf8');
        const contents = encrypted ? text : maskSecrets(BitcoinConfig.parse(text)).config.toString();
        return {
          id,
          kind: 'configuration',
          title: 'bitcoin.conf',
          component: profile.name,
          source: { nodeId, network: profile.network, passwordsLeftOut: encrypted ? 'no' : 'yes' },
          files: [{ name: 'bitcoin.conf', contents: Buffer.from(contents) }],
        };
      }
      const name = decodeURIComponent(encoded);
      if (part === 'descriptors') {
        const descriptors = await this.options.nodes
          .rpc(nodeId)
          .call('listdescriptors', [false], { wallet: name, timeoutMs: WALLET_RPC_TIMEOUT_MS });
        return {
          id,
          kind: 'descriptors',
          title: `${walletLabel(name)}: public descriptors`,
          component: profile.name,
          source: { nodeId, wallet: name, network: profile.network },
          files: [{ name: 'descriptors.json', contents: Buffer.from(`${JSON.stringify(descriptors, null, 2)}\n`) }],
        };
      }
      if (local === undefined) throw new Error('The node runs on another computer.');
      // Bitcoin Core writes the copy itself, so it is consistent; it is read and deleted at once.
      await mkdir(this.options.paths.temporary, { recursive: true });
      const temporary = join(this.options.paths.temporary, `wallet-backup-${randomUUID()}.dat`);
      try {
        await this.options.nodes
          .rpc(nodeId)
          .call('backupwallet', [temporary], { wallet: name, timeoutMs: WALLET_RPC_TIMEOUT_MS });
        return {
          id,
          kind: 'wallet',
          title: walletLabel(name),
          component: profile.name,
          source: { nodeId, wallet: name, network: profile.network },
          files: [{ name: 'wallet.dat', contents: await readFile(temporary) }],
        };
      } finally {
        await rm(temporary, { force: true });
      }
    }
    const lightningMatch = /^lightning\.(.+)\.channels$/.exec(id);
    if (lightningMatch) {
      const connectionId = lightningMatch[1] ?? '';
      const connection = this.options.lightning.list().find((entry) => entry.connection.id === connectionId);
      if (!connection) throw new Error('BTCortex is no longer connected to this node.');
      const { backup, channelPoints } = await this.options.lightning.channelBackup(connectionId);
      if (backup.length === 0) throw new Error('The node has no channels to back up.');
      return {
        id,
        kind: 'channel',
        title: 'Static channel backup',
        component: connection.status.alias ?? connection.connection.name,
        source: {
          connectionId,
          pubkey: connection.status.pubkey ?? '',
          network: connection.status.network ?? '',
          channels: String(channelPoints),
        },
        files: [{ name: 'channel.backup', contents: backup }],
      };
    }
    throw new Error('BTCortex does not know this item.');
  }

  /** Starts a backup as a job. */
  create(itemIds: readonly string[], passphrase?: string, trigger: 'manual' | 'scheduled' = 'manual'): string {
    const stored = this.stored();
    const destination = stored.destination;
    if (destination === null) {
      throw this.failure('backups.no-destination', 'Choose where backups go first.', {
        recoveryActions: [{ id: 'choose-destination', label: 'Choose a folder' }],
      });
    }
    if (this.running) throw this.failure('backups.busy', 'A backup or a restore is already running.');
    this.running = true;
    const job = this.options.jobs.run(
      'backup.create',
      trigger === 'manual' ? 'Back up' : 'Scheduled backup',
      async (report) => this.runBackup(destination, itemIds, passphrase, trigger, report),
      (error) => this.describe(error),
    );
    return job.id;
  }

  private async runBackup(
    destination: string,
    itemIds: readonly string[],
    passphrase: string | undefined,
    trigger: 'manual' | 'scheduled',
    report: JobProgressReporter,
  ): Promise<undefined> {
    const started = this.now();
    const skipped: BackupRun['skipped'] = [];
    try {
      const inventory = await this.inventory();
      const encrypted = passphrase !== undefined;
      const data: BackupItemData[] = [];
      for (const [index, id] of itemIds.entries()) {
        const item = inventory.find((candidate) => candidate.id === id);
        report({
          stage: 'collecting',
          message: `Copying ${item ? `${item.title} (${item.component})` : id}.`,
          fraction: index / Math.max(itemIds.length, 1),
        });
        if (!item) {
          skipped.push({ id, title: id, reason: 'It is no longer on this computer.' });
          continue;
        }
        if (!item.available) {
          skipped.push({ id, title: item.title, reason: item.unavailableReason ?? 'It cannot be backed up now.' });
          continue;
        }
        if (item.secret && !encrypted) {
          skipped.push({
            id,
            title: item.title,
            reason: 'It holds keys or credentials, which go only into encrypted backups.',
          });
          continue;
        }
        try {
          data.push(await this.collect(id, encrypted));
        } catch (error) {
          skipped.push({ id, title: item.title, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      if (data.length === 0) throw this.failure('backups.nothing', 'None of the chosen items could be backed up.');
      report({ stage: 'writing', message: encrypted ? 'Encrypting and writing the backup.' : 'Writing the backup.' });
      const { path } = await writeBackup({
        destination,
        items: data,
        ...(passphrase === undefined ? {} : { passphrase }),
        appVersion: this.options.version,
        trigger,
        readme: README,
        now: started,
      });
      report({ stage: 'verifying', message: 'Checking the backup against its manifest.' });
      const verification = await verifyBackup(path, passphrase);
      if (!verification.ok) {
        throw this.failure(
          'backups.verification-failed',
          `The new backup did not verify: ${verification.problems.join(' ')}`,
        );
      }
      const removed = await applyRetention(destination, this.stored().retention);
      this.options.logger.info('Backup written', {
        path,
        items: data.map((item) => item.id),
        encrypted,
        skipped: skipped.map((item) => item.id),
        removedOld: removed.length,
      });
      this.save({ lastRun: { at: started.toISOString(), trigger, outcome: 'succeeded', path, skipped } });
      return undefined;
    } catch (error) {
      this.save({
        lastRun: {
          at: started.toISOString(),
          trigger,
          outcome: 'failed',
          message: this.describe(error).message,
          skipped,
        },
      });
      throw error;
    } finally {
      this.running = false;
    }
  }

  private describe(error: unknown): AppError {
    if (error instanceof AppFailure) return error.error;
    if (error instanceof WrongPassphraseError) {
      return {
        code: 'backups.wrong-passphrase',
        message: error.message,
        component: COMPONENT,
        dataRisk: 'none',
        recoveryActions: [{ id: 'retry', label: 'Try another passphrase' }],
      };
    }
    if (error instanceof BackupFormatError) {
      return {
        code: 'backups.unreadable',
        message: error.message,
        component: COMPONENT,
        dataRisk: 'none',
        recoveryActions: [],
      };
    }
    const code = (error as NodeJS.ErrnoException).code;
    const explained = code === undefined ? undefined : FILE_SYSTEM_PROBLEMS[code];
    return {
      code: 'backups.failed',
      message: explained ?? (error instanceof Error ? error.message : String(error)),
      component: COMPONENT,
      dataRisk: 'none',
      recoveryActions: [{ id: 'retry', label: 'Try again' }],
    };
  }

  // Checking and restoring

  private async backupAt(path: string): Promise<{ path: string; manifest: Manifest }> {
    try {
      return { path: resolve(path), manifest: await readManifest(resolve(path)) };
    } catch (error) {
      throw new AppFailure(this.describe(error));
    }
  }

  async verify(path: string, passphrase?: string): Promise<BackupVerification> {
    const backup = await this.backupAt(path);
    try {
      return await verifyBackup(backup.path, passphrase);
    } catch (error) {
      throw new AppFailure(this.describe(error));
    }
  }

  async preview(path: string): Promise<RestorePreview> {
    const { path: folder, manifest } = await this.backupAt(path);
    const nodes = new Map(this.options.nodes.list().map((node) => [node.profile.id, node]));
    return {
      backup: summarise(folder, manifest),
      items: manifest.items.map((item) => {
        const base = { id: item.id, kind: item.kind, title: item.title, component: item.component };
        const node = item.source['nodeId'] === undefined ? undefined : nodes.get(item.source['nodeId']);
        if (item.kind === 'configuration' && item.source['nodeId'] !== undefined) {
          const masked = item.source['passwordsLeftOut'] === 'yes';
          const blockedReason =
            node === undefined
              ? 'The node it belongs to is no longer in BTCortex.'
              : node.profile.execution !== 'managed'
                ? 'BTCortex changes only the configuration of nodes it set up.'
                : localDataDirectory(node.profile) === undefined
                  ? 'The node’s files are not on this computer.'
                  : undefined;
          return {
            ...base,
            action: blockedReason === undefined ? ('restore' as const) : ('manual' as const),
            explanation: `Replaces the node’s bitcoin.conf after the same checks as the configuration editor: settings that need confirmation (pruning, network exposure, commands run on events) are listed for you to confirm first, and commands are never restored from an unencrypted backup. The current file is kept as a backup, and the node must be restarted to use it.${masked ? ' Its passwords were left out of this backup, so the passwords in the current file are kept where they match.' : ''}`,
            ...(blockedReason === undefined ? {} : { blockedReason }),
          };
        }
        if (item.kind === 'wallet') {
          const blockedReason =
            node === undefined
              ? 'The node it belongs to is no longer in BTCortex; restore it with restorewallet on any node of the same network.'
              : localDataDirectory(node.profile) === undefined
                ? 'The node’s files are not on this computer.'
                : node.status.state !== 'running'
                  ? 'Start the node first.'
                  : node.profile.network !== item.source['network']
                    ? 'The node is now on another network.'
                    : undefined;
          return {
            ...base,
            action: blockedReason === undefined ? ('restore' as const) : ('manual' as const),
            explanation:
              'Loads the wallet into the node with Bitcoin Core’s restorewallet, under its own name or a new one if that name is taken. Bitcoin Core then looks through the chain for its transactions, which can take a long time and needs the blocks since the wallet was made (a pruned node may not have them).',
            ...(blockedReason === undefined ? {} : { blockedReason }),
          };
        }
        const manual: Record<string, string> = {
          configuration:
            'BTCortex’s settings and node profiles, as JSON. BTCortex does not restore them automatically yet; they show how everything was set up.',
          descriptors:
            'Import them into a watch-only wallet (Sparrow, or Bitcoin Core’s importdescriptors) to watch the wallet again. They cannot spend.',
          channel:
            'Restore the LND node from its seed, then run lncli restorechanbackup --multi_file with this file. LND then asks the peers to close the channels and the funds return on-chain.',
          credentials:
            'The passwords, macaroons and onion-service keys BTCortex kept, as JSON, for setting things up again by hand.',
        };
        return { ...base, action: 'manual' as const, explanation: manual[item.kind] ?? 'Use this file by hand.' };
      }),
    };
  }

  restore(
    path: string,
    itemIds: readonly string[],
    passphrase?: string,
    acceptedSettings: readonly string[] = [],
  ): string {
    if (this.running) throw this.failure('backups.busy', 'A backup or a restore is already running.');
    this.running = true;
    const job = this.options.jobs.run(
      'backup.restore',
      'Restore from a backup',
      async (report) => {
        try {
          await this.runRestore(path, itemIds, passphrase, acceptedSettings, report);
          return undefined;
        } finally {
          this.running = false;
        }
      },
      (error) => this.describe(error),
    );
    return job.id;
  }

  private async runRestore(
    path: string,
    itemIds: readonly string[],
    passphrase: string | undefined,
    acceptedSettings: readonly string[],
    report: JobProgressReporter,
  ): Promise<void> {
    const { path: folder, manifest } = await this.backupAt(path);
    const preview = await this.preview(folder);
    let key: Buffer | undefined;
    if (manifest.encryption) {
      if (passphrase === undefined)
        throw this.failure('backups.passphrase-needed', 'This backup is encrypted: enter its passphrase.');
      key = await unlockBackup(manifest, passphrase);
    }
    const results: RestoreOutcome['results'] = [];
    for (const [index, id] of itemIds.entries()) {
      const item = manifest.items.find((candidate) => candidate.id === id);
      const planned = preview.items.find((candidate) => candidate.id === id);
      if (!item || !planned) continue;
      report({
        stage: 'restoring',
        message: `Restoring ${item.title} (${item.component}).`,
        fraction: index / itemIds.length,
      });
      if (planned.action !== 'restore' || planned.blockedReason !== undefined) {
        results.push({
          id,
          title: item.title,
          outcome: 'failed',
          message: planned.blockedReason ?? 'BTCortex does not restore this item.',
        });
        continue;
      }
      try {
        const file = item.files[0];
        if (!file) throw new Error('The backup holds no file for this item.');
        const contents = await readBackupFile(folder, file, key);
        const message =
          item.kind === 'wallet'
            ? await this.restoreWallet(item, contents)
            : await this.restoreConfig(item.source['nodeId'] ?? '', contents.toString('utf8'), {
                accepted: acceptedSettings,
                encrypted: manifest.encryption !== null,
              });
        results.push({ id, title: item.title, outcome: 'restored', message });
      } catch (error) {
        const described = this.describe(error);
        const settingsToConfirm =
          described.code === 'backups.config-needs-confirmation'
            ? (described.details?.['keys'] as string[] | undefined)
            : undefined;
        results.push({
          id,
          title: item.title,
          outcome: 'failed',
          message: described.message,
          ...(settingsToConfirm ? { settingsToConfirm } : {}),
        });
      }
    }
    const outcome: RestoreOutcome = { at: this.now().toISOString(), backupPath: folder, results };
    this.save({ lastRestore: outcome });
    this.options.logger.info('Restored from a backup', {
      path: folder,
      results: results.map((result) => ({ id: result.id, outcome: result.outcome })),
    });
    if (results.length > 0 && results.every((result) => result.outcome === 'failed')) {
      throw this.failure(
        'backups.restore-failed',
        results.map((result) => `${result.title}: ${result.message}`).join(' '),
      );
    }
  }

  /**
   * Puts a node's bitcoin.conf back through the configuration checks. Settings
   * that need confirmation (pruning, network exposure, commands run on events)
   * are restored only when the user saw and confirmed them; options that run
   * commands never come back from an unencrypted backup, which anyone who can
   * write to its folder could have changed.
   */
  private async restoreConfig(
    nodeId: string,
    text: string,
    options: { accepted: readonly string[]; encrypted: boolean },
  ): Promise<string> {
    const document = await this.options.config.get(nodeId);
    try {
      const result = await this.options.config.save(nodeId, {
        text,
        revision: document.revision,
        acceptedRisks: options.accepted,
      });
      return result.restartRequired ? 'bitcoin.conf restored; restart the node to use it.' : 'bitcoin.conf restored.';
    } catch (error) {
      if (error instanceof AppFailure && error.error.code === 'config.confirmation-required') {
        const keys = (error.error.details?.['keys'] as string[] | undefined) ?? [];
        const risks = (error.error.details?.['risks'] as Record<string, string> | undefined) ?? {};
        const commands = keys.filter((key) => risks[key] === 'executes-commands');
        if (!options.encrypted && commands.length > 0) {
          throw this.failure(
            'backups.config-commands-refused',
            `The backed-up bitcoin.conf sets options that run commands (${commands.join(', ')}). It comes from an unencrypted backup, which anyone who could write to its folder could have changed, so BTCortex does not restore it. Set those options again on the node’s Configuration page if you need them.`,
          );
        }
        throw new AppFailure({
          code: 'backups.config-needs-confirmation',
          message: `The backed-up bitcoin.conf changes settings that need your confirmation: ${keys.join(', ')}. Review them and restore it again.`,
          component: COMPONENT,
          dataRisk: 'none',
          details: { keys },
          recoveryActions: [{ id: 'confirm-settings', label: 'Review the settings and restore again' }],
        });
      }
      if (error instanceof AppFailure && error.error.code === 'config.invalid') {
        // The details may quote lines that hold passwords; only their number is passed on.
        const problems = (error.error.details?.['problems'] as unknown[] | undefined)?.length ?? 0;
        throw this.failure(
          'backups.config-invalid',
          `The backed-up bitcoin.conf does not pass the configuration checks for this node now (${String(problems)} problem${problems === 1 ? '' : 's'}). Copy it by hand from the backup if you are sure.`,
        );
      }
      throw error;
    }
  }

  private async restoreWallet(item: Manifest['items'][number], contents: Buffer): Promise<string> {
    const nodeId = item.source['nodeId'] ?? '';
    const original = item.source['wallet'] ?? '';
    await mkdir(this.options.paths.temporary, { recursive: true });
    const temporary = join(this.options.paths.temporary, `wallet-restore-${randomUUID()}.dat`);
    await writeFile(temporary, contents, { flag: 'wx' });
    try {
      const client = this.options.nodes.rpc(nodeId);
      const stamp = this.now().toISOString().slice(0, 10);
      const candidates = [
        original === '' ? `restored-${stamp}` : original,
        `${original === '' ? 'wallet' : original}-restored-${stamp}`,
      ];
      let lastError: unknown;
      for (const name of candidates) {
        try {
          // Loaded at every start (load_on_startup): an unloaded wallet would drop out of later
          // backups, and pruning could pass it so that it no longer loads at all.
          await client.call('restorewallet', [name, temporary, true], { timeoutMs: RESTORE_RPC_TIMEOUT_MS });
          return `Restored into the node as “${name}”, loaded whenever the node starts. Bitcoin Core is looking through the chain for its transactions.`;
        } catch (error) {
          lastError = error;
          if (!/already exists|Database file exists/i.test(error instanceof Error ? error.message : String(error)))
            break;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    } finally {
      await rm(temporary, { force: true });
    }
  }

  reveal(path: string): void {
    const destination = this.stored().destination;
    const target = resolve(path);
    if (
      destination === null ||
      resolve(join(target, '..')) !== resolve(destination) ||
      !existsSync(join(target, 'manifest.json'))
    ) {
      throw this.failure('backups.not-a-backup', 'That folder is not a BTCortex backup in the backup folder.');
    }
    (this.options.reveal ?? revealInExplorer)(join(target, 'manifest.json'));
  }

  // Schedule

  initialise(): void {
    this.timer = setInterval(() => {
      void this.runScheduled();
    }, SCHEDULE_CHECK_MS);
    this.timer.unref();
    void this.runScheduled();
  }

  shutdown(): void {
    clearInterval(this.timer);
  }

  /** Runs a scheduled backup when one is due; checked every few minutes. */
  async runScheduled(): Promise<string | undefined> {
    const stored = this.stored();
    if (stored.schedule.everyHours === 0 || stored.destination === null || this.running) return undefined;
    const last = stored.lastRun?.at === undefined ? 0 : Date.parse(stored.lastRun.at);
    if (this.now().getTime() - last < stored.schedule.everyHours * 60 * 60 * 1000) return undefined;
    let passphrase: string | undefined;
    if (stored.schedule.encrypted && stored.passphraseSecretId !== null) {
      try {
        passphrase = await this.options.vault.reveal(stored.passphraseSecretId);
      } catch (error) {
        this.options.logger.warn('The stored backup passphrase could not be read', { error });
        return undefined;
      }
    }
    const items = (await this.inventory())
      .filter((item) => item.available && (passphrase !== undefined || !item.secret))
      .map((item) => item.id);
    try {
      return this.create(items, passphrase, 'scheduled');
    } catch (error) {
      this.options.logger.warn('A scheduled backup could not start', { error });
      return undefined;
    }
  }
}
