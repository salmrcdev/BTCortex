import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeConfigVersion, NodeConfigVersionDetail } from '@btcortex/contracts';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatTimestamp } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';
import { configKeys } from './queries';

// Earlier versions of bitcoin.conf (specification section 28): BTCortex keeps
// the file as it was before each save, shows what a version would change with
// secret values never shown, and puts one back through the same checks as a
// save, keeping the current file as a version in turn.

const historyKey = (nodeId: string) => ['config', nodeId, 'history'] as const;

function Values({ values, secret }: { values: string[] | null; secret: boolean }) {
  const { t } = useTranslation();
  if (secret) return <span className="text-muted-foreground">{t('config.history.hidden')}</span>;
  if (values === null) return <span className="text-muted-foreground">{t('config.history.unset')}</span>;
  return <span className="break-all font-mono text-xs">{values.join(', ')}</span>;
}

function Changes({ detail }: { detail: NodeConfigVersionDetail }) {
  const { t } = useTranslation();
  if (detail.changes.length === 0) return <p className="text-muted-foreground">{t('config.history.same')}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('config.history.setting')}</TableHead>
          <TableHead>{t('config.history.now')}</TableHead>
          <TableHead>{t('config.history.then')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {detail.changes.map((change) => (
          <TableRow key={change.key}>
            <TableCell>
              <span className="flex flex-wrap items-center gap-2 font-mono text-xs">
                {change.key}
                {detail.risky.includes(change.key) && <Badge variant="warning">{t('config.history.risky')}</Badge>}
              </span>
            </TableCell>
            <TableCell>
              <Values values={change.current} secret={change.secret} />
            </TableCell>
            <TableCell>
              <Values values={change.version} secret={change.secret} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function VersionRow({
  nodeId,
  version,
  revision,
  blocked,
}: {
  nodeId: string;
  version: NodeConfigVersion;
  revision: string;
  blocked: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useErrorFeedback();
  const checkboxId = useId();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState<string[]>([]);
  // Compared with the file as it is now, so the comparison follows every save.
  const detail = useQuery({
    queryKey: ['config', nodeId, 'version', version.id, revision],
    queryFn: () => callOrchestrator('nodes.config.version', { nodeId, versionId: version.id }),
  });
  const restore = useMutation({
    mutationFn: () =>
      callOrchestrator('nodes.config.restore', { nodeId, versionId: version.id, revision, acceptedRisks: accepted }),
    onSuccess: async () => {
      toast.success(t('config.history.restored', { time: formatTimestamp(version.replacedAt) }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: configKeys.node(nodeId) }),
        queryClient.invalidateQueries({ queryKey: historyKey(nodeId) }),
      ]);
    },
  });
  const risky = detail.data?.risky ?? [];
  const allAccepted = risky.every((key) => accepted.includes(key));
  return (
    <li className="space-y-3 border-b py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="font-medium">
            {t('config.history.replaced', { time: formatTimestamp(version.replacedAt) })}
          </span>
          <span className="text-muted-foreground"> · {formatBytes(version.bytes)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {open ? t('config.history.hide') : t('config.history.compare')}
          </Button>
          <ConfirmButton
            label={t('config.history.restore')}
            title={t('config.history.restoreTitle', { time: formatTimestamp(version.replacedAt) })}
            confirmLabel={t('config.history.restoreConfirm')}
            disabled={blocked || restore.isPending || !detail.data}
            confirmDisabled={!allAccepted}
            onConfirm={() => {
              restore.mutate(undefined, { onError });
            }}
          >
            {detail.data && (
              <>
                <span className="block">{t('config.history.restoreBody')}</span>
                <Changes detail={detail.data} />
                {risky.map((key) => (
                  <label key={key} htmlFor={`${checkboxId}-${key}`} className="flex items-start gap-2 text-foreground">
                    <Checkbox
                      id={`${checkboxId}-${key}`}
                      checked={accepted.includes(key)}
                      onChange={(event) => {
                        setAccepted(
                          event.target.checked ? [...accepted, key] : accepted.filter((entry) => entry !== key),
                        );
                      }}
                    />
                    <span>{t('config.history.acceptRisk', { key })}</span>
                  </label>
                ))}
              </>
            )}
          </ConfirmButton>
        </div>
      </div>
      {open &&
        (detail.isError ? (
          <ErrorPanel title={t('config.history.unavailable')} error={toOrchestratorError(detail.error)} />
        ) : !detail.data ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="space-y-2">
            <Changes detail={detail.data} />
            <details>
              <summary className="cursor-pointer text-muted-foreground">{t('config.history.showFile')}</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs">
                {detail.data.text}
              </pre>
            </details>
          </div>
        ))}
    </li>
  );
}

export function HistoryCard({ nodeId, revision, blocked }: { nodeId: string; revision: string; blocked: boolean }) {
  const { t } = useTranslation();
  const history = useQuery({
    queryKey: historyKey(nodeId),
    queryFn: () => callOrchestrator('nodes.config.history', { nodeId }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History aria-hidden="true" className="size-4 text-muted-foreground" />
          {t('config.history.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="max-w-prose text-muted-foreground">
          {t('config.history.description', { count: history.data?.kept ?? 10 })}
        </p>
        {blocked && <p className="text-muted-foreground">{t('config.history.blocked')}</p>}
        {history.isError ? (
          <ErrorPanel
            title={t('config.history.unavailable')}
            error={toOrchestratorError(history.error)}
            onRetry={() => void history.refetch()}
          />
        ) : !history.data ? (
          <Skeleton className="h-16" />
        ) : history.data.versions.length === 0 ? (
          <p className="text-muted-foreground">{t('config.history.none')}</p>
        ) : (
          <ul>
            {history.data.versions.map((version) => (
              <VersionRow key={version.id} nodeId={nodeId} version={version} revision={revision} blocked={blocked} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
