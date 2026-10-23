import { join } from 'node:path';
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';
import { verifyDetachedSignatures } from '@btcortex/installation-manager';
import {
  compareTorVersions,
  fetchLatestTorVersion,
  isTorBundleVersion,
  mergeFreshKey,
  torReleaseFiles,
  torTrustedKeys,
  TOR_TRUSTED_KEYS,
} from './release';
import { TOR_SIGNING_KEY } from './signing-key.generated';
import { buildTorrc, DEFAULT_TOR_PORTS, torArguments, TorPathError } from './torrc';

const respond = (routes: Record<string, () => Response>) =>
  ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response('not found', { status: 404 }));
  }) as typeof fetch;

const KEYS_OPENPGP = `https://keys.openpgp.org/vks/v1/by-fingerprint/${TOR_SIGNING_KEY.fingerprint}`;

describe('Tor Expert Bundle releases', () => {
  it('builds the published file names for a stable version and refuses anything else', () => {
    expect(torReleaseFiles('15.0.26')).toEqual({
      manifest: 'https://dist.torproject.org/torbrowser/15.0.26/sha256sums-signed-build.txt',
      signature: 'https://dist.torproject.org/torbrowser/15.0.26/sha256sums-signed-build.txt.asc',
      archiveName: 'tor-expert-bundle-windows-x86_64-15.0.26.tar.gz',
      archive: 'https://dist.torproject.org/torbrowser/15.0.26/tor-expert-bundle-windows-x86_64-15.0.26.tar.gz',
      archiveSignature:
        'https://dist.torproject.org/torbrowser/15.0.26/tor-expert-bundle-windows-x86_64-15.0.26.tar.gz.asc',
    });
    expect(() => torReleaseFiles('16.0a14')).toThrow(/not a stable/);
    expect(() => torReleaseFiles('../15.0.26')).toThrow();
    expect(isTorBundleVersion('15.0')).toBe(true);
    expect(['15.0.9', '15.0.26', '14.5.1', '15.0.25'].sort(compareTorVersions)).toEqual([
      '15.0.26',
      '15.0.25',
      '15.0.9',
      '14.5.1',
    ]);
  });

  it('reads the current stable version and refuses an alpha', async () => {
    const info = 'https://aus1.torproject.org/torbrowser/update_3/release/download-windows-x86_64.json';
    await expect(fetchLatestTorVersion(respond({ [info]: () => Response.json({ version: '15.0.26' }) }))).resolves.toBe(
      '15.0.26',
    );
    await expect(
      fetchLatestTorVersion(respond({ [info]: () => Response.json({ version: '16.0a14' }) })),
    ).rejects.toThrow(/not a stable version/);
    await expect(fetchLatestTorVersion(respond({}))).rejects.toThrow(/HTTP 404/);
  });

  it('merges a fresh copy into the pinned key, and never takes a key with another fingerprint', async () => {
    const fresh = await torTrustedKeys(respond({ [KEYS_OPENPGP]: () => new Response(TOR_SIGNING_KEY.armored) }));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.fingerprints).toEqual([TOR_SIGNING_KEY.fingerprint]);

    const other = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'Tor Browser Developers (signing key)', email: 'torbrowser@torproject.org' }],
      format: 'armored',
    });
    expect(await torTrustedKeys(respond({ [KEYS_OPENPGP]: () => new Response(other.publicKey) }))).toBe(
      TOR_TRUSTED_KEYS,
    );
    // Offline: the pinned copy alone.
    const offline = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    expect(await torTrustedKeys(offline)).toBe(TOR_TRUSTED_KEYS);
  });

  it('applies a revocation that only the fresh copy carries', async () => {
    const { privateKey } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'Signer', email: 'signer@example.org' }],
      format: 'object',
    });
    const data = new TextEncoder().encode('sha256sums of a release');
    const signature: string = await openpgp.sign({
      message: await openpgp.createMessage({ binary: data }),
      signingKeys: privateKey,
      detached: true,
      format: 'armored',
    });
    const pinned = privateKey.toPublic().armor();
    const fingerprints = [privateKey.getFingerprint().toUpperCase()];
    const { publicKey: revoked } = await openpgp.revokeKey({ key: privateKey, format: 'object' });
    const check = (armored: string) =>
      verifyDetachedSignatures(data, signature, { keys: [{ name: 'Signer', armored, fingerprints }], threshold: 1 });
    expect((await check(pinned)).meetsThreshold).toBe(true);
    expect((await check(await mergeFreshKey(pinned, revoked))).meetsThreshold).toBe(false);
  });

  it('pins the Tor Browser Developers primary key whose subkeys sign the bundle', () => {
    expect(TOR_SIGNING_KEY.fingerprint).toBe('EF6E286DDA85EA2A4BA7DE684E2C6E8793298290');
    expect(TOR_SIGNING_KEY.subkeys.map((subkey) => subkey.fingerprint)).toContain(
      '022DA248432D2A0E0F54E65E316C1FACD62D07D9',
    );
  });
});

describe('torrc and command line', () => {
  it('keeps every listener on loopback, with cookie authentication and notice-level logs on standard output', () => {
    const torrc = buildTorrc(DEFAULT_TOR_PORTS);
    expect(torrc).toContain('SocksPort 127.0.0.1:9050 IsolateSOCKSAuth');
    expect(torrc).toContain('SocksPort 127.0.0.1:9052 IsolateSOCKSAuth');
    expect(torrc).toContain('ControlPort 127.0.0.1:9054');
    expect(torrc).toContain('CookieAuthentication 1');
    expect(torrc).toContain('Log notice stdout');
    expect(torrc).toContain('SafeLogging 1');
    expect(torrc).not.toMatch(/0\.0\.0\.0|HashedControlPassword|DataDirectory/);
  });

  it('passes every path as its own argument, and ties tor to an owner only when asked', () => {
    const home = join('C:', 'Users', 'Dev', 'AppData', 'Local', 'BTCortex', 'tor');
    const bundle = join('C:', 'Users', 'Dev', 'AppData', 'Local', 'BTCortex', 'installations', 'tor', '15.0.26');
    const args = torArguments({ bundle, home, ownerPid: 4321 });
    expect(args.slice(0, 4)).toEqual(['-f', join(home, 'torrc'), '--defaults-torrc', join(home, 'torrc-defaults')]);
    const option = (name: string) => args[args.indexOf(name) + 1];
    expect(option('DataDirectory')).toBe(join(home, 'data'));
    expect(option('CookieAuthFile')).toBe(join(home, 'data', 'control_auth_cookie'));
    expect(option('GeoIPFile')).toBe(join(bundle, 'data', 'geoip'));
    expect(option('__OwningControllerProcess')).toBe('4321');
    expect(args).not.toContain('DisableNetwork');
    expect(torArguments({ bundle, home })).not.toContain('__OwningControllerProcess');
    expect(torArguments({ bundle, home, disableNetwork: true }).slice(-2)).toEqual(['DisableNetwork', '1']);
  });

  it('refuses folders with non-ASCII names, which tor cannot open on Windows', () => {
    expect(() => torArguments({ bundle: 'C:\\Users\\José\\tor', home: 'C:\\Users\\José\\BTCortex\\tor' })).toThrow(
      TorPathError,
    );
  });
});
