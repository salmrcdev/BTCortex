import type { UpdateService } from '../updates/update-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerUpdateHandlers(dispatcher: Dispatcher, updates: UpdateService): void {
  dispatcher.register('updates.overview', ({ refresh }) => updates.overview(refresh === true));
  dispatcher.register('updates.defer', ({ product, version, days }) => {
    updates.defer(product, version, days);
    return updates.overview(false);
  });
  dispatcher.register('updates.resume', ({ product }) => {
    updates.resume(product);
    return updates.overview(false);
  });
}
