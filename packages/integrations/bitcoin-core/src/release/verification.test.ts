import { describe, expect, it } from 'vitest';
import { BITCOIN_CORE_TRUST_ANCHORS, BITCOIN_CORE_TRUSTED_KEYS } from './verification';

describe('Bitcoin Core trust anchors', () => {
  it('bundles the pinned upstream builder keys, including the release managers', () => {
    const fingerprints = new Set(BITCOIN_CORE_TRUSTED_KEYS.flatMap((key) => key.fingerprints));
    // Cross-checked against Bitcoin Core's SECURITY.md.
    expect(fingerprints.has('E777299FC265DD04793070EB944D35F9AC3DB76A')).toBe(true);
    expect(fingerprints.has('152812300785C96444D3334D17565732E08E5E41')).toBe(true);
    expect(BITCOIN_CORE_TRUSTED_KEYS.length).toBeGreaterThanOrEqual(30);
  });

  it('records where the keys came from', () => {
    expect(BITCOIN_CORE_TRUST_ANCHORS).toMatch(/guix\.sigs at [0-9a-f]{12}/);
  });
});
