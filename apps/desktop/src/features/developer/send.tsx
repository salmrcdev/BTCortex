import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeWithStatus, RawTransactionCheck, TrackedTransaction } from '@btcortex/contracts';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import type { StatusTone } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TransactionLink } from '@/features/explorer/parts';
import { useNodes } from '@/features/nodes/queries';
import { formatBitcoin, formatNumber, formatRelativeTime, formatSatPerVb } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';

// Sending and following transactions (specification section 14). A
// transaction is sent only after the user confirmed it, with what it pays and
// on which network in front of them, and only when the node's mempool would
// accept it. What was sent, or chosen, is followed until it confirms.

const trackedKey = ['devtools', 'tracked'] as const;
const TRACKED_REFRESH_MS = 15_000;

function useTracked() {
  return useQuery({
    queryKey: trackedKey,
    queryFn: () => callOrchestrator('devtools.track.list', {}),
    refetchInterval: TRACKED_REFRESH_MS,
  });
}

/** Sends a decoded transaction the node's mempool would accept, after the user confirms it. */
export function SendButton({ node, check }: { node: NodeWithStatus; check: RawTransactionCheck }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useErrorFeedback();
  const send = useMutation({
    mutationFn: () =>
      callOrchestrator('devtools.broadcast', { nodeId: node.profile.id, hex: check.transaction.hex, confirmed: true }),
    onSuccess: async (result) => {
      toast.success(t('developer.send.sent'), { description: result.txid });
      await queryClient.invalidateQueries({ queryKey: trackedKey });
    },
  });
  const { transaction } = check;
  if (check.acceptance?.allowed !== true || send.isSuccess) return null;
  const mainnet = node.profile.network === 'mainnet';
  return (
    <ConfirmButton
      label={t('developer.send.send')}
      title={t('developer.send.title', { network: t(`networks.${node.profile.network}`) })}
      confirmLabel={t('developer.send.confirm')}
      destructive
      disabled={send.isPending}
      onConfirm={() => {
        send.mutate(undefined, { onError });
      }}
    >
      <p>
        {t('developer.send.body', {
          node: node.profile.name,
          outputs: transaction.outputs.length,
          total: formatBitcoin(transaction.totalOutputSats),
        })}
      </p>
      <p>
        {transaction.feeSats === null
          ? t('developer.send.feeUnknown')
          : t('developer.send.fee', {
              fee: formatBitcoin(transaction.feeSats),
              rate: formatSatPerVb(transaction.feeRate ?? 0),
            })}
      </p>
      <p className="break-all font-mono text-[12px]">{transaction.txid}</p>
      <p className="font-medium">{t(mainnet ? 'developer.send.final' : 'developer.send.finalTest')}</p>
    </ConfirmButton>
  );
}

/** Follows a transaction that is already out there until it confirms. */
export function FollowButton({ nodeId, txid }: { nodeId: string; txid: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useErrorFeedback();
  const tracked = useTracked();
  const follow = useMutation({
    mutationFn: () => callOrchestrator('devtools.track.add', { nodeId, txid }),
    onSuccess: (list) => {
      queryClient.setQueryData(trackedKey, list);
    },
  });
  const following = tracked.data?.some((entry) => entry.nodeId === nodeId && entry.txid === txid) ?? false;
  return (
    <Button
      variant="outline"
      disabled={following || follow.isPending}
      onClick={() => {
        follow.mutate(undefined, { onError });
      }}
    >
      {following ? t('developer.send.following') : t('developer.send.follow')}
    </Button>
  );
}

const TONES: Record<TrackedTransaction['state'], StatusTone> = {
  confirmed: 'healthy',
  mempool: 'working',
  missing: 'attention',
  unknown: 'unknown',
};

export function TrackedTransactions() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const tracked = useTracked();
  const nodes = useNodes();
  const onError = useErrorFeedback();
  const remove = useMutation({
    mutationFn: (entry: TrackedTransaction) =>
      callOrchestrator('devtools.track.remove', { nodeId: entry.nodeId, txid: entry.txid }),
    onSuccess: (list) => {
      queryClient.setQueryData(trackedKey, list);
    },
  });
  const entries = tracked.data ?? [];
  const nameOf = (nodeId: string) => nodes.data?.find((node) => node.profile.id === nodeId)?.profile.name ?? nodeId;
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('developer.send.trackedTitle')}</CardTitle>
          <CardDescription>{t('developer.send.trackedHint')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {tracked.isError ? (
          <ErrorPanel
            title={t('developer.send.trackedFailed')}
            error={toOrchestratorError(tracked.error)}
            onRetry={() => {
              void tracked.refetch();
            }}
          />
        ) : tracked.isPending ? (
          <Skeleton className="h-16" />
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground">{t('developer.send.none')}</p>
        ) : (
          <ul className="divide-y">
            {entries.map((entry) => (
              <li
                key={`${entry.nodeId}-${entry.txid}`}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <TransactionLink nodeId={entry.nodeId} txid={entry.txid} />
                  <StatusIndicator
                    tone={TONES[entry.state]}
                    label={
                      entry.state === 'confirmed'
                        ? t('developer.send.states.confirmed', {
                            count: entry.confirmations,
                            height: formatNumber(entry.blockHeight ?? 0),
                          })
                        : t(`developer.send.states.${entry.state}`)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('developer.send.on', { node: nameOf(entry.nodeId) })}
                    {entry.checkedAt !== null &&
                      ` · ${t('developer.send.checked', { time: formatRelativeTime(new Date(entry.checkedAt)) })}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('developer.send.stop', { txid: entry.txid })}
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(entry, { onError });
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {entries.some((entry) => entry.state === 'missing') && (
          <div className="mt-3">
            <Note tone="info">{t('developer.send.missingHint')}</Note>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
