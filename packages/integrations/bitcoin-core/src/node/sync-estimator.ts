// Estimates the remaining synchronisation time from recent progress. The
// result is explicitly an estimate (specification section 5.5): verification
// speed varies enormously with block size, cache size and disk speed, so the
// estimate uses only a recent window and is withheld until it has enough data.

export interface ProgressSample {
  atMs: number;
  verificationProgress: number;
  blocks: number;
}

export interface SyncEstimate {
  remainingSeconds: number;
  basis: string;
}

const WINDOW_MS = 10 * 60_000;
const MIN_SPAN_MS = 60_000;
const MAX_SAMPLES = 240;

export class SyncEstimator {
  private samples: ProgressSample[] = [];

  record(sample: ProgressSample): void {
    const last = this.samples.at(-1);
    // A reindex or a different chain restarts the history.
    if (last && (sample.verificationProgress < last.verificationProgress || sample.blocks < last.blocks))
      this.samples = [];
    this.samples.push(sample);
    const cutoff = sample.atMs - WINDOW_MS;
    this.samples = this.samples.filter((entry) => entry.atMs >= cutoff).slice(-MAX_SAMPLES);
  }

  estimate(): SyncEstimate | undefined {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last || last.verificationProgress >= 0.9999) return undefined;
    const spanMs = last.atMs - first.atMs;
    const progressed = last.verificationProgress - first.verificationProgress;
    if (spanMs < MIN_SPAN_MS || progressed <= 0) return undefined;
    const remainingSeconds = ((1 - last.verificationProgress) / progressed) * (spanMs / 1000);
    const minutes = Math.round(spanMs / 60_000);
    return {
      remainingSeconds: Math.round(remainingSeconds),
      basis: `Extrapolated from verification progress over the last ${minutes} minute${minutes === 1 ? '' : 's'}; actual speed varies with block sizes and disk speed.`,
    };
  }

  reset(): void {
    this.samples = [];
  }
}
