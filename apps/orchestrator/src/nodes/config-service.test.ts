import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { secretPlaceholder } from '@btcortex/bitcoin-config';
import type { NodeProfile, NodeSnapshot, NodeWithStatus } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { NodeConfigService } from './config-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');
const ORIGINAL = [
  '# Managed by BTCortex',
  'chain=regtest',
  'dbcache=450',
  'rpcauth=alice:5f1a$9c0d',
  '[regtest]',
  'rpcport=18543',
  '',
].join('\n');

let directory: string;
let node: NodeWithStatus;
let applied: string | undefined;
let service: NodeConfigService;

function profile(overrides: Partial<NodeProfile> = {}): NodeProfile {
  return {
    id: 'node-1',
    name: 'Test node',
    implementation: 'bitcoin-core',
    network: 'regtest',
    execution: 'managed',
    runtimeVersion: '31.1',
    dataDirectory: directory,
    rpcEndpoint: 'http://127.0.0.1:18543',
    authentication: { kind: 'cookie', cookieFile: join(directory, 'regtest', '.cookie') },
    keepRunningOnExit: false,
    startWithBtcortex: false,
    createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  };
}

function running(startedSecondsAgo: number): NodeWithStatus['status'] {
  const snapshot = { takenAt: new Date().toISOString(), uptimeSeconds: startedSecondsAgo } as NodeSnapshot;
  return { nodeId: 'node-1', state: 'running', checkedAt: snapshot.takenAt, snapshot };
}

const configPath = () => join(directory, 'bitcoin.conf');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'btcortex-config-'));
  writeFileSync(configPath(), ORIGINAL);
  node = { profile: profile(), status: { nodeId: 'node-1', state: 'stopped', checkedAt: new Date().toISOString() } };
  applied = undefined;
  service = new NodeConfigService({
    nodes: { get: () => node, appliedConfig: () => applied },
    logger,
    totalMemoryBytes: 16 * 1024 ** 3,
  });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('NodeConfigService', () => {
  it('reads the file with secrets hidden and lists the command-line options', async () => {
    const document = await service.get('node-1');
    expect(document).toMatchObject({ path: configPath(), exists: true, editable: true, restartRequired: false });
    expect(document.text).toContain(`rpcauth=alice:${secretPlaceholder(1)}`);
    expect(document.text).not.toContain('9c0d');
    expect(document.commandLine.map((option) => option.key)).toEqual([
      'datadir',
      'chain',
      'server',
      'printtoconsole',
      'pid',
    ]);
  });

  it('saves a valid change, keeps hidden values and a backup', async () => {
    const document = await service.get('node-1');
    const result = await service.save('node-1', {
      text: document.text.replace('dbcache=450', 'dbcache=1024'),
      revision: document.revision,
      acceptedRisks: [],
    });
    expect(result.changedKeys).toEqual(['dbcache']);
    expect(result.restartRequired).toBe(false);
    const written = readFileSync(configPath(), 'utf8');
    expect(written).toBe(ORIGINAL.replace('dbcache=450', 'dbcache=1024'));
    expect(result.backup).not.toBeNull();
    expect(readFileSync(result.backup ?? '', 'utf8')).toBe(ORIGINAL);
    expect((await service.get('node-1')).revision).toBe(result.revision);
  });

  it('refuses to overwrite changes made elsewhere since the file was read', async () => {
    const document = await service.get('node-1');
    writeFileSync(configPath(), `${ORIGINAL}maxconnections=20\n`);
    await expect(
      service.save('node-1', { text: document.text, revision: document.revision, acceptedRisks: [] }),
    ).rejects.toMatchObject({ error: { code: 'config.changed-on-disk' } });
  });

  it('refuses errors and changes to the settings BTCortex relies on', async () => {
    const document = await service.get('node-1');
    await expect(
      service.save('node-1', {
        text: document.text.replace('chain=regtest', 'chain=main').replace('dbcache=450', 'prune=100'),
        revision: document.revision,
        acceptedRisks: [],
      }),
    ).rejects.toMatchObject({
      error: {
        code: 'config.invalid',
        details: {
          problems: [
            expect.stringContaining('prune target'),
            expect.stringContaining('"chain" is managed by BTCortex'),
          ],
        },
      },
    });
    expect(readFileSync(configPath(), 'utf8')).toBe(ORIGINAL);
  });

  it('needs explicit confirmation for settings that expose the node', async () => {
    // Managed nodes start with listen=0; removing it turns listening back on, as setting it to 1 does.
    writeFileSync(configPath(), `${ORIGINAL}listen=0\n`);
    const document = await service.get('node-1');
    const request = { text: document.text.replace('listen=0\n', ''), revision: document.revision };
    await expect(service.save('node-1', { ...request, acceptedRisks: [] })).rejects.toMatchObject({
      error: { code: 'config.confirmation-required', details: { keys: ['listen'] } },
    });
    await expect(service.save('node-1', { ...request, acceptedRisks: ['listen'] })).resolves.toMatchObject({
      changedKeys: ['listen'],
    });
  });

  it('refuses to save a secret anywhere masking would not have put it', async () => {
    writeFileSync(configPath(), `${ORIGINAL}torpassword=hunter2\n`);
    const document = await service.get('node-1');
    const placeholder = /torpassword=(\[hidden value \d+\])/.exec(document.text)?.[1] ?? '';
    await expect(
      service.save('node-1', {
        text: `${document.text}# copy: torpassword ${placeholder} again\n`,
        revision: document.revision,
        acceptedRisks: [],
      }),
    ).rejects.toMatchObject({ error: { code: 'config.invalid' } });
    expect(readFileSync(configPath(), 'utf8')).not.toContain('copy');
  });

  it('shows a file that is not UTF-8 read-only instead of changing its bytes', async () => {
    writeFileSync(configPath(), Buffer.from('# perch\xe9\nchain=regtest\n', 'latin1'));
    const document = await service.get('node-1');
    expect(document).toMatchObject({ editable: false, readOnlyReason: expect.stringContaining('UTF-8') as string });
    await expect(
      service.save('node-1', { text: 'chain=regtest\n', revision: document.revision, acceptedRisks: [] }),
    ).rejects.toMatchObject({ error: { code: 'config.read-only' } });
  });

  it('saves one change at a time, so a second save from the same revision is refused', async () => {
    const document = await service.get('node-1');
    const save = (value: string) =>
      service.save('node-1', {
        text: document.text.replace('dbcache=450', `dbcache=${value}`),
        revision: document.revision,
        acceptedRisks: [],
      });
    const [first, second] = await Promise.allSettled([save('600'), save('700')]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: { error: { code: 'config.changed-on-disk' } } });
    expect(readFileSync(configPath(), 'utf8')).toContain('dbcache=600');
    expect(readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('uses revisions that say nothing about the file’s contents', async () => {
    const { createHash } = await import('node:crypto');
    const document = await service.get('node-1');
    expect(document.revision).not.toBe(createHash('sha256').update(ORIGINAL).digest('hex').slice(0, 32));
    expect((await service.get('node-1')).revision).toBe(document.revision);
  });

  it('tells whether the running node uses the settings in the file', async () => {
    node = { ...node, status: running(60) };
    applied = ORIGINAL;
    expect((await service.get('node-1')).restartRequired).toBe(false);

    const document = await service.get('node-1');
    const commentOnly = await service.save('node-1', {
      text: `# A note\n${document.text}`,
      revision: document.revision,
      acceptedRisks: [],
    });
    expect(commentOnly).toMatchObject({ changedKeys: [], restartRequired: false });

    const changed = await service.save('node-1', {
      text: (await service.get('node-1')).text.replace('dbcache=450', 'dbcache=800'),
      revision: commentOnly.revision,
      acceptedRisks: [],
    });
    expect(changed.restartRequired).toBe(true);
    expect((await service.get('node-1')).restartRequired).toBe(true);

    // A node started outside this session: the file's modification time decides.
    applied = undefined;
    node = { ...node, status: running(3_600) };
    expect((await service.get('node-1')).restartRequired).toBe(true);
  });

  it('never quotes a hidden value, even in its error messages', async () => {
    writeFileSync(configPath(), `${ORIGINAL}torpassword hunter2\n`);
    const document = await service.get('node-1');
    expect(document.text).not.toContain('hunter2');
    const failure: unknown = await service
      .save('node-1', { text: document.text, revision: document.revision, acceptedRisks: [] })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ error: { code: 'config.invalid' } });
    expect(JSON.stringify((failure as { error: unknown }).error)).not.toContain('hunter2');
  });

  it('keeps only the newest ten backups', async () => {
    let now = Date.parse('2026-10-21T10:00:00Z');
    service = new NodeConfigService({
      nodes: { get: () => node, appliedConfig: () => applied },
      logger,
      now: () => new Date((now += 1_000)),
    });
    for (let index = 0; index < 12; index += 1) {
      const document = await service.get('node-1');
      await service.save('node-1', {
        text: document.text.replace(/dbcache=\d+/, `dbcache=${String(500 + index)}`),
        revision: document.revision,
        acceptedRisks: [],
      });
    }
    expect(readdirSync(directory).filter((name) => name.endsWith('.bak'))).toHaveLength(10);
  });

  it('shows an existing node’s configuration read-only and never writes it', async () => {
    node = {
      ...node,
      profile: profile({ execution: 'external', dataDirectory: null, runtimeVersion: null }),
    };
    const document = await service.get('node-1');
    expect(document).toMatchObject({ path: configPath(), editable: false, commandLine: [] });
    expect(document.readOnlyReason).toContain('did not set up');
    await expect(
      service.save('node-1', { text: '', revision: document.revision, acceptedRisks: [] }),
    ).rejects.toMatchObject({ error: { code: 'config.read-only' } });
    expect(readFileSync(configPath(), 'utf8')).toBe(ORIGINAL);
  });

  it('keeps earlier versions, shows them without secrets, and restores one through the usual checks', async () => {
    service = new NodeConfigService({
      nodes: { get: () => node, appliedConfig: () => applied },
      logger,
      now: () => new Date('2026-10-23T12:34:56.789Z'),
    });
    expect((await service.history('node-1')).versions).toEqual([]);
    const document = await service.get('node-1');
    await service.save('node-1', {
      text: document.text.replace('dbcache=450', 'dbcache=800'),
      revision: document.revision,
      acceptedRisks: [],
    });
    const history = await service.history('node-1');
    expect(history.kept).toBe(10);
    expect(history.versions).toHaveLength(1);
    const kept = history.versions[0];
    expect(kept).toMatchObject({ replacedAt: '2026-10-23T12:34:56.789Z', bytes: Buffer.byteLength(ORIGINAL) });
    const detail = await service.version('node-1', kept?.id ?? '');
    expect(detail.text).toContain(`rpcauth=alice:${secretPlaceholder(1)}`);
    expect(detail.text).not.toContain('9c0d');
    expect(detail.changes).toEqual([{ key: 'dbcache', current: ['800'], version: ['450'], secret: false }]);
    expect(detail.risky).toEqual([]);

    const current = await service.get('node-1');
    const restored = await service.restore('node-1', kept?.id ?? '', current.revision, []);
    expect(restored.changedKeys).toEqual(['dbcache']);
    expect(readFileSync(configPath(), 'utf8')).toBe(ORIGINAL);
    // The file that was replaced is kept too, so the restore can be undone.
    expect((await service.history('node-1')).versions).toHaveLength(2);
  });

  it('never gives out the value of a secret option, and restores no version that moves what BTCortex relies on', async () => {
    const name = 'bitcoin.conf.btcortex-2026-10-22T08-00-00-000Z-0a1b2c3d.bak';
    writeFileSync(join(directory, name), ORIGINAL.replace('rpcauth=alice:5f1a$9c0d', 'rpcauth=bob:77aa$ffee'));
    const detail = await service.version('node-1', name);
    expect(detail.replacedAt).toBe('2026-10-22T08:00:00.000Z');
    expect(detail.changes).toEqual([{ key: 'rpcauth', current: null, version: null, secret: true }]);
    expect(JSON.stringify(detail)).not.toContain('ffee');
    // A version that would move the RPC port BTCortex uses is refused, as a save would be.
    const moved = 'bitcoin.conf.btcortex-2026-10-22T09-00-00-000Z-0a1b2c3e.bak';
    writeFileSync(join(directory, moved), ORIGINAL.replace('rpcport=18543', 'rpcport=18999'));
    const current = await service.get('node-1');
    await expect(service.restore('node-1', moved, current.revision, [])).rejects.toMatchObject({
      error: { code: 'config.invalid' },
    });
    expect(readFileSync(configPath(), 'utf8')).toBe(ORIGINAL);
  });

  it('exports a copy with every secret hidden, never as a usable bitcoin.conf', async () => {
    const target = join(directory, 'node-settings.conf');
    await service.export('node-1', target);
    const copy = readFileSync(target, 'utf8');
    expect(copy).toMatch(/^# bitcoin\.conf of "Test node" \(regtest\), exported by BTCortex on \d{4}-\d{2}-\d{2}\./);
    expect(copy).toContain(`rpcauth=alice:${secretPlaceholder(1)}`);
    expect(copy).not.toContain('9c0d');
    expect(copy).toContain('dbcache=450');
    await expect(service.export('node-1', join(directory, 'copy', 'bitcoin.conf'))).rejects.toMatchObject({
      error: { code: 'config.export-refused' },
    });
    await expect(service.export('node-1', join(directory, 'copy.json'))).rejects.toMatchObject({
      error: { code: 'config.export-refused' },
    });
  });

  it('opens only the versions it kept', async () => {
    await expect(service.version('node-1', '..\\bitcoin.conf')).rejects.toMatchObject({
      error: { code: 'config.version-not-found' },
    });
    await expect(
      service.version('node-1', 'bitcoin.conf.btcortex-2026-10-22T08-00-00-000Z-ffffffff.bak'),
    ).rejects.toMatchObject({
      error: { code: 'config.version-not-found', message: expect.stringContaining('ten most recent') as unknown },
    });
  });
});
