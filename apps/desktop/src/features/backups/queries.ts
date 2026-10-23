import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupSchedule } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

// The backup centre. Backups and restores run as jobs; when one ends, the
// overview is read again (see the event bridge in features/nodes/queries.ts).

export const backupKeys = {
  all: ['backups'] as const,
  overview: ['backups', 'overview'] as const,
  preview: (path: string) => ['backups', 'preview', path] as const,
};

export function useBackupOverview() {
  return useQuery({
    queryKey: backupKeys.overview,
    queryFn: () => callOrchestrator('backups.overview', {}, { timeoutMs: 60_000 }),
  });
}

export function useRestorePreview(path: string | undefined) {
  return useQuery({
    queryKey: backupKeys.preview(path ?? ''),
    queryFn: () => callOrchestrator('backups.preview', { path: path ?? '' }, { timeoutMs: 60_000 }),
    enabled: path !== undefined,
    retry: false,
  });
}

export interface BackupSettingsChange {
  destination?: string | null;
  retention?: number;
  schedule?: BackupSchedule;
  passphrase?: string;
  forgetPassphrase?: true;
}

export function useBackupActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: backupKeys.all });
  return {
    configure: useMutation({
      mutationFn: (change: BackupSettingsChange) =>
        callOrchestrator('backups.configure', change, { timeoutMs: 60_000 }),
      onSuccess: refresh,
    }),
    create: useMutation({
      mutationFn: ({ items, passphrase }: { items: string[]; passphrase?: string }) =>
        callOrchestrator('backups.create', { items, ...(passphrase === undefined ? {} : { passphrase }) }),
    }),
    verify: useMutation({
      mutationFn: ({ path, passphrase }: { path: string; passphrase?: string }) =>
        callOrchestrator(
          'backups.verify',
          { path, ...(passphrase === undefined ? {} : { passphrase }) },
          { timeoutMs: 300_000 },
        ),
    }),
    restore: useMutation({
      mutationFn: ({
        path,
        items,
        passphrase,
        acceptedSettings,
      }: {
        path: string;
        items: string[];
        passphrase?: string;
        acceptedSettings?: string[];
      }) =>
        callOrchestrator('backups.restore', {
          path,
          items,
          ...(passphrase === undefined ? {} : { passphrase }),
          ...(acceptedSettings === undefined ? {} : { acceptedSettings }),
          confirmed: true,
        }),
    }),
    reveal: useMutation({
      mutationFn: (path: string) => callOrchestrator('backups.reveal', { path }),
    }),
  };
}
