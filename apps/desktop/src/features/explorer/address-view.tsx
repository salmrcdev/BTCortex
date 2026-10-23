import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CopyableValue } from '@/components/data/copyable-value';
import { StatTile } from '@/components/data/stat-tile';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { Amount, Detail, DetailGrid, TransactionLink } from './parts';
import { OpenInExplorers } from './remote-explorers';
import { useExplorerAddress } from './queries';

// An address: its script always, and its history only from the node's own
// Electrum server; Bitcoin Core keeps no index of addresses, and BTCortex
// asks no outside service.

export function AddressView({ nodeId, address }: { nodeId: string; address: string }) {
  const { t } = useTranslation();
  const detail = useExplorerAddress(nodeId, address);
  if (detail.isError) {
    return (
      <ErrorPanel
        title={t('explorer.address.failed')}
        error={toOrchestratorError(detail.error)}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const data = detail.data;
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      <OpenInExplorers nodeId={nodeId} page={{ kind: 'address', address: data.address }} />
      <Card>
        <CardHeader>
          <CardTitle>{t('explorer.address.title')}</CardTitle>
          {data.source === 'electrum-server' && (
            <StatusIndicator tone="healthy" label={t('explorer.address.fromOwnServer')} />
          )}
          {data.source === 'remote-electrum-server' && (
            <StatusIndicator
              tone="healthy"
              label={t('explorer.address.fromRemoteServer', { name: data.sourceName ?? '' })}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailGrid>
            <Detail label={t('explorer.address.address')}>
              <CopyableValue value={data.address} label={t('explorer.address.address')} />
            </Detail>
            <Detail label={t('explorer.scriptType')}>
              <span className="font-mono text-[13px]">{data.script.type}</span>
            </Detail>
            <Detail label={t('explorer.address.scripthash')}>
              <CopyableValue value={data.scripthash} label={t('explorer.address.scripthash')} />
            </Detail>
          </DetailGrid>
          {data.source === 'unavailable' ? (
            <Note tone="info">
              {data.unavailableReason}{' '}
              <Link to="/electrum" className="underline underline-offset-2">
                {t('navigation.electrum')}
              </Link>
            </Note>
          ) : (
            data.balance && (
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  label={t('explorer.address.confirmed')}
                  value={<Amount sats={data.balance.confirmedSats} />}
                />
                <StatTile
                  label={t('explorer.address.unconfirmed')}
                  value={<Amount sats={data.balance.unconfirmedSats} />}
                />
                <StatTile
                  label={t('explorer.address.transactions')}
                  value={<span className="tabular">{formatNumber(data.history.length)}</span>}
                />
              </div>
            )
          )}
        </CardContent>
      </Card>

      {data.source !== 'unavailable' && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('explorer.address.historyTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.history.length === 0 ? (
                <p className="text-muted-foreground">{t('explorer.address.noHistory')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('explorer.block.txid')}</TableHead>
                        <TableHead className="text-right">{t('explorer.address.height')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.history.map((entry) => (
                        <TableRow key={entry.txid}>
                          <TableCell>
                            <TransactionLink nodeId={nodeId} txid={entry.txid} />
                          </TableCell>
                          <TableCell className="tabular text-right">
                            {entry.height > 0 ? formatNumber(entry.height) : t('explorer.address.inMempool')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('explorer.address.unspentTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.unspent.length === 0 ? (
                <p className="text-muted-foreground">{t('explorer.address.noUnspent')}</p>
              ) : (
                <ul className="space-y-2">
                  {data.unspent.map((coin) => (
                    <li
                      key={`${coin.txid}:${String(coin.vout)}`}
                      className="flex flex-wrap items-baseline justify-between gap-2"
                    >
                      <span>
                        <TransactionLink nodeId={nodeId} txid={coin.txid} />
                        <span className="text-muted-foreground">:{coin.vout}</span>
                      </span>
                      <Amount sats={coin.valueSats} className="font-medium" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
