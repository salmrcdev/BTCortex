import { getCACertificates } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { trustSystemAuthorities } from './certificates';

describe('trusted certificate authorities', () => {
  it('adds the authorities Windows trusts to those Node.js ships with', () => {
    const bundled = getCACertificates('bundled').length;
    const system = getCACertificates('system').length;
    expect(trustSystemAuthorities()).toBeGreaterThanOrEqual(bundled);
    // Node.js drops certificates that appear in both lists.
    expect(getCACertificates('default').length).toBeGreaterThanOrEqual(Math.max(bundled, system));
  });
});
