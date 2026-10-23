import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BitcoinConfig,
  effectiveScalar,
  NETWORK_PARAMETERS,
  recommendConfiguration,
  resolveEffective,
  validateConfig,
} from '@btcortex/bitcoin-config';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import { AppFailure } from '@btcortex/contracts';
import type {
  AppError,
  BitcoinNetworkId,
  NodeImplementation,
  NodeProfile,
  NodeUsage,
  SetupPlan,
} from '@btcortex/contracts';
import {
  configFilePath,
  cookieFilePath,
  defaultRpcEndpoint,
  detectExistingInstallations,
  fetchLatestReleaseVersion,
  installBitcoinCore,
} from '@btcortex/integration-bitcoin-core';
import {
  fetchLatestKnotsVersion,
  followsDifferentChain,
  installBitcoinKnots,
  parseKnotsVersion,
} from '@btcortex/integration-bitcoin-knots';
import type { InstallProgress } from '@btcortex/installation-manager';
import { describeInstallationFailure } from '../jobs/installation-errors';
import type { JobManager, JobProgressReporter } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import type { NodeManager } from '../nodes/node-manager';
import type { NodeRepository } from '../nodes/repository';
import { describeHardware } from '../platform/hardware';
import type { AppPaths } from '../platform/paths';
import { bitcoinCoreRuntimes, bitcoinKnotsRuntimes } from '../platform/paths';
import { chooseLoopbackPort } from '../platform/ports';

// Zero-touch set-up of a Bitcoin Core node: one plan, one approval, then a job
// that downloads and verifies the official release, writes a hardware-aware
// configuration, registers the node and starts it (specification sections 18
// and 25). The plan step changes nothing. Bitcoin Knots is set up the same way
// on request only, never by default: its releases since 29.4.1 follow a chain
// Bitcoin Core rejects, so the user must agree to that first, and its nodes
// get no Electrum server.

const PRODUCTS: Record<NodeImplementation, string> = {
  'bitcoin-core': 'Bitcoin Core',
  'bitcoin-knots': 'Bitcoin Knots',
};
/** The 31.1 Windows archive is about 55 MB, Knots 29.4.2's about 51 MB. */
const APPROXIMATE_DOWNLOAD_BYTES: Record<NodeImplementation, number> = {
  'bitcoin-core': 55_000_000,
  'bitcoin-knots': 51_000_000,
};
const KNOTS_WITHOUT_ELECTRUM =
  'BTCortex sets up Electrum servers for Bitcoin Core nodes only: whether Electrum wallets accept a Bitcoin Knots node’s chain is not established.';
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 1_000;

export interface SetupServiceOptions {
  paths: AppPaths;
  repository: NodeRepository;
  nodes: NodeManager;
  jobs: JobManager;
  logger: Logger;
  /** Defaults to the application's verified runtimes directory. */
  runtimesDirectory?: string;
  /** Defaults to the application's verified Bitcoin Knots runtimes directory. */
  knotsRuntimesDirectory?: string;
  now?: () => Date;
  fetch?: typeof fetch;
  /** A node set up as an Electrum back end gets its Electrum server set up next. */
  setUpElectrumServer?: (nodeId: string) => void;
  /** Bitcoin data directories found on this computer; replaced in tests. */
  existingDataDirectories?: () => Promise<{ path: string; networksWithChainData: readonly BitcoinNetworkId[] }[]>;
}

/** The data directory a new node of this network would get. */
export function proposedDataDirectory(paths: Pick<AppPaths, 'nodes'>, network: BitcoinNetworkId): string {
  let index = 1;
  while (existsSync(join(paths.nodes, `${network}-${index}`))) index += 1;
  return join(paths.nodes, `${network}-${index}`);
}

export function describeSetupFailure(error: unknown, implementation: NodeImplementation = 'bitcoin-core'): AppError {
  return describeInstallationFailure(error, `${PRODUCTS[implementation]} set-up`);
}

/** Whether this release follows a chain Bitcoin Core rejects; a Knots version BTCortex cannot read counts as one. */
export function followsOtherChain(implementation: NodeImplementation, version: string): boolean {
  if (implementation !== 'bitcoin-knots') return false;
  const parsed = parseKnotsVersion(version);
  return parsed === undefined || followsDifferentChain(parsed);
}

export interface SetupStartOptions {
  /** A node set up as an Electrum back end gets its Electrum server set up next. */
  electrumServerAfterwards?: boolean;
  implementation?: NodeImplementation;
  /** The user agreed that the node follows a chain Bitcoin Core rejects. */
  acceptDifferentChain?: boolean;
}

export class SetupService {
  /**
   * The RPC and P2P ports of the other nodes of this network: those BTCortex
   * knows, running or not, and Bitcoin data directories found on this computer
   * that hold this network's chain. Each node's own bitcoin.conf says which it
   * uses; without a setting, the network's default.
   */
  private async portsOfOtherNodes(network: BitcoinNetworkId): Promise<{ rpc: Set<number>; p2p: Set<number> }> {
    const parameters = NETWORK_PARAMETERS[network];
    const rpc = new Set<number>();
    const p2p = new Set<number>();
    const directories = new Set<string>();
    for (const profile of this.options.repository.list()) {
      if (profile.network !== network) continue;
      const port = Number.parseInt(URL.parse(profile.rpcEndpoint)?.port ?? '', 10);
      rpc.add(Number.isNaN(port) ? parameters.rpcPort : port);
      if (profile.dataDirectory) directories.add(profile.dataDirectory);
    }
    const found = await (
      this.options.existingDataDirectories ?? (async () => (await detectExistingInstallations()).dataDirectories)
    )().catch(() => []);
    for (const directory of found) {
      if (directory.networksWithChainData.includes(network)) directories.add(directory.path);
    }
    for (const directory of directories) {
      let config = BitcoinConfig.empty();
      try {
        config = BitcoinConfig.parse(await readFile(configFilePath(directory), 'utf8'));
      } catch {
        // No readable bitcoin.conf: the defaults apply.
      }
      const effective = resolveEffective(config, network);
      const rpcPort = Number.parseInt(effectiveScalar(effective, 'rpcport') ?? '', 10);
      const p2pPort = Number.parseInt(effectiveScalar(effective, 'port') ?? '', 10);
      rpc.add(Number.isNaN(rpcPort) ? parameters.rpcPort : rpcPort);
      p2p.add(Number.isNaN(p2pPort) ? parameters.p2pPort : p2pPort);
    }
    return { rpc, p2p };
  }
  private readonly now: () => Date;

  constructor(private readonly options: SetupServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  private latestVersion(implementation: NodeImplementation): Promise<string> {
    return implementation === 'bitcoin-knots'
      ? fetchLatestKnotsVersion(this.options.fetch)
      : fetchLatestReleaseVersion(this.options.fetch);
  }

  async plan(
    network: BitcoinNetworkId,
    usage: NodeUsage,
    implementation: NodeImplementation = 'bitcoin-core',
  ): Promise<SetupPlan> {
    const dataDirectory = proposedDataDirectory(this.options.paths, network);
    const [hardware, existing, version] = await Promise.all([
      describeHardware(dataDirectory),
      detectExistingInstallations(),
      this.latestVersion(implementation).then(
        (value) => ({ value }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      ),
    ]);
    const recommendation = recommendConfiguration({ network: network, usage, hardware });
    const knotsWithElectrum = implementation === 'bitcoin-knots' && usage === 'electrum-backend';
    return {
      network,
      usage,
      implementation,
      differentChain:
        'value' in version ? followsOtherChain(implementation, version.value) : implementation === 'bitcoin-knots',
      ...('value' in version
        ? { version: version.value }
        : { versionError: `The latest version could not be checked: ${version.error}` }),
      approximateDownloadBytes: APPROXIMATE_DOWNLOAD_BYTES[implementation],
      dataDirectory,
      hardware,
      feasible: recommendation.feasible && 'value' in version && !knotsWithElectrum,
      blockers: [
        ...recommendation.blockers,
        ...('error' in version ? [versionBlocker(PRODUCTS[implementation], version.error)] : []),
        ...(knotsWithElectrum ? [KNOTS_WITHOUT_ELECTRUM] : []),
      ],
      settings: recommendation.settings,
      pruned: recommendation.pruned,
      ...(recommendation.pruneTargetMiB === undefined ? {} : { pruneTargetMiB: recommendation.pruneTargetMiB }),
      estimatedFootprintBytes: recommendation.estimatedFootprintBytes,
      consequences: recommendation.consequences,
      existing,
    };
  }

  /**
   * Starts the set-up job. A node set up as an Electrum back end gets its
   * Electrum server set up next, unless the caller does that itself.
   */
  start(
    name: string,
    network: BitcoinNetworkId,
    usage: NodeUsage,
    {
      electrumServerAfterwards = true,
      implementation = 'bitcoin-core',
      acceptDifferentChain = false,
    }: SetupStartOptions = {},
  ): string {
    const product = PRODUCTS[implementation];
    if (implementation === 'bitcoin-knots') {
      if (usage === 'electrum-backend') {
        throw setupFailure('setup.knots-without-electrum', KNOTS_WITHOUT_ELECTRUM, product);
      }
      if (!acceptDifferentChain) throw differentChainFailure(product);
    }
    const job = this.options.jobs.run(
      implementation === 'bitcoin-knots' ? 'bitcoin-knots.setup' : 'bitcoin-core.setup',
      `Set up ${product} (${NETWORK_PARAMETERS[network].label})`,
      async (report) => ({
        nodeId: await this.execute(name, network, usage, report, {
          electrumServerAfterwards: electrumServerAfterwards && implementation === 'bitcoin-core',
          implementation,
          acceptDifferentChain,
        }),
      }),
      (error) => describeSetupFailure(error, implementation),
    );
    return job.id;
  }

  private async execute(
    name: string,
    network: BitcoinNetwork,
    usage: NodeUsage,
    report: JobProgressReporter,
    options: Required<SetupStartOptions>,
  ): Promise<string> {
    const { paths } = this.options;
    const { implementation } = options;
    const product = PRODUCTS[implementation];
    report({ stage: 'resolving', message: `Checking the latest ${product} release.` });
    const version = await this.latestVersion(implementation);
    // The release found now is the one installed: agreement covers it only if it was asked for.
    if (followsOtherChain(implementation, version) && !options.acceptDifferentChain) {
      throw differentChainFailure(product);
    }

    const onProgress = (progress: InstallProgress) => {
      report({
        stage: progress.stage,
        message: progress.message,
        ...(progress.receivedBytes !== undefined && progress.totalBytes
          ? { fraction: Math.min(1, progress.receivedBytes / progress.totalBytes) }
          : {}),
      });
    };
    const common = {
      version,
      downloadsDirectory: paths.downloads,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      onProgress,
    };
    const runtime =
      implementation === 'bitcoin-knots'
        ? await installBitcoinKnots({
            ...common,
            runtimesDirectory: this.options.knotsRuntimesDirectory ?? bitcoinKnotsRuntimes(paths),
          })
        : await installBitcoinCore({
            ...common,
            runtimesDirectory: this.options.runtimesDirectory ?? bitcoinCoreRuntimes(paths),
          });

    report({ stage: 'configuring', message: 'Writing a configuration suited to this computer.' });
    const dataDirectory = proposedDataDirectory(paths, network);
    await mkdir(dataDirectory, { recursive: true });
    const hardware = await describeHardware(dataDirectory);
    const recommendation = recommendConfiguration({ network, usage, hardware });
    if (!recommendation.feasible) {
      throw new AppFailure({
        code: 'bitcoin-core.not-feasible',
        message: recommendation.blockers.join(' '),
        component: `${product} set-up`,
        dataRisk: 'none',
        recoveryActions: [{ id: 'free-space', label: 'Free disk space or choose another drive' }],
      });
    }

    const parameters = NETWORK_PARAMETERS[network];
    // Ports of the other nodes of this network count even while they are stopped.
    const taken = await this.portsOfOtherNodes(network);
    const rpcPort = await chooseLoopbackPort(
      parameters.rpcPort,
      [parameters.rpcPort + 100, parameters.rpcPort + 199],
      taken.rpc,
    );
    const p2pPort = await chooseLoopbackPort(
      parameters.p2pPort,
      [parameters.p2pPort + 100, parameters.p2pPort + 199],
      taken.p2p,
    );
    if (rpcPort === undefined || p2pPort === undefined) {
      throw new AppFailure({
        code: 'bitcoin-core.no-free-port',
        message: 'No free local port is available for the node’s RPC interface.',
        component: `${product} set-up`,
        dataRisk: 'none',
        recoveryActions: [{ id: 'close-programs', label: 'Close other Bitcoin software and try again' }],
      });
    }

    const config = BitcoinConfig.empty();
    if (implementation === 'bitcoin-knots') {
      config.prependComment(
        'Bitcoin Knots data: this node follows a chain Bitcoin Core rejects. Never start Bitcoin Core on this directory.',
      );
    }
    config.prependComment(
      `Managed by BTCortex for "${name}" (${parameters.label}), created ${this.now().toISOString().slice(0, 10)}. Comments and unknown options are preserved.`,
    );
    // Pinning the chain here means even a manual start of this directory can never reach mainnet by accident.
    config.set('chain', parameters.chainName, { scope: null });
    for (const setting of recommendation.settings) config.set(setting.key, setting.value, { scope: null });
    if (rpcPort !== parameters.rpcPort) config.set('rpcport', String(rpcPort), { scope: parameters.section });
    if (p2pPort !== parameters.p2pPort) config.set('port', String(p2pPort), { scope: parameters.section });
    const problems = validateConfig(config, {
      network,
      windows: process.platform === 'win32',
      totalMemoryBytes: hardware.totalMemoryBytes,
      managed: true,
    }).filter((diagnostic) => diagnostic.severity === 'error');
    if (problems.length > 0)
      throw new Error(
        `The generated configuration is invalid: ${problems.map((problem) => problem.message).join(' ')}`,
      );
    await writeFile(configFilePath(dataDirectory), config.toString(), { flag: 'wx' });

    report({ stage: 'registering', message: 'Registering the node.' });
    const timestamp = this.now().toISOString();
    const profile: NodeProfile = {
      id: randomUUID(),
      name,
      implementation,
      network,
      execution: 'managed',
      runtimeVersion: runtime.version,
      dataDirectory,
      rpcEndpoint: defaultRpcEndpoint(network, rpcPort),
      authentication: { kind: 'cookie', cookieFile: cookieFilePath(dataDirectory, network) },
      keepRunningOnExit: false,
      startWithBtcortex: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.options.repository.insert(profile);
    this.options.nodes.track(profile);

    report({ stage: 'starting', message: `Starting ${product} for the first time.` });
    await this.options.nodes.start(profile.id);
    await this.waitUntilAnswering(profile.id, product);
    this.options.logger.info('Node set up', {
      nodeId: profile.id,
      implementation,
      network,
      version: runtime.version,
      dataDirectory,
    });
    // The Electrum server's own set-up runs as a job of its own, so its progress shows on its page.
    if (usage === 'electrum-backend' && options.electrumServerAfterwards) {
      this.options.setUpElectrumServer?.(profile.id);
    }
    return profile.id;
  }

  private async waitUntilAnswering(nodeId: string, product: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // An answer — even "warming up" — means the node is up; it finishes loading on its own.
      if (this.options.nodes.isAnswering(nodeId)) return;
      const { status } = this.options.nodes.get(nodeId);
      if (status.state === 'failed' && status.error) throw new AppFailure(status.error);
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
    throw new Error(
      `${product} did not start answering within three minutes. It may still be starting; check the node page.`,
    );
  }
}

/** Why the latest release could not be looked up, in words a person can act on. */
function versionBlocker(product: string, error: string): string {
  if (/HTTP (403|429)\b/.test(error)) {
    return `GitHub, where BTCortex looks up the latest ${product} release, is turning requests away for now: it limits how often each internet address may ask. Try again within the hour.`;
  }
  return `BTCortex could not look up the latest ${product} release, so it cannot download it (${error}). Check the internet connection and try again.`;
}

function setupFailure(code: string, message: string, product: string): AppFailure {
  return new AppFailure({ code, message, component: `${product} set-up`, dataRisk: 'none', recoveryActions: [] });
}

function differentChainFailure(product: string): AppFailure {
  return new AppFailure({
    code: 'setup.different-chain-not-accepted',
    message: `${product} follows a chain Bitcoin Core rejects. It is set up only once you have agreed to that.`,
    component: `${product} set-up`,
    dataRisk: 'none',
    recoveryActions: [{ id: 'review-plan', label: 'Review the plan and agree, or choose Bitcoin Core' }],
  });
}
