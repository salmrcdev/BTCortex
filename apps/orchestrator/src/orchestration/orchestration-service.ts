import { AppFailure } from '@btcortex/contracts';
import type {
  Orchestration,
  OrchestrationPlan,
  OrchestrationRun,
  ServiceAction,
  ServiceModuleSummary,
} from '@btcortex/contracts';
import type { Logger } from '../logging/logger';
import type { ModuleInstance, ServiceModule } from '../services/service-module';

// Service orchestration (specification sections 24.1 and 29): the instances
// of every integration module, in the order they start — what is needed
// before what needs it — and plans that start what something needs first,
// stop what needs something first, and say what else is affected. A plan runs
// only after the user confirmed it, one step at a time, one plan at a time.

export const EVERYTHING = 'all';
const COMPONENT = 'Service orchestration';

interface Located {
  module: ServiceModule;
  instance: ModuleInstance;
}

type Step = OrchestrationPlan['steps'][number];

const active = (instance: ModuleInstance) =>
  instance.state === 'running' || instance.state === 'starting' || instance.state === 'waiting';

const VERBS: Record<ServiceAction, string> = { start: 'start', stop: 'stop', restart: 'restart' };

export interface OrchestrationOptions {
  modules: readonly ServiceModule[];
  logger: Logger;
}

export class OrchestrationService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: OrchestrationOptions) {}

  private async collect(): Promise<Located[]> {
    const lists = await Promise.all(
      this.options.modules.map(async (module) => {
        try {
          return (await module.instances()).map((instance) => ({ module, instance }));
        } catch (error) {
          this.options.logger.warn('A module could not list its services', { module: module.id, error });
          return [];
        }
      }),
    );
    return lists.flat();
  }

  /** Requirements before what requires them; otherwise in the modules' order. */
  private ordered(located: Located[]): Located[] {
    const byId = new Map(located.map((entry) => [entry.instance.id, entry]));
    const placed = new Set<string>();
    const result: Located[] = [];
    const place = (entry: Located, path: Set<string>) => {
      if (placed.has(entry.instance.id) || path.has(entry.instance.id)) return;
      path.add(entry.instance.id);
      for (const requirement of entry.instance.requires) {
        const needed = byId.get(requirement.id);
        if (needed) place(needed, path);
      }
      placed.add(entry.instance.id);
      result.push(entry);
    };
    for (const entry of located) place(entry, new Set());
    return result;
  }

  private summary(module: ServiceModule): ServiceModuleSummary {
    return {
      id: module.id,
      name: module.name,
      status: module.status,
      level: module.level,
      capabilities: [...module.capabilities],
      permissions: [...module.permissions],
      dependencies: module.dependencies.map((dependency) => ({ ...dependency })),
      documentation: module.documentation,
      updates: module.updates,
      route: module.route,
    };
  }

  private shape(located: Located[]): Orchestration {
    const requiredBy = new Map<string, string[]>();
    for (const { instance } of located) {
      for (const requirement of instance.requires) {
        requiredBy.set(requirement.id, [...(requiredBy.get(requirement.id) ?? []), instance.id]);
      }
    }
    return {
      modules: this.options.modules.map((module) => this.summary(module)),
      instances: this.ordered(located).map(({ module, instance }) => ({
        id: instance.id,
        moduleId: module.id,
        name: instance.name,
        route: instance.route,
        state: instance.state,
        health: instance.health,
        summary: instance.summary,
        actions: [...instance.actions],
        requires: instance.requires.map((requirement) => ({ ...requirement })),
        requiredBy: requiredBy.get(instance.id) ?? [],
        logSources: [...instance.logSources],
      })),
    };
  }

  async overview(): Promise<Orchestration> {
    return this.shape(await this.collect());
  }

  private planFor(located: Located[], target: string, action: ServiceAction): OrchestrationPlan {
    const byId = new Map(located.map((entry) => [entry.instance.id, entry.instance]));
    const steps: Step[] = [];
    const consequences: string[] = [];
    let blocked: string | null = null;
    const block = (reason: string) => {
      blocked ??= reason;
    };
    const add = (instance: ModuleInstance, step: ServiceAction) => {
      if (!steps.some((existing) => existing.instanceId === instance.id && existing.action === step)) {
        steps.push({ instanceId: instance.id, name: instance.name, action: step });
      }
    };

    const startWithRequirements = (instance: ModuleInstance, seen: Set<string>) => {
      if (seen.has(instance.id)) return;
      seen.add(instance.id);
      for (const requirement of instance.requires) {
        const needed = byId.get(requirement.id);
        if (!needed) {
          if (requirement.hard) block(`${instance.name} ${requirement.reason}, which is not available.`);
          continue;
        }
        if (active(needed)) continue;
        if (needed.actions.includes('start')) startWithRequirements(needed, seen);
        else if (requirement.hard)
          block(`${instance.name} ${requirement.reason}, but ${needed.name} cannot be started: ${needed.summary}`);
        else consequences.push(`${instance.name} ${requirement.reason}, and ${needed.name} is not running.`);
      }
      if (!active(instance)) add(instance, 'start');
    };

    const stopWithDependants = (instance: ModuleInstance, seen: Set<string>) => {
      if (seen.has(instance.id)) return;
      seen.add(instance.id);
      for (const { instance: other } of located) {
        const requirement = other.requires.find((candidate) => candidate.id === instance.id);
        if (!requirement || !active(other)) continue;
        // Already being stopped by this plan: nothing to say about it.
        if (steps.some((step) => step.instanceId === other.id && step.action === 'stop')) continue;
        if (requirement.hard && other.actions.includes('stop')) stopWithDependants(other, seen);
        else consequences.push(`${other.name} ${requirement.reason}: that stops until ${instance.name} runs again.`);
      }
      add(instance, 'stop');
    };

    if (target === EVERYTHING) {
      const ordered = this.ordered(located).map((entry) => entry.instance);
      if (action === 'start') {
        for (const instance of ordered)
          if (instance.actions.includes('start')) startWithRequirements(instance, new Set());
      } else if (action === 'stop') {
        const seen = new Set<string>();
        for (const instance of [...ordered].reverse())
          if (instance.actions.includes('stop')) stopWithDependants(instance, seen);
      } else {
        block('Services are restarted one at a time.');
      }
    } else {
      const instance = byId.get(target);
      if (!instance) block('This service is not known, or no longer exists.');
      else if (!instance.actions.includes(action))
        block(`${instance.name} cannot ${VERBS[action]} now. ${instance.summary}`);
      else if (action === 'start') startWithRequirements(instance, new Set());
      else if (action === 'stop') stopWithDependants(instance, new Set());
      else {
        add(instance, 'restart');
        for (const { instance: other } of located) {
          const requirement = other.requires.find((candidate) => candidate.id === instance.id);
          if (requirement && active(other)) {
            consequences.push(`${other.name} ${requirement.reason}: that pauses while ${instance.name} restarts.`);
          }
        }
      }
    }
    return { target, action, steps, consequences: [...new Set(consequences)], blocked };
  }

  async plan(target: string, action: ServiceAction): Promise<OrchestrationPlan> {
    return this.planFor(await this.collect(), target, action);
  }

  /** Carries out a confirmed plan; one plan runs at a time. */
  run(target: string, action: ServiceAction): Promise<OrchestrationRun> {
    const work = this.queue.then(async () => {
      const located = await this.collect();
      const plan = this.planFor(located, target, action);
      if (plan.blocked !== null) {
        throw new AppFailure({
          code: 'services.blocked',
          message: plan.blocked,
          component: COMPONENT,
          dataRisk: 'none',
          recoveryActions: [],
        });
      }
      const modules = new Map(located.map((entry) => [entry.instance.id, entry.module]));
      const done: string[] = [];
      for (const step of plan.steps) {
        const module = modules.get(step.instanceId);
        try {
          if (!module?.run) throw new Error('Its module has no lifecycle operations.');
          await module.run(step.instanceId, step.action);
        } catch (error) {
          this.options.logger.warn('A service orchestration step failed', { step, error });
          throw new AppFailure({
            code: 'services.step-failed',
            message: `${step.name} could not ${VERBS[step.action]}${done.length > 0 ? `, after ${String(done.length)} earlier step(s) were done` : ''}.`,
            component: COMPONENT,
            dataRisk: 'none',
            ...(error instanceof AppFailure
              ? { likelyCause: error.error.message }
              : error instanceof Error
                ? { likelyCause: error.message }
                : {}),
            details: { done },
            recoveryActions: [{ id: 'retry', label: 'Look at the service and try again' }],
          });
        }
        done.push(step.instanceId);
        this.options.logger.info('Service orchestration step done', { instance: step.instanceId, action: step.action });
      }
      return { plan, done, overview: await this.overview() };
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}
