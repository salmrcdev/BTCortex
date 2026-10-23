// Application-wide keyboard shortcuts (specification section 24.2). Control
// combinations work everywhere, single keys only outside text fields, and
// none of them overrides what Windows or the WebView already uses.

export type ShortcutId = 'palette' | 'sidebar' | 'settings' | 'help' | 'shortcuts';

export const SHORTCUTS: readonly { id: ShortcutId; keys: readonly string[] }[] = [
  { id: 'palette', keys: ['Ctrl', 'K'] },
  { id: 'sidebar', keys: ['Ctrl', 'B'] },
  { id: 'settings', keys: ['Ctrl', ','] },
  { id: 'help', keys: ['F1'] },
  { id: 'shortcuts', keys: ['?'] },
];

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function shortcutFor(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'target'>,
): ShortcutId | undefined {
  if (event.isComposing || event.altKey) return undefined;
  if (event.ctrlKey || event.metaKey) {
    if (event.shiftKey) return undefined;
    switch (event.key.toLowerCase()) {
      case 'k':
        return 'palette';
      case 'b':
        return 'sidebar';
      case ',':
        return 'settings';
      default:
        return undefined;
    }
  }
  if (event.key === 'F1' && !event.shiftKey) return 'help';
  return event.key === '?' && !isEditable(event.target) ? 'shortcuts' : undefined;
}
