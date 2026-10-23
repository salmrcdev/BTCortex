import { detectExistingInstallations } from '@btcortex/integration-bitcoin-core';
import type { JobManager } from '../jobs/job-manager';
import type { Dispatcher } from '../rpc/dispatcher';
import type { SetupService } from '../setup/setup-service';

export function registerSetupHandlers(dispatcher: Dispatcher, setup: SetupService, jobs: JobManager): void {
  dispatcher.register('setup.plan', ({ network, usage, implementation }) => setup.plan(network, usage, implementation));
  dispatcher.register('setup.start', ({ name, network, usage, implementation, acceptDifferentChain }) => ({
    jobId: setup.start(name, network, usage, {
      ...(implementation === undefined ? {} : { implementation }),
      acceptDifferentChain: acceptDifferentChain === true,
    }),
  }));
  dispatcher.register('bitcoinCore.detect', () => detectExistingInstallations());
  dispatcher.register('jobs.list', () => jobs.list());
  dispatcher.register('jobs.get', ({ jobId }) => jobs.get(jobId));
}
