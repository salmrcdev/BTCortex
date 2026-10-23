import type { I2pRouterService } from '../i2p/i2p-router';
import type { PrivacyService } from '../nodes/privacy-service';
import type { Dispatcher } from '../rpc/dispatcher';
import type { TorService } from '../tor/tor-service';

export function registerTorHandlers(
  dispatcher: Dispatcher,
  tor: TorService,
  privacy: PrivacyService,
  i2p: I2pRouterService,
): void {
  dispatcher.register('tor.status', () => tor.status());
  dispatcher.register('tor.install', () => ({ jobId: tor.install() }));
  dispatcher.register('tor.start', () => tor.start());
  dispatcher.register('tor.stop', () => tor.stop());
  dispatcher.register('tor.configure', (change) => tor.configure(change));
  dispatcher.register('i2p.status', ({ refresh }) => i2p.status(refresh === true));
  dispatcher.register('nodes.privacy', ({ nodeId }) => privacy.overview(nodeId));
  dispatcher.register('nodes.privacy.configure', ({ nodeId, change }) => privacy.configure(nodeId, change));
}
