import { createHmac, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import {
  BitcoinConfig,
  interpretBoolean,
  isSecretOption,
  lookupOption,
  resolveEffective,
} from '@btcortex/bitcoin-config';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import type { NodeProfile } from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import type { Logger } from '../logging/logger';
import { localDataDirectory } from '../nodes/local-files';
import type { SettingsStore } from '../persistence/settings';
import type { SecretVault } from '../vault/vault';

// Security-relevant changes to a node's bitcoin.conf (specification section
// 19.2): settings that open the node to other computers, run commands, or
// change how it signs in or reaches the network. BTCortex remembers a keyed
// digest of each such setting rather than its value, because some hold
// passwords; the key lives in the vault. A file is compared only once it has
// stayed the same between two looks, so an editor caught half-way through
// saving does not raise a false alarm. A change BTCortex made itself is noted
// for the record; one made elsewhere is a warning, since it may not be the
// user's doing.

const SETTINGS_KEY = 'monitoring.config-watch';
/** Settings that matter for security or privacy although Bitcoin Core does not count them as exposing the node. */
const ALSO_WATCHED = new Set([
  'server',
  'rpcuser',
  'rpcauth',
  'rpcwhitelist',
  'rpcwhitelistdefault',
  'rpccookiefile',
  'rpccookieperms',
  'proxy',
  'onion',
  'onlynet',
  'listenonion',
  'torcontrol',
  'i2psam',
  'i2pacceptincoming',
]);
/** Watched settings whose new values may be shown: addresses and switches, never commands or credentials. */
const SHOWN = new Set([
  'server',
  'proxy',
  'onion',
  'onlynet',
  'listenonion',
  'torcontrol',
  'i2psam',
  'i2pacceptincoming',
]);

function watched(key: string): boolean {
  const risk = lookupOption(key)?.definition.risk;
  return risk === 'exposure' || risk === 'executes-commands' || isSecretOption(key) || ALSO_WATCHED.has(key);
}

/** The new values of a setting as they may be shown, switches as on or off; null for settings never shown. */
function shownValues(key: string, values: readonly string[]): string[] | null {
  const definition = lookupOption(key)?.definition;
  if (isSecretOption(key) || (definition?.risk !== 'exposure' && !SHOWN.has(key))) return null;
  if (definition?.type !== 'boolean') return [...values];
  return values.map((value) => (interpretBoolean(value) ? 'on' : 'off'));
}

const ChangeSchema = z.object({
  key: z.string(),
  kind: z.enum(['added', 'removed', 'changed']),
  /** The new values, for settings that may be shown. */
  now: z.array(z.string()).nullable(),
});
export type ConfigChange = z.infer<typeof ChangeSchema>;

const NoticeSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  at: z.string(),
  /** Whether BTCortex made every change in the notice. */
  byBtcortex: z.boolean(),
  changes: z.array(ChangeSchema),
});
export type ConfigNotice = z.infer<typeof NoticeSchema>;

const StoredSchema = z.object({
  keyId: z.string().nullable(),
  nodes: z.record(z.string(), z.object({ digests: z.record(z.string(), z.string()) })),
  notices: z.array(NoticeSchema),
});
type Stored = z.infer<typeof StoredSchema>;

export interface ConfigWatchOptions {
  settings: SettingsStore;
  vault: Pick<SecretVault, 'store' | 'reveal'>;
  logger: Logger;
  now?: () => Date;
}

interface Look {
  stamp: string;
  /** Whether this stamp has been compared already. */
  compared: boolean;
}

export class ConfigWatch {
  private key: Buffer | undefined;
  private readonly looks = new Map<string, Look>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ConfigWatchOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private load(): Stored {
    return this.options.settings.get(SETTINGS_KEY, StoredSchema) ?? { keyId: null, nodes: {}, notices: [] };
  }

  private save(stored: Stored): void {
    this.options.settings.set(SETTINGS_KEY, stored);
  }

  /** Changes waiting to be seen, the latest first. */
  notices(): ConfigNotice[] {
    return [...this.load().notices].sort((a, b) => b.at.localeCompare(a.at));
  }

  /** The user has seen the notice about this node. */
  dismiss(nodeId: string): void {
    const stored = this.load();
    this.save({ ...stored, notices: stored.notices.filter((notice) => notice.nodeId !== nodeId) });
  }

  private async digestKey(): Promise<Buffer> {
    if (this.key) return this.key;
    const stored = this.load();
    if (stored.keyId !== null) {
      try {
        this.key = Buffer.from(await this.options.vault.reveal(stored.keyId), 'hex');
        return this.key;
      } catch (error) {
        this.options.logger.warn('The key for bitcoin.conf digests is gone; BTCortex starts comparing afresh', {
          error,
        });
      }
    }
    const key = randomBytes(32);
    const keyId = await this.options.vault.store(
      'Digests of security-relevant bitcoin.conf settings',
      key.toString('hex'),
    );
    // Digests made with another key cannot be compared, so the files are learnt again.
    this.save({ ...this.load(), keyId, nodes: {} });
    this.key = key;
    return key;
  }

  private posture(
    text: string,
    network: BitcoinNetwork,
    key: Buffer,
  ): Map<string, { digest: string; values: string[] }> {
    const result = new Map<string, { digest: string; values: string[] }>();
    for (const [name, value] of resolveEffective(BitcoinConfig.parse(text), network)) {
      if (value.lines.length === 0 || !watched(name)) continue;
      const digest = createHmac('sha256', key)
        .update(`${name}\n${value.negated ? 'off' : 'on'}\n${value.values.join('\n')}`)
        .digest('hex');
      result.set(name, { digest, values: value.values });
    }
    return result;
  }

  /** Runs one look at a time, so that a scan and BTCortex's own save never interleave. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Looks at every node's bitcoin.conf and notes security-relevant changes made outside BTCortex. */
  scan(profiles: readonly NodeProfile[]): Promise<void> {
    return this.serial(async () => {
      const present = new Set(profiles.map((profile) => profile.id));
      for (const profile of profiles) {
        try {
          await this.scanOne(profile);
        } catch (error) {
          this.options.logger.debug('Could not compare bitcoin.conf', { nodeId: profile.id, error });
        }
      }
      for (const nodeId of this.looks.keys()) if (!present.has(nodeId)) this.looks.delete(nodeId);
      const stored = this.load();
      if (Object.keys(stored.nodes).some((nodeId) => !present.has(nodeId))) {
        this.save({
          ...stored,
          nodes: Object.fromEntries(Object.entries(stored.nodes).filter(([nodeId]) => present.has(nodeId))),
          notices: stored.notices.filter((notice) => present.has(notice.nodeId)),
        });
      }
    });
  }

  /** BTCortex has just saved this node's file: its security-relevant changes are noted as BTCortex's. */
  ownChange(profile: NodeProfile): Promise<void> {
    return this.serial(async () => {
      const file = await this.read(profile);
      if (file) await this.compare(profile, file, true);
    });
  }

  private async read(profile: NodeProfile): Promise<{ text: string; stamp: string } | undefined> {
    const root = localDataDirectory(profile);
    if (root === undefined) return undefined;
    const path = configFilePath(root);
    const info = await stat(path).catch(() => undefined);
    if (!info) return { text: '', stamp: 'absent' };
    return { text: await readFile(path, 'utf8'), stamp: `${String(info.mtimeMs)}:${String(info.size)}` };
  }

  private async scanOne(profile: NodeProfile): Promise<void> {
    const file = await this.read(profile);
    if (!file) return;
    const look = this.looks.get(profile.id);
    if (look?.stamp !== file.stamp) {
      // New or changed since the last look: compare once it has settled.
      this.looks.set(profile.id, { stamp: file.stamp, compared: false });
      return;
    }
    if (!look.compared) await this.compare(profile, file, false);
  }

  private async compare(
    profile: NodeProfile,
    file: { text: string; stamp: string },
    byBtcortex: boolean,
  ): Promise<void> {
    const key = await this.digestKey();
    const posture = this.posture(file.text, profile.network, key);
    const stored = this.load();
    const known = stored.nodes[profile.id];
    const digests = Object.fromEntries([...posture].map(([name, { digest }]) => [name, digest]));
    const nodes = { ...stored.nodes, [profile.id]: { digests } };
    this.looks.set(profile.id, { stamp: file.stamp, compared: true });
    const changes: ConfigChange[] = [];
    // On the first look at a node, what is there is the baseline.
    for (const name of known ? [...new Set([...Object.keys(known.digests), ...posture.keys()])].sort() : []) {
      const before = known?.digests[name];
      const after = posture.get(name);
      if (before === after?.digest) continue;
      changes.push({
        key: name,
        kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
        now: after ? shownValues(name, after.values) : null,
      });
    }
    if (changes.length === 0) {
      this.save({ ...stored, nodes });
      return;
    }
    const earlier = stored.notices.find((notice) => notice.nodeId === profile.id);
    const notice: ConfigNotice = {
      nodeId: profile.id,
      nodeName: profile.name,
      at: this.now().toISOString(),
      byBtcortex: byBtcortex && (earlier?.byBtcortex ?? true),
      changes: [
        ...(earlier?.changes ?? []).filter((change) => !changes.some((next) => next.key === change.key)),
        ...changes,
      ].sort((a, b) => a.key.localeCompare(b.key)),
    };
    this.options.logger[byBtcortex ? 'info' : 'warn']('Security-relevant bitcoin.conf settings changed', {
      nodeId: profile.id,
      keys: changes.map((change) => change.key),
      byBtcortex,
    });
    this.save({
      ...stored,
      nodes,
      notices: [...stored.notices.filter((other) => other.nodeId !== profile.id), notice],
    });
  }
}
