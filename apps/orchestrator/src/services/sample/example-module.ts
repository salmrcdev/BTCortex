import type { ServiceAction, ServiceState } from '@btcortex/contracts';
import type { ModuleInstance, ServiceModule } from '../service-module';

// A sample integration module (specification section 29), read alongside
// docs/PLUGIN_DEVELOPMENT.md. It fulfils every facet of the contract for a
// small stand-in program that lives in memory, so the whole lifecycle —
// detection, installation, configuration, start, health, logs, metrics,
// update, stop and removal — can be read and run without installing
// anything. It is not registered in BTCortex; its test drives it through the
// orchestration like any other module.
//
// A real module receives the same kind of options: a client of its program
// from its package in packages/integrations, the job manager for long work,
// and the instance ids of what it needs. It never reaches for anything else.

/** What a real integration package would provide: verified installs, configuration and a client. */
export interface ExampleProgram {
  installedVersions(): string[];
  /** The newest release the publisher offers, as its release feed says. */
  latestRelease(): string;
  install(version: string): Promise<void>;
  uninstall(version: string): Promise<void>;
  configure(settings: { port: number }): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  running(): boolean;
  /** The program's own answer to a status request. */
  probe(): Promise<{ height: number }>;
}

export interface ExampleModuleOptions {
  program: ExampleProgram;
  /** The node the program reads, as an orchestration instance id such as `node:abc`. */
  node: string;
  /** Long work runs as a job, with progress the interface follows. */
  jobs: { start(title: string, work: () => Promise<void>): { jobId: string } };
}

export const EXAMPLE_INSTANCE = 'example';

export function exampleModule(options: ExampleModuleOptions): ServiceModule {
  const { program } = options;
  const newest = () => program.installedVersions().at(-1) ?? null;

  return {
    // Metadata, as the catalogue shows it.
    id: 'example-service',
    name: 'Example service',
    status: 'unit-tested',
    level: 'fully-managed',
    route: null,
    documentation: { document: 'PLUGIN_DEVELOPMENT', section: 'a-sample-module' },

    // Dependencies on other integrations, and what it may do on this computer.
    dependencies: [{ id: 'bitcoin-core', optional: false, reason: 'Reads blocks from a node.' }],
    permissions: ['processes', 'node-rpc'],

    // Capability detection: what it offers, and what is there now.
    capabilities: ['detect', 'install', 'configure', 'start', 'stop', 'health', 'logs', 'update', 'uninstall'],
    state(): Promise<ServiceState> {
      const installed = program.installedVersions();
      const current = newest();
      const update = current !== null && current !== program.latestRelease();
      return Promise.resolve({
        installed: installed.length > 0,
        versions: installed,
        running: program.running() ? 1 : 0,
        health: installed.length === 0 ? 'unknown' : program.running() ? 'healthy' : 'inactive',
        summary:
          current === null
            ? 'Not installed.'
            : `Version ${current} installed${update ? `; ${program.latestRelease()} is available` : ''}.`,
      });
    },

    // Installation and removal, as jobs.
    install(): Promise<{ jobId: string }> {
      const version = program.latestRelease();
      return Promise.resolve(
        options.jobs.start(`Install the example service ${version}`, () => program.install(version)),
      );
    },
    async uninstall(version: string): Promise<void> {
      if (program.running() && newest() === version) throw new Error('The running version cannot be removed.');
      await program.uninstall(version);
    },

    // Configuration: where the interface changes it.
    configuration: { route: '/services', summary: 'Its port, written by BTCortex.' },

    // Updates go through the update centre's product, when BTCortex updates it.
    updates: null,

    // Instances, with health, logs and metrics, and what each needs.
    async instances(): Promise<ModuleInstance[]> {
      if (newest() === null) return [];
      const running = program.running();
      const height = running ? (await program.probe().catch(() => null))?.height : undefined;
      return [
        {
          id: EXAMPLE_INSTANCE,
          name: 'Example service',
          route: null,
          state: running ? 'running' : 'stopped',
          health: !running ? 'inactive' : height === undefined ? 'attention' : 'healthy',
          summary: !running
            ? 'Stopped.'
            : height === undefined
              ? 'Running, but not answering.'
              : `Running at block ${String(height)}.`,
          actions: running ? ['stop', 'restart'] : ['start'],
          requires: [{ id: options.node, hard: true, reason: 'reads blocks from its node' }],
          logSources: ['example'],
          metrics: ['example.height'],
        },
      ];
    },

    // Lifecycle operations, among those the instance offers.
    async run(instanceId: string, action: ServiceAction): Promise<void> {
      if (instanceId !== EXAMPLE_INSTANCE) throw new Error(`${instanceId} is not the example service.`);
      if (action === 'stop' || action === 'restart') await program.stop();
      if (action === 'start' || action === 'restart') await program.start();
    },
  };
}
