import { describe, expect, it } from 'vitest';
import {
  compareKnotsVersions,
  fetchLatestKnotsVersion,
  followsDifferentChain,
  parseKnotsVersion,
  releaseFiles,
} from './releases';
import { BITCOIN_KNOTS_TRUST_ANCHORS, BITCOIN_KNOTS_TRUSTED_KEYS, RELEASE_MAINTAINER } from './verification';

const version = (text: string) => {
  const parsed = parseKnotsVersion(text);
  if (!parsed) throw new Error(`not a Knots version: ${text}`);
  return parsed;
};

describe('Bitcoin Knots releases', () => {
  it('reads versions with and without a patch number, and nothing else', () => {
    expect(parseKnotsVersion('29.4.2.knots20260508')).toEqual({
      text: '29.4.2.knots20260508',
      major: 29,
      minor: 4,
      patch: 2,
      stamp: '20260508',
    });
    expect(parseKnotsVersion('29.3.knots20260210')).toMatchObject({ major: 29, minor: 3, patch: 0 });
    expect(parseKnotsVersion('31.1')).toBeUndefined();
    expect(parseKnotsVersion('29.4.2.knots2026')).toBeUndefined();
  });

  it('orders releases sharing a date by their base version', () => {
    const releases = ['29.4.knots20260508', '29.3.knots20260507', '29.4.2.knots20260508', '29.3.knots20260508'];
    expect(
      releases
        .map(version)
        .sort(compareKnotsVersions)
        .map((entry) => entry.text),
    ).toEqual(['29.3.knots20260507', '29.3.knots20260508', '29.4.knots20260508', '29.4.2.knots20260508']);
  });

  it('knows which releases follow a chain Bitcoin Core rejects', () => {
    expect(followsDifferentChain(version('29.4.1.knots20260508'))).toBe(true);
    expect(followsDifferentChain(version('29.4.2.knots20260508'))).toBe(true);
    expect(followsDifferentChain(version('30.0.knots20270101'))).toBe(true);
    expect(followsDifferentChain(version('29.4.knots20260508'))).toBe(false);
    expect(followsDifferentChain(version('29.3.knots20260507'))).toBe(false);
  });

  it('downloads the signed portable archive from bitcoinknots.org, never the installer', () => {
    expect(releaseFiles('29.4.2.knots20260508')).toEqual({
      directory: 'https://bitcoinknots.org/files/29.x/29.4.2.knots20260508/',
      sums: 'https://bitcoinknots.org/files/29.x/29.4.2.knots20260508/SHA256SUMS',
      signatures: 'https://bitcoinknots.org/files/29.x/29.4.2.knots20260508/SHA256SUMS.asc',
      windowsArchiveName: 'bitcoin-29.4.2.knots20260508-win64-pgpverifiable.zip',
      windowsArchive:
        'https://bitcoinknots.org/files/29.x/29.4.2.knots20260508/bitcoin-29.4.2.knots20260508-win64-pgpverifiable.zip',
    });
    expect(() => releaseFiles('31.1')).toThrow(/not a Bitcoin Knots release/);
  });

  it('takes the latest final release from GitHub and refuses anything else', async () => {
    const answer = (body: unknown) => (() => Promise.resolve(new Response(JSON.stringify(body)))) as typeof fetch;
    expect(await fetchLatestKnotsVersion(answer({ tag_name: 'v29.4.2.knots20260508' }))).toBe('29.4.2.knots20260508');
    await expect(fetchLatestKnotsVersion(answer({ tag_name: 'v29.5.0rc1', prerelease: true }))).rejects.toThrow(
      /not a final Bitcoin Knots release/,
    );
  });
});

describe('Bitcoin Knots trust anchors', () => {
  it('bundles the builder keys, the maintainer’s among them', () => {
    const maintainer = BITCOIN_KNOTS_TRUSTED_KEYS.find((key) => key.name === RELEASE_MAINTAINER);
    // Cross-checked against the bitcoin-knots research record and the signatures on 29.4.2's checksums.
    expect(maintainer?.fingerprints).toContain('1A3E761F19D2CC7785C5502EA291A2C45D0C504A');
    expect(BITCOIN_KNOTS_TRUSTED_KEYS.length).toBeGreaterThanOrEqual(15);
    expect(BITCOIN_KNOTS_TRUST_ANCHORS).toMatch(/bitcoinknots\/guix\.sigs at [0-9a-f]{12}/);
  });
});
