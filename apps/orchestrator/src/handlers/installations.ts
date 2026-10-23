import type { InstallationService } from '../installations/installation-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerInstallationHandlers(dispatcher: Dispatcher, installations: InstallationService): void {
  dispatcher.register('installations.list', () => installations.list());
  dispatcher.register('installations.checkUpdates', () => installations.checkUpdates());
  dispatcher.register('installations.verify', ({ product, version }) => installations.verify(product, version));
  dispatcher.register('installations.update', ({ product }) => ({ jobId: installations.update(product) }));
  dispatcher.register('installations.remove', async ({ product, version }) => ({
    removedBytes: await installations.remove(product, version),
  }));
  dispatcher.register('nodes.useRuntime', async ({ nodeId, version }) => ({
    restarting: await installations.useRuntime(nodeId, version),
  }));
}
