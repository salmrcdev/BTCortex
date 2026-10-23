import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NodeWithStatus } from '@btcortex/contracts';
import { extractZip } from '@btcortex/installation-manager';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { LogService } from '../logs/log-service';
import { ensureAppDirectories, resolveAppPaths } from '../platform/paths';
import type { AppPaths } from '../platform/paths';
import { DiagnosticsService } from './diagnostics-service';
import { writeZip } from './zip-writer';

const TXID = 'a1'.repeat(32);
const logger = new StructuredLogger([new MemorySink()], 'debug');

let root: string;
let home: string;
let paths: AppPaths;
let revealed: string[];
let service: DiagnosticsService;
let now: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-diagnostics-'));
  home = join(root, 'Users', 'Satoshi');
  paths = resolveAppPaths({ BTCORTEX_DATA_DIR: join(home, 'AppData', 'Local', 'BTCortex') });
  ensureAppDirectories(paths);
  const nodeDirectory = join(paths.nodes, 'regtest-1');
  mkdirSync(join(nodeDirectory, 'regtest'), { recursive: true });
  writeFileSync(join(nodeDirectory, 'bitcoin.conf'), 'chain=regtest\nrpcauth=alice:5f1a$9c0d\ntorpassword=hunter2\n');
  writeFileSync(
    join(nodeDirectory, 'regtest', 'debug.log'),
    `2026-10-21T10:00:00Z Using data directory ${nodeDirectory}\n2026-10-21T10:00:01Z AddToWallet ${TXID}\n`,
  );
  writeFileSync(
    join(paths.logs, 'orchestrator.log'),
    `${JSON.stringify({
      time: '2026-10-21T10:00:00.000Z',
      level: 'info',
      component: 'orchestrator',
      message: 'Request with Bearer abcdefghijklmnop',
      context: { rpcPassword: 'hunter2', path: paths.root },
    })}\n`,
  );
  const node = {
    profile: {
      id: 'node-1234567890',
      name: 'Home node',
      execution: 'managed',
      network: 'regtest',
      dataDirectory: nodeDirectory,
      authentication: { kind: 'cookie', cookieFile: join(nodeDirectory, 'regtest', '.cookie') },
    },
    status: { nodeId: 'node-1234567890', state: 'stopped', checkedAt: '2026-10-21T10:00:00.000Z' },
  } as NodeWithStatus;
  const nodes = { list: () => [node] };
  revealed = [];
  now = Date.parse('2026-10-21T12:00:00Z');
  service = new DiagnosticsService({
    paths,
    nodes,
    jobs: { list: () => [] },
    logs: new LogService({ paths, nodes }),
    version: '0.1.0',
    logger,
    homeDirectory: home,
    now: () => new Date((now += 1_000)),
    reveal: (path) => revealed.push(path),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function unpack(path: string): Promise<{ folder: string; read: (name: string) => string }> {
  const destination = join(root, 'unpacked');
  rmSync(destination, { recursive: true, force: true });
  const folder =
    path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.zip$/, '') ?? '';
  await extractZip(path, destination, { expectedRoot: folder, maxTotalBytes: 50 * 1024 * 1024 });
  return { folder, read: (name) => readFileSync(join(destination, folder, name), 'utf8') };
}

describe('writeZip', () => {
  it('writes an archive the safe extractor accepts', async () => {
    const archive = join(root, 'test.zip');
    writeFileSync(
      archive,
      writeZip([
        { name: 'bundle/a.txt', data: 'hello '.repeat(1000), modifiedAt: new Date('2026-10-21T12:00:00Z') },
        { name: 'bundle/sub/b.json', data: '{"ok":true}', modifiedAt: new Date('2026-10-21T12:00:00Z') },
      ]),
    );
    const destination = join(root, 'out');
    await extractZip(archive, destination, { expectedRoot: 'bundle', maxTotalBytes: 1024 * 1024 });
    expect(readFileSync(join(destination, 'bundle', 'a.txt'), 'utf8')).toBe('hello '.repeat(1000));
    expect(readFileSync(join(destination, 'bundle', 'sub', 'b.json'), 'utf8')).toBe('{"ok":true}');
  });
});

describe('DiagnosticsService', () => {
  it('bundles logs, configuration and state without secrets, profile paths or transaction ids', async () => {
    const bundle = await service.createBundle();
    expect(bundle.files).toEqual(
      expect.arrayContaining([
        'system.json',
        'nodes.json',
        'jobs.json',
        'config/home-node-node-123.conf',
        'logs/orchestrator.log',
        'logs/home-node-node-123-debug.log',
        'README.txt',
      ]),
    );
    const { read } = await unpack(bundle.path);
    const everything = bundle.files.map((name) => read(name)).join('\n');
    for (const secret of ['hunter2', '9c0d', 'abcdefghijklmnop', TXID, home, home.replace(/\\/g, '\\\\')]) {
      expect(everything).not.toContain(secret);
    }
    expect(read('config/home-node-node-123.conf')).toContain('rpcauth=alice:[hidden value 1]');
    expect(read('logs/home-node-node-123-debug.log')).toContain('AddToWallet [id hidden]');
    expect(read('logs/home-node-node-123-debug.log')).toContain('%USERPROFILE%');
    expect(read('README.txt')).toContain('Removed before writing');
  });

  it('adds the state of BTCortex’s tor, without its notices and with the profile path hidden', async () => {
    const withTor = new DiagnosticsService({
      paths,
      nodes: { list: () => [] },
      jobs: { list: () => [] },
      logs: new LogService({ paths, nodes: { list: () => [] } }),
      tor: () =>
        Promise.resolve({
          state: 'failed',
          installed: { version: '15.0.26', torVersion: '0.4.9.14', verifiedAt: '2026-10-23T01:00:00.000Z' },
          runningVersion: null,
          autoStart: true,
          ports: { socks: 9050, applicationSocks: 9052, control: 9054 },
          bootstrap: null,
          circuitEstablished: false,
          networkLiveness: null,
          versionStatus: null,
          startedAt: null,
          traffic: null,
          pid: null,
          error: {
            code: 'tor.exited',
            message: 'tor stopped unexpectedly.',
            component: 'Tor',
            dataRisk: 'none',
            details: { lastLines: [`Read configuration file "${home}\\tor\\torrc".`] },
            recoveryActions: [],
          },
          recentLines: [{ time: '2026-10-23T01:00:00.000Z', severity: 'info', message: 'Bootstrapped 5%' }],
          external: [],
          usedBy: [],
        }),
      version: '0.1.0',
      logger,
      homeDirectory: home,
      now: () => new Date((now += 1_000)),
    });
    const bundle = await withTor.createBundle();
    const { read } = await unpack(bundle.path);
    const tor = read('tor.json');
    expect(JSON.parse(tor)).toMatchObject({ state: 'failed', ports: { control: 9054 }, error: { code: 'tor.exited' } });
    expect(tor).not.toContain('recentLines');
    expect(tor).not.toContain(home.replace(/\\/g, '\\\\'));
    expect(tor).toContain('%USERPROFILE%');
  });

  it('keeps the five newest bundles and reveals only its own files', async () => {
    for (let index = 0; index < 7; index += 1) await service.createBundle();
    const bundles = readdirSync(paths.exports).filter((name) => name.endsWith('.zip'));
    expect(bundles).toHaveLength(5);

    const newest = join(paths.exports, bundles.sort().at(-1) ?? '');
    service.reveal(newest);
    expect(revealed).toEqual([newest]);
    expect(() => {
      service.reveal(join(paths.logs, 'orchestrator.log'));
    }).toThrow(/not a diagnostic bundle/);
    expect(() => {
      service.reveal(join(paths.exports, '..', 'btcortex.db'));
    }).toThrow(/not a diagnostic bundle/);
  });
});
