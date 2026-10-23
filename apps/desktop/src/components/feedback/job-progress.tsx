import { CircleCheck, LoaderCircle } from 'lucide-react';
import type { Job } from '@btcortex/contracts';
import { Meter } from '@/components/data/meter';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface JobStage {
  id: string;
  label: string;
}

/** Ordered stages of a background job with the current one highlighted and live progress. */
export function JobProgress({ job, stages }: { job: Job; stages: readonly JobStage[] }) {
  const currentIndex = stages.findIndex((stage) => stage.id === job.progress.stage);
  return (
    <ol className="space-y-2" aria-live="polite">
      {stages.map((stage, index) => {
        const done = job.state === 'succeeded' || (currentIndex !== -1 && index < currentIndex);
        const active = job.state === 'running' && index === currentIndex;
        return (
          <li key={stage.id} className="flex items-center gap-2">
            {done ? (
              <CircleCheck aria-hidden="true" className="size-4 text-success" />
            ) : active ? (
              <LoaderCircle aria-hidden="true" className="size-4 text-info motion-safe:animate-spin" />
            ) : (
              <span aria-hidden="true" className="size-4 rounded-full border border-input" />
            )}
            <span className={cn(!done && !active && 'text-muted-foreground')}>{stage.label}</span>
            {active && job.progress.fraction !== undefined && (
              <span className="tabular text-muted-foreground">{formatPercent(job.progress.fraction)}</span>
            )}
          </li>
        );
      })}
      {job.state === 'running' && job.progress.fraction !== undefined && (
        <li>
          <Meter
            role="progressbar"
            tone="info"
            value={job.progress.fraction}
            label={job.progress.message}
            valueText={formatPercent(job.progress.fraction)}
            className="mt-2"
          />
        </li>
      )}
    </ol>
  );
}
