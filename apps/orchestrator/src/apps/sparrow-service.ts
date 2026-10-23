import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';
import { AppFailure } from '@btcortex/contracts';
import type { BitcoinNetworkId, NodeProfile, SparrowConnectionVia, SparrowStatus } from '@btcortex/contracts';
import {
  activeNetworkMarkers,
  fetchLatestSparrowVersion,
  findInstalledSparrow,
  installSparrow,
  isSparrowRunning,
  launchSparrow,
  planSparrowConnection,
  readSparrowConfig,
  setAsideNetworkMarkers,
  sparrowConfigPath,
  sparrowHome,
  writeSparrowConfig,
} from '@btcortex/integration-sparrow';
import type { CoreConnectionTarget, SparrowConnectionTarget, SparrowRuntime } from '@btcortex/integration-sparrow';
import { describeInstallationFailure } from '../jobs/installation-errors';
import type { JobManager, JobProgressReporter } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import { localDataDirectory } from '../nodes/local-files';
import type { NodeManager } from '../nodes/node-manager';
import type { AppPaths } from '../platform/paths';

// Connects Sparrow to a BTCortex node with zero manual steps: verified
// installation, configuration written only while Sparrow is closed (the
// node's RPC interface with its cookie, or the node's Electrum server), and
// launch on the right network (docs/research/notes/wallets-hardware.md §6.2).
// BTCortex never reads or touches Sparrow's wallets.

const COMPONENT = 'Sparrow Wallet';

export interface SparrowServiceOptions {
  paths: AppPaths;
  nodes: Pick<NodeManager, 'get'>;
  jobs: JobManager;
  logger: Logger;
  fetch?: typeof fetch;
  env?: { APPDATA?: string | undefined };
  /** The URL of the node's Electrum server, once it has one. */
  electrumUrl?: (nodeId: string) => string | undefined;
  /** Injected in tests; default to the real process checks. */
  isRunning?: () => Promise<boolean>;
  launch?: (executable: string, network: NodeProfile['network']) => void;
}

/** Choices the user made in Sparrow that BTCortex changes only with explicit consent. */
export interface SparrowConsent {
  /** Replace a server the user configured. */
  replaceExistingServer: boolean;
  /** Set aside a "Restart in …" choice that would make Sparrow ignore the node. */
  resetStartupNetwork: boolean;
}

function fixedNetworkFailure(fixed: readonly BitcoinNetworkId[], network: BitcoinNetworkId): AppFailure {
  const label = NETWORK_PARAMETERS[network].label;
  return new AppFailure({
    code: 'sparrow.network-marker',
    message: `Sparrow is set to always start on ${fixed.map((other) => NETWORK_PARAMETERS[other].label).join(', ')}, so it would ignore this ${label} node.`,
    component: COMPONENT,
    dataRisk: 'none',
    likelyCause: 'Sparrow’s “Restart in …” option was used earlier.',
    recoveryActions: [{ id: 'reset-startup-network', label: `Let BTCortex start Sparrow on ${label}` }],
  });
}

/** Where Sparrow should find the node: its RPC address and root data directory. */
export function coreTargetFor(profile: NodeProfile): CoreConnectionTarget | { unsupported: string } {
  if (profile.implementation !== 'bitcoin-core') {
    return { unsupported: 'Sparrow is connected only to Bitcoin Core nodes.' };
  }
  if (profile.authentication.kind !== 'cookie') {
    return {
      unsupported:
        'This node uses a password. Sparrow would store it in plain text, so BTCortex connects Sparrow only to nodes that use cookie authentication on this computer.',
    };
  }
  // Sparrow wants the root data directory and appends the network folder for the cookie itself.
  const dataDirectory = localDataDirectory(profile);
  if (dataDirectory === undefined) return { unsupported: 'This node’s files are not on this computer.' };
  return { rpcEndpoint: profile.rpcEndpoint, dataDirectory };
}

export class SparrowService {
  private readonly isRunning: () => Promise<boolean>;
  private readonly launch: (executable: string, network: NodeProfile['network']) => void;

  constructor(private readonly options: SparrowServiceOptions) {
    this.isRunning = options.isRunning ?? isSparrowRunning;
    this.launch =
      options.launch ??
      ((executable, network) => {
        launchSparrow(executable, network);
      });
  }

  private get appsDirectory(): string {
    return join(this.options.paths.installations, 'sparrow');
  }

  private get home(): string {
    return sparrowHome(this.options.env ?? process.env);
  }

  /** Networks Sparrow is fixed to start on, other than the node's own. */
  private fixedStartupNetworks(network: BitcoinNetworkId): BitcoinNetworkId[] {
    return activeNetworkMarkers(this.home).filter((fixed) => fixed !== network);
  }

  /** The newest verified Sparrow BTCortex installed. */
  private async newestInstalled(): Promise<SparrowRuntime | undefined> {
    if (!existsSync(this.appsDirectory)) return undefined;
    const versions = readdirSync(this.appsDirectory)
      .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const version of versions) {
      const runtime = await findInstalledSparrow(this.appsDirectory, version);
      if (runtime) return runtime;
    }
    return undefined;
  }

  /** Whether Sparrow is installed and open, whichever node it is used with (for the catalogue). */
  async summary(): Promise<{ installed: string | null; running: boolean; settingsFound: boolean }> {
    const installed = await this.newestInstalled();
    return {
      installed: installed?.version ?? null,
      running: await this.isRunning(),
      settingsFound: existsSync(this.home),
    };
  }

  /** Where Sparrow should connect for this node, or why it cannot. */
  private targetFor(
    profile: NodeProfile,
    via: SparrowConnectionVia,
  ): SparrowConnectionTarget | { unsupported: string } {
    if (via === 'node') return coreTargetFor(profile);
    const electrumUrl = this.options.electrumUrl?.(profile.id);
    return electrumUrl === undefined
      ? { unsupported: 'This node has no Electrum server yet. Set one up on the Electrum servers page first.' }
      : { electrumUrl };
  }

  async status(nodeId: string, via: SparrowConnectionVia = 'node'): Promise<SparrowStatus> {
    const { profile } = this.options.nodes.get(nodeId);
    const target = this.targetFor(profile, via);
    const installed = await this.newestInstalled();
    const status: SparrowStatus = {
      installed: installed ? { version: installed.version, verifiedAt: installed.verification.verifiedAt } : null,
      running: await this.isRunning(),
      settingsFound: existsSync(this.home),
      connection: { usesThisNode: false },
    };
    if ('unsupported' in target) return { ...status, unsupportedReason: target.unsupported };
    const existing = await readSparrowConfig(sparrowConfigPath(this.home, profile.network));
    const plan = planSparrowConnection(existing, target);
    const fixedStartupNetworks = this.fixedStartupNetworks(profile.network);
    return {
      ...status,
      connection: {
        usesThisNode: plan.alreadyConfigured && fixedStartupNetworks.length === 0,
        ...(plan.conflict
          ? {
              otherServer: {
                serverType: plan.conflict.serverType,
                ...(plan.conflict.server === undefined ? {} : { server: plan.conflict.server }),
              },
            }
          : {}),
        ...(fixedStartupNetworks.length > 0 ? { fixedStartupNetworks } : {}),
      },
    };
  }

  connect(nodeId: string, consent: SparrowConsent, via: SparrowConnectionVia = 'node'): string {
    const { profile } = this.options.nodes.get(nodeId);
    const job = this.options.jobs.run(
      'sparrow.connect',
      via === 'electrum'
        ? `Connect Sparrow to the Electrum server of ${profile.name}`
        : `Connect Sparrow to ${profile.name}`,
      async (report) => {
        await this.execute(profile, consent, report, via);
        return { nodeId };
      },
      (error) => describeInstallationFailure(error, COMPONENT),
    );
    return job.id;
  }

  async open(nodeId: string): Promise<void> {
    const { profile } = this.options.nodes.get(nodeId);
    const installed = await this.newestInstalled();
    if (!installed) {
      throw new AppFailure({
        code: 'sparrow.not-installed',
        message: 'Sparrow is not installed by BTCortex yet.',
        component: COMPONENT,
        dataRisk: 'none',
        recoveryActions: [{ id: 'connect-sparrow', label: 'Use Sparrow with this node' }],
      });
    }
    const fixed = this.fixedStartupNetworks(profile.network);
    if (fixed.length > 0) throw fixedNetworkFailure(fixed, profile.network);
    this.launch(installed.executable, profile.network);
  }

  private async execute(
    profile: NodeProfile,
    consent: SparrowConsent,
    report: JobProgressReporter,
    via: SparrowConnectionVia,
  ): Promise<void> {
    const target = this.targetFor(profile, via);
    if ('unsupported' in target) {
      throw new AppFailure({
        code: 'sparrow.unsupported-node',
        message: target.unsupported,
        component: COMPONENT,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }

    report({ stage: 'resolving', message: 'Checking the latest Sparrow release.' });
    const version = await fetchLatestSparrowVersion(this.options.fetch);
    const runtime = await installSparrow({
      version,
      appsDirectory: this.appsDirectory,
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

    report({ stage: 'checking', message: 'Making sure Sparrow is closed and set to the right network.' });
    if (await this.isRunning()) {
      throw new AppFailure({
        code: 'sparrow.running',
        message:
          'Sparrow is open. Close it first: Sparrow rewrites its settings when it closes and would undo the change.',
        component: COMPONENT,
        dataRisk: 'none',
        recoveryActions: [{ id: 'close-sparrow', label: 'Close Sparrow, then try again' }],
      });
    }
    const fixed = this.fixedStartupNetworks(profile.network);
    if (fixed.length > 0 && !consent.resetStartupNetwork) throw fixedNetworkFailure(fixed, profile.network);

    const configPath = sparrowConfigPath(this.home, profile.network);
    const existing = await readSparrowConfig(configPath);
    const plan = planSparrowConnection(existing, target);
    if (plan.conflict && !consent.replaceExistingServer) {
      throw new AppFailure({
        code: 'sparrow.other-server',
        message: `Sparrow is set up to use another server${plan.conflict.server ? ` (${plan.conflict.server})` : ''}. BTCortex will not replace it without your permission.`,
        component: COMPONENT,
        dataRisk: 'none',
        details: { serverType: plan.conflict.serverType },
        recoveryActions: [
          {
            id: 'replace-server',
            label: via === 'electrum' ? 'Replace it with this Electrum server' : 'Replace it with this node',
          },
        ],
      });
    }

    // Every check has passed; only now does anything change.
    if (fixed.length > 0 || !plan.alreadyConfigured) {
      report({
        stage: 'configuring',
        message: via === 'electrum' ? 'Pointing Sparrow at the Electrum server.' : 'Pointing Sparrow at the node.',
      });
    }
    if (fixed.length > 0) {
      const backups = await setAsideNetworkMarkers(this.home, fixed);
      this.options.logger.info('Set aside Sparrow’s fixed start-up network', { nodeId: profile.id, backups });
    }
    if (!plan.alreadyConfigured) {
      const { backup } = await writeSparrowConfig(configPath, existing, plan.changes, undefined, plan.removals);
      this.options.logger.info('Configured Sparrow for a node', { nodeId: profile.id, via, configPath, backup });
    }

    report({ stage: 'launching', message: 'Opening Sparrow.' });
    this.launch(runtime.executable, profile.network);
  }
}
