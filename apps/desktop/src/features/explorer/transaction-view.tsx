import { useTranslation } from 'react-i18next';
import type { TransactionDetail } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpenInExplorers } from './remote-explorers';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatRelativeTime, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { analyseLockTime } from '@/lib/transaction-analysis';
import { replacementPolicy, TransactionAnalysisView } from '@/features/developer/transaction-analysis-view';
import { useNodes } from '@/features/nodes/queries';
import { AddressLink, Amount, BlockLink, Detail, DetailGrid, FeeRate, ScriptDetails, TransactionLink } from './parts';
import { useExplorerTransaction } from './queries';

// A transaction as the node knows it: where it stands, what it pays, the
// coins it spends and the outputs it creates, and its unconfirmed relatives.

function Status({ transaction, nodeId }: { transaction: TransactionDetail; nodeId: string }) {
  const { t } = useTranslation();
  const status = transaction.status;
  if (status.state === 'mempool') {
    return (
      <StatusIndicator
        tone="working"
        label={
          status.firstSeen === undefined
            ? t('explorer.tx.unconfirmed')
            : t('explorer.tx.unconfirmedSince', { since: formatRelativeTime(status.firstSeen * 1000) })
        }
      />
    );
  }
  if (status.state === 'confirmed') {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <StatusIndicator tone="healthy" label={t('explorer.tx.confirmations', { count: status.confirmations })} />
        <span className="text-muted-foreground">
          {t('explorer.tx.inBlock')} <BlockLink nodeId={nodeId} hash={status.blockHash} height={status.blockHeight} /> ·{' '}
          {formatTimestamp(new Date(status.blockTime * 1000))}
        </span>
      </span>
    );
  }
  return <StatusIndicator tone="inactive" label={t('explorer.tx.notSeen')} />;
}

/** The lock time in words: a block height or a time. */
function useLockTimeText() {
  const { t } = useTranslation();
  return (transaction: TransactionDetail): string => {
    const lock = analyseLockTime(
      transaction.lockTime,
      transaction.inputs.map((input) => input.sequence),
    );
    if (lock.kind === 'none') return t('explorer.tx.noLockTime');
    return lock.kind === 'height'
      ? t('explorer.tx.lockHeight', { height: formatNumber(lock.height) })
      : t('explorer.tx.lockAt', { time: formatTimestamp(new Date(lock.time * 1000)) });
  };
}

export function TransactionBody({ transaction, nodeId }: { transaction: TransactionDetail; nodeId: string }) {
  const { t } = useTranslation();
  const lockTimeText = useLockTimeText();
  const node = useNodes().data?.find((candidate) => candidate.profile.id === nodeId);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('explorer.tx.title')}</CardTitle>
          <Status transaction={transaction} nodeId={nodeId} />
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailGrid>
            <Detail label={t('explorer.tx.txid')}>
              <CopyableValue value={transaction.txid} label={t('explorer.tx.txid')} />
            </Detail>
            {transaction.segwit && (
              <Detail label={t('explorer.tx.wtxid')}>
                <CopyableValue value={transaction.wtxid} label={t('explorer.tx.wtxid')} />
              </Detail>
            )}
            <Detail label={t('explorer.tx.fee')}>
              {transaction.feeSats === null ? (
                <span className="text-muted-foreground">{t('explorer.tx.feeUnknown')}</span>
              ) : (
                <span className="inline-flex flex-wrap gap-x-3">
                  <Amount sats={transaction.feeSats} />
                  <FeeRate value={transaction.feeRate} />
                </span>
              )}
            </Detail>
            <Detail label={t('explorer.tx.size')}>
              <span className="tabular">
                {t('explorer.tx.sizeValue', {
                  vsize: formatNumber(transaction.vsize),
                  weight: formatNumber(transaction.weight),
                  size: formatNumber(transaction.sizeBytes),
                })}
              </span>
            </Detail>
            <Detail label={t('explorer.tx.totals')}>
              <span className="inline-flex flex-wrap gap-x-3">
                {transaction.totalInputSats !== null && (
                  <span>
                    {t('explorer.tx.in')} <Amount sats={transaction.totalInputSats} />
                  </span>
                )}
                <span>
                  {t('explorer.tx.out')} <Amount sats={transaction.totalOutputSats} />
                </span>
              </span>
            </Detail>
            <Detail label={t('explorer.tx.properties')}>
              {[
                transaction.segwit ? t('explorer.tx.segwit') : t('explorer.tx.legacy'),
                transaction.signalsReplaceable ? t('explorer.tx.replaceable') : t('explorer.tx.final'),
                t('explorer.tx.version', { version: transaction.version }),
                lockTimeText(transaction),
              ].join(' · ')}
            </Detail>
          </DetailGrid>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer select-none font-medium">{t('explorer.tx.analysis')}</summary>
            <div className="mt-3">
              <TransactionAnalysisView transaction={transaction} policy={replacementPolicy(node)} />
            </div>
          </details>
          {transaction.mempool && (
            <section className="space-y-2" aria-labelledby="mempool-relatives">
              <h3 id="mempool-relatives" className="font-medium">
                {t('explorer.tx.relatives')}
              </h3>
              <p className="text-muted-foreground">
                {t('explorer.tx.relativesSummary', {
                  ancestors: transaction.mempool.ancestorCount - 1,
                  descendants: transaction.mempool.descendantCount - 1,
                })}
                {transaction.mempool.ancestorFeeRate !== null &&
                  ` ${t('explorer.tx.packageRate', { rate: formatNumber(transaction.mempool.ancestorFeeRate, { maximumFractionDigits: 2 }) })}`}
              </p>
              {transaction.mempool.depends.length > 0 && (
                <p>
                  {t('explorer.tx.spendsFrom')}{' '}
                  {transaction.mempool.depends.map((txid) => (
                    <span key={txid} className="mr-2">
                      <TransactionLink nodeId={nodeId} txid={txid} />
                    </span>
                  ))}
                </p>
              )}
              {transaction.mempool.spentBy.length > 0 && (
                <p>
                  {t('explorer.tx.spentBy')}{' '}
                  {transaction.mempool.spentBy.map((txid) => (
                    <span key={txid} className="mr-2">
                      <TransactionLink nodeId={nodeId} txid={txid} />
                    </span>
                  ))}
                </p>
              )}
            </section>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('explorer.tx.inputs', { count: transaction.inputs.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {transaction.inputs.map((input, index) => (
                <li
                  key={`${input.previous?.txid ?? 'coinbase'}:${String(input.previous?.vout ?? index)}`}
                  className="border-b pb-3 last:border-0"
                >
                  {input.coinbase !== undefined ? (
                    <p className="font-medium">{t('explorer.tx.coinbaseInput')}</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          {input.prevout?.script.address !== undefined ? (
                            <AddressLink nodeId={nodeId} address={input.prevout.script.address} />
                          ) : (
                            <span className="text-muted-foreground">
                              {input.prevout?.script.type ?? t('explorer.tx.unknownCoin')}
                            </span>
                          )}
                        </span>
                        {input.prevout && <Amount sats={input.prevout.valueSats} className="font-medium" />}
                      </div>
                      {input.previous && (
                        <p className="text-xs text-muted-foreground">
                          {t('explorer.tx.spends')} <TransactionLink nodeId={nodeId} txid={input.previous.txid} />:
                          {input.previous.vout}
                        </p>
                      )}
                    </>
                  )}
                  {(input.scriptSig?.asm ?? '') !== '' && input.scriptSig && (
                    <ScriptDetails
                      script={{ hex: input.scriptSig.hex, asm: input.scriptSig.asm, type: 'scriptSig' }}
                      label={t('explorer.tx.scriptSig')}
                    />
                  )}
                  {input.witness.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {t('explorer.tx.witness', { count: input.witness.length })}
                      </summary>
                      <ol className="mt-1 space-y-1 break-all font-mono text-xs">
                        {input.witness.map((item, itemIndex) => (
                          <li key={`${String(itemIndex)}-${item.slice(0, 16)}`}>{item === '' ? '—' : item}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('explorer.tx.outputs', { count: transaction.outputs.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {transaction.outputs.map((output) => (
                <li key={output.n} className="border-b pb-3 last:border-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <span className="mr-2 tabular text-muted-foreground">#{output.n}</span>
                      {output.script.address !== undefined ? (
                        <AddressLink nodeId={nodeId} address={output.script.address} />
                      ) : (
                        <span className="text-muted-foreground">{output.script.type}</span>
                      )}
                    </span>
                    <Amount sats={output.valueSats} className="font-medium" />
                  </div>
                  {output.unspent !== null && (
                    <p className="text-xs text-muted-foreground">
                      {output.unspent ? t('explorer.tx.unspent') : t('explorer.tx.spent')}
                    </p>
                  )}
                  <ScriptDetails script={output.script} label={t('explorer.tx.script')} />
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      {transaction.hex !== '' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('explorer.tx.raw')}</CardTitle>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                {t('explorer.tx.rawShow', { size: formatNumber(transaction.sizeBytes) })}
              </summary>
              <p className="mt-2 max-h-64 overflow-y-auto break-all font-mono text-xs">{transaction.hex}</p>
              <div className="mt-2">
                <CopyableValue value={transaction.hex} label={t('explorer.tx.raw')} className="max-w-full" />
              </div>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function TransactionView({ nodeId, txid }: { nodeId: string; txid: string }) {
  const { t } = useTranslation();
  const transaction = useExplorerTransaction(nodeId, txid);
  if (transaction.isError) {
    return (
      <ErrorPanel
        title={t('explorer.tx.notFound')}
        error={toOrchestratorError(transaction.error)}
        onRetry={() => void transaction.refetch()}
      />
    );
  }
  if (!transaction.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      {transaction.data.status.state === 'mempool' && <Note tone="info">{t('explorer.tx.following')}</Note>}
      <OpenInExplorers nodeId={nodeId} page={{ kind: 'transaction', txid: transaction.data.txid }} />
      <TransactionBody transaction={transaction.data} nodeId={nodeId} />
    </div>
  );
}
