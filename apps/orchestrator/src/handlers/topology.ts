import type { TopologyService } from '../topology/topology-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerTopologyHandlers(dispatcher: Dispatcher, topology: TopologyService): void {
  dispatcher.register('topology.graph', () => topology.topology());
}
