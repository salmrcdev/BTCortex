import { invoke, isTauri } from '@tauri-apps/api/core';

/** Whether the address leads to an onion service, which only Tor Browser (or another Tor client) reaches. */
export function isOnionAddress(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, '').endsWith('.onion');
  } catch {
    return false;
  }
}

/**
 * Whether BTCortex opens the address in the user's browser: only https
 * addresses, and none of an onion service, which the ordinary browser would
 * either not reach or reach without Tor.
 */
export function opensInBrowser(url: string): boolean {
  return /^https:\/\//i.test(url) && !isOnionAddress(url);
}

/**
 * Opens an https address in the user's browser. The WebView itself never
 * navigates away from BTCortex, and only https addresses are passed on (the
 * shell's opener permission allows nothing else either).
 */
export async function openExternal(url: string): Promise<void> {
  if (!opensInBrowser(url)) throw new Error('Only https addresses outside Tor are opened.');
  if (isTauri()) {
    await invoke('plugin:opener|open_url', { url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
