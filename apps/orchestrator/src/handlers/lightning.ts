import type { LightningService } from '../lightning/lightning-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerLightningHandlers(dispatcher: Dispatcher, lightning: LightningService): void {
  dispatcher.register('lightning.list', () => lightning.list());
  dispatcher.register('lightning.detectLocal', () => lightning.detectLocal());
  dispatcher.register('lightning.add', (params) => lightning.add(params));
  dispatcher.register('lightning.remove', ({ connectionId }) => {
    lightning.remove(connectionId);
    return { removed: true as const };
  });
  dispatcher.register('lightning.dashboard', ({ connectionId }) => lightning.dashboard(connectionId));
  dispatcher.register('lightning.refresh', ({ connectionId }) => lightning.refresh(connectionId));
  dispatcher.register('lightning.saveChannelBackup', ({ connectionId }) => lightning.saveChannelBackup(connectionId));
}
