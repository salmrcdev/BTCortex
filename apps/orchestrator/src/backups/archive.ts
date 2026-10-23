import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { BackupKindSchema } from '@btcortex/contracts';
import type { BackupKind, BackupSummary, BackupVerification } from '@btcortex/contracts';

// BTCortex's backup format: a folder named BTCortex-backup-<time> holding
// manifest.json, README.txt and the items' files under items\. In an
// encrypted backup every file is AES-256-GCM (a fresh 12-byte nonce per file,
// the 16-byte tag after the ciphertext) under a key derived from the
// passphrase with scrypt. The manifest records, for each file, the SHA-256 of
// the bytes stored and of the original contents, so a backup can be checked
// without the passphrase and its contents with it. A short known text,
// encrypted with the same key, tells a wrong passphrase from damaged files.
// Paths in a manifest are checked before use, so a crafted backup cannot make
// BTCortex read outside its folder.

export const BACKUP_FORMAT = 'btcortex-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_FOLDER_PREFIX = 'BTCortex-backup-';
const MANIFEST = 'manifest.json';
const README = 'README.txt';
const CHECK_TEXT = 'BTCortex backup passphrase check';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** 2^17 rounds take about half a second and 128 MiB, which slows guessing down considerably. */
const SCRYPT_PARAMETERS = { N: 2 ** 17, r: 8, p: 1 };

const EncryptionSchema = z.object({
  cipher: z.literal('aes-256-gcm'),
  kdf: z.literal('scrypt'),
  N: z
    .number()
    .int()
    .min(2 ** 14)
    .max(2 ** 22),
  r: z.number().int().min(1).max(32),
  p: z.number().int().min(1).max(16),
  salt: z.string().regex(/^[0-9a-f]{32,128}$/),
  /** CHECK_TEXT encrypted with the key: nonce, ciphertext and tag, hex. */
  check: z.string().regex(/^[0-9a-f]+$/),
});
type Encryption = z.infer<typeof EncryptionSchema>;

const RELATIVE_PATH = /^items\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

const ManifestFileSchema = z.object({
  /** Relative to the backup folder, with forward slashes, under items/. */
  path: z
    .string()
    .regex(RELATIVE_PATH)
    .refine((path) => !path.split('/').includes('..')),
  /** The original file's name, for restoring by hand. */
  name: z.string().min(1).max(200),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  storedBytes: z.number().int().nonnegative(),
  storedSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const ManifestItemSchema = z.object({
  id: z.string().min(1).max(200),
  kind: BackupKindSchema,
  title: z.string(),
  component: z.string(),
  /** Item-specific facts needed to restore it, for example the node and wallet it came from. */
  source: z.record(z.string(), z.string()),
  files: z.array(ManifestFileSchema),
});

export const ManifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  appVersion: z.string(),
  createdAt: z.iso.datetime(),
  trigger: z.enum(['manual', 'scheduled']),
  encryption: EncryptionSchema.nullable(),
  items: z.array(ManifestItemSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestItem = z.infer<typeof ManifestItemSchema>;

export interface BackupItemData {
  id: string;
  kind: BackupKind;
  title: string;
  component: string;
  source: Record<string, string>;
  files: { name: string; contents: Uint8Array }[];
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('The passphrase is not the one this backup was made with.');
    this.name = 'WrongPassphraseError';
  }
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function deriveKeyWith(passphrase: string, salt: Buffer, parameters: { N: number; r: number; p: number }) {
  // scrypt needs 128 * N * r bytes; allow that and a little more.
  const options: ScryptOptions = { ...parameters, maxmem: 129 * parameters.N * parameters.r };
  return new Promise<Buffer>((resolveKey, reject) => {
    scrypt(passphrase.normalize('NFC'), salt, KEY_BYTES, options, (error, key) => {
      if (error) reject(error);
      else resolveKey(key);
    });
  });
}

function encrypt(key: Buffer, plaintext: Uint8Array): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

/** Throws when the key is wrong or the bytes were changed (the tag does not match). */
function decrypt(key: Buffer, stored: Uint8Array): Buffer {
  if (stored.length < NONCE_BYTES + TAG_BYTES) throw new BackupFormatError('An encrypted file is too short.');
  const buffer = Buffer.from(stored);
  const nonce = buffer.subarray(0, NONCE_BYTES);
  const tag = buffer.subarray(buffer.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer.subarray(NONCE_BYTES, buffer.length - TAG_BYTES)), decipher.final()]);
}

/** The key of an encrypted backup, after checking that the passphrase is the right one. */
export async function unlockBackup(manifest: Manifest, passphrase: string): Promise<Buffer> {
  const encryption = manifest.encryption;
  if (!encryption) throw new BackupFormatError('This backup is not encrypted.');
  const key = await deriveKeyWith(passphrase, Buffer.from(encryption.salt, 'hex'), encryption);
  let check: string;
  try {
    check = decrypt(key, Buffer.from(encryption.check, 'hex')).toString('utf8');
  } catch {
    throw new WrongPassphraseError();
  }
  if (check !== CHECK_TEXT) throw new WrongPassphraseError();
  return key;
}

function safeSegment(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return (cleaned === '' ? 'item' : cleaned).slice(0, 80);
}

/** Writes a file and flushes it to disk, failing if it already exists. */
async function writeNew(path: string, contents: Uint8Array | string): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function folderName(createdAt: Date): string {
  return `${BACKUP_FOLDER_PREFIX}${createdAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}`;
}

export interface WriteBackupOptions {
  destination: string;
  items: readonly BackupItemData[];
  /** Encrypts every file; required for items that hold keys or credentials. */
  passphrase?: string;
  appVersion: string;
  trigger: 'manual' | 'scheduled';
  readme: string;
  now: Date;
}

/** Writes a complete backup into a new folder in `destination` and returns its path. */
export async function writeBackup(options: WriteBackupOptions): Promise<{ path: string; manifest: Manifest }> {
  await mkdir(options.destination, { recursive: true });
  let name = folderName(options.now);
  for (let suffix = 2; existsSync(join(options.destination, name)); suffix += 1) {
    name = `${folderName(options.now)}-${String(suffix)}`;
  }
  const final = join(options.destination, name);
  const partial = `${final}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });

  let key: Buffer | undefined;
  let encryption: Encryption | null = null;
  if (options.passphrase !== undefined) {
    const salt = randomBytes(16);
    key = await deriveKeyWith(options.passphrase, salt, SCRYPT_PARAMETERS);
    encryption = {
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      ...SCRYPT_PARAMETERS,
      salt: salt.toString('hex'),
      check: encrypt(key, Buffer.from(CHECK_TEXT, 'utf8')).toString('hex'),
    };
  }

  try {
    const items: ManifestItem[] = [];
    for (const [index, item] of options.items.entries()) {
      const folder = `items/${String(index + 1).padStart(2, '0')}-${safeSegment(item.id)}`;
      await mkdir(join(partial, ...folder.split('/')), { recursive: true });
      const files = [];
      for (const file of item.files) {
        const stored = key ? encrypt(key, file.contents) : Buffer.from(file.contents);
        const path = `${folder}/${safeSegment(file.name)}${key ? '.enc' : ''}`;
        await writeNew(join(partial, ...path.split('/')), stored);
        files.push({
          path,
          name: file.name,
          bytes: file.contents.length,
          sha256: sha256(file.contents),
          storedBytes: stored.length,
          storedSha256: sha256(stored),
        });
      }
      items.push({
        id: item.id,
        kind: item.kind,
        title: item.title,
        component: item.component,
        source: item.source,
        files,
      });
    }
    const manifest: Manifest = ManifestSchema.parse({
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: options.appVersion,
      createdAt: options.now.toISOString(),
      trigger: options.trigger,
      encryption,
      items,
    });
    await writeNew(join(partial, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeNew(join(partial, README), options.readme);
    await rename(partial, final);
    return { path: final, manifest };
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}

export async function readManifest(path: string): Promise<Manifest> {
  let text: string;
  try {
    text = await readFile(join(path, MANIFEST), 'utf8');
  } catch {
    throw new BackupFormatError('This folder is not a BTCortex backup: it has no manifest.json.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupFormatError('The backup’s manifest.json is damaged.');
  }
  const format = (parsed as { format?: unknown; formatVersion?: unknown } | null) ?? {};
  if (format.format === BACKUP_FORMAT && format.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `This backup was made by a BTCortex with backup format ${String(format.formatVersion)}, which this version does not read.`,
    );
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) throw new BackupFormatError('This folder is not a BTCortex backup BTCortex can read.');
  return result.data;
}

/** The absolute path of a file in a backup, refusing anything outside its folder. */
function fileIn(backup: string, relative: string): string {
  const root = resolve(backup);
  const target = resolve(root, ...relative.split('/'));
  if (!target.startsWith(`${root}${sep}`)) throw new BackupFormatError('The manifest names a file outside the backup.');
  return target;
}

/** One file's original contents, checked against the manifest. */
export async function readBackupFile(
  backup: string,
  file: Manifest['items'][number]['files'][number],
  key: Buffer | undefined,
): Promise<Buffer> {
  const stored = await readFile(fileIn(backup, file.path));
  if (sha256(stored) !== file.storedSha256) throw new BackupFormatError(`${file.name} was changed or damaged.`);
  const contents = key ? decrypt(key, stored) : stored;
  if (sha256(contents) !== file.sha256) throw new BackupFormatError(`${file.name} does not match its record.`);
  return contents;
}

/** Checks every file against the manifest; with the passphrase, decrypts and checks the contents too. */
export async function verifyBackup(path: string, passphrase?: string): Promise<BackupVerification> {
  const manifest = await readManifest(path);
  let key: Buffer | undefined;
  if (manifest.encryption && passphrase !== undefined) key = await unlockBackup(manifest, passphrase);
  const problems: string[] = [];
  let checkedFiles = 0;
  for (const item of manifest.items) {
    for (const file of item.files) {
      checkedFiles += 1;
      try {
        const stored = await readFile(fileIn(path, file.path));
        if (stored.length !== file.storedBytes || sha256(stored) !== file.storedSha256) {
          problems.push(`${item.title}: ${file.name} was changed or damaged.`);
          continue;
        }
        const contents = key ? decrypt(key, stored) : manifest.encryption === null ? stored : undefined;
        if (contents !== undefined && sha256(contents) !== file.sha256) {
          problems.push(`${item.title}: ${file.name} does not match its record.`);
        }
      } catch (error) {
        problems.push(
          `${item.title}: ${file.name} ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'is missing' : 'could not be read'}.`,
        );
      }
    }
  }
  return {
    ok: problems.length === 0,
    checkedFiles,
    decrypted: manifest.encryption === null || key !== undefined,
    problems,
  };
}

export function summarise(path: string, manifest: Manifest): BackupSummary {
  return {
    path,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    encrypted: manifest.encryption !== null,
    trigger: manifest.trigger,
    bytes: manifest.items.reduce(
      (sum, item) => sum + item.files.reduce((total, file) => total + file.storedBytes, 0),
      0,
    ),
    items: manifest.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      component: item.component,
      files: item.files.length,
    })),
  };
}

/** BTCortex backups in a folder, newest first; other folders are ignored. */
export async function listBackups(destination: string): Promise<{ path: string; manifest: Manifest }[]> {
  if (!existsSync(destination)) return [];
  const found: { path: string; manifest: Manifest }[] = [];
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(BACKUP_FOLDER_PREFIX) || entry.name.endsWith('.partial'))
      continue;
    const path = join(destination, entry.name);
    try {
      found.push({ path, manifest: await readManifest(path) });
    } catch {
      // Not readable as a backup: never counted, never deleted.
    }
  }
  return found.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

/** Items whose last copy is never deleted by retention: without them, funds or channels can be lost. */
const IRREPLACEABLE_KINDS: ReadonlySet<BackupKind> = new Set(['wallet', 'channel', 'credentials']);

/**
 * Deletes the oldest BTCortex backups beyond `keep`, except one that holds the
 * newest copy of a wallet, a channel backup or the credentials that no newer
 * backup holds: automatic backups without a passphrase leave wallets out, and
 * a run of them must never push the only wallet copy away. Returns what was
 * deleted.
 */
export async function applyRetention(destination: string, keep: number): Promise<string[]> {
  const backups = await listBackups(destination);
  const removed: string[] = [];
  const heldByNewer = new Set<string>();
  for (const [position, backup] of backups.entries()) {
    const irreplaceable = backup.manifest.items
      .filter((item) => IRREPLACEABLE_KINDS.has(item.kind))
      .map((item) => item.id);
    const lastCopy = irreplaceable.some((id) => !heldByNewer.has(id));
    for (const id of irreplaceable) heldByNewer.add(id);
    if (position < keep || lastCopy) continue;
    // Only a folder directly in the destination whose manifest BTCortex wrote.
    if (dirname(resolve(backup.path)) !== resolve(destination)) continue;
    await rm(backup.path, { recursive: true, force: true });
    removed.push(backup.path);
  }
  return removed;
}
