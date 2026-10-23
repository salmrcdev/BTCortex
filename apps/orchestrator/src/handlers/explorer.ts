import type { ExplorerService } from '../explorer/explorer-service';
import type { RemoteExplorerService } from '../explorer/remote-explorer-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerExplorerHandlers(
  dispatcher: Dispatcher,
  explorer: ExplorerService,
  remote: RemoteExplorerService,
): void {
  dispatcher.register('explorers.remote.list', () => remote.list());
  dispatcher.register('explorers.remote.test', (endpoint) => remote.test(endpoint));
  dispatcher.register('explorers.remote.add', (params) => remote.add(params));
  dispatcher.register('explorers.remote.remove', ({ id }) => remote.remove(id));
  dispatcher.register('explorers.remote.open', ({ id, page }) => remote.open(id, page));
  dispatcher.register('explorer.overview', ({ nodeId }) => explorer.overview(nodeId));
  dispatcher.register('explorer.search', ({ nodeId, query }) => explorer.search(nodeId, query));
  dispatcher.register('explorer.block', ({ nodeId, id, page }) => explorer.block(nodeId, id, page));
  dispatcher.register('explorer.transaction', ({ nodeId, txid }) => explorer.transaction(nodeId, txid));
  dispatcher.register('explorer.decodeRaw', ({ nodeId, hex }) => explorer.decodeRaw(nodeId, hex));
  dispatcher.register('explorer.decodeScript', ({ nodeId, hex }) => explorer.decodeScript(nodeId, hex));
  dispatcher.register('explorer.address', ({ nodeId, address }) => explorer.address(nodeId, address));
}
