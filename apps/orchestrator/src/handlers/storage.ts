import type { DiskUsageService } from '../storage/disk-usage-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerStorageHandlers(dispatcher: Dispatcher, diskUsage: DiskUsageService): void {
  dispatcher.register('storage.overview', ({ refresh }) => diskUsage.overview(refresh === true));
  dispatcher.register('storage.clean', ({ kind }) => diskUsage.clean(kind));
}
