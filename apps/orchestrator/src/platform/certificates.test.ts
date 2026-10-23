import { X509Certificate } from 'node:crypto';
import { getCACertificates } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { trustSystemAuthorities } from './certificates';

describe('trusted certificate authorities', () => {
  it('adds the authorities Windows trusts to those Node.js ships with', () => {
    const fingerprints = (certificates: string[]) =>
      new Set(certificates.map((certificate) => new X509Certificate(certificate).fingerprint256));
    const expected = fingerprints([...getCACertificates('bundled'), ...getCACertificates('system')]);

    expect(trustSystemAuthorities()).toBeGreaterThanOrEqual(expected.size);

    // Stores may contain duplicates or encode the same certificate differently.
    expect(fingerprints(getCACertificates('default'))).toEqual(expected);
  });
});
