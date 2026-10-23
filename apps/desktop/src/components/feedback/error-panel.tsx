import { CircleX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { OrchestratorError } from '@/lib/orchestrator';

export interface ErrorPanelProps {
  title: string;
  error: OrchestratorError;
  onRetry?: () => void;
}

/**
 * Explains a failure the way specification section 30 requires: what
 * happened, the affected component, whether data is at risk, the likely cause
 * and the available recovery actions.
 */
export function ErrorPanel({ title, error, onRetry }: ErrorPanelProps) {
  const { t } = useTranslation();
  const details = error.appError;
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-card p-4">
      <div className="flex items-start gap-3">
        <CircleX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1 space-y-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted-foreground">{t('errors.whatHappened')}</dt>
            <dd>{details?.message ?? error.message}</dd>
            {details && (
              <>
                <dt className="text-muted-foreground">{t('errors.affectedComponent')}</dt>
                <dd>{details.component}</dd>
                <dt className="text-muted-foreground">{t('errors.dataAtRisk')}</dt>
                <dd>{t(`errors.dataRisk.${details.dataRisk}`)}</dd>
                {details.likelyCause && (
                  <>
                    <dt className="text-muted-foreground">{t('errors.likelyCause')}</dt>
                    <dd>{details.likelyCause}</dd>
                  </>
                )}
                {details.recoveryActions.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">{t('errors.whatToDo')}</dt>
                    <dd>
                      <ul className="list-disc space-y-0.5 pl-5">
                        {details.recoveryActions.map((action) => (
                          <li key={action.id}>{action.label}</li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
              </>
            )}
          </dl>
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              {t('errors.retry')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
