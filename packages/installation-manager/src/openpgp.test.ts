import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as openpgp from 'openpgp';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseChecksumManifest } from './checksums';
import type { TrustedKey } from './openpgp';
import { splitArmouredSignatures, verifyDetachedSignatures } from './openpgp';

const MANIFEST = new TextEncoder().encode(
  [
    'c99ef173471c58e6766d9eebd12e6c35349082eeed3939bc99eed58ef57db587  bitcoin-31.1-win64.zip',
    'd0c6d0f3cd08689472a6f53c4ce33a5f059c092758c32c42541b47db4e193458  bitcoin-31.1-win64-setup.exe',
    '',
  ].join('\n'),
);

interface TestSigner {
  key: TrustedKey;
  privateKey: openpgp.PrivateKey;
}

async function createSigner(name: string): Promise<TestSigner> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'ed25519Legacy',
    userIDs: [{ name, email: `${name}@example.org` }],
    format: 'object',
  });
  return {
    privateKey,
    key: { name, fingerprints: [publicKey.getFingerprint().toUpperCase()], armored: publicKey.armor() },
  };
}

async function sign(signer: TestSigner, data: Uint8Array): Promise<string> {
  const message = await openpgp.createMessage({ binary: data });
  const signature: string = await openpgp.sign({
    message,
    signingKeys: signer.privateKey,
    detached: true,
    format: 'armored',
  });
  return signature;
}

let alice: TestSigner;
let bob: TestSigner;
let mallory: TestSigner;

beforeAll(async () => {
  [alice, bob, mallory] = await Promise.all([createSigner('alice'), createSigner('bob'), createSigner('mallory')]);
});

describe('verifyDetachedSignatures', () => {
  it('counts distinct valid signers against the threshold', async () => {
    const signatures = [await sign(alice, MANIFEST), await sign(bob, MANIFEST)].join('\n');
    const keys = [alice.key, bob.key];
    const report = await verifyDetachedSignatures(MANIFEST, signatures, { keys, threshold: 2 });
    expect(report.meetsThreshold).toBe(true);
    expect(report.validSigners.map((signer) => signer.signer).sort()).toEqual(['alice', 'bob']);
    expect((await verifyDetachedSignatures(MANIFEST, signatures, { keys, threshold: 3 })).meetsThreshold).toBe(false);
  });

  it('never counts the same key twice', async () => {
    const signatures = [await sign(alice, MANIFEST), await sign(alice, MANIFEST)].join('\n');
    // Two key files carrying the same key, as with TheCharlatan and sedited upstream.
    const keys = [alice.key, { ...alice.key, name: 'alias' }];
    const report = await verifyDetachedSignatures(MANIFEST, signatures, { keys, threshold: 2 });
    expect(report.validSigners).toHaveLength(1);
    expect(report.meetsThreshold).toBe(false);
  });

  it('counts a builder who signs with two keys once', async () => {
    const second = await createSigner('alice-second');
    // One builder's key file with two primary keys in one block, as luke-jr's in bitcoinknots/guix.sigs.
    const packets = [alice.privateKey.toPublic().write(), second.privateKey.toPublic().write()];
    const combined = new Uint8Array(packets.reduce((total, part) => total + part.length, 0));
    combined.set(packets[0] ?? new Uint8Array(), 0);
    combined.set(packets[1] ?? new Uint8Array(), packets[0]?.length ?? 0);
    const both: TrustedKey = {
      name: 'alice',
      fingerprints: [...alice.key.fingerprints, ...second.key.fingerprints],
      armored: openpgp.armor(openpgp.enums.armor.publicKey, combined),
    };
    const signatures = [await sign(alice, MANIFEST), await sign(second, MANIFEST)].join('\n');
    const report = await verifyDetachedSignatures(MANIFEST, signatures, { keys: [both], threshold: 2 });
    expect(report.validSigners).toHaveLength(2);
    expect(report.meetsThreshold).toBe(false);
    const withBob = await verifyDetachedSignatures(MANIFEST, [signatures, await sign(bob, MANIFEST)].join('\n'), {
      keys: [both, bob.key],
      threshold: 2,
    });
    expect(withBob.meetsThreshold).toBe(true);
  });

  it('counts one person pinned under two names with two keys once', async () => {
    // bigshiny90 and shiny in bitcoinknots/guix.sigs: two keys, two file names, one e-mail address.
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'alice (attestations)', email: 'Alice@example.org' }],
      format: 'object',
    });
    const attestations: TestSigner = {
      privateKey,
      key: {
        name: 'alice-attestations',
        fingerprints: [publicKey.getFingerprint().toUpperCase()],
        armored: publicKey.armor(),
      },
    };
    const keys = [alice.key, attestations.key, bob.key];
    const twoKeys = [await sign(alice, MANIFEST), await sign(attestations, MANIFEST)].join('\n');
    const report = await verifyDetachedSignatures(MANIFEST, twoKeys, { keys, threshold: 2 });
    expect(report.validSigners.map((signer) => signer.signer).sort()).toEqual(['alice', 'alice-attestations']);
    expect(report.signerCount).toBe(1);
    expect(report.meetsThreshold).toBe(false);
    const withBob = [twoKeys, await sign(bob, MANIFEST)].join('\n');
    expect(await verifyDetachedSignatures(MANIFEST, withBob, { keys, threshold: 2 })).toMatchObject({
      signerCount: 2,
      meetsThreshold: true,
    });
  });

  it('rejects signatures over different bytes, unknown keys and garbage', async () => {
    const tampered = new TextEncoder().encode('0000  bitcoin-31.1-win64.zip\n');
    const signatures = [
      await sign(alice, tampered),
      await sign(mallory, MANIFEST),
      '-----BEGIN PGP SIGNATURE-----\nnot base64\n-----END PGP SIGNATURE-----',
    ].join('\n');
    const report = await verifyDetachedSignatures(MANIFEST, signatures, { keys: [alice.key, bob.key], threshold: 1 });
    expect(report.results.map((result) => result.status)).toEqual(['invalid', 'unknown-key', 'unparseable']);
    expect(report.meetsThreshold).toBe(false);
  });

  it('ignores a key whose fingerprint is not the pinned one', async () => {
    const signatures = await sign(mallory, MANIFEST);
    // Mallory's key file presented under Alice's pinned fingerprint.
    const swapped: TrustedKey = { name: 'alice', armored: mallory.key.armored, fingerprints: alice.key.fingerprints };
    const report = await verifyDetachedSignatures(MANIFEST, signatures, { keys: [swapped], threshold: 1 });
    expect(report.results[0]?.status).toBe('unknown-key');
  });

  it('splits concatenated armoured blocks', async () => {
    const text = `${await sign(alice, MANIFEST)}\n${await sign(bob, MANIFEST)}`;
    expect(splitArmouredSignatures(text)).toHaveLength(2);
  });
});

describe('verifyDetachedSignatures with one signature file per signer, the way LND publishes them', () => {
  const signBinary = async (signer: TestSigner, data: Uint8Array): Promise<Uint8Array> => {
    const signature: Uint8Array = await openpgp.sign({
      message: await openpgp.createMessage({ binary: data }),
      signingKeys: signer.privateKey,
      detached: true,
      format: 'binary',
    });
    return signature;
  };
  const encode = (text: string) => new TextEncoder().encode(text);

  it('reads binary and armoured files alike and reports what it cannot read', async () => {
    const files = [
      await signBinary(alice, MANIFEST),
      encode(await sign(bob, MANIFEST)),
      await signBinary(mallory, MANIFEST),
      encode('not a signature at all'),
    ];
    const report = await verifyDetachedSignatures(MANIFEST, files, { keys: [alice.key, bob.key], threshold: 2 });
    expect(report.results.map((result) => result.status)).toEqual(['valid', 'valid', 'unknown-key', 'unparseable']);
    expect(report.validSigners.map((signer) => signer.signer).sort()).toEqual(['alice', 'bob']);
    expect(report.meetsThreshold).toBe(true);
  });

  it('checks every signature in a file and never counts a signer twice across files', async () => {
    const first = await signBinary(alice, MANIFEST);
    const second = await signBinary(alice, MANIFEST);
    const both = new Uint8Array([...first, ...second]);
    const report = await verifyDetachedSignatures(MANIFEST, [first, both], {
      keys: [alice.key, bob.key],
      threshold: 2,
    });
    expect(report.results.map((result) => result.status)).toEqual(['valid', 'valid', 'valid']);
    expect(report.validSigners).toHaveLength(1);
    expect(report.meetsThreshold).toBe(false);
  });

  it('rejects a binary signature over different bytes', async () => {
    const tampered = encode('0000  bitcoin-31.1-win64.zip');
    const report = await verifyDetachedSignatures(MANIFEST, [await signBinary(alice, tampered)], {
      keys: [alice.key],
      threshold: 1,
    });
    expect(report.results[0]?.status).toBe('invalid');
    expect(report.meetsThreshold).toBe(false);
  });
});

describe('parseChecksumManifest', () => {
  it('parses both sha256sum separators strictly', () => {
    const sums = parseChecksumManifest(new TextDecoder().decode(MANIFEST));
    expect(sums.get('bitcoin-31.1-win64.zip')).toBe('c99ef173471c58e6766d9eebd12e6c35349082eeed3939bc99eed58ef57db587');
    const binary = parseChecksumManifest(`${'d'.repeat(64)} *Sparrow-2.5.5.zip\r\n`);
    expect(binary.get('Sparrow-2.5.5.zip')).toBe('d'.repeat(64));
    expect(() => parseChecksumManifest('abc  file\n')).toThrow();
    const line = `${'a'.repeat(64)}  same.zip`;
    expect(() => parseChecksumManifest(`${line}\n${line}\n`)).toThrow(/twice/);
  });
});

describe('a publisher that still signs with DSA', () => {
  // Fulcrum 2.1.4's real checksum file and signature, and Calin Culianu's DSA-2048 key.
  const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'testing', 'fixtures', name));
  const key = (allowDsa: boolean): TrustedKey => ({
    name: 'Calin Culianu',
    armored: fixture('calin-culianu.asc').toString('utf8'),
    fingerprints: ['D465135F97D0047E18E99DC321810A542031C02C'],
    ...(allowDsa ? { allowDsa } : {}),
  });

  it('verifies the pinned DSA key only when that key is marked as allowed', async () => {
    const manifest = fixture('Fulcrum-2.1.4-shasums.txt');
    const signature = fixture('Fulcrum-2.1.4-shasums.txt.asc').toString('utf8');
    const allowed = await verifyDetachedSignatures(manifest, signature, { keys: [key(true)], threshold: 1 });
    expect(allowed.meetsThreshold).toBe(true);
    expect(allowed.validSigners).toEqual([
      { signer: 'Calin Culianu', fingerprint: 'D465135F97D0047E18E99DC321810A542031C02C' },
    ]);
    const refused = await verifyDetachedSignatures(manifest, signature, { keys: [key(false)], threshold: 1 });
    expect(refused.meetsThreshold).toBe(false);
    // A changed checksum file does not verify, DSA or not.
    const tampered = Buffer.from(manifest.toString('utf8').replace('9e8b0435', '0e8b0435'));
    expect(
      (await verifyDetachedSignatures(tampered, signature, { keys: [key(true)], threshold: 1 })).meetsThreshold,
    ).toBe(false);
  });
});
