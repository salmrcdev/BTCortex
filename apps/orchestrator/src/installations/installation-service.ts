import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AppFailure } from '@btcortex/contracts';
import type {
  AppError,
  InstalledProduct,
  InstalledSoftware,
  IntegrityReport,
  SoftwareUpdate,
} from '@btcortex/contracts';
import { checkInstalledFiles, InstallationRejectedError } from '@btcortex/installation-manager';
import type { InstallProgress, VerificationRecord } from '@btcortex/installation-manager';
import {
  compareVersions,
  fetchLatestReleaseVersion,
  findInstalledRuntime,
  installBitcoinCore,
  parseReleaseVersion,
} from '@btcortex/integration-bitcoin-core';
import {
  compareKnotsVersions,
  fetchLatestKnotsVersion,
  installBitcoinKnots,
  listInstalledKnots,
  parseKnotsVersion,
} from '@btcortex/integration-bitcoin-knots';
import {
  electrumHeldReason,
  fetchLatestElectrumVersion,
  installElectrum,
  listInstalledElectrum,
} from '@btcortex/integration-electrum-wallet';
import { fetchLatestFulcrumVersion, installFulcrum, listInstalledFulcrum } from '@btcortex/integration-fulcrum';
import { fetchLatestSparrowVersion, findInstalledSparrow, installSparrow } from '@btcortex/integration-sparrow';
import { fetchLatestHwiVersion, installHwi, listInstalledHwi } from '@btcortex/integration-hwi';
import { fetchLatestTorVersion, installTor, listInstalledTor } from '@btcortex/integration-tor';
import type { JobManager } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import type { NodeManager } from '../nodes/node-manager';
import type { NodeRepository } from '../nodes/repository';
import { folderSize } from '../platform/disks';

// Software BTCortex installed from verified releases (specification section
// 17.3): what is installed and what was verified, newer releases, a check of
// every file against the hashes recorded at installation, side-by-side
// updates, safe removal of versions nothing uses, and moving a node to a
// newer Bitcoin Core. Versions live in their own folders, so an update never
// touches the version a node is running; a running tor moves to a new version
// by restarting, because tor ships security fixes often, and so do running
// Electrum servers (Fulcrum) within the same major version. Bitcoin Knots
// versions are a product of their own: a Knots node moves only to another
// Knots version and a Bitcoin Core node only to Bitcoin Core, because the two
// follow different chains.

const UPDATE_CHECK_REUSE_MS = 10 * 60_000;
const VERSION_FOLDER = /^\d+\.\d+(\.\d+)?$/;
const PRODUCTS: readonly InstalledProduct[] = [
  'bitcoin-core',
  'bitcoin-knots',
  'sparrow',
  'tor',
  'hwi',
  'fulcrum',
  'electrum',
];
const LABELS: Record<InstalledProduct, string> = {
  'bitcoin-core': 'Bitcoin Core',
  'bitcoin-knots': 'Bitcoin Knots',
  sparrow: 'Sparrow',
  tor: 'Tor',
  hwi: 'HWI',
  fulcrum: 'Fulcrum',
  electrum: 'Electrum',
};

interface Installed {
  product: InstalledProduct;
  version: string;
  directory: string;
  verification: VerificationRecord;
}

export interface InstallationServiceOptions {
  /** Bitcoin Core runtimes, one folder per version. */
  runtimesDirectory: string;
  /** Bitcoin Knots runtimes, one folder per version. */
  knotsDirectory?: string;
  /** Sparrow releases, one folder per version. */
  sparrowDirectory: string;
  /** Tor Expert Bundles, one folder per version. */
  torDirectory: string;
  /** HWI releases, one folder per version. */
  hwiDirectory: string;
  /** Nodes whose configuration runs this HWI version as their signer. */
  hwiUsers?: (version: string) => Promise<{ id: string; name: string }[]>;
  /** Fulcrum releases, one folder per version. */
  fulcrumDirectory?: string;
  /** Nodes whose Electrum server runs this Fulcrum version now. */
  fulcrumUsers?: (version: string) => { id: string; name: string }[];
  /** Called after a Fulcrum update, so that running Electrum servers move to it. */
  fulcrumUpdated?: () => Promise<void>;
  /** Standalone Electrum releases, one folder per version. */
  electrumDirectory?: string;
  /** Whether any Electrum runs, whose files may then be in use. */
  electrumRunning?: () => Promise<boolean>;
  downloadsDirectory: string;
  nodes: Pick<NodeManager, 'list' | 'get' | 'restart' | 'updateProfile'>;
  repository: Pick<NodeRepository, 'setRuntimeVersion'>;
  jobs: Pick<JobManager, 'run'>;
  sparrowRunning: () => Promise<boolean>;
  /** The Tor Expert Bundle version BTCortex's tor runs now, if it runs. */
  torRunningVersion: () => string | null;
  /** Called after a Tor update, so that a running tor moves to it. */
  torUpdated?: () => Promise<void>;
  logger: Logger;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Replaced in tests. */
  latest?: Partial<Record<InstalledProduct, () => Promise<string>>>;
  install?: Partial<
    Record<InstalledProduct, (version: string, onProgress: (progress: InstallProgress) => void) => Promise<void>>
  >;
}

function failure(code: string, message: string, extra: Partial<AppError> = {}): AppFailure {
  return new AppFailure({
    code,
    message,
    component: 'Installed software',
    dataRisk: 'none',
    recoveryActions: [],
    ...extra,
  });
}

function newestFirst(a: string, b: string): number {
  const knotsLeft = parseKnotsVersion(a);
  const knotsRight = parseKnotsVersion(b);
  if (knotsLeft && knotsRight) return compareKnotsVersions(knotsRight, knotsLeft);
  const left = parseReleaseVersion(a);
  const right = parseReleaseVersion(b);
  return left && right ? compareVersions(right, left) : b.localeCompare(a, 'en', { numeric: true });
}

export class InstallationService {
  private updates: { at: number; value: Promise<SoftwareUpdate[]> } | undefined;

  constructor(private readonly options: InstallationServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async installed(): Promise<Installed[]> {
    const found: Installed[] = [];
    const versions = async (directory: string) =>
      existsSync(directory)
        ? (await readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && VERSION_FOLDER.test(entry.name))
            .map((entry) => entry.name)
            .sort(newestFirst)
        : [];
    for (const version of await versions(this.options.runtimesDirectory)) {
      const runtime = await findInstalledRuntime(this.options.runtimesDirectory, version);
      if (runtime)
        found.push({
          product: 'bitcoin-core',
          version,
          directory: runtime.directory,
          verification: runtime.verification,
        });
    }
    if (this.options.knotsDirectory) {
      for (const runtime of await listInstalledKnots(this.options.knotsDirectory)) {
        found.push({
          product: 'bitcoin-knots',
          version: runtime.version,
          directory: runtime.directory,
          verification: runtime.verification,
        });
      }
    }
    for (const version of await versions(this.options.sparrowDirectory)) {
      const runtime = await findInstalledSparrow(this.options.sparrowDirectory, version);
      if (runtime) {
        found.push({
          product: 'sparrow',
          version,
          directory: join(this.options.sparrowDirectory, version),
          verification: runtime.verification,
        });
      }
    }
    for (const runtime of await listInstalledTor(this.options.torDirectory)) {
      found.push({
        product: 'tor',
        version: runtime.version,
        directory: runtime.directory,
        verification: runtime.verification,
      });
    }
    for (const runtime of await listInstalledHwi(this.options.hwiDirectory)) {
      found.push({
        product: 'hwi',
        version: runtime.version,
        directory: runtime.directory,
        verification: runtime.verification,
      });
    }
    if (this.options.electrumDirectory) {
      for (const runtime of await listInstalledElectrum(this.options.electrumDirectory)) {
        found.push({
          product: 'electrum',
          version: runtime.version,
          directory: runtime.directory,
          verification: runtime.verification,
        });
      }
    }
    if (this.options.fulcrumDirectory) {
      for (const runtime of await listInstalledFulcrum(this.options.fulcrumDirectory)) {
        found.push({
          product: 'fulcrum',
          version: runtime.version,
          directory: runtime.directory,
          verification: runtime.verification,
        });
      }
    }
    return found;
  }

  private async find(product: InstalledProduct, version: string): Promise<Installed> {
    const entry = (await this.installed()).find((item) => item.product === product && item.version === version);
    if (!entry) throw failure('installations.not-found', `${LABELS[product]} ${version} is not installed.`);
    return entry;
  }

  private async usedBy(product: InstalledProduct, version: string): Promise<{ id: string; name: string }[]> {
    if (product === 'hwi') return (await this.options.hwiUsers?.(version)) ?? [];
    if (product === 'fulcrum') return this.options.fulcrumUsers?.(version) ?? [];
    if (product !== 'bitcoin-core' && product !== 'bitcoin-knots') return [];
    return this.options.nodes
      .list()
      .filter(
        (node) =>
          node.profile.execution === 'managed' &&
          node.profile.implementation === product &&
          node.profile.runtimeVersion === version,
      )
      .map((node) => ({ id: node.profile.id, name: node.profile.name }));
  }

  async list(): Promise<InstalledSoftware[]> {
    const sparrowRunning = await this.options.sparrowRunning();
    const electrumRunning = (await this.options.electrumRunning?.().catch(() => false)) ?? false;
    return Promise.all(
      (await this.installed()).map(async (entry) => {
        const { verification } = entry;
        const usedBy = await this.usedBy(entry.product, entry.version);
        const codeSigning =
          verification.authenticode.length === 0 ? 'none' : entry.product === 'bitcoin-core' ? 'verified' : 'recorded';
        return {
          product: entry.product,
          version: entry.version,
          directory: entry.directory,
          bytes: await folderSize(entry.directory),
          verifiedAt: verification.verifiedAt,
          signatures: {
            valid: verification.signatures.validSigners.length,
            required: verification.signatures.threshold,
          },
          codeSigning,
          integrityRecorded: verification.files !== undefined,
          usedBy,
          running:
            (entry.product === 'sparrow' && sparrowRunning) ||
            (entry.product === 'tor' && this.options.torRunningVersion() === entry.version) ||
            (entry.product === 'fulcrum' && usedBy.length > 0) ||
            (entry.product === 'electrum' && electrumRunning),
        } satisfies InstalledSoftware;
      }),
    );
  }

  /** Newest releases upstream; reused for ten minutes so the page can refresh without asking the servers again. */
  checkUpdates(): Promise<SoftwareUpdate[]> {
    const now = this.now().getTime();
    if (this.updates && now - this.updates.at < UPDATE_CHECK_REUSE_MS) return this.updates.value;
    const value = this.lookUpUpdates();
    this.updates = { at: now, value };
    return value;
  }

  private async lookUpUpdates(): Promise<SoftwareUpdate[]> {
    const installed = await this.installed();
    return Promise.all(
      PRODUCTS.map(async (product): Promise<SoftwareUpdate> => {
        const newest = installed.find((entry) => entry.product === product)?.version ?? null;
        const checkedAt = this.now().toISOString();
        // Knots is asked about only once it is installed: it is never offered unasked.
        if (product === 'bitcoin-knots' && newest === null) {
          return { product, installed: null, latest: null, updateAvailable: false, checkedAt };
        }
        try {
          const version = await this.latestRelease(product)();
          const held = product === 'electrum' ? electrumHeldReason(version) : undefined;
          return {
            product,
            installed: newest,
            latest: version,
            updateAvailable: held === undefined && newest !== null && newestFirst(version, newest) < 0,
            checkedAt,
            ...(held === undefined ? {} : { held }),
          };
        } catch (error) {
          this.options.logger.warn('Could not check for a newer release', { product, error });
          return {
            product,
            installed: newest,
            latest: null,
            updateAvailable: false,
            checkedAt,
            error: 'The release server could not be reached. Check the internet connection and try again.',
          };
        }
      }),
    );
  }

  private latestRelease(product: InstalledProduct): () => Promise<string> {
    const injected = this.options.latest?.[product];
    if (injected) return injected;
    if (product === 'sparrow') return () => fetchLatestSparrowVersion(this.options.fetch);
    if (product === 'tor') return () => fetchLatestTorVersion(this.options.fetch);
    if (product === 'hwi') return () => fetchLatestHwiVersion(this.options.fetch);
    if (product === 'fulcrum') return () => fetchLatestFulcrumVersion(this.options.fetch);
    if (product === 'electrum') return () => fetchLatestElectrumVersion(this.options.fetch);
    if (product === 'bitcoin-knots') return () => fetchLatestKnotsVersion(this.options.fetch);
    return () => fetchLatestReleaseVersion(this.options.fetch);
  }

  private installer(
    product: InstalledProduct,
  ): (version: string, onProgress: (progress: InstallProgress) => void) => Promise<void> {
    const injected = this.options.install?.[product];
    if (injected) return injected;
    const common = {
      downloadsDirectory: this.options.downloadsDirectory,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    };
    if (product === 'sparrow') {
      return async (version, onProgress) => {
        await installSparrow({ version, appsDirectory: this.options.sparrowDirectory, onProgress, ...common });
      };
    }
    if (product === 'tor') {
      return async (version, onProgress) => {
        await installTor({ version, runtimesDirectory: this.options.torDirectory, onProgress, ...common });
      };
    }
    if (product === 'hwi') {
      return async (version, onProgress) => {
        await installHwi({ version, runtimesDirectory: this.options.hwiDirectory, onProgress, ...common });
      };
    }
    if (product === 'electrum') {
      const runtimesDirectory = this.options.electrumDirectory;
      if (runtimesDirectory === undefined)
        throw failure('installations.unavailable', 'Electrum cannot be installed here.');
      return async (version, onProgress) => {
        await installElectrum({ version, runtimesDirectory, onProgress, ...common });
      };
    }
    if (product === 'fulcrum') {
      const runtimesDirectory = this.options.fulcrumDirectory;
      if (runtimesDirectory === undefined)
        throw failure('installations.unavailable', 'Fulcrum cannot be installed here.');
      return async (version, onProgress) => {
        await installFulcrum({ version, runtimesDirectory, onProgress, ...common });
      };
    }
    if (product === 'bitcoin-knots') {
      const runtimesDirectory = this.options.knotsDirectory;
      if (runtimesDirectory === undefined)
        throw failure('installations.unavailable', 'Bitcoin Knots cannot be installed here.');
      return async (version, onProgress) => {
        await installBitcoinKnots({ version, runtimesDirectory, onProgress, ...common });
      };
    }
    return async (version, onProgress) => {
      await installBitcoinCore({ version, runtimesDirectory: this.options.runtimesDirectory, onProgress, ...common });
    };
  }

  async verify(product: InstalledProduct, version: string): Promise<IntegrityReport> {
    const entry = await this.find(product, version);
    const check = await checkInstalledFiles(entry.directory, entry.verification);
    this.options.logger.info('Checked an installation', {
      product,
      version,
      missing: check.missing.length,
      changed: check.changed.length,
    });
    return { product, version, ...check };
  }

  /** Installs the newest release next to the current one; a version already installed is left as it is. */
  update(product: InstalledProduct): string {
    const job = this.options.jobs.run(
      'software.update',
      `Update ${LABELS[product]}`,
      async (report) => {
        report({ stage: 'resolving', message: 'Checking the newest release.' });
        const version = await this.latestRelease(product)();
        const onProgress = (progress: InstallProgress) => {
          report({
            stage: progress.stage,
            message: progress.message,
            ...(progress.receivedBytes !== undefined && progress.totalBytes
              ? { fraction: Math.min(1, progress.receivedBytes / progress.totalBytes) }
              : {}),
          });
        };
        await this.installer(product)(version, onProgress);
        this.updates = undefined;
        if (product === 'tor' && this.options.torUpdated) {
          report({ stage: 'restarting', message: 'Restarting tor on the new version.' });
          await this.options.torUpdated();
        }
        if (product === 'fulcrum' && this.options.fulcrumUpdated) {
          report({ stage: 'restarting', message: 'Restarting the running Electrum servers on the new version.' });
          await this.options.fulcrumUpdated();
        }
        report({ stage: 'finished', message: `Version ${version} is installed and verified.` });
        return undefined;
      },
      (error) =>
        error instanceof AppFailure
          ? error.error
          : {
              code:
                error instanceof InstallationRejectedError ? 'installations.rejected' : 'installations.update-failed',
              message:
                error instanceof InstallationRejectedError
                  ? `The new release was not installed because it did not pass verification: ${error.message}`
                  : 'The update could not be completed. Nothing was changed in the installed versions.',
              component: 'Installed software',
              dataRisk: 'none',
              // A rejected release stays rejected: trying again would only repeat the refusal.
              recoveryActions:
                error instanceof InstallationRejectedError
                  ? []
                  : [{ id: 'retry-update', label: 'Try the update again' }],
            },
    );
    return job.id;
  }

  async remove(product: InstalledProduct, version: string): Promise<number> {
    const entry = await this.find(product, version);
    const users = await this.usedBy(product, version);
    if (users.length > 0) {
      const names = users.map((user) => user.name).join(', ');
      throw failure(
        'installations.in-use',
        product === 'hwi'
          ? `HWI ${version} is the hardware-wallet signer of ${names}. Set those nodes up again on the Hardware wallets page to move them to a newer HWI first.`
          : product === 'fulcrum'
            ? `Fulcrum ${version} runs the Electrum server of ${names}. Update Fulcrum, or stop those servers, and try again.`
            : `${LABELS[product]} ${version} is used by ${names}. Move those nodes to another version first.`,
      );
    }
    if (product === 'sparrow' && (await this.options.sparrowRunning())) {
      throw failure('installations.running', 'Sparrow is open, so its files are in use. Close Sparrow and try again.');
    }
    if (product === 'electrum' && (await this.options.electrumRunning?.())) {
      throw failure(
        'installations.running',
        'Electrum is open, so its files may be in use. Close Electrum and try again.',
      );
    }
    if (product === 'tor' && this.options.torRunningVersion() === version) {
      throw failure(
        'installations.running',
        `tor runs from Tor ${version} now. Stop Tor, or update it, and try again.`,
      );
    }
    const bytes = await folderSize(entry.directory);
    await rm(entry.directory, { recursive: true, force: true });
    this.updates = undefined;
    this.options.logger.info('Removed an installed version', { product, version, bytes });
    return bytes;
  }

  /**
   * Moves a managed node to a newer installed version of its own software and
   * restarts it if it was running: a Bitcoin Core node to Bitcoin Core, a
   * Bitcoin Knots node to Knots, never one to the other.
   */
  async useRuntime(nodeId: string, version: string): Promise<boolean> {
    const node = this.options.nodes.get(nodeId);
    const { profile } = node;
    const product: InstalledProduct = profile.implementation === 'bitcoin-knots' ? 'bitcoin-knots' : 'bitcoin-core';
    if (profile.execution !== 'managed' || !profile.runtimeVersion) {
      throw failure('nodes.not-managed', `BTCortex chooses the ${LABELS[product]} version only for nodes it set up.`);
    }
    const other = product === 'bitcoin-knots' ? parseReleaseVersion(version) : parseKnotsVersion(version);
    if (other) {
      throw failure(
        'installations.other-software',
        `${profile.name} runs ${LABELS[product]}, and ${product === 'bitcoin-knots' ? 'Bitcoin Core' : 'Bitcoin Knots'} ${version} follows another chain: a node keeps its own software.`,
      );
    }
    await this.find(product, version);
    const older =
      product === 'bitcoin-knots'
        ? (() => {
            const current = parseKnotsVersion(profile.runtimeVersion);
            const next = parseKnotsVersion(version);
            return current !== undefined && next !== undefined && compareKnotsVersions(next, current) < 0;
          })()
        : (() => {
            const current = parseReleaseVersion(profile.runtimeVersion);
            const next = parseReleaseVersion(version);
            return current !== undefined && next !== undefined && compareVersions(next, current) < 0;
          })();
    if (older) {
      throw failure(
        'installations.downgrade',
        `${LABELS[product]} does not support moving a data directory back to an older version, so ${profile.name} stays on ${profile.runtimeVersion}.`,
      );
    }
    if (version === profile.runtimeVersion) return false;
    const updated = this.options.repository.setRuntimeVersion(nodeId, version, this.now().toISOString());
    if (updated) this.options.nodes.updateProfile(updated);
    this.options.logger.info('Moved a node to another version', {
      nodeId,
      product,
      from: profile.runtimeVersion,
      to: version,
    });
    const running = node.status.state === 'running' || node.status.state === 'starting';
    if (running) await this.options.nodes.restart(nodeId);
    return running;
  }
}
