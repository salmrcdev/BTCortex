import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppError, OrchestratorEvent } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { openDatabase } from '../persistence/database';
import { migrations } from '../persistence/migrations';
import { JobManager } from './job-manager';

const logger = new StructuredLogger([new MemorySink()], 'debug');
const failure = (error: unknown): AppError => ({
  code: 'test.failed',
  message: String(error),
  component: 'Test',
  dataRisk: 'none',
  recoveryActions: [],
});

let root: string;
let database: DatabaseSync;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-jobs-'));
  database = openDatabase({ file: join(root, 'btcortex.db'), migrations, logger });
});

afterEach(() => {
  database.close();
  rmSync(root, { recursive: true, force: true });
});

describe('JobManager', () => {
  it('reports jobs a previous session left unfinished as interrupted, and leaves finished ones alone', async () => {
    // The previous session: one job finished, one was running and one still waiting when BTCortex closed.
    const before = new JobManager({ database, publish: () => undefined, logger });
    const finished = before.run('bitcoin-core.setup', 'Set up Bitcoin Core', () => Promise.resolve(undefined), failure);
    await before.waitFor(finished.id);
    const running = before.run(
      'bitcoin-core.setup',
      'Set up Bitcoin Core (Testnet4)',
      (report) => {
        report({ stage: 'downloading', message: 'Downloading.', fraction: 0.5 });
        return new Promise(() => undefined);
      },
      failure,
    );
    const waiting = before.run(
      'electrum.setup',
      'Set up an Electrum server',
      () => new Promise(() => undefined),
      failure,
    );
    expect(before.get(running.id).state).toBe('running');
    expect(before.get(waiting.id).state).toBe('queued');

    // The next session.
    const published: OrchestratorEvent[] = [];
    const after = new JobManager({
      database,
      publish: (event) => published.push(event),
      logger,
      now: () => new Date('2026-10-23T12:00:00.000Z'),
    });
    after.recoverInterrupted();

    for (const id of [running.id, waiting.id]) {
      expect(after.get(id)).toMatchObject({
        state: 'failed',
        updatedAt: '2026-10-23T12:00:00.000Z',
        error: { code: 'jobs.interrupted', dataRisk: 'none', recoveryActions: [{ id: 'retry' }] },
      });
    }
    expect(after.get(finished.id).state).toBe('succeeded');
    expect(published.map((event) => (event.type === 'job.updated' ? event.payload.id : event.type)).sort()).toEqual(
      [running.id, waiting.id].sort(),
    );

    // Nothing is left to recover a second time.
    published.length = 0;
    after.recoverInterrupted();
    expect(published).toEqual([]);
  });
});
