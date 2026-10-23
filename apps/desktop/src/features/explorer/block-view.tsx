import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopyableValue } from '@/components/data/copyable-value';
import { StatTile } from '@/components/data/stat-tile';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpenInExplorers } from './remote-explorers';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatNumber, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { Amount, Detail, DetailGrid, FeeRate, TransactionLink } from './parts';
import { useExplorerBlock } from './queries';

// A block as the node keeps it: its header always, and on an unpruned node
// its statistics and transactions, a page at a time.

export function BlockView({ nodeId, id, page }: { nodeId: string; id: string; page: number }) {
  const { t } = useTranslation();
  const block = useExplorerBlock(nodeId, id, page);
  if (block.isError) {
    return (
      <ErrorPanel
        title={t('explorer.block.notFound')}
        error={toOrchestratorError(block.error)}
        onRetry={() => void block.refetch()}
      />
    );
  }
  const data = block.data;
  if (!data) return <Skeleton className="h-64" />;
  const pages = Math.max(1, Math.ceil(data.page.total / data.page.size));
  const stats = data.stats;
  return (
    <div className="space-y-6">
      <OpenInExplorers nodeId={nodeId} page={{ kind: 'block', hash: data.hash }} />
      <Card>
        <CardHeader>
          <CardTitle>{t('explorer.block.title', { height: formatNumber(data.height) })}</CardTitle>
          <div className="flex gap-2">
            <Button asChild variant="outline" disabled={data.previousHash === null}>
              {data.previousHash === null ? (
                <span aria-disabled="true">
                  <ChevronLeft aria-hidden="true" />
                  {t('explorer.block.previous')}
                </span>
              ) : (
                <Link to="/explorer" search={{ node: nodeId, block: data.previousHash }}>
                  <ChevronLeft aria-hidden="true" />
                  {t('explorer.block.previous')}
                </Link>
              )}
            </Button>
            <Button asChild variant="outline" disabled={data.nextHash === null}>
              {data.nextHash === null ? (
                <span aria-disabled="true">
                  {t('explorer.block.next')}
                  <ChevronRight aria-hidden="true" />
                </span>
              ) : (
                <Link to="/explorer" search={{ node: nodeId, block: data.nextHash }}>
                  {t('explorer.block.next')}
                  <ChevronRight aria-hidden="true" />
                </Link>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data.available && <Note tone="info">{t('explorer.block.pruned')}</Note>}
          <DetailGrid>
            <Detail label={t('explorer.block.hash')}>
              <CopyableValue value={data.hash} label={t('explorer.block.hash')} />
            </Detail>
            <Detail label={t('explorer.block.time')}>
              {formatTimestamp(new Date(data.time * 1000))}
              <span className="ml-2 text-muted-foreground">
                {t('explorer.block.confirmations', { count: Math.max(0, data.confirmations) })}
              </span>
            </Detail>
            <Detail label={t('explorer.block.transactions')}>
              <span className="tabular">{formatNumber(data.transactionCount)}</span>
            </Detail>
            {data.sizeBytes !== null && data.weight !== null && (
              <Detail label={t('explorer.block.size')}>
                <span className="tabular">
                  {t('explorer.block.sizeValue', {
                    size: formatBytes(data.sizeBytes),
                    weight: formatNumber(data.weight),
                  })}
                </span>
              </Detail>
            )}
            {data.coinbaseText !== null && (
              <Detail label={t('explorer.block.coinbaseText')}>
                <span className="break-all font-mono text-[13px]">{data.coinbaseText}</span>
              </Detail>
            )}
            <Detail label={t('explorer.block.difficulty')}>
              <span className="tabular">{formatNumber(data.difficulty, { maximumFractionDigits: 2 })}</span>
            </Detail>
            <Detail label={t('explorer.block.merkleRoot')}>
              <CopyableValue value={data.merkleRoot} label={t('explorer.block.merkleRoot')} />
            </Detail>
            <Detail label={t('explorer.block.header')}>
              <span className="font-mono text-[13px]">
                {t('explorer.block.headerValue', {
                  version: data.versionHex,
                  bits: data.bits,
                  nonce: formatNumber(data.nonce),
                })}
              </span>
            </Detail>
          </DetailGrid>
          {stats && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label={t('explorer.block.fees')} value={<Amount sats={stats.totalFeeSats} />} />
              <StatTile label={t('explorer.block.subsidy')} value={<Amount sats={stats.subsidySats} />} />
              <StatTile
                label={t('explorer.block.medianFeeRate')}
                value={<FeeRate value={stats.feeRatePercentiles[2] ?? null} />}
                context={t('explorer.block.feeRange', {
                  low: formatNumber(stats.feeRatePercentiles[0] ?? 0),
                  high: formatNumber(stats.feeRatePercentiles[4] ?? 0),
                })}
              />
              <StatTile
                label={t('explorer.block.coins')}
                value={<span className="tabular">{formatNumber(stats.outputs)}</span>}
                context={t('explorer.block.coinsContext', { inputs: formatNumber(stats.inputs) })}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {data.available && (
        <Card>
          <CardHeader>
            <CardTitle>{t('explorer.block.transactionsTitle')}</CardTitle>
            <span className="text-muted-foreground">
              {t('explorer.block.page', { page: data.page.index + 1, pages })}
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('explorer.block.txid')}</TableHead>
                    <TableHead className="text-right">{t('explorer.block.feeRateHeading')}</TableHead>
                    <TableHead className="text-right">{t('explorer.block.vsizeHeading')}</TableHead>
                    <TableHead className="text-right">{t('explorer.block.outputHeading')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.transactions.map((transaction) => (
                    <TableRow key={transaction.txid}>
                      <TableCell>
                        <TransactionLink nodeId={nodeId} txid={transaction.txid} />
                        {transaction.coinbase && (
                          <span className="ml-2 text-xs text-muted-foreground">{t('explorer.block.coinbase')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <FeeRate value={transaction.feeRate} />
                      </TableCell>
                      <TableCell className="tabular text-right">{formatNumber(transaction.vsize)}</TableCell>
                      <TableCell className="text-right">
                        <Amount sats={transaction.outputSats} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pages > 1 && (
              <nav className="flex items-center gap-2" aria-label={t('explorer.block.pages')}>
                <Button asChild variant="outline" disabled={page === 0}>
                  {page === 0 ? (
                    <span aria-disabled="true">{t('explorer.block.earlier')}</span>
                  ) : (
                    <Link to="/explorer" search={{ node: nodeId, block: data.hash, page: page - 1 }}>
                      {t('explorer.block.earlier')}
                    </Link>
                  )}
                </Button>
                <Button asChild variant="outline" disabled={page + 1 >= pages}>
                  {page + 1 >= pages ? (
                    <span aria-disabled="true">{t('explorer.block.later')}</span>
                  ) : (
                    <Link to="/explorer" search={{ node: nodeId, block: data.hash, page: page + 1 }}>
                      {t('explorer.block.later')}
                    </Link>
                  )}
                </Button>
              </nav>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
