import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NodeWithStatus } from '@btcortex/contracts';
import { resolveAppPaths } from '../platform/paths';
import { LogService } from './log-service';
import { LogTail } from './log-tail';
import { parseApplicationLine, parseBitcoinCoreLine, parseConsoleLine, parseShellLine } from './parsers';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'btcortex-logs-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('log line parsers', () => {
  it('reads the orchestrator’s structured lines and redacts their context', () => {
    const line = JSON.stringify({
      time: '2026-10-21T10:00:00.000Z',
      level: 'warn',
      component: 'orchestrator.nodes',
      message: 'Node check failed',
      context: { nodeId: 'n1', password: 'hunter2' },
    });
    expect(parseApplicationLine(line)).toEqual({
      time: '2026-10-21T10:00:00.000Z',
      severity: 'warning',
      component: 'orchestrator.nodes',
      message: 'Node check failed',
      context: { nodeId: 'n1', password: '[redacted]' },
      continuation: false,
    });
    expect(parseApplicationLine('not json')).toMatchObject({ severity: 'info', message: 'not json' });
  });

  it('reads shell lines and skips the orchestrator output the shell relays', () => {
    expect(parseShellLine('[2026-10-21][17:10:07][btcortex_lib::sidecar][INFO] Orchestrator started')).toEqual({
      time: '2026-10-21T17:10:07.000Z',
      severity: 'info',
      component: 'btcortex_lib::sidecar',
      message: 'Orchestrator started',
      continuation: false,
    });
    expect(parseShellLine('[2026-10-21][17:10:07][orchestrator][DEBUG] relayed')).toBeUndefined();
    expect(parseShellLine('  stack frame')).toMatchObject({ continuation: true });
  });

  it('reads Bitcoin Core’s severity tags, categories and older wording', () => {
    expect(parseBitcoinCoreLine('2026-10-21T10:00:00Z UpdateTip: new best=00ab height=5')).toMatchObject({
      time: '2026-10-21T10:00:00.000Z',
      severity: 'info',
      message: 'UpdateTip: new best=00ab height=5',
    });
    expect(parseBitcoinCoreLine('2026-10-21T10:00:01Z [warning] Disk space is low')).toMatchObject({
      severity: 'warning',
      message: 'Disk space is low',
    });
    expect(parseBitcoinCoreLine('2026-10-21T10:00:02Z [net] connection to peer=3 closed')).toMatchObject({
      severity: 'debug',
      component: 'net',
    });
    expect(parseBitcoinCoreLine('2026-10-21T10:00:03Z [net:error] something failed')).toMatchObject({
      severity: 'error',
      component: 'net',
    });
    expect(parseBitcoinCoreLine('2026-10-21T10:00:04Z Error: Disk full')).toMatchObject({ severity: 'error' });
    expect(parseBitcoinCoreLine('continued text')).toMatchObject({ continuation: true });
    expect(parseConsoleLine('Error: Cannot obtain a lock on directory C:\\x')).toMatchObject({ severity: 'error' });
    expect(parseConsoleLine('   ')).toBeUndefined();
  });
});

describe('LogTail', () => {
  const options = { windowBytes: 1024 * 1024, maxEntries: 1000 };

  it('parses only what was appended, and only complete lines', async () => {
    const path = join(directory, 'debug.log');
    writeFileSync(path, '2026-10-21T10:00:00Z first\n2026-10-21T10:00:01Z second\n');
    const tail = new LogTail(path, parseBitcoinCoreLine, options);
    expect((await tail.read()).map((entry) => entry.message)).toEqual(['first', 'second']);

    appendFileSync(path, '2026-10-21T10:00:02Z third\n2026-10-21T10:00:03Z four');
    expect((await tail.read()).map((entry) => entry.message)).toEqual(['first', 'second', 'third']);
    appendFileSync(path, 'th\nwrapped text\n');
    const entries = await tail.read();
    expect(entries.map((entry) => entry.message)).toEqual(['first', 'second', 'third', 'fourth\nwrapped text']);
    expect(entries[1]?.offset).toBe('2026-10-21T10:00:00Z first\n'.length);
  });

  it('starts again after the file was rotated or truncated', async () => {
    const path = join(directory, 'debug.log');
    writeFileSync(path, '2026-10-21T10:00:00Z old one\n2026-10-21T10:00:01Z old two\n');
    const tail = new LogTail(path, parseBitcoinCoreLine, options);
    await tail.read();
    writeFileSync(path, '2026-10-21T11:00:00Z new\n');
    expect((await tail.read()).map((entry) => entry.message)).toEqual(['new']);
    rmSync(path);
    expect(await tail.read()).toEqual([]);
  });

  it('reads only the end of a large file and dates lines that have no time', async () => {
    const path = join(directory, 'console.log');
    writeFileSync(path, `${'x'.repeat(5000)}\nError: Cannot obtain a lock\n`);
    const tail = new LogTail(path, parseConsoleLine, { windowBytes: 100, maxEntries: 10 });
    const [entry, ...rest] = await tail.read();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ message: 'Error: Cannot obtain a lock', severity: 'error', timeEstimated: true });
  });
});

describe('LogService', () => {
  it('merges sources newest first and filters by severity, text, time and limit', async () => {
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: directory });
    mkdirSync(paths.logs, { recursive: true });
    const line = (time: string, level: string, message: string) =>
      `${JSON.stringify({ time, level, component: 'orchestrator', message })}\n`;
    writeFileSync(
      join(paths.logs, 'orchestrator.log'),
      line('2026-10-21T10:00:00.000Z', 'info', 'started') +
        line('2026-10-21T10:00:05.000Z', 'error', 'download failed') +
        line('2026-10-21T10:00:09.000Z', 'debug', 'handled request'),
    );
    const nodeDirectory = join(directory, 'node');
    mkdirSync(join(nodeDirectory, 'regtest'), { recursive: true });
    writeFileSync(
      join(nodeDirectory, 'regtest', 'debug.log'),
      '2026-10-21T10:00:02Z Bitcoin Core version v31.1.0\n2026-10-21T10:00:07Z [warning] low disk space\n',
    );
    const node = {
      profile: {
        id: 'node-1',
        name: 'Test',
        execution: 'managed',
        network: 'regtest',
        dataDirectory: nodeDirectory,
        authentication: { kind: 'cookie', cookieFile: join(nodeDirectory, 'regtest', '.cookie') },
      },
    } as NodeWithStatus;
    const service = new LogService({ paths, nodes: { list: () => [node] } });

    expect(service.sources().map((source) => [source.id, source.exists])).toEqual([
      ['btcortex', true],
      ['shell', false],
      ['tor', false],
      ['node:node-1:debug', true],
      ['node:node-1:console', false],
    ]);

    const everything = await service.read({
      sourceIds: ['btcortex', 'node:node-1:debug', 'unknown'],
      minimumSeverity: 'debug',
      limit: 100,
    });
    expect(everything.entries.map((entry) => entry.message)).toEqual([
      'handled request',
      'low disk space',
      'download failed',
      'Bitcoin Core version v31.1.0',
      'started',
    ]);
    expect(everything.entries[1]).toMatchObject({ id: expect.stringMatching(/^node:node-1:debug:\d+$/) as string });

    const warnings = await service.read({
      sourceIds: ['btcortex', 'node:node-1:debug'],
      minimumSeverity: 'warning',
      limit: 1,
    });
    expect(warnings.entries.map((entry) => entry.message)).toEqual(['low disk space']);
    expect(warnings.limited).toBe(true);

    const searched = await service.read({
      sourceIds: ['btcortex', 'node:node-1:debug'],
      minimumSeverity: 'debug',
      search: 'DOWNLOAD',
      since: '2026-10-21T10:00:01.000Z',
      until: '2026-10-21T10:00:06.000Z',
      limit: 100,
    });
    expect(searched.entries.map((entry) => entry.message)).toEqual(['download failed']);
  });
});
