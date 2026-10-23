import { invoke, isTauri } from '@tauri-apps/api/core';

// The system's own Open and Save dialogs. The WebView only learns the path the
// user chose; reading and writing the file is the orchestrator's work, so the
// WebView itself never gains file system access.

export interface FileFilter {
  name: string;
  extensions: string[];
}

export async function chooseFileToOpen(filters: FileFilter[]): Promise<string | null> {
  if (!isTauri()) return null;
  const chosen = await invoke<string | string[] | null>('plugin:dialog|open', {
    options: { multiple: false, directory: false, filters },
  });
  return typeof chosen === 'string' ? chosen : null;
}

export async function chooseFileToSave(defaultPath: string, filters: FileFilter[]): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>('plugin:dialog|save', { options: { defaultPath, filters } });
}

/** A folder, for example where an index should go. */
export async function chooseFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const chosen = await invoke<string | string[] | null>('plugin:dialog|open', {
    options: { multiple: false, directory: true, ...(defaultPath ? { defaultPath } : {}) },
  });
  return typeof chosen === 'string' ? chosen : null;
}
