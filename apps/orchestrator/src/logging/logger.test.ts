import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemorySink, RotatingFileSink, StructuredLogger } from './logger';

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'btcortex-logs-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('StructuredLogger', () => {
  it('redacts secrets in messages and context', () => {
    const sink = new MemorySink();
    const logger = new StructuredLogger([sink], 'debug');
    logger.info('Connecting to http://alice:hunter2@127.0.0.1:8332/', { rpcpassword: 'hunter2', port: 8332 });
    const [entry] = sink.entries;
    expect(JSON.stringify(entry)).not.toContain('hunter2');
    expect(entry?.context).toEqual({ rpcpassword: '[redacted]', port: 8332 });
  });

  it('filters by level and namespaces child components', () => {
    const sink = new MemorySink();
    const logger = new StructuredLogger([sink], 'info');
    logger.debug('hidden');
    logger.child('bitcoin-core').warn('visible');
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({ level: 'warn', component: 'orchestrator.bitcoin-core' });
  });
});

describe('RotatingFileSink', () => {
  it('rotates by size and keeps disk usage bounded', () => {
    const directory = temporaryDirectory();
    const sink = new RotatingFileSink({ directory, fileName: 'test.log', maxFileBytes: 200, maxRotatedFiles: 2 });
    const logger = new StructuredLogger([sink], 'debug', 'test', () => new Date('2026-10-21T10:00:00.000Z'));
    for (let index = 0; index < 40; index += 1) logger.info(`entry number ${index}`);
    logger.close();

    const files = readdirSync(directory).sort();
    expect(files).toEqual(['test.log', 'test.log.1', 'test.log.2']);
    const active = readFileSync(join(directory, 'test.log'), 'utf8').trim().split('\n');
    expect(active.at(-1)).toContain('entry number 39');
    for (const line of active) expect(() => JSON.parse(line) as unknown).not.toThrow();
  });
});
