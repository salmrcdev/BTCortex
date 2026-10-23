import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AppFailure, JobSchema } from '@btcortex/contracts';
import type { AppError, Job, OrchestratorEvent } from '@btcortex/contracts';
import type { Logger } from '../logging/logger';

// Long-running operations (installations, set-up) run as jobs: they report
// progress as events, survive in the database, and an interrupted job is
// reported honestly after a restart instead of silently disappearing
// (specification sections 30 and 32).

const RETAINED_JOBS = 100;
const FINISHED: ReadonlySet<Job['state']> = new Set(['succeeded', 'failed', 'cancelled']);

export type JobProgressReporter = (progress: Job['progress']) => void;

export interface JobManagerOptions {
  database: DatabaseSync;
  publish: (event: OrchestratorEvent) => void;
  logger: Logger;
  now?: () => Date;
}

export class JobManager {
  private readonly now: () => Date;
  private readonly watchers = new Map<string, Set<(job: Job) => void>>();

  constructor(private readonly options: JobManagerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Marks jobs left running by a previous session as failed. */
  recoverInterrupted(): void {
    for (const job of this.list().filter(
      (candidate) => candidate.state === 'running' || candidate.state === 'queued',
    )) {
      this.save({
        ...job,
        state: 'failed',
        updatedAt: this.now().toISOString(),
        error: {
          code: 'jobs.interrupted',
          message: 'BTCortex closed before this task finished.',
          component: job.title,
          dataRisk: 'none',
          likelyCause: 'The application or the computer was shut down during the task.',
          recoveryActions: [{ id: 'retry', label: 'Start the task again; downloads resume where they stopped' }],
        },
      });
    }
  }

  list(): Job[] {
    return this.options.database
      .prepare('SELECT record FROM jobs ORDER BY created_at DESC LIMIT ?')
      .all(RETAINED_JOBS)
      .map((row) => JobSchema.parse(JSON.parse(String(row['record']))));
  }

  get(id: string): Job {
    const row = this.options.database.prepare('SELECT record FROM jobs WHERE id = ?').get(id);
    if (!row) {
      throw new AppFailure({
        code: 'jobs.not-found',
        message: 'This task no longer exists.',
        component: 'Background tasks',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    return JobSchema.parse(JSON.parse(String(row['record'])));
  }

  /**
   * Resolves with the job once it has finished, passing every update on the
   * way, so that one job can carry out others and show their progress.
   */
  waitFor(id: string, onUpdate?: (job: Job) => void): Promise<Job> {
    const current = this.get(id);
    if (FINISHED.has(current.state)) return Promise.resolve(current);
    return new Promise((resolve) => {
      const watchers = this.watchers.get(id) ?? new Set();
      const watcher = (job: Job) => {
        onUpdate?.(job);
        if (!FINISHED.has(job.state)) return;
        watchers.delete(watcher);
        if (watchers.size === 0) this.watchers.delete(id);
        resolve(job);
      };
      watchers.add(watcher);
      this.watchers.set(id, watchers);
    });
  }

  /**
   * Creates a job and runs `work` in the background. The returned job is in
   * the `queued` state; progress and the outcome arrive as `job.updated` events.
   */
  run(
    kind: Job['kind'],
    title: string,
    work: (report: JobProgressReporter) => Promise<Job['result']>,
    describeFailure: (error: unknown) => AppError,
  ): Job {
    const timestamp = this.now().toISOString();
    let job: Job = {
      id: randomUUID(),
      kind,
      title,
      state: 'queued',
      progress: { stage: 'queued', message: 'Waiting to start.' },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.save(job);
    const queued = job;

    const report: JobProgressReporter = (progress) => {
      job = { ...job, state: 'running', progress, updatedAt: this.now().toISOString() };
      this.save(job);
    };

    void (async () => {
      try {
        const result = await work(report);
        job = { ...job, state: 'succeeded', updatedAt: this.now().toISOString(), ...(result ? { result } : {}) };
      } catch (error) {
        this.options.logger.error('Background task failed', { jobId: job.id, kind, error });
        job = { ...job, state: 'failed', updatedAt: this.now().toISOString(), error: describeFailure(error) };
      }
      this.save(job);
    })();

    return queued;
  }

  private save(job: Job): void {
    const valid = JobSchema.parse(job);
    this.options.database
      .prepare(
        `INSERT INTO jobs (id, kind, record, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET record = excluded.record, state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(valid.id, valid.kind, JSON.stringify(valid), valid.state, valid.createdAt, valid.updatedAt);
    this.options.database
      .prepare('DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?)')
      .run(RETAINED_JOBS);
    this.options.publish({ type: 'job.updated', at: valid.updatedAt, payload: valid });
    for (const watcher of [...(this.watchers.get(valid.id) ?? [])]) watcher(valid);
  }
}
