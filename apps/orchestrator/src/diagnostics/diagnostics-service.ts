import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { arch, cpus, homedir, release, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { BitcoinConfig, maskSecrets } from '@btcortex/bitcoin-config';
import { AppFailure } from '@btcortex/contracts';
import type { DiagnosticBundle, LogSource, TorStatus } from '@btcortex/contracts';
import { redact, redactString } from '@btcortex/core';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import type { JobManager } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import type { LogService } from '../logs/log-service';
import { localDataDirectory } from '../nodes/local-files';
import type { NodeManager } from '../nodes/node-manager';
import { describeHardware } from '../platform/hardware';
import type { AppPaths } from '../platform/paths';
import { writeZip } from './zip-writer';
import type { ZipFile } from './zip-writer';

// Sanitised diagnostic bundle (specification section 20): what a supporter
// needs to understand a problem, without passwords, RPC cookies, macaroons,
// tokens, private keys or recovery phrases. The user's Windows profile path is
// replaced, and transaction and block identifiers in Bitcoin Core's log are
// hidden because they can link transactions to the user.

const LOG_TAIL_BYTES = 5 * 1024 * 1024;
const KEPT_BUNDLES = 5;
const MAX_JOBS = 50;
const BUNDLE_PREFIX = 'btcortex-diagnostics-';

export interface DiagnosticsServiceOptions {
  paths: AppPaths;
  nodes: Pick<NodeManager, 'list'>;
  jobs: Pick<JobManager, 'list'>;
  logs: Pick<LogService, 'sources'>;
  /** The state of BTCortex's tor, for connection problems. */
  tor?: () => Promise<TorStatus>;
  version: string;
  logger: Logger;
  now?: () => Date;
  homeDirectory?: string;
  /** Shows a file in File Explorer; replaced in tests. */
  reveal?: (path: string) => void;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The last `limit` bytes of a file, starting at a line boundary. */
async function readTail(path: string, limit: number): Promise<string> {
  const info = await stat(path);
  const start = Math.max(0, info.size - limit);
  const buffer = Buffer.alloc(info.size - start);
  const handle = await open(path, 'r');
  try {
    await handle.read(buffer, 0, buffer.length, start);
  } finally {
    await handle.close();
  }
  const text = buffer.toString('utf8');
  return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'node'
  );
}

function revealInExplorer(path: string): void {
  if (process.platform !== 'win32') return;
  spawn('explorer.exe', ['/select,', path], { detached: true, stdio: 'ignore' }).unref();
}

export class DiagnosticsService {
  private readonly now: () => Date;
  private readonly exports: string;
  private readonly profilePatterns: RegExp[];

  constructor(private readonly options: DiagnosticsServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.exports = options.paths.exports;
    const home = options.homeDirectory ?? homedir();
    // The profile path as written in plain text, in JSON (escaped backslashes) and with forward slashes.
    this.profilePatterns = [home, home.replace(/\\/g, '\\\\'), home.replace(/\\/g, '/')]
      .filter((form, index, all) => form !== '' && all.indexOf(form) === index)
      .sort((a, b) => b.length - a.length)
      .map((form) => new RegExp(escapeRegExp(form), 'gi'));
  }

  /** Redacts secrets and replaces the user's profile path. */
  private sanitise(text: string): string {
    return this.profilePatterns.reduce(
      (current, pattern) => current.replace(pattern, '%USERPROFILE%'),
      redactString(text),
    );
  }

  private sanitiseLog(source: LogSource, text: string): string {
    if (source.kind === 'application') {
      // Structured entries: redact by field name as well as by value.
      return text
        .split('\n')
        .map((line) => {
          try {
            return JSON.stringify(redact(JSON.parse(line)));
          } catch {
            return line;
          }
        })
        .map((line) => this.sanitise(line))
        .join('\n');
    }
    const sanitised = this.sanitise(text);
    return source.kind === 'bitcoin-core' ? sanitised.replace(/\b[0-9a-f]{64}\b/gi, '[id hidden]') : sanitised;
  }

  async createBundle(): Promise<DiagnosticBundle> {
    const createdAt = this.now();
    const folder = `${BUNDLE_PREFIX}${createdAt.toISOString().replace(/[:.]/g, '-')}`;
    const files: ZipFile[] = [];
    // Everything sits in one folder, so extracting the bundle never scatters files.
    const add = (name: string, text: string) => {
      files.push({ name: `${folder}/${name}`, data: text, modifiedAt: createdAt });
    };
    const nodes = this.options.nodes.list();

    const hardware = await describeHardware(this.options.paths.root).catch(() => undefined);
    add(
      'system.json',
      this.sanitise(
        JSON.stringify(
          {
            btcortex: this.options.version,
            createdAt: createdAt.toISOString(),
            operatingSystem: { platform: process.platform, release: release(), architecture: arch() },
            processor: cpus()[0]?.model ?? 'unknown',
            logicalProcessors: cpus().length,
            totalMemoryBytes: totalmem(),
            hardware,
            runtime: `Node.js ${process.version}`,
          },
          null,
          2,
        ),
      ),
    );
    add('nodes.json', this.sanitise(JSON.stringify(redact(nodes), null, 2)));
    add('jobs.json', this.sanitise(JSON.stringify(redact(this.options.jobs.list().slice(0, MAX_JOBS)), null, 2)));
    const tor = await this.options.tor?.().catch(() => undefined);
    if (tor) {
      // Its notices are in logs/tor.log already.
      const { recentLines: _notices, ...state } = tor;
      add('tor.json', this.sanitise(JSON.stringify(redact(state), null, 2)));
    }

    for (const { profile } of nodes) {
      const root = localDataDirectory(profile);
      if (root === undefined) continue;
      const path = configFilePath(root);
      if (!existsSync(path)) continue;
      const masked = maskSecrets(BitcoinConfig.parse(await readFile(path, 'utf8'))).config.toString();
      add(`config/${slug(profile.name)}-${profile.id.slice(0, 8)}.conf`, this.sanitise(masked));
    }

    for (const source of this.options.logs.sources()) {
      if (!source.exists) continue;
      const name =
        source.nodeId === undefined
          ? basename(source.path)
          : `${slug(source.nodeName ?? 'node')}-${source.nodeId.slice(0, 8)}-${basename(source.path)}`;
      add(`logs/${name}`, this.sanitiseLog(source, await readTail(source.path, LOG_TAIL_BYTES)));
      // The previous orchestrator log often holds the start of a problem.
      const previous = `${source.path}.1`;
      if (source.kind === 'application' && existsSync(previous)) {
        add(`logs/${basename(previous)}`, this.sanitiseLog(source, await readTail(previous, LOG_TAIL_BYTES)));
      }
    }

    add(
      'README.txt',
      [
        `BTCortex diagnostic bundle, created ${createdAt.toISOString()} by BTCortex ${this.options.version}.`,
        '',
        'Contents',
        '- system.json: operating system, processor, memory and disk space.',
        '- nodes.json: the nodes BTCortex knows, their settings and their last status.',
        '- jobs.json: the latest background jobs and how they ended.',
        "- tor.json: BTCortex's tor: its connection to the Tor network, its ports and its version.",
        "- config/: each node's bitcoin.conf.",
        '- logs/: the most recent part (up to 5 MiB) of each log file.',
        '',
        'Removed before writing',
        '- Passwords, RPC credentials and cookies, rpcauth hashes, macaroons, access tokens, private keys and recovery phrases.',
        '- Your Windows user folder, shown as %USERPROFILE%.',
        "- Transaction and block identifiers in Bitcoin Core's log, because they can link transactions to you.",
        '',
        'Read it before sharing it: it still shows, for example, the names of your nodes and wallets and how this computer is set up.',
        '',
      ].join('\r\n'),
    );

    await mkdir(this.exports, { recursive: true });
    const path = join(this.exports, `${folder}.zip`);
    const archive = writeZip(files);
    await writeFile(`${path}.tmp`, archive);
    await rename(`${path}.tmp`, path);
    await this.pruneBundles();
    this.options.logger.info('Created a diagnostic bundle', { path, sizeBytes: archive.length, files: files.length });
    return {
      path,
      sizeBytes: archive.length,
      createdAt: createdAt.toISOString(),
      files: files.map((file) => file.name.slice(folder.length + 1)),
    };
  }

  /** Shows a bundle in File Explorer; only files in the exports folder are accepted. */
  reveal(path: string): void {
    const target = resolve(path);
    const isBundle =
      dirname(target) === resolve(this.exports) &&
      basename(target).startsWith(BUNDLE_PREFIX) &&
      target.endsWith('.zip') &&
      existsSync(target);
    if (!isBundle) {
      throw new AppFailure({
        code: 'diagnostics.not-a-bundle',
        message: 'That file is not a diagnostic bundle created by BTCortex.',
        component: 'Diagnostics',
        dataRisk: 'none',
        recoveryActions: [{ id: 'create-bundle', label: 'Create a new diagnostic bundle' }],
      });
    }
    (this.options.reveal ?? revealInExplorer)(target);
  }

  private async pruneBundles(): Promise<void> {
    const bundles = (await readdir(this.exports))
      .filter((name) => name.startsWith(BUNDLE_PREFIX) && name.endsWith('.zip'))
      .sort()
      .reverse();
    for (const old of bundles.slice(KEPT_BUNDLES)) await unlink(join(this.exports, old));
  }
}
