import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyRetention,
  BackupFormatError,
  listBackups,
  readBackupFile,
  readManifest,
  unlockBackup,
  verifyBackup,
  WrongPassphraseError,
  writeBackup,
} from './archive';
import type { BackupItemData } from './archive';

let destination: string;

beforeEach(() => {
  destination = mkdtempSync(join(tmpdir(), 'btcortex-archive-'));
});

afterEach(() => {
  rmSync(destination, { recursive: true, force: true });
});

const WALLET = Buffer.from('wallet bytes with private keys');
const items: BackupItemData[] = [
  {
    id: 'node.n1.config',
    kind: 'configuration',
    title: 'bitcoin.conf',
    component: 'Main node',
    source: { nodeId: 'n1' },
    files: [{ name: 'bitcoin.conf', contents: Buffer.from('chain=main\nprune=550\n') }],
  },
  {
    id: 'node.n1.wallet.',
    kind: 'wallet',
    title: 'Default wallet',
    component: 'Main node',
    source: { nodeId: 'n1', wallet: '' },
    files: [{ name: 'wallet.dat', contents: WALLET }],
  },
];

const write = (passphrase?: string, at = '2026-10-23T08:00:00.000Z') =>
  writeBackup({
    destination,
    items,
    ...(passphrase === undefined ? {} : { passphrase }),
    appVersion: '0.1.0',
    trigger: 'manual',
    readme: 'README',
    now: new Date(at),
  });

describe('BTCortex backups', () => {
  it('are folders with a manifest that checks every file', async () => {
    const { path, manifest } = await write();
    expect(path).toBe(join(destination, 'BTCortex-backup-20261023T080000Z'));
    expect(manifest.encryption).toBeNull();
    expect(manifest.items.map((item) => item.id)).toEqual(['node.n1.config', 'node.n1.wallet.']);
    expect(readFileSync(join(path, 'README.txt'), 'utf8')).toBe('README');
    expect(await verifyBackup(path)).toEqual({ ok: true, checkedFiles: 2, decrypted: true, problems: [] });
    expect(readdirSync(destination)).toEqual(['BTCortex-backup-20261023T080000Z']);
  });

  it('notice a changed or missing file', async () => {
    const { path, manifest } = await write();
    const [config, wallet] = manifest.items.flatMap((item) => item.files);
    writeFileSync(join(path, ...(config?.path ?? '').split('/')), 'chain=test\n');
    rmSync(join(path, ...(wallet?.path ?? '').split('/')));
    const result = await verifyBackup(path);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      'bitcoin.conf: bitcoin.conf was changed or damaged.',
      'Default wallet: wallet.dat is missing.',
    ]);
  });

  it('encrypt every file when given a passphrase, and are read back only with it', async () => {
    const passphrase = 'correct horse battery staple';
    const { path, manifest } = await write(passphrase);
    expect(manifest.encryption).toMatchObject({ cipher: 'aes-256-gcm', kdf: 'scrypt', N: 2 ** 17 });
    const walletFile = manifest.items[1]?.files[0];
    if (!walletFile) throw new Error('Expected the wallet file.');
    expect(walletFile.path.endsWith('.enc')).toBe(true);
    const stored = readFileSync(join(path, ...walletFile.path.split('/')));
    expect(stored.includes(WALLET)).toBe(false);

    expect(await verifyBackup(path)).toMatchObject({ ok: true, decrypted: false });
    expect(await verifyBackup(path, passphrase)).toMatchObject({ ok: true, decrypted: true });
    const key = await unlockBackup(manifest, passphrase);
    expect(await readBackupFile(path, walletFile, key)).toEqual(WALLET);
    await expect(unlockBackup(manifest, 'not the passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('refuse a manifest that points outside the backup', async () => {
    const { path, manifest } = await write();
    const crafted = {
      ...manifest,
      items: [{ ...manifest.items[0], files: [{ ...manifest.items[0]?.files[0], path: 'items/../../secret.txt' }] }],
    };
    writeFileSync(join(path, 'manifest.json'), JSON.stringify(crafted));
    await expect(readManifest(path)).rejects.toBeInstanceOf(BackupFormatError);
    writeFileSync(join(path, 'manifest.json'), '{ not json');
    await expect(readManifest(path)).rejects.toThrow(/damaged/);
  });

  it('keep the newest backups and never touch other folders', async () => {
    await write(undefined, '2026-10-20T08:00:00.000Z');
    await write(undefined, '2026-10-21T08:00:00.000Z');
    const { path: newest } = await write(undefined, '2026-10-22T08:00:00.000Z');
    mkdirSync(join(destination, 'BTCortex-backup-not-a-backup'));
    mkdirSync(join(destination, 'Holiday photos'));
    const removed = await applyRetention(destination, 2);
    expect(removed).toEqual([join(destination, 'BTCortex-backup-20261020T080000Z')]);
    expect((await listBackups(destination)).map((backup) => backup.path)).toEqual([
      newest,
      join(destination, 'BTCortex-backup-20261021T080000Z'),
    ]);
    expect(existsSync(join(destination, 'BTCortex-backup-not-a-backup'))).toBe(true);
    expect(existsSync(join(destination, 'Holiday photos'))).toBe(true);
  });

  it('never delete the last copy of a wallet, however many backups without it follow', async () => {
    const { path: withWallet } = await write(undefined, '2026-10-20T08:00:00.000Z');
    const configurationOnly = (at: string) =>
      writeBackup({
        destination,
        items: items.filter((item) => item.kind === 'configuration'),
        appVersion: '0.1.0',
        trigger: 'scheduled',
        readme: 'README',
        now: new Date(at),
      });
    const { path: second } = await configurationOnly('2026-10-21T08:00:00.000Z');
    await configurationOnly('2026-10-22T08:00:00.000Z');
    await configurationOnly('2026-10-23T08:00:00.000Z');
    const removed = await applyRetention(destination, 2);
    // The second backup is beyond the limit and holds nothing that newer ones lack; the first holds the only wallet.
    expect(removed).toEqual([second]);
    expect(existsSync(withWallet)).toBe(true);
    // Once a newer backup holds the wallet too, the old copy can go.
    const { path: newest } = await write(undefined, '2026-10-24T08:00:00.000Z');
    expect(await applyRetention(destination, 2)).toEqual([
      join(destination, 'BTCortex-backup-20261022T080000Z'),
      withWallet,
    ]);
    expect(existsSync(newest)).toBe(true);
  });

  it('never leave a half-written backup behind', async () => {
    await expect(
      writeBackup({
        destination,
        items: [
          {
            ...items[0],
            id: 'x',
            kind: 'configuration',
            title: 'x',
            component: 'x',
            source: {},
            // Two files with the same name: the second write fails.
            files: [
              { name: 'same', contents: Buffer.from('a') },
              { name: 'same', contents: Buffer.from('b') },
            ],
          },
        ],
        appVersion: '0.1.0',
        trigger: 'manual',
        readme: 'README',
        now: new Date('2026-10-23T09:00:00.000Z'),
      }),
    ).rejects.toThrow();
    expect(readdirSync(destination)).toEqual([]);
  });
});
