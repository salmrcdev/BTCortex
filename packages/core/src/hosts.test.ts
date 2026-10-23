import { describe, expect, it } from 'vitest';
import { isOnionHost, normaliseHostName } from './hosts';

const ONION = `${'a'.repeat(56)}.onion`;

describe('host names', () => {
  it('recognise an onion service however it is written', () => {
    expect(isOnionHost(ONION)).toBe(true);
    // A fully qualified name with its trailing dot must not slip past the check to the Windows resolver.
    expect(isOnionHost(`${ONION}.`)).toBe(true);
    expect(isOnionHost(` ${ONION.toUpperCase()} `)).toBe(true);
    expect(isOnionHost('onion.example.org')).toBe(false);
    expect(isOnionHost('example.onion.example.org.')).toBe(false);
  });

  it('compare names without case or the trailing dot', () => {
    expect(normaliseHostName('Umbrel.Local.')).toBe('umbrel.local');
    expect(normaliseHostName('example.org..')).toBe('example.org');
  });
});
