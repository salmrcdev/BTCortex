import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recommendConfiguration } from '@btcortex/bitcoin-config';
import { AppFailure, DeploymentRecordSchema } from '@btcortex/contracts';
import type {
  AppError,
  DeploymentChoices,
  DeploymentComponent,
  DeploymentPlan,
  DeploymentRecord,
  DeploymentStepOutcome,
  DeploymentStepState,
  DiskKind,
  HardwareSummary,
  InstalledSoftware,
  Job,
  NodeUsage,
  NodeWithStatus,
  ProfilesOverview,
} from '@btcortex/contracts';
import type { ElectrumService } from '../electrum/electrum-service';
import type { HardwareService } from '../hardware/hardware-service';
import type { JobManager, JobProgressReporter } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import { privateBroadcastSupported } from '../nodes/privacy-service';
import type { PrivacyService } from '../nodes/privacy-service';
import type { SettingsStore } from '../persistence/settings';
import { describeDisk } from '../platform/disks';
import { describeHardware } from '../platform/hardware';
import type { AppPaths } from '../platform/paths';
import type { SparrowService } from '../apps/sparrow-service';
import { proposedDataDirectory } from '../setup/setup-service';
import type { SetupService } from '../setup/setup-service';
import type { TorService } from '../tor/tor-service';
import { findProfile, includedComponents, PROFILES } from './catalogue';
import { buildPlan } from './plan';
import type { NodeTarget } from './plan';
import { ReleaseSizes } from './releases';
import type { InstallableComponent, ReleaseSize } from './releases';

// Deployment profiles (specification section 18): the plan for a profile as
// the user customised it, and its deployment as one background job that runs
// the same set-ups the individual pages use, one after the other, waiting for
// each. A step that fails does not undo the others: everything done stays
// done, and the deployment's record says what is left and where to finish it.

const COMPONENT = 'Deployment profiles';
const SETTINGS_KEY = 'profiles';
const KEPT_DEPLOYMENTS = 10;
const StoredSchema = z.object({ deployments: z.array(DeploymentRecordSchema) });
/** Sparrow failures that need the user's own decision rather than a fix. */
const SPARROW_DECISIONS = new Set(['sparrow.other-server', 'sparrow.running', 'sparrow.network-marker']);

export interface ProfileServiceOptions {
  settings: SettingsStore;
  jobs: Pick<JobManager, 'run' | 'waitFor' | 'get'>;
  logger: Logger;
  paths: Pick<AppPaths, 'nodes'>;
  nodes: { list(): NodeWithStatus[] };
  setup: Pick<SetupService, 'start'>;
  tor: Pick<TorService, 'install' | 'ensureRunning'>;
  privacy: Pick<PrivacyService, 'configure'>;
  electrum: Pick<ElectrumService, 'status' | 'plan' | 'setUpForNewNode'>;
  sparrow: Pick<SparrowService, 'connect'>;
  hardware: Pick<HardwareService, 'overview' | 'installHwi' | 'installTrezorSuite'>;
  installedSoftware: () => Promise<InstalledSoftware[]>;
  releases?: Pick<ReleaseSizes, 'lookup'>;
  /** For tests. */
  describeHardware?: (path: string) => Promise<HardwareSummary>;
  diskKind?: (root: string) => Promise<DiskKind>;
  now?: () => Date;
}

/** How a new node is configured: as an Electrum back end, a wallet back end or a plain node. */
export function usageFor(included: ReadonlySet<DeploymentComponent>): NodeUsage {
  if (included.has('electrum-server')) return 'electrum-backend';
  if (included.has('sparrow')) return 'wallet-backend';
  return 'general';
}

function messageOf(error: unknown): string {
  if (error instanceof AppFailure) return error.error.message;
  return error instanceof Error ? error.message : String(error);
}

export class ProfileService {
  private readonly releases: Pick<ReleaseSizes, 'lookup'>;
  private deploying = false;

  constructor(private readonly options: ProfileServiceOptions) {
    this.releases = options.releases ?? new ReleaseSizes();
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private failure(code: string, message: string, extra: Partial<AppError> = {}): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [], ...extra });
  }

  // Records

  private records(): DeploymentRecord[] {
    return this.options.settings.get(SETTINGS_KEY, StoredSchema)?.deployments ?? [];
  }

  private store(record: DeploymentRecord): void {
    const others = this.records().filter((candidate) => candidate.id !== record.id);
    this.options.settings.set(SETTINGS_KEY, {
      deployments: [record, ...others]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, KEPT_DEPLOYMENTS),
    });
  }

  /** Deployments a previous session left unfinished are marked as interrupted. */
  initialise(): void {
    for (const record of this.records()) {
      if (record.finishedAt !== null) continue;
      let state: Job['state'] | undefined;
      try {
        state = this.options.jobs.get(record.jobId).state;
      } catch {
        state = undefined;
      }
      if (state === 'running' || state === 'queued') continue;
      this.store({
        ...record,
        finishedAt: this.now().toISOString(),
        steps: record.steps.map((step) =>
          step.state === 'pending' || step.state === 'running'
            ? {
                ...step,
                state: 'failed',
                message: 'Interrupted when BTCortex closed. Deploy the profile again to finish.',
              }
            : step,
        ),
      });
    }
  }

  overview(): ProfilesOverview {
    return { profiles: [...PROFILES], deployments: this.records() };
  }

  // Planning

  async plan(choices: DeploymentChoices): Promise<DeploymentPlan> {
    const profile = findProfile(choices.profileId);
    const included = includedComponents(profile, choices.components);
    const software = await this.options.installedSoftware().catch(() => []);
    const installedProduct = (product: InstalledSoftware['product']) =>
      software.some((entry) => entry.product === product);
    const suite = included.has('trezor-suite')
      ? await this.options.hardware.overview().then(
          (overview) => overview.trezorSuite.installed !== null,
          () => false,
        )
      : false;

    const existingId = choices.target.kind === 'existing' ? choices.target.nodeId : undefined;
    const node = this.options.nodes.list().find((candidate) => candidate.profile.id === existingId);
    const dataDirectory = proposedDataDirectory(this.options.paths, choices.network);
    // The disk that holds, or would hold, the node's data.
    const hardware = await (this.options.describeHardware ?? describeHardware)(
      choices.target.kind === 'new' ? dataDirectory : (node?.profile.dataDirectory ?? this.options.paths.nodes),
    );
    let target: NodeTarget;
    if (choices.target.kind === 'new') {
      target = {
        kind: 'new',
        name: choices.target.name,
        dataDirectory,
        recommendation: recommendConfiguration({ network: choices.network, usage: usageFor(included), hardware }),
      };
    } else {
      const nodeId = choices.target.nodeId;
      if (!node) {
        target = { kind: 'missing' };
      } else {
        const electrumSetUp = this.options.electrum.status(nodeId).state !== 'not-set-up';
        target = {
          kind: 'existing',
          node,
          electrumSetUp,
          electrumPlan:
            included.has('electrum-server') && !electrumSetUp
              ? await this.options.electrum.plan(nodeId).catch(() => undefined)
              : undefined,
          privateBroadcastSupported: privateBroadcastSupported(node.profile, node.status.snapshot?.network.version),
        };
      }
    }
    const diskKind = await (this.options.diskKind ?? ((root: string) => describeDisk(root).then((disk) => disk.kind)))(
      hardware.volumePath,
    ).catch((): DiskKind => 'unknown');

    const installed: Record<InstallableComponent, boolean> = {
      'bitcoin-core': false,
      tor: installedProduct('tor'),
      'electrum-server': installedProduct('fulcrum'),
      sparrow: installedProduct('sparrow'),
      hwi: installedProduct('hwi'),
      'trezor-suite': suite,
    };
    const wanted: InstallableComponent[] = [
      ...(target.kind === 'new' ? (['bitcoin-core'] as const) : []),
      ...(['tor', 'electrum-server', 'sparrow', 'hwi', 'trezor-suite'] as const).filter(
        (component) => included.has(component) && !installed[component],
      ),
    ];
    const releases: Partial<Record<InstallableComponent, ReleaseSize>> = Object.fromEntries(
      await Promise.all(wanted.map(async (component) => [component, await this.releases.lookup(component)] as const)),
    );
    const latestCore = releases['bitcoin-core']?.version;
    installed['bitcoin-core'] = software.some(
      (entry) => entry.product === 'bitcoin-core' && entry.version === latestCore,
    );
    return buildPlan({ profile, choices, included, hardware, diskKind, target, installed, releases });
  }

  // Deploying

  async deploy(choices: DeploymentChoices): Promise<{ jobId: string; deploymentId: string }> {
    if (this.deploying) {
      throw this.failure('profiles.busy', 'A deployment is already running. Wait for it to finish first.');
    }
    const plan = await this.plan(choices);
    if (!plan.feasible) {
      throw this.failure('profiles.not-feasible', plan.blockers.join(' '), {
        recoveryActions: [{ id: 'review-plan', label: 'Review the choices' }],
      });
    }
    const profile = findProfile(choices.profileId);
    const record: DeploymentRecord = {
      id: randomUUID(),
      jobId: '',
      profileId: profile.id,
      network: choices.network,
      nodeId: choices.target.kind === 'existing' ? choices.target.nodeId : null,
      nodeName: plan.node.name,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      steps: plan.steps.map((step): DeploymentStepOutcome => ({
        component: step.component,
        title: step.title,
        state: step.state === 'already-done' ? 'skipped' : 'pending',
        message: step.state === 'already-done' ? step.detail : null,
        route: null,
      })),
    };
    this.deploying = true;
    const job = this.options.jobs.run(
      'profile.deploy',
      `Deploy profile ${profile.letter}: ${profile.title}`,
      async (report) => {
        try {
          return await this.execute(record, plan, report);
        } finally {
          this.deploying = false;
        }
      },
      (error) =>
        error instanceof AppFailure
          ? error.error
          : {
              code: 'profiles.failed',
              message: messageOf(error),
              component: COMPONENT,
              dataRisk: 'none',
              recoveryActions: [],
            },
    );
    record.jobId = job.id;
    this.store(record);
    this.options.logger.info('Deploying a profile', {
      profileId: profile.id,
      network: choices.network,
      components: plan.steps.map((step) => step.component),
    });
    return { jobId: job.id, deploymentId: record.id };
  }

  private async execute(
    record: DeploymentRecord,
    plan: DeploymentPlan,
    report: JobProgressReporter,
  ): Promise<{ nodeId: string }> {
    const { choices } = plan;
    const planned = new Map(plan.steps.map((step) => [step.component, step]));
    const toDo = (component: DeploymentComponent) => planned.get(component)?.state === 'to-do';
    const set = (
      component: DeploymentComponent,
      state: DeploymentStepState,
      message: string | null = null,
      route: string | null = null,
    ) => {
      record.steps = record.steps.map((step) =>
        step.component === component ? { ...step, state, message, route: route ?? step.route } : step,
      );
      this.store(record);
    };
    /** Runs another job, passing its progress on, and resolves with it once it has finished. */
    const follow = async (component: DeploymentComponent, jobId: string): Promise<Job> => {
      const title = planned.get(component)?.title ?? component;
      set(component, 'running');
      return this.options.jobs.waitFor(jobId, (job) => {
        report({
          stage: component,
          message: `${title}: ${job.progress.message}`,
          ...(job.progress.fraction === undefined ? {} : { fraction: job.progress.fraction }),
        });
      });
    };
    const failed = (job: Job) => job.error?.message ?? 'It did not finish.';

    // The node, without which nothing else can follow.
    let nodeId: string;
    if (choices.target.kind === 'existing') {
      nodeId = choices.target.nodeId;
    } else {
      const usage = usageFor(new Set(plan.steps.map((step) => step.component)));
      const job = await follow(
        'bitcoin-core',
        this.options.setup.start(choices.target.name, choices.network, usage, { electrumServerAfterwards: false }),
      );
      if (job.state !== 'succeeded' || !job.result) {
        set('bitcoin-core', 'failed', failed(job));
        record.steps = record.steps.map((step) =>
          step.state === 'pending'
            ? { ...step, state: 'skipped', message: 'Not done, because the node could not be set up.' }
            : step,
        );
        this.finish(record);
        throw new AppFailure(
          job.error ?? {
            code: 'profiles.node-failed',
            message: 'The node could not be set up, so nothing else was deployed.',
            component: COMPONENT,
            dataRisk: 'none',
            recoveryActions: [],
          },
        );
      }
      nodeId = job.result.nodeId;
      record.nodeId = nodeId;
      set(
        'bitcoin-core',
        'done',
        choices.network === 'regtest'
          ? 'Set up and started.'
          : 'Set up and started; it is catching up with the network.',
        `/nodes/${nodeId}`,
      );
    }

    // The Electrum server, before Tor: its set-up needs the node answering, and Tor restarts it.
    let electrumReady = !toDo('electrum-server') && planned.has('electrum-server');
    if (toDo('electrum-server')) {
      const job = await follow('electrum-server', this.options.electrum.setUpForNewNode(nodeId));
      electrumReady = job.state === 'succeeded';
      if (electrumReady) {
        set('electrum-server', 'done', 'Set up; it starts indexing once the node has caught up.', '/electrum');
      } else {
        set('electrum-server', 'failed', failed(job), '/electrum');
      }
    }

    if (toDo('tor') && choices.tor) {
      try {
        const installed = (await this.options.installedSoftware().catch(() => [])).some(
          (entry) => entry.product === 'tor',
        );
        if (!installed) {
          const job = await follow('tor', this.options.tor.install());
          if (job.state !== 'succeeded') throw new Error(failed(job));
        }
        set('tor', 'running');
        report({ stage: 'tor', message: 'Starting tor and changing how the node connects.' });
        await this.options.tor.ensureRunning();
        await this.options.privacy.configure(nodeId, choices.tor);
        set('tor', 'done', 'The node now connects through Tor; it restarted once.', `/nodes/${nodeId}/privacy`);
      } catch (error) {
        set('tor', 'failed', messageOf(error), `/nodes/${nodeId}/privacy`);
      }
    }

    if (toDo('sparrow')) {
      const via = planned.has('electrum-server') ? 'electrum' : 'node';
      const route = via === 'electrum' ? '/electrum' : `/nodes/${nodeId}`;
      if (via === 'electrum' && !electrumReady) {
        set('sparrow', 'skipped', 'Not connected, because the Electrum server was not set up.', route);
      } else {
        const job = await follow(
          'sparrow',
          this.options.sparrow.connect(nodeId, { replaceExistingServer: false, resetStartupNetwork: false }, via),
        );
        if (job.state === 'succeeded') {
          set('sparrow', 'done', 'Connected and opened.', route);
        } else if (job.error && SPARROW_DECISIONS.has(job.error.code)) {
          set('sparrow', 'needs-attention', job.error.message, route);
        } else {
          set('sparrow', 'failed', failed(job), route);
        }
      }
    }

    for (const [component, install] of [
      ['hwi', () => this.options.hardware.installHwi()],
      ['trezor-suite', () => this.options.hardware.installTrezorSuite()],
    ] as const) {
      if (!toDo(component)) continue;
      const job = await follow(component, install());
      if (job.state === 'succeeded') set(component, 'done', 'Installed.', '/hardware');
      else set(component, 'failed', failed(job), '/hardware');
    }

    const builtIn: Partial<Record<DeploymentComponent, string>> = {
      explorer: `/explorer?node=${nodeId}`,
      'rpc-console': `/nodes/${nodeId}/console`,
      monitoring: '/monitoring',
    };
    for (const [component, route] of Object.entries(builtIn) as [DeploymentComponent, string][]) {
      if (planned.get(component)?.state === 'built-in') set(component, 'done', 'Ready in BTCortex.', route);
    }
    if (planned.get('backups')?.state === 'later') {
      set('backups', 'needs-attention', 'Choose a backup folder, ideally on another disk.', '/backups');
    }
    this.finish(record);

    const problems = record.steps.filter((step) => step.state === 'failed');
    if (problems.length > 0) {
      throw this.failure(
        'profiles.partly-deployed',
        `Deployed except: ${problems.map((step) => step.title).join(', ')}. Everything else is in place; finish these from their pages.`,
        { recoveryActions: [{ id: 'open-profiles', label: 'See what is left' }] },
      );
    }
    report({ stage: 'finished', message: 'The profile is deployed.' });
    this.options.logger.info('Deployed a profile', { profileId: record.profileId, nodeId });
    return { nodeId };
  }

  private finish(record: DeploymentRecord): void {
    record.finishedAt = this.now().toISOString();
    this.store(record);
  }
}
