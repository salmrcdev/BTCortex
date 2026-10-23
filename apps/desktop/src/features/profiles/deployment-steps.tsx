import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DeploymentRecord, DeploymentStepState } from '@btcortex/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The steps of a deployment with what became of each: icon and word together,
// never colour alone, and a way to where a step can be checked or finished.

function StepIcon({ state }: { state: DeploymentStepState }) {
  const className = 'mt-0.5 size-4 shrink-0';
  switch (state) {
    case 'done':
      return <CircleCheck aria-hidden="true" className={cn(className, 'text-success')} />;
    case 'running':
      return <LoaderCircle aria-hidden="true" className={cn(className, 'text-info motion-safe:animate-spin')} />;
    case 'failed':
      return <CircleX aria-hidden="true" className={cn(className, 'text-danger')} />;
    case 'needs-attention':
      return <CircleAlert aria-hidden="true" className={cn(className, 'text-warning')} />;
    case 'skipped':
      return <CircleMinus aria-hidden="true" className={cn(className, 'text-muted-foreground')} />;
    default:
      return <CircleDashed aria-hidden="true" className={cn(className, 'text-muted-foreground')} />;
  }
}

export function DeploymentSteps({ record }: { record: DeploymentRecord }) {
  const { t } = useTranslation();
  return (
    <ol className="space-y-2" aria-live="polite">
      {record.steps.map((step) => (
        <li key={step.component} className="flex gap-3">
          <StepIcon state={step.state} />
          <div className="min-w-0 flex-1">
            <p>
              <span className="font-medium">{step.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">{t(`profiles.stepStates.${step.state}`)}</span>
            </p>
            {step.message !== null && <p className="text-muted-foreground">{step.message}</p>}
          </div>
          {step.route !== null && step.state !== 'pending' && step.state !== 'running' && (
            <Button asChild variant="outline" className="shrink-0">
              <a href={`#${step.route}`}>{t('profiles.open')}</a>
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Running, finished, or finished with steps left to the user. */
export function deploymentOutcome(record: DeploymentRecord): 'running' | 'done' | 'attention' | 'failed' {
  if (record.finishedAt === null) return 'running';
  if (record.steps.some((step) => step.state === 'failed')) return 'failed';
  if (record.steps.some((step) => step.state === 'needs-attention')) return 'attention';
  return 'done';
}
