import { invoke, isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';

// The native shell's own settings (apps/desktop/src-tauri/src/shell.rs):
// the notification-area icon, closing to it and starting with Windows. They
// belong to the shell rather than the orchestrator because the shell needs
// them before anything else has started.

export const ShellSettingsSchema = z.object({
  closeToTray: z.boolean(),
  startMinimised: z.boolean(),
  startWithWindows: z.boolean(),
  /** Turned off in Windows' start-up settings, which take precedence. */
  disabledByWindows: z.boolean(),
  autostartSupported: z.boolean(),
});
export type ShellSettings = z.infer<typeof ShellSettingsSchema>;

export type ShellSettingsUpdate = Partial<Pick<ShellSettings, 'closeToTray' | 'startMinimised' | 'startWithWindows'>>;

function outsideDesktop(): Error {
  return new Error('These settings are only available in the BTCortex desktop application.');
}

/** The shell reports failures as plain sentences. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'The shell did not answer.');
}

export async function getShellSettings(): Promise<ShellSettings> {
  if (!isTauri()) throw outsideDesktop();
  try {
    return ShellSettingsSchema.parse(await invoke('shell_settings'));
  } catch (error) {
    throw toError(error);
  }
}

export async function updateShellSettings(update: ShellSettingsUpdate): Promise<ShellSettings> {
  if (!isTauri()) throw outsideDesktop();
  try {
    return ShellSettingsSchema.parse(await invoke('shell_update_settings', { update }));
  } catch (error) {
    throw toError(error);
  }
}
