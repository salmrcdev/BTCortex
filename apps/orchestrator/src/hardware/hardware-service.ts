import { AppFailure } from '@btcortex/contracts';
import type { AppError, BitcoinNetworkId, HardwareOverview, IdentifiedDevice } from '@btcortex/contracts';
import type { InstallProgress } from '@btcortex/installation-manager';
import {
  fetchLatestTrezorSuiteVersion,
  installTrezorSuite,
  launchTrezorSuite,
  listAttachedDevices,
  trezorBridgeState,
  trezorSuiteState,
} from '@btcortex/integration-hardware-wallets';
import type { AttachedDevice, SuiteEnvironment } from '@btcortex/integration-hardware-wallets';
import {
  fetchLatestHwiVersion,
  hwiChain,
  HwiClient,
  HwiError,
  installHwi,
  listInstalledHwi,
} from '@btcortex/integration-hwi';
import type { HwiRuntime } from '@btcortex/integration-hwi';
import { describeInstallationFailure } from '../jobs/installation-errors';
import type { JobManager, JobProgressReporter } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';

// Signing devices and the software around them (specification section 9;
// docs/research/notes/wallets-hardware.md §5 and §8): devices recognised from
// Windows' device list without opening them, HWI installed from its verified
// release for anything that talks to a device, and Trezor Suite installed
// and opened for what belongs to Trezor (set-up, firmware, Safe 7 pairing).
// Nothing here can set up, wipe or restore a device, or touch a recovery
// phrase; HWI's results, which include device labels, are never logged.

const COMPONENT = 'Hardware wallets';

export interface HardwareServiceOptions {
  /** Parent of the verified HWI versions. */
  hwiDirectory: string;
  downloadsDirectory: string;
  /** Where the Trezor Suite installation's verification record is kept. */
  suiteRecordFile: string;
  jobs: Pick<JobManager, 'run'>;
  logger: Logger;
  fetch?: typeof fetch;
  env?: SuiteEnvironment;
  now?: () => Date;
  /** Replaced in tests. */
  listDevices?: () => Promise<AttachedDevice[]>;
  client?: (executable: string) => Pick<HwiClient, 'enumerate'>;
  installHwi?: (version: string, onProgress: (progress: InstallProgress) => void) => Promise<void>;
  installSuite?: (version: string, onProgress: (progress: InstallProgress) => void) => Promise<void>;
  latestHwi?: () => Promise<string>;
  latestSuite?: () => Promise<string>;
  launchSuite?: (executable: string) => void;
}

function failure(code: string, message: string, extra: Partial<AppError> = {}): AppFailure {
  return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [], ...extra });
}

/** Explains HWI's failures in the user's terms. */
export function describeHwiError(error: HwiError): AppFailure {
  const known: Record<number, [string, string]> = {
    [-3]: [
      'The hardware wallet could not be reached.',
      'It is not connected, or another application such as Trezor Suite or Sparrow is using it. Close the other application and try again.',
    ],
    [-12]: ['The hardware wallet is not ready.', 'Unlock it with its PIN on the device and try again.'],
    [-14]: ['The action was cancelled on the hardware wallet.', 'Nothing was changed.'],
    [-15]: ['The hardware wallet is busy.', 'Finish what it shows on its screen, then try again.'],
    [-18]: [
      'The hardware wallet is not set up yet.',
      'Set it up with its own application first, for example Trezor Suite.',
    ],
  };
  const [message, likelyCause] = known[error.code] ?? [
    `HWI reported: ${error.message}`,
    'See the hardware wallet for details.',
  ];
  return failure(`hardware.hwi-${String(-error.code)}`, message, {
    likelyCause,
    details: { hwiCode: error.code },
  });
}

function progressReporter(report: JobProgressReporter) {
  return (progress: InstallProgress) => {
    report({
      stage: progress.stage,
      message: progress.message,
      ...(progress.receivedBytes !== undefined && progress.totalBytes
        ? { fraction: Math.min(1, progress.receivedBytes / progress.totalBytes) }
        : {}),
    });
  };
}

/** Several callers (the page, the catalogue's adapters) ask at once; one scan answers them all. */
const OVERVIEW_REUSE_MS = 2_000;

export class HardwareService {
  private recent: { at: number; value: Promise<HardwareOverview> } | undefined;

  constructor(private readonly options: HardwareServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** The newest verified HWI BTCortex installed. */
  async hwi(): Promise<HwiRuntime | undefined> {
    return (await listInstalledHwi(this.options.hwiDirectory))[0];
  }

  overview(): Promise<HardwareOverview> {
    const now = this.now().getTime();
    if (this.recent && now - this.recent.at < OVERVIEW_REUSE_MS) return this.recent.value;
    const value = this.scan();
    this.recent = { at: now, value };
    return value;
  }

  private async scan(): Promise<HardwareOverview> {
    const env = this.options.env ?? process.env;
    const [devices, hwi, trezorSuite, trezorBridge] = await Promise.all([
      (this.options.listDevices ?? listAttachedDevices)().catch((error: unknown) => {
        this.options.logger.warn('Windows did not list the USB devices', { error });
        return [];
      }),
      this.hwi(),
      trezorSuiteState(this.options.suiteRecordFile, env),
      trezorBridgeState(env),
    ]);
    return {
      devices,
      hwi: hwi ? { version: hwi.version, verifiedAt: hwi.verification.verifiedAt } : null,
      trezorSuite,
      trezorBridge,
      scannedAt: this.now().toISOString(),
    };
  }

  /** Asks HWI which devices are connected, with their model and, once unlocked, their fingerprint. */
  async identify(network: BitcoinNetworkId): Promise<IdentifiedDevice[]> {
    const hwi = await this.hwi();
    if (!hwi) {
      throw failure('hardware.hwi-missing', 'HWI is not installed yet.', {
        recoveryActions: [{ id: 'install-hwi', label: 'Install HWI' }],
      });
    }
    const client = (this.options.client ?? ((executable: string) => new HwiClient({ executable })))(hwi.executable);
    try {
      const devices = await client.enumerate(hwiChain(network));
      return devices.map((device) => ({
        type: device.type,
        model: device.model,
        ...(device.label === undefined ? {} : { label: device.label }),
        ...(device.fingerprint === undefined ? {} : { fingerprint: device.fingerprint }),
        locked: device.needsPinSent,
        needsPassphrase: device.needsPassphraseSent,
        ...(device.error === undefined ? {} : { error: device.error }),
      }));
    } catch (error) {
      if (error instanceof HwiError) throw describeHwiError(error);
      throw error;
    }
  }

  installHwi(): string {
    return this.options.jobs.run(
      'hwi.install',
      'Install HWI',
      async (report) => {
        report({ stage: 'resolving', message: 'Checking the newest HWI release.' });
        const version = await (this.options.latestHwi ?? (() => fetchLatestHwiVersion(this.options.fetch)))();
        const install =
          this.options.installHwi ??
          (async (target: string, onProgress: (progress: InstallProgress) => void) => {
            await installHwi({
              version: target,
              runtimesDirectory: this.options.hwiDirectory,
              downloadsDirectory: this.options.downloadsDirectory,
              onProgress,
              ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
            });
          });
        await install(version, progressReporter(report));
        report({ stage: 'finished', message: `HWI ${version} is installed and verified.` });
        return undefined;
      },
      (error) => describeInstallationFailure(error, COMPONENT),
    ).id;
  }

  installTrezorSuite(): string {
    return this.options.jobs.run(
      'trezor-suite.install',
      'Install Trezor Suite',
      async (report) => {
        report({ stage: 'resolving', message: 'Checking the newest Trezor Suite release.' });
        const version = await (this.options.latestSuite ?? (() => fetchLatestTrezorSuiteVersion(this.options.fetch)))();
        const install =
          this.options.installSuite ??
          (async (target: string, onProgress: (progress: InstallProgress) => void) => {
            await installTrezorSuite({
              version: target,
              downloadsDirectory: this.options.downloadsDirectory,
              recordFile: this.options.suiteRecordFile,
              ...(this.options.env ? { env: this.options.env } : {}),
              onProgress,
              ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
            });
          });
        await install(version, progressReporter(report));
        report({ stage: 'finished', message: `Trezor Suite ${version} is installed and verified.` });
        return undefined;
      },
      (error) => describeInstallationFailure(error, 'Trezor Suite'),
    ).id;
  }

  async openTrezorSuite(): Promise<void> {
    const state = await trezorSuiteState(this.options.suiteRecordFile, this.options.env ?? process.env);
    if (!state.installed) {
      throw failure('hardware.suite-missing', 'Trezor Suite is not installed.', {
        recoveryActions: [{ id: 'install-trezor-suite', label: 'Install Trezor Suite' }],
      });
    }
    if (state.running) return;
    (this.options.launchSuite ?? launchTrezorSuite)(state.installed.path);
    this.options.logger.info('Opened Trezor Suite');
  }
}
