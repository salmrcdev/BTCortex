import type { ElectrumWalletService } from '../apps/electrum-wallet-service';
import type { SparrowService } from '../apps/sparrow-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerAppHandlers(
  dispatcher: Dispatcher,
  sparrow: SparrowService,
  electrumWallet: ElectrumWalletService,
): void {
  dispatcher.register('apps.electrum.status', ({ nodeId }) => electrumWallet.status(nodeId));
  dispatcher.register('apps.electrum.open', ({ nodeId }) => ({ jobId: electrumWallet.open(nodeId) }));
  dispatcher.register('apps.sparrow.status', ({ nodeId, via }) => sparrow.status(nodeId, via));
  dispatcher.register('apps.sparrow.connect', ({ nodeId, replaceExistingServer, resetStartupNetwork, via }) => ({
    jobId: sparrow.connect(nodeId, { replaceExistingServer, resetStartupNetwork }, via),
  }));
  dispatcher.register('apps.sparrow.open', async ({ nodeId }) => {
    await sparrow.open(nodeId);
    return { launched: true };
  });
}
