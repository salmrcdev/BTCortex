import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nodeKeys } from '@/features/nodes/queries';
import { callOrchestrator, isDesktopRuntime } from '@/lib/orchestrator';
import { getShellSettings, updateShellSettings } from '@/lib/shell';
import type { ShellSettings, ShellSettingsUpdate } from '@/lib/shell';

export const shellKeys = { settings: ['shell', 'settings'] as const };

/** Starting with Windows can also change in Windows' own settings, so it is read again on every visit. */
export function useShellSettings() {
  return useQuery({
    queryKey: shellKeys.settings,
    queryFn: getShellSettings,
    enabled: isDesktopRuntime(),
    staleTime: 0,
  });
}

export function useUpdateShellSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: ShellSettingsUpdate) => updateShellSettings(update),
    onSuccess: (settings: ShellSettings) => {
      queryClient.setQueryData(shellKeys.settings, settings);
    },
  });
}

export function useConfigureLifecycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: { nodeId: string; keepRunningOnExit?: boolean; startWithBtcortex?: boolean }) =>
      callOrchestrator('nodes.lifecycle.configure', change),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodeKeys.all }),
  });
}
