import { Link } from '@tanstack/react-router';
import { Check, Info, Minus, Search } from 'lucide-react';
import { useId, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type {
  FeeRateBucket,
  MempoolOverview,
  MempoolTransaction,
  MetricsPoint,
  NodeWithStatus,
} from '@btcortex/contracts';
import { ColumnChart } from '@/components/charts/column-chart';
import { LineChart } from '@/components/charts/line-chart';
import { capacityTone, Meter } from '@/components/data/meter';
import { StatTile } from '@/components/data/stat-tile';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  formatBitcoin,
  formatBytes,
  formatClockTime,
  formatCompact,
  formatNumber,
  formatPercent,
  formatSatPerVb,
  formatSats,
  formatTimestamp,
  formatVirtualBytes,
  formatVirtualBytesAxis,
  truncateMiddle,
} from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { AddressLink, TransactionLink } from '@/features/explorer/parts';
import { useMempoolOverview, useMempoolTransaction, useNodeMetrics } from './queries';

// Mempool analysis (specification section 5.9). Every figure is this node's
// own view, and the page says so: other nodes can hold other transactions.

const BLOCK_MINUTES = 10;
const OUTPUT_ROWS = 100;
const TXID = /^[0-9a-f]{64}$/;

function bucketLabel(bucket: FeeRateBucket): string {
  return bucket.maximum === null ? `${String(bucket.minimum)}+` : `${String(bucket.minimum)}–${String(bucket.maximum)}`;
}

function approximateWait(minutes: number, t: TFunction): string {
  if (minutes < 60) return t('mempool.waitMinutes', { count: minutes });
  if (minutes < 24 * 60) return t('mempool.waitHours', { count: Math.round(minutes / 60) });
  return t('mempool.waitDays', { count: Math.round(minutes / (24 * 60)) });
}

function FeeDistribution({ overview, updatedAt }: { overview: MempoolOverview; updatedAt: number }) {
  const { t } = useTranslation();
  if (!overview.feeRateBuckets) return <p className="text-muted-foreground">{t('mempool.noDiagram')}</p>;
  return (
    <div className="space-y-2">
      <p>
        {overview.nextBlockMinimumSatPerVb === null
          ? t('mempool.fitsInOneBlock')
          : t('mempool.nextBlock', { rate: formatSatPerVb(overview.nextBlockMinimumSatPerVb) })}
      </p>
      <ColumnChart
        title={t('mempool.distributionTitle')}
        data={overview.feeRateBuckets.map((bucket) => ({
          key: String(bucket.minimum),
          label: bucketLabel(bucket),
          value: bucket.virtualBytes,
          detail: t('mempool.bucketFees', { fees: formatBitcoin(bucket.feeSats) }),
        }))}
        formatValue={(value) => formatVirtualBytes(value)}
        formatTick={formatVirtualBytesAxis}
        categoryHeading={t('mempool.bucketHeading')}
        valueHeading={t('mempool.sizeHeading')}
        detailHeading={t('mempool.feesHeading')}
      />
      <p className="text-xs text-muted-foreground">
        {t('mempool.distributionSource', { time: formatTimestamp(new Date(updatedAt)) })}
      </p>
    </div>
  );
}

type TrendMetric = 'size' | 'transactions' | 'minimumFee';

// One measure at a time: each has its own scale, and two scales never share an axis.
const TREND_METRICS: Record<
  TrendMetric,
  {
    read: (point: MetricsPoint) => number;
    format: (value: number) => string;
    tick: (value: number, maximum: number) => string;
  }
> = {
  size: {
    read: (point) => point.mempoolVirtualBytes,
    format: (value) => formatVirtualBytes(value, 1),
    tick: formatVirtualBytesAxis,
  },
  transactions: {
    read: (point) => point.mempoolTransactions,
    format: (value) => formatNumber(value),
    tick: (value) => formatNumber(value, { maximumFractionDigits: 1 }),
  },
  minimumFee: {
    read: (point) => point.mempoolMinimumFeeSatPerVb,
    format: (value) => formatSatPerVb(value),
    tick: (value) => formatSatPerVb(value),
  },
};

function Trend({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const metrics = useNodeMetrics(nodeId);
  const [metric, setMetric] = useState<TrendMetric>('size');
  if (metrics.isError) {
    return <ErrorPanel title={t('mempool.unavailable')} error={toOrchestratorError(metrics.error)} />;
  }
  if (!metrics.data) return <Skeleton className="h-48" />;
  const samples = metrics.data;
  if (samples.length < 2) return <p className="text-muted-foreground">{t('mempool.trendCollecting')}</p>;
  return (
    <Tabs
      value={metric}
      onValueChange={(value) => {
        setMetric(value as TrendMetric);
      }}
    >
      <TabsList aria-label={t('mempool.trendMetricsLabel')}>
        {(Object.keys(TREND_METRICS) as TrendMetric[]).map((key) => (
          <TabsTrigger key={key} value={key}>
            {t(`mempool.trendMetrics.${key}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {(Object.keys(TREND_METRICS) as TrendMetric[]).map((key) => {
        const { read, format, tick } = TREND_METRICS[key];
        return (
          <TabsContent key={key} value={key} className="mt-2 space-y-2">
            <LineChart
              title={t(`mempool.trendCharts.${key}`)}
              points={samples.map((point) => ({ x: Date.parse(point.at), y: read(point) }))}
              formatY={format}
              formatTick={tick}
              formatX={(time) => formatClockTime(time)}
              formatXLong={(time) => formatTimestamp(new Date(time))}
              xHeading={t('mempool.timeHeading')}
              yHeading={t(`mempool.trendMetrics.${key}`)}
            />
          </TabsContent>
        );
      })}
      <p className="mt-2 text-xs text-muted-foreground">{t('mempool.trendSource')}</p>
    </Tabs>
  );
}

function Estimates({ overview }: { overview: MempoolOverview }) {
  const { t } = useTranslation();
  const anyEstimate = overview.estimates.some((estimate) => estimate.satPerVb !== null);
  return (
    <div className="space-y-2">
      {!anyEstimate && <p className="text-muted-foreground">{t('mempool.noEstimates')}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('mempool.targetHeading')}</TableHead>
            <TableHead className="text-right">{t('mempool.feeRateHeading')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {overview.estimates.map((estimate) => (
            <TableRow key={estimate.target}>
              <TableCell>
                {t('mempool.target', {
                  count: estimate.target,
                  time: approximateWait(estimate.target * BLOCK_MINUTES, t),
                })}
              </TableCell>
              <TableCell className="tabular text-right">
                {estimate.satPerVb === null ? '—' : formatSatPerVb(estimate.satPerVb)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t('mempool.estimatesSource')}</p>
    </div>
  );
}

function Policy({ overview }: { overview: MempoolOverview }) {
  const { t } = useTranslation();
  const rows: { label: string; value: string; help: string }[] = [
    {
      label: t('mempool.policyMinimumRelay'),
      value: formatSatPerVb(overview.minimumRelayFeeSatPerVb),
      help: t('mempool.policyMinimumRelayHelp'),
    },
    {
      label: t('mempool.policyMinimumNow'),
      value: formatSatPerVb(overview.minimumFeeSatPerVb),
      help: t('mempool.policyMinimumNowHelp'),
    },
    {
      label: t('mempool.policyIncremental'),
      value: formatSatPerVb(overview.incrementalRelayFeeSatPerVb),
      help: t('mempool.policyIncrementalHelp'),
    },
    {
      label: t('mempool.policyReplacement'),
      value: overview.fullRbf ? t('mempool.fullRbfOn') : t('mempool.fullRbfOff'),
      help: overview.fullRbf ? t('mempool.fullRbfOnHelp') : t('mempool.fullRbfOffHelp'),
    },
  ];
  if (overview.clusterLimitCount !== undefined && overview.clusterLimitVirtualBytes !== undefined) {
    rows.push({
      label: t('mempool.policyCluster'),
      value: t('mempool.clusterValue', {
        count: overview.clusterLimitCount,
        size: formatVirtualBytes(overview.clusterLimitVirtualBytes, 0),
      }),
      help: t('mempool.policyClusterHelp'),
    });
  }
  if (overview.maxDataCarrierBytes !== undefined) {
    rows.push({
      label: t('mempool.policyDataCarrier'),
      value: formatBytes(overview.maxDataCarrierBytes, 0),
      help: t('mempool.policyDataCarrierHelp'),
    });
  }
  return (
    <div className="space-y-4">
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-medium">{row.value}</dd>
            <dd className="text-xs text-muted-foreground">{row.help}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="relay-features" className="space-y-2">
        <h3 id="relay-features" className="font-medium">
          {t('mempool.featuresTitle')}
        </h3>
        {overview.policyFeatures === null ? (
          <p className="text-muted-foreground">{t('mempool.featuresUnknown')}</p>
        ) : (
          <ul className="space-y-2">
            {overview.policyFeatures.map((feature) => (
              <li key={feature.id} className="flex items-start gap-2">
                {feature.supported ? (
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <Minus aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <p>
                    {t(`mempool.features.${feature.id}.name`)}
                    <span className="text-muted-foreground">
                      {' · '}
                      {feature.supported
                        ? t('mempool.featureSince', { version: feature.since })
                        : t('mempool.featureMissing', { version: feature.since })}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{t(`mempool.features.${feature.id}.help`)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Replacement({ transaction }: { transaction: MempoolTransaction }) {
  const { t } = useTranslation();
  const terms = transaction.replacement;
  return (
    <section aria-labelledby="replacement-heading" className="space-y-1">
      <h3 id="replacement-heading" className="font-medium">
        {t('mempool.replacementTitle')}
      </h3>
      {terms === null ? (
        <p>{t('mempool.notReplaceable')}</p>
      ) : (
        <>
          <p>
            {t('mempool.replacementMinimum', {
              fee: formatSats(terms.minimumFeeSats),
              rate: formatSatPerVb(terms.minimumSatPerVb),
            })}
          </p>
          <p className="text-muted-foreground">
            {terms.evicts === 0
              ? t('mempool.replacementWhyAlone', { replaced: formatSats(terms.replacedFeeSats) })
              : t('mempool.replacementWhy', { count: terms.evicts, replaced: formatSats(terms.replacedFeeSats) })}
          </p>
          {terms.mustImproveDiagram && <p className="text-muted-foreground">{t('mempool.replacementDiagram')}</p>}
        </>
      )}
    </section>
  );
}

function Relatives({ count, virtualBytes }: { count: number; virtualBytes: number }) {
  const { t } = useTranslation();
  // Bitcoin Core counts the transaction itself among its ancestors and descendants.
  const others = count - 1;
  if (others <= 0) return <>{t('mempool.packageNone')}</>;
  return <>{t('mempool.package', { count: others, size: formatVirtualBytes(virtualBytes) })}</>;
}

function TransactionDetail({ nodeId, transaction }: { nodeId: string; transaction: MempoolTransaction }) {
  const { t } = useTranslation();
  const effective = transaction.chunk.satPerVb;
  const boosted = effective > transaction.satPerVb * 1.05;
  const held = effective < transaction.satPerVb * 0.95;
  const chunks = transaction.cluster?.chunks ?? [];
  return (
    <div className="space-y-4">
      <p>
        <Link to="/explorer" search={{ node: nodeId, tx: transaction.txid }} className="underline underline-offset-2">
          {t('mempool.openInExplorer')}
        </Link>
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('mempool.ownFeeRate')} value={formatSatPerVb(transaction.satPerVb)} />
        <StatTile label={t('mempool.chunkFeeRate')} value={formatSatPerVb(effective)} />
        <StatTile label={t('mempool.fee')} value={formatSats(transaction.feeSats)} />
        <StatTile label={t('mempool.size')} value={formatVirtualBytes(transaction.virtualBytes)} />
      </div>
      <p className="flex items-start gap-2">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
        <span>
          {boosted
            ? t('mempool.cpfpBoosted', { rate: formatSatPerVb(effective) })
            : held
              ? t('mempool.cpfpHeld', { rate: formatSatPerVb(effective) })
              : t('mempool.cpfpNone')}
        </span>
      </p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('mempool.seen')}</dt>
          <dd>{formatTimestamp(new Date(transaction.seenAt * 1000))}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('mempool.replaceable')}</dt>
          <dd>{transaction.replaceable ? t('common.yes') : t('common.no')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('mempool.ancestors')}</dt>
          <dd>
            <Relatives count={transaction.ancestors.count} virtualBytes={transaction.ancestors.virtualBytes} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('mempool.descendants')}</dt>
          <dd>
            <Relatives count={transaction.descendants.count} virtualBytes={transaction.descendants.virtualBytes} />
          </dd>
        </div>
      </dl>
      {transaction.unbroadcast && <p className="text-muted-foreground">{t('mempool.unbroadcast')}</p>}
      <Replacement transaction={transaction} />
      {transaction.cluster && chunks.length > 1 && (
        <Table>
          <TableCaption>{t('mempool.clusterCaption', { count: transaction.cluster.transactions })}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('mempool.chunkHeading')}</TableHead>
              <TableHead>{t('mempool.transactionsHeading')}</TableHead>
              <TableHead className="text-right">{t('mempool.feeRateHeading')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chunks.map((chunk, index) => (
              <TableRow key={chunk.txids.join()}>
                <TableCell className="tabular">{index + 1}</TableCell>
                <TableCell className="font-mono text-[13px]">
                  {chunk.txids.map((txid) =>
                    txid === transaction.txid ? (
                      <span key={txid} className="block font-semibold" title={txid}>
                        {truncateMiddle(txid, 10, 10)}
                      </span>
                    ) : (
                      <span key={txid} className="block">
                        <TransactionLink nodeId={nodeId} txid={txid} />
                      </span>
                    ),
                  )}
                </TableCell>
                <TableCell className="tabular text-right">{formatSatPerVb(chunk.satPerVb)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Table>
        {transaction.outputs.length > OUTPUT_ROWS && (
          <TableCaption>
            {t('mempool.outputsShown', {
              shown: formatNumber(OUTPUT_ROWS),
              total: formatNumber(transaction.outputs.length),
            })}
          </TableCaption>
        )}
        <TableHeader>
          <TableRow>
            <TableHead>{t('mempool.outputHeading')}</TableHead>
            <TableHead>{t('mempool.addressHeading')}</TableHead>
            <TableHead className="text-right">{t('mempool.amountHeading')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transaction.outputs.slice(0, OUTPUT_ROWS).map((output) => (
            <TableRow key={output.index}>
              <TableCell className="tabular">{output.index}</TableCell>
              <TableCell className="max-w-96 truncate font-mono text-[13px]" title={output.address ?? output.type}>
                {output.address === undefined ? output.type : <AddressLink nodeId={nodeId} address={output.address} />}
              </TableCell>
              <TableCell className="tabular text-right">{formatBitcoin(output.valueSats)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TransactionLookup({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [text, setText] = useState('');
  const [txid, setTxid] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const transaction = useMempoolTransaction(nodeId, txid);
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = text.trim().toLowerCase();
          const valid = TXID.test(value);
          setInvalid(!valid);
          if (valid) setTxid(value);
        }}
      >
        <div className="min-w-64 flex-1 space-y-1">
          <Label htmlFor={inputId}>{t('mempool.txid')}</Label>
          <Input
            id={inputId}
            value={text}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            className="font-mono text-[13px]"
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </div>
        <Button type="submit">
          <Search aria-hidden="true" />
          {t('mempool.lookUp')}
        </Button>
      </form>
      {invalid && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {t('mempool.txidInvalid')}
        </p>
      )}
      {txid !== undefined &&
        (transaction.isError ? (
          <ErrorPanel title={t('mempool.lookUpFailed')} error={toOrchestratorError(transaction.error)} />
        ) : transaction.data ? (
          <TransactionDetail nodeId={nodeId} transaction={transaction.data} />
        ) : (
          <Skeleton className="h-32" />
        ))}
    </div>
  );
}

export function MempoolPage({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const nodeId = node.profile.id;
  const running = node.status.state === 'running';
  const overview = useMempoolOverview(nodeId, running);
  if (!running) return <p className="py-6 text-muted-foreground">{t('mempool.notRunning')}</p>;
  if (overview.isError) {
    return (
      <ErrorPanel
        title={t('mempool.unavailable')}
        error={toOrchestratorError(overview.error)}
        onRetry={() => void overview.refetch()}
      />
    );
  }
  if (!overview.data) return <Skeleton className="h-64" />;
  const data = overview.data;
  const usage = data.maxMemoryBytes > 0 ? data.memoryUsageBytes / data.maxMemoryBytes : 0;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-md border px-3 py-2">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
        <span>{t('mempool.ownView')}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('mempool.transactions')}
          value={formatCompact(data.transactions)}
          context={data.transactions >= 10_000 ? formatNumber(data.transactions) : undefined}
        />
        <StatTile label={t('mempool.size')} value={formatVirtualBytes(data.virtualBytes)} />
        <StatTile label={t('mempool.feesWaiting')} value={formatBitcoin(Math.round(data.totalFeeBtc * 100_000_000))} />
        <StatTile label={t('mempool.minimumToEnter')} value={formatSatPerVb(data.minimumFeeSatPerVb)} />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t('node.mempoolMemory')}</span>
          <span className="tabular">
            {t('node.mempoolMemoryOf', {
              used: formatBytes(data.memoryUsageBytes),
              max: formatBytes(data.maxMemoryBytes),
            })}{' '}
            ({formatPercent(usage)})
          </span>
        </div>
        <Meter
          tone={capacityTone(usage)}
          value={usage}
          label={t('node.mempoolMemory')}
          valueText={formatPercent(usage)}
        />
      </div>

      {/* The charts take the full width so that ten fee-rate buckets keep readable labels. */}
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t('mempool.distributionTitle')}</CardTitle>
            <CardDescription>{t('mempool.distributionDescription')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <FeeDistribution overview={data} updatedAt={overview.dataUpdatedAt} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t('mempool.trendTitle')}</CardTitle>
            <CardDescription>{t('mempool.trendDescription')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Trend nodeId={nodeId} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('mempool.estimatesTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Estimates overview={data} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('mempool.policyTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Policy overview={data} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t('mempool.lookUpTitle')}</CardTitle>
            <CardDescription>{t('mempool.lookUpDescription')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <TransactionLookup nodeId={nodeId} />
        </CardContent>
      </Card>
    </div>
  );
}
