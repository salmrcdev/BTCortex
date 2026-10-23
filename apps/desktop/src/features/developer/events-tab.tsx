import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ZmqEventView } from '@btcortex/contracts';
import { StatTile } from '@/components/data/stat-tile';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatLogTime, formatNumber, truncateMiddle } from '@/lib/format';
import { callOrchestrator, subscribeToOrchestratorEvents, toOrchestratorError } from '@/lib/orchestrator';

// ZMQ event monitoring (specification section 15): the notifications a node
// publishes, watched live while this tab is open. Batches arrive about once a
// second; the latest events are listed with links to the explorer.

const KEPT_EVENTS = 100;

interface Totals {
  block: number;
  added: number;
  removed: number;
  missed: number;
}

const EMPTY: Totals = { block: 0, added: 0, removed: 0, missed: 0 };

function eventLabel(event: ZmqEventView): NonNullable<ZmqEventView['change']> | ZmqEventView['kind'] {
  return event.change ?? event.kind;
}

export function EventsTab({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const feedback = useErrorFeedback();
  const statusKey = ['devtools', 'zmq', nodeId] as const;
  const status = useQuery({ queryKey: statusKey, queryFn: () => callOrchestrator('devtools.zmq.status', { nodeId }) });
  const [events, setEvents] = useState<ZmqEventView[]>([]);
  const [totals, setTotals] = useState<Totals>(EMPTY);
  const [startedAt, setStartedAt] = useState<number>();
  /** When the latest batch arrived, for the rate; set by the event handler, not while rendering. */
  const [lastBatchAt, setLastBatchAt] = useState<number>();
  const [stopped, setStopped] = useState<string>();
  const watchingHere = useRef(false);
  const watch = useMutation({
    mutationFn: (on: boolean) => callOrchestrator('devtools.zmq.watch', { nodeId, watch: on }),
    onSuccess: (result) => {
      queryClient.setQueryData(statusKey, result);
    },
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void subscribeToOrchestratorEvents((event) => {
      if (event.type !== 'zmq.events' || event.payload.nodeId !== nodeId) return;
      const batch = event.payload;
      setLastBatchAt(Date.now());
      setEvents((previous) => [...batch.events.slice().reverse(), ...previous].slice(0, KEPT_EVENTS));
      setTotals((previous) => ({
        block: previous.block + (batch.counts['block'] ?? 0),
        added: previous.added + (batch.counts['transaction-added'] ?? 0),
        removed: previous.removed + (batch.counts['transaction-removed'] ?? 0),
        missed: previous.missed + batch.missed,
      }));
      if (batch.stopped !== null) {
        setStopped(batch.stopped);
        void queryClient.invalidateQueries({ queryKey: ['devtools', 'zmq', nodeId] });
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
      // Watching started here ends when the tab closes.
      if (watchingHere.current)
        void callOrchestrator('devtools.zmq.watch', { nodeId, watch: false }).catch(() => undefined);
    };
  }, [nodeId, queryClient]);

  if (status.isError) {
    return (
      <ErrorPanel
        title={t('developer.events.failed')}
        error={toOrchestratorError(status.error)}
        onRetry={() => void status.refetch()}
      />
    );
  }
  if (!status.data) return <Skeleton className="h-40" />;
  const watching = status.data.watching;
  const minutes =
    startedAt === undefined || lastBatchAt === undefined ? 0 : Math.max(1 / 60, (lastBatchAt - startedAt) / 60_000);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{t('developer.events.intro')}</p>
      {status.data.unavailableReason !== null ? (
        <Note tone="info">{status.data.unavailableReason}</Note>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={watch.isPending}
            variant={watching ? 'outline' : 'default'}
            onClick={() => {
              const next = !watching;
              watch.mutate(next, {
                onSuccess: () => {
                  watchingHere.current = next;
                  if (next) {
                    setStartedAt(Date.now());
                    setStopped(undefined);
                    setTotals(EMPTY);
                    setEvents([]);
                  }
                },
                onError: feedback,
              });
            }}
          >
            {watching ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {watching ? t('developer.events.stop') : t('developer.events.start')}
          </Button>
          <StatusIndicator
            tone={watching ? 'healthy' : 'inactive'}
            label={watching ? t('developer.events.watching') : (stopped ?? t('developer.events.idle'))}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('developer.events.blocks')} value={formatNumber(totals.block)} />
        <StatTile
          label={t('developer.events.added')}
          value={formatNumber(totals.added)}
          context={
            minutes === 0
              ? undefined
              : t('developer.events.perMinute', {
                  rate: formatNumber(totals.added / minutes, { maximumFractionDigits: 1 }),
                })
          }
        />
        <StatTile label={t('developer.events.removed')} value={formatNumber(totals.removed)} />
        <StatTile label={t('developer.events.missed')} value={formatNumber(totals.missed)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('developer.events.published')}</CardTitle>
        </CardHeader>
        <CardContent>
          {status.data.notifications.length === 0 ? (
            <p className="text-muted-foreground">{t('developer.events.noNotifications')}</p>
          ) : (
            <ul className="space-y-1">
              {status.data.notifications.map((entry) => (
                <li key={`${entry.type}-${entry.address}`} className="flex flex-wrap gap-x-3">
                  <span className="font-mono text-[13px]">{entry.type}</span>
                  <span className="font-mono text-[13px] text-muted-foreground">{entry.address}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('developer.events.latest')}</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-muted-foreground">{t('developer.events.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('developer.events.time')}</TableHead>
                  <TableHead>{t('developer.events.kind')}</TableHead>
                  <TableHead>{t('developer.events.hash')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event, index) => (
                  <TableRow key={`${event.at}-${event.hash ?? ''}-${String(index)}`}>
                    <TableCell className="tabular">{formatLogTime(event.at)}</TableCell>
                    <TableCell>{t(`developer.events.kinds.${eventLabel(event)}`)}</TableCell>
                    <TableCell className="font-mono text-[12px]">
                      {event.hash === null ? (
                        event.bytes === null ? (
                          '—'
                        ) : (
                          t('developer.events.bytes', { bytes: formatNumber(event.bytes) })
                        )
                      ) : (
                        <a
                          className="underline-offset-2 hover:underline"
                          href={`#/explorer?node=${nodeId}&${event.kind === 'block' || event.change?.startsWith('block') ? 'block' : 'tx'}=${event.hash}`}
                        >
                          {truncateMiddle(event.hash, 12, 10)}
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
