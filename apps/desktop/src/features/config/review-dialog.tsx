import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isSecretOption, OPTION_DEFINITIONS } from '@btcortex/bitcoin-config';
import type { NodeWithStatus } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { NetworkBadge } from '@/components/status/network-badge';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/form-controls';
import type { OrchestratorError } from '@/lib/orchestrator';
import type { DraftAnalysis } from './config-model';
import { DiagnosticLine } from './diagnostic-line';

// Before anything is written: what changes, what is wrong, which risky
// settings need explicit confirmation, and whether to restart now
// (specification sections 5.6 and 21.3).

export interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the dialog closes; the button that opened it may be gone by then. */
  onReturnFocus: () => void;
  node: NodeWithStatus;
  analysis: DraftAnalysis;
  saving: boolean;
  error: OrchestratorError | undefined;
  onSave: (acceptedRisks: string[], restartAfterSave: boolean) => void;
  onReload: () => void;
}

/** A hidden value left as it was: the placeholder alone, or after the user name for rpcauth. */
const UNCHANGED_HIDDEN = /^(?:[^:]*:)?\[hidden value \d+\]$/;

/** Options whose risk needs a more precise explanation than their risk class gives. */
const RISK_KEYS = ['prune', 'reindex', 'reindex-chainstate'] as const;

function useFormatValues() {
  const { t } = useTranslation();
  return (key: string, values: string[] | undefined): string => {
    if (values === undefined) return t('config.reviewDefault');
    if (isSecretOption(key)) {
      return values.every((value) => UNCHANGED_HIDDEN.test(value))
        ? t('config.reviewHidden')
        : t('config.reviewNewHidden');
    }
    return values.length === 0 ? '—' : values.join(', ');
  };
}

/** Text items the orchestrator put in an error's details, for example the reasons a save was refused. */
function detailStrings(error: OrchestratorError | undefined, name: string): string[] {
  const value = error?.appError?.details?.[name];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function ReviewBody({
  node,
  analysis,
  saving,
  error,
  onSave,
  onReload,
}: Omit<ReviewDialogProps, 'open' | 'onOpenChange' | 'onReturnFocus'>) {
  const { t } = useTranslation();
  const id = useId();
  const format = useFormatValues();
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const nodeRunning = node.status.state === 'running';
  const [restart, setRestart] = useState(nodeRunning);
  const changedKeys = new Set(analysis.changes.map((change) => change.key));
  const errors = analysis.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = analysis.diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === 'warning' && diagnostic.key !== undefined && changedKeys.has(diagnostic.key),
  );
  const riskyKeys = analysis.risky.map(({ change }) => change.key);
  const allConfirmed = riskyKeys.every((key) => confirmed.has(key));
  const canSave = errors.length === 0 && allConfirmed && !saving;
  const refusals = detailStrings(error, 'problems');

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <AlertDialogTitle>{t('config.reviewTitle', { name: node.profile.name })}</AlertDialogTitle>
        <NetworkBadge network={node.profile.network} />
      </div>
      <AlertDialogDescription className="sr-only">{t('config.reviewChanges')}</AlertDialogDescription>

      <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <section aria-labelledby={`${id}-changes`} className="space-y-2">
          <h3 id={`${id}-changes`} className="text-sm font-semibold">
            {t('config.reviewChanges')}
          </h3>
          {analysis.changes.length === 0 ? (
            <p className="text-muted-foreground">{t('config.reviewNoChanges')}</p>
          ) : (
            <ul className="space-y-2">
              {analysis.changes.map((change) => (
                <li key={change.key}>
                  <p>
                    <span className="font-mono text-[13px] font-medium">{change.key}</span>:{' '}
                    <span className="text-muted-foreground">{format(change.key, change.before)}</span> →{' '}
                    <span className="font-medium">{format(change.key, change.after)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{OPTION_DEFINITIONS.get(change.key)?.description}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {errors.length > 0 && (
          <section className="space-y-2" aria-label={t('config.reviewBlocking')}>
            <p className="font-medium">{t('config.reviewBlocking')}</p>
            <ul className="space-y-1">
              {errors.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${String(index)}`}>
                  <DiagnosticLine
                    diagnostic={diagnostic}
                    {...(diagnostic.line === undefined
                      ? {}
                      : { location: t('config.line', { line: diagnostic.line }) })}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {warnings.length > 0 && (
          <section className="space-y-2" aria-label={t('config.reviewWarnings')}>
            <p className="font-medium">{t('config.reviewWarnings')}</p>
            <ul className="space-y-1">
              {warnings.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${String(index)}`}>
                  <DiagnosticLine diagnostic={diagnostic} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {analysis.risky.length > 0 && (
          <fieldset className="space-y-2">
            {analysis.risky.map(({ change, risk }) => (
              <label key={change.key} className="flex items-start gap-2">
                <Checkbox
                  checked={confirmed.has(change.key)}
                  onChange={(event) => {
                    const next = new Set(confirmed);
                    if (event.target.checked) next.add(change.key);
                    else next.delete(change.key);
                    setConfirmed(next);
                  }}
                />
                <span>
                  {t('config.confirmRisk', {
                    key: change.key,
                    explanation: (RISK_KEYS as readonly string[]).includes(change.key)
                      ? t(`config.riskByKey.${change.key as (typeof RISK_KEYS)[number]}`)
                      : t(`config.riskExplanation.${risk}`),
                  })}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {nodeRunning && analysis.changes.length > 0 && (
          <label className="flex items-start gap-2">
            <Checkbox
              checked={restart}
              onChange={(event) => {
                setRestart(event.target.checked);
              }}
            />
            <span>{t('config.restartAfterSave')}</span>
          </label>
        )}
        <p className="text-xs text-muted-foreground">{t('config.backupNote')}</p>

        {error && (
          <div className="space-y-2">
            <ErrorPanel title={t('config.saveFailed')} error={error} />
            {refusals.length > 0 && (
              <section aria-label={t('config.problemsHeading')} className="space-y-1">
                <p className="font-medium">{t('config.problemsHeading')}</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {refusals.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </section>
            )}
            {error.appError?.code === 'config.changed-on-disk' && (
              <Button variant="outline" onClick={onReload}>
                {t('config.reload')}
              </Button>
            )}
          </div>
        )}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
        <Button
          disabled={!canSave}
          onClick={() => {
            onSave(riskyKeys, nodeRunning && analysis.changes.length > 0 && restart);
          }}
        >
          {saving ? t('config.saving') : t('config.save')}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

export function ReviewDialog({ open, onOpenChange, onReturnFocus, ...body }: ReviewDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        {open && <ReviewBody {...body} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}
