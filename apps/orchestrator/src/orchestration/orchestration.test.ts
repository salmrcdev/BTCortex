import { describe, expect, it } from 'vitest';
import type { ServiceAction, ServiceInstanceState } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import type { ModuleInstance, ServiceModule } from '../services/service-module';
import { EXAMPLE_INSTANCE, exampleModule } from '../services/sample/example-module';
import type { ExampleProgram } from '../services/sample/example-module';
import { EVERYTHING, OrchestrationService } from './orchestration-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');

/** A module whose instances are kept in a table, and whose operations are recorded. */
function fakeModule(id: string, instances: ModuleInstance[], calls: string[], fail?: string): ServiceModule {
  return {
    id,
    name: id,
    status: 'unit-tested',
    level: 'fully-managed',
    capabilities: ['start', 'stop'],
    route: null,
    permissions: [],
    dependencies: [],
    documentation: null,
    updates: null,
    state: () => Promise.resolve({ installed: true, versions: [], running: 0, health: 'unknown', summary: '' }),
    instances: () => Promise.resolve(instances),
    run(instanceId: string, action: ServiceAction) {
      calls.push(`${action} ${instanceId}`);
      if (instanceId === fail) return Promise.reject(new Error('It refused.'));
      const instance = instances.find((candidate) => candidate.id === instanceId);
      if (instance) {
        const state: ServiceInstanceState = action === 'stop' ? 'stopped' : 'running';
        Object.assign(instance, { state, actions: state === 'running' ? ['stop', 'restart'] : ['start'] });
      }
      return Promise.resolve();
    },
  };
}

const instance = (
  id: string,
  state: ServiceInstanceState,
  requires: ModuleInstance['requires'] = [],
  actions?: ServiceAction[],
): ModuleInstance => ({
  id,
  name: id === 'tor' ? 'Tor' : id,
  route: null,
  state,
  health: 'unknown',
  summary: `${id} is ${state}.`,
  actions: actions ?? (state === 'running' ? ['stop', 'restart'] : ['start']),
  requires,
  logSources: [],
  metrics: [],
});

function world(
  states: { tor?: ServiceInstanceState; node?: ServiceInstanceState; electrum?: ServiceInstanceState } = {},
) {
  const calls: string[] = [];
  const tor = instance('tor', states.tor ?? 'running');
  const node = instance('node:a', states.node ?? 'running', [
    { id: 'tor', hard: true, reason: 'routes its connections through Tor' },
  ]);
  const external = instance(
    'node:b',
    'running',
    [{ id: 'tor', hard: false, reason: 'reaches onion peers through Tor' }],
    [],
  );
  const electrum = instance('electrum:a', states.electrum ?? 'running', [
    { id: 'node:a', hard: true, reason: 'reads the blockchain from its node' },
  ]);
  const service = new OrchestrationService({
    // Listed out of order on purpose: the overview sorts by dependencies.
    modules: [
      fakeModule('fulcrum', [electrum], calls),
      fakeModule('bitcoin-core', [node, external], calls),
      fakeModule('tor', [tor], calls),
    ],
    logger,
  });
  return { service, calls };
}

describe('service orchestration', () => {
  it('lists services in the order they start, with what needs each', async () => {
    const { service } = world();
    const overview = await service.overview();
    expect(overview.instances.map((entry) => entry.id)).toEqual(['tor', 'node:a', 'electrum:a', 'node:b']);
    expect(overview.instances.find((entry) => entry.id === 'tor')?.requiredBy).toEqual(['node:a', 'node:b']);
    expect(overview.instances.find((entry) => entry.id === 'electrum:a')?.moduleId).toBe('fulcrum');
    expect(overview.modules.map((module) => module.id)).toEqual(['fulcrum', 'bitcoin-core', 'tor']);
  });

  it('starts what a service needs first', async () => {
    const { service } = world({ tor: 'stopped', node: 'stopped', electrum: 'stopped' });
    expect(await service.plan('electrum:a', 'start')).toMatchObject({
      steps: [
        { instanceId: 'tor', action: 'start' },
        { instanceId: 'node:a', action: 'start' },
        { instanceId: 'electrum:a', action: 'start' },
      ],
      blocked: null,
    });
  });

  it('stops what needs a service first, and says what else loses it', async () => {
    const { service } = world();
    const plan = await service.plan('tor', 'stop');
    expect(plan.steps.map((step) => `${step.action} ${step.instanceId}`)).toEqual([
      'stop electrum:a',
      'stop node:a',
      'stop tor',
    ]);
    expect(plan.consequences).toEqual(['node:b reaches onion peers through Tor: that stops until Tor runs again.']);
  });

  it('plans everything at once in dependency order, saying nothing of what it stops itself', async () => {
    const { service } = world({ tor: 'stopped', node: 'stopped', electrum: 'stopped' });
    expect((await service.plan(EVERYTHING, 'start')).steps.map((step) => step.instanceId)).toEqual([
      'tor',
      'node:a',
      'electrum:a',
    ]);
    const running = world();
    const stop = await running.service.plan(EVERYTHING, 'stop');
    expect(stop.steps.map((step) => step.instanceId)).toEqual(['electrum:a', 'node:a', 'tor']);
    expect(stop.consequences).toEqual(['node:b reaches onion peers through Tor: that stops until Tor runs again.']);
    expect((await running.service.plan(EVERYTHING, 'restart')).blocked).toMatch(/one at a time/);
  });

  it('refuses what cannot be done, and says why', async () => {
    const { service } = world();
    expect((await service.plan('node:b', 'stop')).blocked).toBe('node:b cannot stop now. node:b is running.');
    expect((await service.plan('nothing', 'start')).blocked).toMatch(/not known/);
    const restart = await service.plan('node:a', 'restart');
    expect(restart.steps).toEqual([{ instanceId: 'node:a', name: 'node:a', action: 'restart' }]);
    expect(restart.consequences).toEqual([
      'electrum:a reads the blockchain from its node: that pauses while node:a restarts.',
    ]);
  });

  it('runs a plan step by step, and stops at a step that fails', async () => {
    const { service, calls } = world({ tor: 'stopped', node: 'stopped', electrum: 'stopped' });
    const run = await service.run('electrum:a', 'start');
    expect(run.done).toEqual(['tor', 'node:a', 'electrum:a']);
    expect(calls).toEqual(['start tor', 'start node:a', 'start electrum:a']);
    expect(run.overview.instances.every((entry) => entry.id === 'node:b' || entry.state === 'running')).toBe(true);

    const failing = world({ tor: 'stopped', node: 'stopped' });
    const fake = failing.service as unknown as { options: { modules: ServiceModule[] } };
    fake.options.modules[1] = fakeModule(
      'bitcoin-core',
      [instance('node:a', 'stopped', [{ id: 'tor', hard: true, reason: 'routes its connections through Tor' }])],
      failing.calls,
      'node:a',
    );
    await expect(failing.service.run('node:a', 'start')).rejects.toMatchObject({
      error: { code: 'services.step-failed', details: { done: ['tor'] } },
    });
  });
});

describe('the sample module', () => {
  it('goes through the whole lifecycle with the orchestration', async () => {
    const versions: string[] = [];
    let running = false;
    let config: { port: number } | undefined;
    let latest = '1.0.0';
    const program: ExampleProgram = {
      installedVersions: () => [...versions],
      latestRelease: () => latest,
      install: (version) => {
        versions.push(version);
        return Promise.resolve();
      },
      uninstall: (version) => {
        versions.splice(versions.indexOf(version), 1);
        return Promise.resolve();
      },
      configure: (settings) => {
        config = settings;
      },
      start: () => {
        running = true;
        return Promise.resolve();
      },
      stop: () => {
        running = false;
        return Promise.resolve();
      },
      running: () => running,
      probe: () => Promise.resolve({ height: 840_000 }),
    };
    const jobs: Promise<void>[] = [];
    const module = exampleModule({
      program,
      node: 'node:a',
      jobs: {
        start: (_title, work) => {
          jobs.push(work());
          return { jobId: `job-${String(jobs.length)}` };
        },
      },
    });
    const calls: string[] = [];
    const node = instance('node:a', 'stopped');
    const service = new OrchestrationService({ modules: [fakeModule('bitcoin-core', [node], calls), module], logger });

    // Detected, not installed: nothing to orchestrate yet.
    expect(await module.state()).toMatchObject({ installed: false, summary: 'Not installed.' });
    expect((await service.overview()).instances.map((entry) => entry.id)).toEqual(['node:a']);

    // Installed as a job, then configured.
    expect(await module.install?.()).toEqual({ jobId: 'job-1' });
    await Promise.all(jobs);
    program.configure({ port: 50_101 });
    expect(config).toEqual({ port: 50_101 });

    // Started with its node first, then healthy, with its logs and metrics declared.
    await service.run(EXAMPLE_INSTANCE, 'start');
    expect(calls).toEqual(['start node:a']);
    const started = (await module.instances())[0];
    expect(started).toMatchObject({
      state: 'running',
      health: 'healthy',
      summary: 'Running at block 840000.',
      logSources: ['example'],
    });
    expect(started?.metrics).toEqual(['example.height']);

    // A new release shows as an update and is installed the same way.
    latest = '1.1.0';
    expect((await module.state()).summary).toBe('Version 1.0.0 installed; 1.1.0 is available.');
    await module.install?.();
    await Promise.all(jobs);
    await service.run(EXAMPLE_INSTANCE, 'restart');
    expect(await module.state()).toMatchObject({ versions: ['1.0.0', '1.1.0'], summary: 'Version 1.1.0 installed.' });

    // Stopping its node stops it first; then the old version is removed.
    const stop = await service.plan('node:a', 'stop');
    expect(stop.steps.map((step) => step.instanceId)).toEqual([EXAMPLE_INSTANCE, 'node:a']);
    await service.run('node:a', 'stop');
    expect(running).toBe(false);
    await module.uninstall?.('1.0.0');
    expect(program.installedVersions()).toEqual(['1.1.0']);
  });
});
