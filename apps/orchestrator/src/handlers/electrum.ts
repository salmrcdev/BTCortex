import type { ElectrumService } from '../electrum/electrum-service';
import type { RemoteElectrumService } from '../electrum/remote-electrum-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerElectrumHandlers(
  dispatcher: Dispatcher,
  electrum: ElectrumService,
  remote: RemoteElectrumService,
): void {
  dispatcher.register('electrum.overview', () => electrum.overview());
  dispatcher.register('electrum.plan', ({ nodeId, dataDirectory }) => electrum.plan(nodeId, dataDirectory));
  dispatcher.register('electrum.setUp', ({ nodeId, dataDirectory }) => ({
    jobId: electrum.setUp(nodeId, dataDirectory),
  }));
  dispatcher.register('electrum.start', ({ nodeId }) => electrum.start(nodeId));
  dispatcher.register('electrum.stop', ({ nodeId }) => electrum.stop(nodeId));
  dispatcher.register('electrum.remoteAccess', ({ nodeId, enabled }) => electrum.setRemoteAccess(nodeId, enabled));
  dispatcher.register('electrum.remove', ({ nodeId, deleteIndex }) => electrum.remove(nodeId, deleteIndex));
  dispatcher.register('electrum.remote.list', () => remote.list());
  dispatcher.register('electrum.remote.test', (endpoint) => remote.test(endpoint));
  dispatcher.register('electrum.remote.add', (params) => remote.add(params));
  dispatcher.register('electrum.remote.remove', ({ id }) => remote.remove(id));
}
