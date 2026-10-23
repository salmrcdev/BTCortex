import type { DevToolsService } from '../devtools/devtools-service';
import type { TransactionToolsService } from '../devtools/transaction-tools';
import type { ZmqWatchService } from '../devtools/zmq-watch';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerDevToolsHandlers(
  dispatcher: Dispatcher,
  devtools: DevToolsService,
  zmq: ZmqWatchService,
  transactions: TransactionToolsService,
): void {
  dispatcher.register('devtools.psbt', ({ nodeId, psbt }) => devtools.psbt(nodeId, psbt));
  dispatcher.register('devtools.descriptor', ({ nodeId, descriptor, count }) =>
    devtools.descriptor(nodeId, descriptor, count),
  );
  dispatcher.register('devtools.features', ({ nodeId }) => devtools.features(nodeId));
  dispatcher.register('devtools.mine', ({ nodeId, blocks, address }) => devtools.mine(nodeId, blocks, address));
  dispatcher.register('devtools.probe', (params) => devtools.probe(params));
  dispatcher.register('devtools.zmq.status', ({ nodeId }) => zmq.status(nodeId));
  dispatcher.register('devtools.zmq.watch', ({ nodeId, watch }) => zmq.watch(nodeId, watch));
  dispatcher.register('devtools.address', ({ nodeId, address }) => transactions.address(nodeId, address));
  dispatcher.register('devtools.uri.create', (request) => transactions.createUri(request));
  dispatcher.register('devtools.uri.read', ({ nodeId, uri }) => transactions.readUri(nodeId, uri));
  dispatcher.register('devtools.psbt.combine', ({ nodeId, psbts }) => transactions.combinePsbts(nodeId, psbts));
  dispatcher.register('devtools.psbt.finalise', ({ nodeId, psbt }) => transactions.finalisePsbt(nodeId, psbt));
  dispatcher.register('devtools.broadcast', ({ nodeId, hex }) => transactions.broadcast(nodeId, hex));
  dispatcher.register('devtools.output', ({ nodeId, txid, vout }) => transactions.lookupOutput(nodeId, txid, vout));
  dispatcher.register('devtools.scan', ({ nodeId, targets }) => transactions.scanCoins(nodeId, targets));
  dispatcher.register('devtools.scan.abort', ({ nodeId }) => transactions.abortScan(nodeId));
  dispatcher.register('devtools.track.list', () => transactions.tracked());
  dispatcher.register('devtools.track.add', ({ nodeId, txid }) => transactions.track(nodeId, txid));
  dispatcher.register('devtools.track.remove', ({ nodeId, txid }) => transactions.untrack(nodeId, txid));
}
