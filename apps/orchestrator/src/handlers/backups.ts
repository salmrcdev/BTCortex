import type { BackupService } from '../backups/backup-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerBackupHandlers(dispatcher: Dispatcher, backups: BackupService): void {
  dispatcher.register('backups.overview', () => backups.overview());
  dispatcher.register('backups.configure', (change) => backups.configure(change));
  dispatcher.register('backups.create', ({ items, passphrase }) => ({ jobId: backups.create(items, passphrase) }));
  dispatcher.register('backups.verify', ({ path, passphrase }) => backups.verify(path, passphrase));
  dispatcher.register('backups.preview', ({ path }) => backups.preview(path));
  dispatcher.register('backups.restore', ({ path, items, passphrase, acceptedSettings }) => ({
    jobId: backups.restore(path, items, passphrase, acceptedSettings),
  }));
  dispatcher.register('backups.reveal', ({ path }) => {
    backups.reveal(path);
    return { opened: true as const };
  });
}
