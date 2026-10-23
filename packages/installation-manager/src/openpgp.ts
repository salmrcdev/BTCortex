import * as openpgp from 'openpgp';

// Verifies detached OpenPGP signatures against pinned keys without GnuPG. A
// signature file may hold several armoured signatures (Bitcoin Core's
// SHA256SUMS.asc has one per builder), or a publisher may sign in separate,
// often binary, files (LND has one per release signer); signers are counted
// once per primary key, so one person with several key files, signature files
// or subkeys is never double-counted. Keys whose fingerprint differs from the
// pinned one are ignored, so a swapped key file cannot introduce a new trust
// anchor.

export interface TrustedKey {
  /** Who the key belongs to, for reports. */
  readonly name: string;
  readonly armored: string;
  /** Pinned primary fingerprints (upper-case hex); keys outside this list are ignored. */
  readonly fingerprints: readonly string[];
  /**
   * The publisher still signs with a DSA key, which OpenPGP.js rejects by
   * default (Fulcrum's author does). Accepted for this pinned key only, and
   * only at 2048 bits or more.
   */
  readonly allowDsa?: boolean;
}

export type SignatureStatus = 'valid' | 'invalid' | 'unknown-key' | 'unparseable';

export interface SignatureResult {
  status: SignatureStatus;
  signingKeyIds: string[];
  signer?: string;
  fingerprint?: string;
  createdAt?: string;
  reason?: string;
}

export interface SignatureReport {
  results: SignatureResult[];
  validSigners: { signer: string; fingerprint: string }[];
  /** The people among the valid signers: what the threshold counts. */
  signerCount: number;
  threshold: number;
  meetsThreshold: boolean;
}

interface KeyringEntry {
  name: string;
  key: openpgp.PublicKey;
  /** Options for verifying with this key: the library's defaults, or DSA allowed for a pinned DSA key. */
  config?: Partial<openpgp.Config>;
}

interface Keyring {
  entries: KeyringEntry[];
  /** The person behind each signer name, for counting people rather than names. */
  personOf: Map<string, string>;
}

const MIN_DSA_BITS = 2048;

const keyringCache = new WeakMap<readonly TrustedKey[], Promise<Keyring>>();

/** The e-mail addresses in a key's user IDs, lower-cased. */
function emailsOf(key: openpgp.PublicKey): string[] {
  return key
    .getUserIDs()
    .map((userId) => /<([^<>\s]+@[^<>\s]+)>/.exec(userId)?.[1]?.toLowerCase())
    .filter((email) => email !== undefined);
}

/**
 * One person can be pinned under several names: the same key in two files
 * (TheCharlatan and sedited in bitcoin-core/guix.sigs), or two keys with the
 * same e-mail address (bigshiny90 and shiny in bitcoinknots/guix.sigs). Names
 * that share a key or an address are one person, named after the first.
 */
function groupPeople(entries: readonly KeyringEntry[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (name: string): string => {
    let root = name;
    for (let next = parent.get(root); next !== undefined && next !== root; next = parent.get(root)) root = next;
    parent.set(name, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const [first, second] = [find(a), find(b)].sort();
    if (first !== undefined && second !== undefined && first !== second) parent.set(second, first);
  };
  const owners = new Map<string, string>();
  for (const { name, key } of entries) {
    if (!parent.has(name)) parent.set(name, name);
    for (const mark of [
      `key:${key.getFingerprint().toUpperCase()}`,
      ...emailsOf(key).map((email) => `mail:${email}`),
    ]) {
      const owner = owners.get(mark);
      if (owner === undefined) owners.set(mark, name);
      else union(owner, name);
    }
  }
  return new Map([...parent.keys()].map((name) => [name, find(name)]));
}

function loadKeyring(keys: readonly TrustedKey[]): Promise<Keyring> {
  let cached = keyringCache.get(keys);
  if (!cached) {
    cached = (async () => {
      const entries: KeyringEntry[] = [];
      for (const trusted of keys) {
        const pinned = new Set(trusted.fingerprints.map((fingerprint) => fingerprint.toUpperCase()));
        try {
          for (const key of await openpgp.readKeys({ armoredKeys: trusted.armored })) {
            if (!pinned.has(key.getFingerprint().toUpperCase())) continue;
            const { algorithm, bits } = key.getAlgorithmInfo();
            if (algorithm === 'dsa') {
              if (trusted.allowDsa !== true || (bits ?? 0) < MIN_DSA_BITS) continue;
              entries.push({
                name: trusted.name,
                key,
                config: { rejectPublicKeyAlgorithms: new Set([openpgp.enums.publicKey.elgamal]) },
              });
            } else {
              entries.push({ name: trusted.name, key });
            }
          }
        } catch {
          // A key the library cannot load can never produce a valid signature; skip it.
        }
      }
      return { entries, personOf: groupPeople(entries) };
    })();
    keyringCache.set(keys, cached);
  }
  return cached;
}

/**
 * People, not keys or names, count towards a threshold: a builder who signs
 * with two keys, or is pinned under two names, counts once.
 */
function distinctSigners(validSigners: Map<string, string>, personOf: Map<string, string>): number {
  return new Set([...validSigners.values()].map((name) => personOf.get(name) ?? name)).size;
}

const SIGNATURE_BLOCK = /-----BEGIN PGP SIGNATURE-----[\s\S]*?-----END PGP SIGNATURE-----/g;

export function splitArmouredSignatures(text: string): string[] {
  return text.match(SIGNATURE_BLOCK) ?? [];
}

/** One signature per packet, so that every signature in a file is checked, and counted, on its own. */
function eachSignature(signature: openpgp.Signature): openpgp.Signature[] {
  return signature.packets.map((packet) => {
    const packets = new openpgp.PacketList<openpgp.SignaturePacket>();
    packets.push(packet);
    return new openpgp.Signature(packets);
  });
}

/**
 * The signatures to check, each on its own: the armoured blocks in a text, or
 * the signatures in each file, armoured or binary. What cannot be read is
 * returned as an error, to be reported.
 */
async function readSignatures(signatures: string | readonly Uint8Array[]): Promise<(openpgp.Signature | Error)[]> {
  const read = async (load: () => Promise<openpgp.Signature>) => {
    try {
      return eachSignature(await load());
    } catch (error) {
      return [error instanceof Error ? error : new Error(String(error))];
    }
  };
  const parsed: (openpgp.Signature | Error)[] = [];
  for (const file of typeof signatures === 'string' ? [signatures] : signatures) {
    const text = typeof file === 'string' ? file : new TextDecoder().decode(file);
    if (typeof file === 'string' || text.includes('-----BEGIN PGP SIGNATURE-----')) {
      for (const block of splitArmouredSignatures(text)) {
        parsed.push(...(await read(() => openpgp.readSignature({ armoredSignature: block }))));
      }
    } else {
      parsed.push(...(await read(() => openpgp.readSignature({ binarySignature: file }))));
    }
  }
  return parsed;
}

/**
 * A clear-signed checksum file (HWI's `SHA256SUMS.txt.asc`): only the signed
 * text is returned, so nothing outside the signature can be mistaken for part
 * of it.
 */
export async function verifyCleartextSignatures(
  armoredMessage: string,
  options: { keys: readonly TrustedKey[]; threshold: number },
): Promise<{ report: SignatureReport; text: string }> {
  const { entries: keyring, personOf } = await loadKeyring(options.keys);
  const results: SignatureResult[] = [];
  const validSigners = new Map<string, string>();
  const report = () => ({
    results,
    validSigners: [...validSigners].map(([fingerprint, signer]) => ({ signer, fingerprint })),
    signerCount: distinctSigners(validSigners, personOf),
    threshold: options.threshold,
    meetsThreshold: distinctSigners(validSigners, personOf) >= options.threshold,
  });

  let message: openpgp.CleartextMessage;
  try {
    message = await openpgp.readCleartextMessage({ cleartextMessage: armoredMessage });
  } catch (error) {
    results.push({
      status: 'unparseable',
      signingKeyIds: [],
      reason: error instanceof Error ? error.message : String(error),
    });
    return { report: report(), text: '' };
  }
  const keyIds = message.getSigningKeyIDs();
  const candidates = keyring.filter(({ key }) => keyIds.some((keyId) => key.getKeys(keyId).length > 0));
  if (candidates.length === 0) {
    results.push({ status: 'unknown-key', signingKeyIds: keyIds.map((keyId) => keyId.toHex().toUpperCase()) });
  }
  for (const candidate of candidates) {
    const verification = await openpgp.verify({
      message,
      verificationKeys: candidate.key,
      ...(candidate.config ? { config: candidate.config } : {}),
    });
    for (const signature of verification.signatures) {
      if (candidate.key.getKeys(signature.keyID).length === 0) continue;
      const signingKeyIds = [signature.keyID.toHex().toUpperCase()];
      try {
        await signature.verified;
        const packet = (await signature.signature).packets[0];
        const fingerprint = candidate.key.getFingerprint().toUpperCase();
        results.push({
          status: 'valid',
          signingKeyIds,
          signer: candidate.name,
          fingerprint,
          ...(packet?.created ? { createdAt: packet.created.toISOString() } : {}),
        });
        validSigners.set(fingerprint, candidate.name);
      } catch (error) {
        results.push({
          status: 'invalid',
          signingKeyIds,
          signer: candidate.name,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { report: report(), text: message.getText() };
}

/**
 * Checks detached signatures over `data`: a text of armoured signatures, or
 * signature files, each armoured or binary.
 */
export async function verifyDetachedSignatures(
  data: Uint8Array,
  signatures: string | readonly Uint8Array[],
  options: { keys: readonly TrustedKey[]; threshold: number },
): Promise<SignatureReport> {
  const { entries: keyring, personOf } = await loadKeyring(options.keys);
  const results: SignatureResult[] = [];
  const validSigners = new Map<string, string>();

  for (const signature of await readSignatures(signatures)) {
    if (signature instanceof Error) {
      results.push({ status: 'unparseable', signingKeyIds: [], reason: signature.message });
      continue;
    }
    const keyIds = signature.getSigningKeyIDs();
    const signingKeyIds = keyIds.map((keyId) => keyId.toHex().toUpperCase());
    const candidates = keyring.filter(({ key }) => keyIds.some((keyId) => key.getKeys(keyId).length > 0));
    if (candidates.length === 0) {
      results.push({ status: 'unknown-key', signingKeyIds });
      continue;
    }

    let verified: { signer: string; fingerprint: string; createdAt?: string } | undefined;
    let failure: string | undefined;
    for (const candidate of candidates) {
      try {
        const message = await openpgp.createMessage({ binary: data });
        const verification = await openpgp.verify({
          message,
          signature,
          verificationKeys: candidate.key,
          ...(candidate.config ? { config: candidate.config } : {}),
        });
        const [first] = verification.signatures;
        if (!first) throw new Error('The signature block contains no signature.');
        await first.verified;
        const packet = (await first.signature).packets[0];
        verified = {
          signer: candidate.name,
          fingerprint: candidate.key.getFingerprint().toUpperCase(),
          ...(packet?.created ? { createdAt: packet.created.toISOString() } : {}),
        };
        break;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }

    if (verified) {
      results.push({ status: 'valid', signingKeyIds, ...verified });
      validSigners.set(verified.fingerprint, verified.signer);
    } else {
      results.push({
        status: 'invalid',
        signingKeyIds,
        ...(candidates[0] ? { signer: candidates[0].name } : {}),
        ...(failure ? { reason: failure } : {}),
      });
    }
  }

  return {
    results,
    validSigners: [...validSigners].map(([fingerprint, signer]) => ({ signer, fingerprint })),
    signerCount: distinctSigners(validSigners, personOf),
    threshold: options.threshold,
    meetsThreshold: distinctSigners(validSigners, personOf) >= options.threshold,
  };
}
