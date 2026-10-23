import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import {
  BitcoinConfig,
  describeChanges,
  isSecretOption,
  managedSettingChanges,
  maskSecrets,
  restoreSecrets,
  riskyChanges,
  validateConfig,
} from '@btcortex/bitcoin-config';
import { AppFailure, NODE_CONFIG_VERSION_ID } from '@btcortex/contracts';
import type {
  NodeConfigDocument,
  NodeConfigHistory,
  NodeConfigVersionDetail,
  NodeProfile,
  NodeWithStatus,
  SaveNodeConfigResult,
} from '@btcortex/contracts';
import { buildArguments, configFilePath } from '@btcortex/integration-bitcoin-core';
import type { Logger } from '../logging/logger';
import { localDataDirectory } from './local-files';
import type { NodeManager } from './node-manager';
import { nodeComponent } from './node-errors';

// Reading and saving a node's bitcoin.conf for the configuration editor
// (specification section 5.6). BTCortex changes the file only for nodes it
// manages; existing installations stay read-only. Saving repeats every check
// the editor made, puts hidden values back, refuses changes to settings
// BTCortex relies on, keeps a backup and replaces the file atomically.

const KEPT_BACKUPS = 10;
/** bitcoind reads bitcoin.conf as it starts; a file changed later is not in use yet. */
const START_TOLERANCE_MS = 2_000;
const ABSENT = 'absent';
/**
 * Revisions are keyed with a secret that never leaves this process: a plain
 * hash of the file would let the interface test guesses of hidden passwords.
 */
const REVISION_KEY = randomBytes(32);
const NOT_UTF8 =
  'bitcoin.conf is not saved as UTF-8, so saving it here could change some of its characters, passwords included. Save it as UTF-8 in a text editor to edit it in BTCortex.';

export interface NodeConfigServiceOptions {
  nodes: Pick<NodeManager, 'get' | 'appliedConfig'>;
  logger: Logger;
  totalMemoryBytes?: number;
  now?: () => Date;
  /** Runs once a node's file is saved; monitoring notes the security-relevant changes as BTCortex's own. */
  afterSave?: (profile: NodeProfile) => Promise<void>;
}

export interface SaveRequest {
  text: string;
  revision: string;
  acceptedRisks: readonly string[];
}

interface ConfigFile {
  /** The file's bytes; `undefined` when it does not exist. */
  bytes: Buffer | undefined;
  text: string | undefined;
  /** False when the bytes are not valid UTF-8: writing the decoded text back would change them. */
  utf8: boolean;
  revision: string;
  modifiedAt: Date | undefined;
}

/** When a kept version was replaced, from the time in its name. */
function replacedAt(name: string): string | undefined {
  const match = /\.btcortex-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/.exec(name);
  if (!match) return undefined;
  const [, day, hours, minutes, seconds, milliseconds] = match;
  return `${day ?? ''}T${hours ?? ''}:${minutes ?? ''}:${seconds ?? ''}.${milliseconds ?? ''}Z`;
}

function revisionOf(bytes: Buffer | string | undefined): string {
  return bytes === undefined ? ABSENT : createHmac('sha256', REVISION_KEY).update(bytes).digest('hex').slice(0, 32);
}

async function readConfigFile(path: string): Promise<ConfigFile> {
  let bytes: Buffer;
  let modifiedAt: Date;
  try {
    const [content, info] = await Promise.all([readFile(path), stat(path)]);
    bytes = content;
    modifiedAt = info.mtime;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { bytes: undefined, text: undefined, utf8: true, revision: ABSENT, modifiedAt: undefined };
    }
    throw error;
  }
  const revision = revisionOf(bytes);
  try {
    // ignoreBOM keeps a byte-order mark in the text, so that it is written back unchanged.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { bytes, text, utf8: true, revision, modifiedAt };
  } catch {
    return { bytes, text: new TextDecoder('utf-8').decode(bytes), utf8: false, revision, modifiedAt };
  }
}

/** Replaces a file so that a crash leaves either the old or the new contents, never a torn file. */
async function writeDurably(path: string, contents: Buffer | string): Promise<void> {
  const temporary = `${path}.btcortex-${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** When the running node started, from its latest snapshot. */
function startedAt(node: NodeWithStatus): number | undefined {
  const snapshot = node.status.snapshot;
  if (node.status.state !== 'running' || !snapshot) return undefined;
  return Date.parse(snapshot.takenAt) - snapshot.uptimeSeconds * 1000;
}

function readOnlyReason(profile: NodeProfile, path: string | undefined): string | undefined {
  if (!path) return 'This node’s files are not on this computer, so its configuration cannot be shown here.';
  if (profile.execution !== 'managed') {
    return 'BTCortex does not change the configuration of nodes it did not set up. You can still read it here.';
  }
  return undefined;
}

/** The options BTCortex passes when it starts a managed node; they override bitcoin.conf. */
function commandLineOptions(profile: NodeProfile): { key: string; value: string }[] {
  if (profile.execution !== 'managed' || !profile.dataDirectory) return [];
  return buildArguments({ bitcoind: '', dataDirectory: profile.dataDirectory, network: profile.network }).map(
    (argument) => {
      const [key = '', ...value] = argument.replace(/^-/, '').split('=');
      return { key, value: value.join('=') };
    },
  );
}

export class NodeConfigService {
  private readonly now: () => Date;
  private readonly saving = new Map<string, Promise<void>>();

  constructor(private readonly options: NodeConfigServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async get(nodeId: string): Promise<NodeConfigDocument> {
    const node = this.options.nodes.get(nodeId);
    const { profile } = node;
    const root = localDataDirectory(profile);
    const path = root === undefined ? undefined : configFilePath(root);
    const commandLine = commandLineOptions(profile);
    if (path === undefined) {
      const reason = readOnlyReason(profile, path) ?? '';
      return {
        path: null,
        exists: false,
        editable: false,
        readOnlyReason: reason,
        text: '',
        revision: ABSENT,
        restartRequired: false,
        commandLine,
      };
    }
    const file = await readConfigFile(path);
    const reason = readOnlyReason(profile, path) ?? (file.utf8 ? undefined : NOT_UTF8);
    return {
      path,
      exists: file.text !== undefined,
      editable: reason === undefined,
      ...(reason === undefined ? {} : { readOnlyReason: reason }),
      text: file.text === undefined ? '' : maskSecrets(BitcoinConfig.parse(file.text)).config.toString(),
      revision: file.revision,
      ...(file.modifiedAt ? { modifiedAt: file.modifiedAt.toISOString() } : {}),
      restartRequired: this.restartRequired(node, file.text ?? '', file.modifiedAt),
      commandLine,
    };
  }

  /** One save at a time per node: two overlapping saves with the same revision must not both pass. */
  async save(nodeId: string, request: SaveRequest): Promise<SaveNodeConfigResult> {
    const previous = this.saving.get(nodeId) ?? Promise.resolve();
    const run = previous.then(() => this.saveNow(nodeId, request));
    this.saving.set(
      nodeId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async saveNow(nodeId: string, request: SaveRequest): Promise<SaveNodeConfigResult> {
    const node = this.options.nodes.get(nodeId);
    const { profile } = node;
    const component = nodeComponent(profile);
    const root = localDataDirectory(profile);
    const path = root === undefined ? undefined : configFilePath(root);
    const reason = readOnlyReason(profile, path);
    if (path === undefined || reason !== undefined) {
      throw new AppFailure({
        code: 'config.read-only',
        message: reason ?? 'This configuration cannot be changed from BTCortex.',
        component,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }

    const current = await readConfigFile(path);
    if (!current.utf8) {
      throw new AppFailure({
        code: 'config.read-only',
        message: NOT_UTF8,
        component,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    if (current.revision !== request.revision) {
      throw new AppFailure({
        code: 'config.changed-on-disk',
        message: 'bitcoin.conf changed after it was opened here, so saving now could undo those changes.',
        component,
        dataRisk: 'none',
        likelyCause: 'Another program, or someone using a text editor, changed the file.',
        recoveryActions: [{ id: 'reload-config', label: 'Reload the file and make your changes again' }],
      });
    }

    const before = BitcoinConfig.parse(current.text ?? '');
    const restored = restoreSecrets(BitcoinConfig.parse(request.text), maskSecrets(before).hidden);
    const after = restored.config;
    const problems = [
      ...restored.unresolvedLines.map(
        (line) => `Line ${String(line)}: this hidden value does not belong to the option on that line.`,
      ),
      ...[
        ...validateConfig(after, {
          network: profile.network,
          windows: process.platform === 'win32',
          managed: true,
          ...(this.options.totalMemoryBytes === undefined ? {} : { totalMemoryBytes: this.options.totalMemoryBytes }),
        }),
        ...managedSettingChanges(before, after, profile.network),
      ]
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => {
          if (diagnostic.line === undefined) return diagnostic.message;
          // A message about a line that holds a restored secret may quote it; the interface must not see it.
          const message = restored.restoredLines.includes(diagnostic.line)
            ? 'this line holds a hidden value and is not valid for Bitcoin Core. Replace the value or remove the line.'
            : diagnostic.message;
          return `Line ${String(diagnostic.line)}: ${message}`;
        }),
    ];
    if (problems.length > 0) {
      throw new AppFailure({
        code: 'config.invalid',
        message:
          'The configuration was not saved because Bitcoin Core would refuse it or BTCortex would lose the node.',
        component,
        dataRisk: 'none',
        details: { problems },
        recoveryActions: [{ id: 'fix-config', label: 'Correct the settings marked as errors' }],
      });
    }

    const changes = describeChanges(before, after, profile.network);
    const risky = riskyChanges(changes).filter(({ change }) => !request.acceptedRisks.includes(change.key));
    const unconfirmed = risky.map(({ change }) => change.key);
    if (unconfirmed.length > 0) {
      throw new AppFailure({
        code: 'config.confirmation-required',
        message: `These settings need your explicit confirmation before they are saved: ${unconfirmed.join(', ')}.`,
        component,
        dataRisk: 'none',
        details: { keys: unconfirmed, risks: Object.fromEntries(risky.map(({ change, risk }) => [change.key, risk])) },
        recoveryActions: [{ id: 'confirm-risks', label: 'Review and confirm the risky settings' }],
      });
    }

    const text = after.toString();
    const backup = current.bytes === undefined ? null : await this.backUp(path, current.bytes);
    await writeDurably(path, text);
    const changedKeys = changes.map((change) => change.key);
    // Only option names are logged; values may be secrets.
    this.options.logger.info('Saved bitcoin.conf', { nodeId, path, changedKeys, backup });
    await this.options.afterSave?.(profile).catch((error: unknown) => {
      this.options.logger.warn('Could not note the saved bitcoin.conf for monitoring', { nodeId, error });
    });
    return {
      revision: revisionOf(text),
      restartRequired: this.restartRequired(node, text, this.now()),
      backup,
      changedKeys,
    };
  }

  /** The file of a node whose files are on this computer. */
  private localPath(nodeId: string): { profile: NodeProfile; path: string | undefined } {
    const { profile } = this.options.nodes.get(nodeId);
    const root = localDataDirectory(profile);
    return { profile, path: root === undefined ? undefined : configFilePath(root) };
  }

  /** The kept versions, newest first: each is the file as it was before a save replaced it. */
  async history(nodeId: string): Promise<NodeConfigHistory> {
    const { path } = this.localPath(nodeId);
    if (path === undefined) return { versions: [], kept: KEPT_BACKUPS };
    const prefix = `${basename(path)}.btcortex-`;
    let names: string[];
    try {
      names = (await readdir(dirname(path))).filter(
        (name) => name.startsWith(prefix) && NODE_CONFIG_VERSION_ID.test(name),
      );
    } catch {
      return { versions: [], kept: KEPT_BACKUPS };
    }
    const versions = await Promise.all(
      names.map(async (name) => {
        const info = await stat(join(dirname(path), name));
        return { id: name, replacedAt: replacedAt(name) ?? info.mtime.toISOString(), bytes: info.size };
      }),
    );
    versions.sort((a, b) => b.replacedAt.localeCompare(a.replacedAt));
    return { versions, kept: KEPT_BACKUPS };
  }

  private async versionText(
    nodeId: string,
    versionId: string,
  ): Promise<{ profile: NodeProfile; path: string; text: string }> {
    const { profile, path } = this.localPath(nodeId);
    const component = nodeComponent(profile);
    // The id is checked against the names BTCortex gives, so it can only name a file next to bitcoin.conf.
    if (path === undefined || !NODE_CONFIG_VERSION_ID.test(versionId)) {
      throw new AppFailure({
        code: 'config.version-not-found',
        message: 'This version of bitcoin.conf is not kept here.',
        component,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    try {
      const bytes = await readFile(join(dirname(path), versionId));
      return { profile, path, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
    } catch (error) {
      throw new AppFailure({
        code: 'config.version-not-found',
        message:
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'This version of bitcoin.conf is no longer kept; BTCortex keeps the ten most recent.'
            : 'This version of bitcoin.conf cannot be read as UTF-8 text.',
        component,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
  }

  /** A kept version with secrets hidden, and what restoring it would change; secret values never leave. */
  async version(nodeId: string, versionId: string): Promise<NodeConfigVersionDetail> {
    const { profile, path, text } = await this.versionText(nodeId, versionId);
    const current = await readConfigFile(path);
    const version = BitcoinConfig.parse(text);
    const changes = describeChanges(BitcoinConfig.parse(current.text ?? ''), version, profile.network);
    const stamp = replacedAt(versionId) ?? (await stat(join(dirname(path), versionId))).mtime.toISOString();
    return {
      id: versionId,
      replacedAt: stamp,
      text: maskSecrets(version).config.toString(),
      changes: changes.map((change) => {
        const secret = isSecretOption(change.key);
        return {
          key: change.key,
          current: secret ? null : (change.before ?? null),
          version: secret ? null : (change.after ?? null),
          secret,
        };
      }),
      risky: riskyChanges(changes).map(({ change }) => change.key),
    };
  }

  /** Puts a kept version back through every check a save makes; the current file is kept as a version too. */
  async restore(nodeId: string, versionId: string, revision: string, acceptedRisks: readonly string[]) {
    const { text } = await this.versionText(nodeId, versionId);
    const result = await this.save(nodeId, { text, revision, acceptedRisks });
    this.options.logger.info('Restored an earlier bitcoin.conf', {
      nodeId,
      versionId,
      changedKeys: result.changedKeys,
    });
    return result;
  }

  /**
   * A copy without secrets for sharing or keeping elsewhere (specification section 28). It is never
   * named bitcoin.conf, so it cannot be mistaken for, or dropped in as, a node's real configuration.
   */
  async export(nodeId: string, target: string): Promise<void> {
    const { profile, path } = this.localPath(nodeId);
    const component = nodeComponent(profile);
    const refuse = (message: string) =>
      new AppFailure({ code: 'config.export-refused', message, component, dataRisk: 'none', recoveryActions: [] });
    if (path === undefined) throw refuse('This node’s files are not on this computer, so there is nothing to export.');
    const extension = extname(target).toLowerCase();
    if (extension !== '.conf' && extension !== '.txt') throw refuse('A copy is saved as a .conf or .txt file.');
    if (basename(target).toLowerCase() === 'bitcoin.conf') {
      throw refuse(
        'Choose another name than bitcoin.conf: the copy has its secrets hidden, so a node could not use it.',
      );
    }
    const file = await readConfigFile(path);
    const masked = maskSecrets(BitcoinConfig.parse(file.text ?? '')).config.toString();
    const header = [
      `# bitcoin.conf of "${profile.name}" (${profile.network}), exported by BTCortex on ${this.now().toISOString().slice(0, 10)}.`,
      '# Secret values are hidden, so this copy cannot be used as it is.',
      '',
    ].join('\n');
    await writeFile(target, `${header}${masked}`, { flag: 'w' });
    this.options.logger.info('Exported bitcoin.conf without secrets', { nodeId });
  }

  /** Whether the running node uses different settings from the file's. */
  private restartRequired(node: NodeWithStatus, text: string, modifiedAt: Date | undefined): boolean {
    const started = startedAt(node);
    if (started === undefined) return false;
    const applied = this.options.nodes.appliedConfig(node.profile.id);
    if (applied !== undefined) {
      return describeChanges(BitcoinConfig.parse(applied), BitcoinConfig.parse(text), node.profile.network).length > 0;
    }
    // Started outside this session: rely on the file's modification time.
    return modifiedAt !== undefined && modifiedAt.getTime() > started + START_TOLERANCE_MS;
  }

  /** Writes the previous contents next to the file and keeps only the newest backups. */
  private async backUp(path: string, bytes: Buffer): Promise<string> {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const backup = `${path}.btcortex-${stamp}-${randomUUID().slice(0, 8)}.bak`;
    const handle = await open(backup, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const prefix = `${basename(path)}.btcortex-`;
    const backups = (await readdir(dirname(path)))
      .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
      .sort()
      .reverse();
    for (const old of backups.slice(KEPT_BACKUPS)) await unlink(join(dirname(path), old));
    return backup;
  }
}
