import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppFailure } from '@btcortex/contracts';
import type { ElectrumConnection, ElectrumWalletStatus, NodeProfile } from '@btcortex/contracts';
import {
  electrumArguments,
  electrumDataFolder,
  fetchLatestElectrumVersion,
  findInstalledElectrumApplication,
  installElectrum,
  isCompatibleElectrumVersion,
  isElectrumRunning,
  launchElectrum,
  listInstalledElectrum,
} from '@btcortex/integration-electrum-wallet';
import type { ElectrumRuntime, InstalledElectrum } from '@btcortex/integration-electrum-wallet';
import { describeInstallationFailure } from '../jobs/installation-errors';
import type { JobManager, JobProgressReporter } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import type { NodeManager } from '../nodes/node-manager';
import type { AppPaths } from '../platform/paths';
import { electrumWalletsFolder } from '../platform/paths';

// Opens Electrum with the user's own Electrum server
// (docs/research/notes/wallets-hardware.md §4): an Electrum the user
// installed is used as it is, so its wallets are never opened by another
// version (a newer one may upgrade wallet files the older one then cannot
// read); otherwise BTCortex installs the current standalone release after
// checking its signatures. The server goes on Electrum's command line
// (`--oneserver --server`) for that session only: Electrum's settings and
// wallets are not changed.

const COMPONENT = 'Electrum';
const LATEST_REUSE_MS = 60 * 60_000;

export interface ElectrumWalletServiceOptions {
  paths: AppPaths;
  nodes: Pick<NodeManager, 'get'>;
  jobs: Pick<JobManager, 'run'>;
  logger: Logger;
  /** The node's Electrum server and whether it serves wallets now. */
  server: (nodeId: string) => { connection: ElectrumConnection; ready: boolean } | undefined;
  fetch?: typeof fetch;
  /** Replaced in tests. */
  latestVersion?: () => Promise<string>;
  findApplication?: () => Promise<InstalledElectrum | undefined>;
  isRunning?: () => Promise<boolean>;
  launch?: (executable: string, args: readonly string[]) => void;
  install?: (version: string, report: JobProgressReporter) => Promise<ElectrumRuntime>;
  /** Electrum's default data folder; replaced in tests. */
  electrumDataFolder?: () => string | undefined;
}

function newer(left: string, right: string): boolean {
  return left.localeCompare(right, 'en', { numeric: true }) > 0;
}

export class ElectrumWalletService {
  private latest: { at: number; value: Promise<string | null> } | undefined;

  constructor(private readonly options: ElectrumWalletServiceOptions) {}

  private get runtimesDirectory(): string {
    return join(this.options.paths.installations, 'electrum');
  }

  /**
   * BTCortex's own Electrum keeps its wallets here, never in %APPDATA%\Electrum:
   * that folder may hold the wallets of an Electrum BTCortex cannot see (a
   * standalone copy), which a newer Electrum would upgrade beyond its reach.
   */
  get ownWalletsFolder(): string {
    return electrumWalletsFolder(this.options.paths);
  }

  private otherElectrumWallets(): boolean {
    const folder = (this.options.electrumDataFolder ?? electrumDataFolder)();
    return folder !== undefined && existsSync(folder);
  }

  private failure(code: string, message: string, extra: Partial<AppFailure['error']> = {}): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [], ...extra });
  }

  /** The newest release, checked at most once an hour; `null` when it could not be checked. */
  private latestRelease(): Promise<string | null> {
    const now = Date.now();
    if (this.latest && now - this.latest.at < LATEST_REUSE_MS) return this.latest.value;
    const value = (this.options.latestVersion ?? (() => fetchLatestElectrumVersion(this.options.fetch)))().catch(
      (error: unknown) => {
        this.options.logger.debug('The latest Electrum release could not be checked', { error });
        return null;
      },
    );
    this.latest = { at: now, value };
    return value;
  }

  private findApplication(): Promise<InstalledElectrum | undefined> {
    return (this.options.findApplication ?? findInstalledElectrumApplication)();
  }

  private isRunning(): Promise<boolean> {
    return (this.options.isRunning ?? isElectrumRunning)().catch(() => false);
  }

  /** Why Electrum cannot be opened for this node now, if so. */
  private unavailable(profile: NodeProfile, application: InstalledElectrum | undefined): string | undefined {
    const server = this.options.server(profile.id);
    if (!server)
      return 'This node has no Electrum server yet. Set one up first; Electrum needs one, as it cannot use Bitcoin Core directly.';
    if (!server.ready) return 'The Electrum server is not ready for wallets yet: it opens when indexing is finished.';
    if (application?.version && !isCompatibleElectrumVersion(application.version)) {
      return `The Electrum ${application.version} installed on this computer needs a newer Electrum protocol than Fulcrum offers.`;
    }
    return undefined;
  }

  /** What is on this computer, whichever node it is used with (for the catalogue). */
  async summary(): Promise<{ installed: string | null; application: string | null; running: boolean }> {
    const [application, installed, running] = await Promise.all([
      this.findApplication(),
      listInstalledElectrum(this.runtimesDirectory).then((runtimes) => runtimes[0]),
      this.isRunning(),
    ]);
    return {
      installed: installed?.version ?? null,
      application: application ? (application.version ?? 'unknown') : null,
      running,
    };
  }

  async status(nodeId: string): Promise<ElectrumWalletStatus> {
    const { profile } = this.options.nodes.get(nodeId);
    const [application, installed, latest, running] = await Promise.all([
      this.findApplication(),
      listInstalledElectrum(this.runtimesDirectory).then((runtimes) => runtimes[0]),
      this.latestRelease(),
      this.isRunning(),
    ]);
    const reason = this.unavailable(profile, application);
    return {
      ownWalletsFolder: application ? null : this.ownWalletsFolder,
      otherElectrumWallets: !application && this.otherElectrumWallets(),
      installed: installed ? { version: installed.version, verifiedAt: installed.verification.verifiedAt } : null,
      application: application ? { version: application.version, directory: application.directory } : null,
      opens: application ? 'application' : installed ? 'verified' : 'install',
      latest,
      applicationOutdated:
        application?.version !== undefined &&
        application.version !== null &&
        latest !== null &&
        newer(latest, application.version),
      running,
      server: this.options.server(nodeId)?.connection.server ?? null,
      ...(reason === undefined ? {} : { unavailableReason: reason }),
    };
  }

  open(nodeId: string): string {
    const { profile } = this.options.nodes.get(nodeId);
    const job = this.options.jobs.run(
      'electrum-wallet.open',
      `Open Electrum with the Electrum server of ${profile.name}`,
      async (report) => {
        await this.openNow(profile, report);
        return { nodeId };
      },
      (error) => describeInstallationFailure(error, COMPONENT),
    );
    return job.id;
  }

  private async openNow(profile: NodeProfile, report: JobProgressReporter): Promise<void> {
    report({ stage: 'checking', message: 'Checking the Electrum server and the Electrum on this computer.' });
    const application = await this.findApplication();
    const reason = this.unavailable(profile, application);
    const server = this.options.server(profile.id);
    if (reason !== undefined || !server) {
      throw this.failure('electrum-wallet.unavailable', reason ?? 'This node has no Electrum server yet.');
    }
    if (await this.isRunning()) {
      throw this.failure(
        'electrum-wallet.running',
        'Electrum is open. Close it first, so that it starts again with this server.',
        { recoveryActions: [{ id: 'close-electrum', label: 'Close Electrum, then try again' }] },
      );
    }
    let executable = application?.executable;
    if (!executable) {
      const installed = (await listInstalledElectrum(this.runtimesDirectory))[0];
      executable = installed?.executable ?? (await this.installCurrent(report)).executable;
    }
    report({ stage: 'launching', message: 'Opening Electrum.' });
    // The user's own Electrum keeps its folder; BTCortex's copy gets one of its own.
    const args = electrumArguments(
      profile.network,
      server.connection.server,
      application ? undefined : this.ownWalletsFolder,
    );
    (this.options.launch ?? launchElectrum)(executable, args);
    this.options.logger.info('Opened Electrum with an Electrum server', {
      nodeId: profile.id,
      application: application !== undefined,
      network: profile.network,
    });
  }

  private async installCurrent(report: JobProgressReporter): Promise<ElectrumRuntime> {
    report({ stage: 'resolving', message: 'Checking the current Electrum release.' });
    const version = await (this.options.latestVersion ?? (() => fetchLatestElectrumVersion(this.options.fetch)))();
    if (!isCompatibleElectrumVersion(version)) {
      throw this.failure(
        'electrum-wallet.incompatible',
        `Electrum ${version} needs a newer Electrum protocol than Fulcrum offers, so BTCortex does not install it yet.`,
      );
    }
    if (this.options.install) return this.options.install(version, report);
    return installElectrum({
      version,
      runtimesDirectory: this.runtimesDirectory,
      downloadsDirectory: this.options.paths.downloads,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      onProgress: (progress) => {
        report({
          stage: progress.stage,
          message: progress.message,
          ...(progress.receivedBytes !== undefined && progress.totalBytes
            ? { fraction: Math.min(1, progress.receivedBytes / progress.totalBytes) }
            : {}),
        });
      },
    });
  }
}
