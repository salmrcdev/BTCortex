import { describe, expect, it } from 'vitest';
import { shortcutFor } from './keyboard';

const press = (
  key: string,
  modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {},
  target: EventTarget | null = document.body,
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  target,
  ...modifiers,
});

describe('keyboard shortcuts', () => {
  it('recognises the Control combinations anywhere', () => {
    const field = document.createElement('input');
    expect(shortcutFor(press('k', { ctrlKey: true }))).toBe('palette');
    expect(shortcutFor(press('K', { ctrlKey: true }, field))).toBe('palette');
    expect(shortcutFor(press('b', { ctrlKey: true }))).toBe('sidebar');
    expect(shortcutFor(press(',', { ctrlKey: true }))).toBe('settings');
  });

  it('leaves other combinations alone', () => {
    expect(shortcutFor(press('k'))).toBeUndefined();
    expect(shortcutFor(press('k', { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(shortcutFor(press('k', { ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(shortcutFor(press('f', { ctrlKey: true }))).toBeUndefined();
  });

  it('takes the question mark only outside text fields', () => {
    expect(shortcutFor(press('?', { shiftKey: true }))).toBe('shortcuts');
    expect(shortcutFor(press('?', { shiftKey: true }, document.createElement('textarea')))).toBeUndefined();
    expect(shortcutFor(press('?', { shiftKey: true }, document.createElement('input')))).toBeUndefined();
  });
});
