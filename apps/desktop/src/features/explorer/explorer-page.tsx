import { Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExplorerOverview, NodeWithStatus, RawTransactionCheck, ScriptSummary } from '@btcortex/contracts';
import { StatTile } from '@/components/data/stat-tile';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { NetworkBadge } from '@/components/status/network-badge';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatCompact, formatNumber, formatRelativeTime } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useNodes } from '@/features/nodes/queries';
import { AddressView } from './address-view';
import { BlockView } from './block-view';
import { BlockLink, Detail, DetailGrid, FeeRate } from './parts';
import { useDecodeRaw, useDecodeScript, useExplorerOverview, useExplorerSearch } from './queries';
import { RemoteExplorers } from './remote-explorers';
import { TransactionBody, TransactionView } from './transaction-view';

// The explorer (specification section 12): search, the chain at a glance,
// and views of blocks, transactions and addresses, all from the chosen node.
// What a view shows is in the address bar, so it can be returned to.

export interface ExplorerSearch {
  node?: string;
  /** Text to look up as soon as the page opens. */
  q?: string;
  block?: string;
  page?: number;
  tx?: string;
  address?: string;
}

function HashRate({ value }: { value: number | null }) {
  if (value === null) return <span>—</span>;
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s', 'ZH/s'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  return (
    <span className="tabular">{`${formatNumber(scaled, { maximumFractionDigits: 1 })} ${units[unit] ?? ''}`}</span>
  );
}

function Overview({ nodeId, overview }: { nodeId: string; overview: ExplorerOverview }) {
  const { t } = useTranslation();
  const estimates = overview.feeEstimates;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('explorer.overview.height')}
          value={<BlockLink nodeId={nodeId} hash={overview.bestBlockHash} height={overview.height} />}
        />
        <StatTile label={t('explorer.overview.hashRate')} value={<HashRate value={overview.networkHashRate} />} />
        <StatTile
          label={t('explorer.overview.transactions')}
          value={
            <span className="tabular">{overview.transactions ? formatCompact(overview.transactions.count) : '—'}</span>
          }
          context={
            overview.transactions?.perSecond !== null && overview.transactions?.perSecond !== undefined
              ? t('explorer.overview.perSecond', {
                  rate: formatNumber(overview.transactions.perSecond, { maximumFractionDigits: 1 }),
                })
              : undefined
          }
        />
        <StatTile
          label={t('explorer.overview.mempool')}
          value={<span className="tabular">{formatNumber(overview.mempool.transactions)}</span>}
          context={t('explorer.overview.mempoolContext', {
            size: formatBytes(overview.mempool.vsize),
            rate: formatNumber(overview.mempool.minimumFeeRate, { maximumFractionDigits: 2 }),
          })}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('explorer.overview.feesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label={t('explorer.overview.nextBlock')} value={<FeeRate value={estimates.nextBlock} />} />
            <StatTile label={t('explorer.overview.halfHour')} value={<FeeRate value={estimates.halfHour} />} />
            <StatTile label={t('explorer.overview.hour')} value={<FeeRate value={estimates.hour} />} />
            <StatTile label={t('explorer.overview.day')} value={<FeeRate value={estimates.day} />} />
          </div>
          <p className="text-xs text-muted-foreground">{t('explorer.overview.feesNote')}</p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {overview.pruned && (
          <Note tone="info">
            {t('explorer.overview.pruned', {
              height: overview.pruneHeight === null ? '—' : formatNumber(overview.pruneHeight),
            })}
          </Note>
        )}
        {!overview.transactionIndex && <Note tone="info">{t('explorer.overview.noTxindex')}</Note>}
        {!overview.addressLookups && (
          <Note tone="info">
            {t('explorer.overview.noAddresses')}{' '}
            <Link to="/electrum" className="underline underline-offset-2">
              {t('navigation.electrum')}
            </Link>
          </Note>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('explorer.overview.recentTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('explorer.overview.heightHeading')}</TableHead>
                  <TableHead>{t('explorer.overview.timeHeading')}</TableHead>
                  <TableHead className="text-right">{t('explorer.overview.txsHeading')}</TableHead>
                  <TableHead className="text-right">{t('explorer.overview.sizeHeading')}</TableHead>
                  <TableHead className="text-right">{t('explorer.overview.medianHeading')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.recentBlocks.map((block) => (
                  <TableRow key={block.hash}>
                    <TableCell>
                      <BlockLink nodeId={nodeId} hash={block.hash} height={block.height} />
                    </TableCell>
                    <TableCell>{formatRelativeTime(block.time * 1000)}</TableCell>
                    <TableCell className="tabular text-right">{formatNumber(block.transactionCount)}</TableCell>
                    <TableCell className="tabular text-right">
                      {block.sizeBytes > 0 ? formatBytes(block.sizeBytes) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <FeeRate value={block.medianFeeRate} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScriptView({ script }: { script: ScriptSummary }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('explorer.script.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <DetailGrid>
          <Detail label={t('explorer.scriptType')}>
            <span className="font-mono text-[13px]">{script.type}</span>
          </Detail>
          {script.address !== undefined && (
            <Detail label={t('explorer.address.address')}>
              <span className="break-all font-mono text-[13px]">{script.address}</span>
            </Detail>
          )}
          <Detail label={t('explorer.scriptAsm')}>
            <span className="break-all font-mono text-[13px]">{script.asm === '' ? '—' : script.asm}</span>
          </Detail>
          {script.descriptor !== undefined && (
            <Detail label={t('explorer.descriptor')}>
              <span className="break-all font-mono text-[13px]">{script.descriptor}</span>
            </Detail>
          )}
        </DetailGrid>
      </CardContent>
    </Card>
  );
}

function RawView({ nodeId, check }: { nodeId: string; check: RawTransactionCheck }) {
  const { t } = useTranslation();
  const acceptance = check.acceptance;
  return (
    <div className="space-y-4">
      {acceptance && (
        <StatusIndicator
          tone={acceptance.allowed ? 'healthy' : 'failed'}
          label={
            acceptance.allowed
              ? t('explorer.raw.accepted')
              : t('explorer.raw.rejected', { reason: acceptance.reason ?? t('explorer.raw.noReason') })
          }
          className="font-medium"
        />
      )}
      <Note tone="info">{t('explorer.raw.notBroadcast')}</Note>
      <TransactionBody transaction={check.transaction} nodeId={nodeId} />
    </div>
  );
}

type Local =
  | { kind: 'raw'; check: RawTransactionCheck }
  | { kind: 'script'; script: ScriptSummary }
  | { kind: 'none'; message: string };

export function ExplorerPage({ search }: { search: ExplorerSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const nodes = useNodes();
  const inputId = useId();
  const [query, setQuery] = useState(search.q ?? '');
  const [local, setLocal] = useState<Local>();
  const available = nodes.data ?? [];
  const chosen: NodeWithStatus | undefined =
    available.find((node) => node.profile.id === search.node) ??
    available.find((node) => node.status.state === 'running') ??
    available[0];
  const nodeId = chosen?.profile.id;
  const overview = useExplorerOverview(search.block || search.tx || search.address ? undefined : nodeId);
  const find = useExplorerSearch(nodeId);
  const decodeRaw = useDecodeRaw(nodeId);
  const decodeScript = useDecodeScript(nodeId);

  const go = (target: ExplorerSearch) => {
    setLocal(undefined);
    void navigate({ to: '/explorer', search: { ...(nodeId === undefined ? {} : { node: nodeId }), ...target } });
  };

  const lookUp = (value: string) => {
    const text = value.trim();
    if (text === '' || nodeId === undefined) return;
    // A new lookup starts clean: an earlier result, or an earlier decoding's failure, says nothing about this one.
    setLocal(undefined);
    decodeRaw.reset();
    decodeScript.reset();
    find.mutate(text, {
      onSuccess: (result) => {
        if (result.kind === 'block' && result.id) go({ block: result.id });
        else if (result.kind === 'transaction' && result.id) go({ tx: result.id });
        else if (result.kind === 'address' && result.id) go({ address: result.id });
        else if (result.kind === 'raw-transaction' && result.id) {
          decodeRaw.mutate(result.id, {
            onSuccess: (check) => {
              setLocal({ kind: 'raw', check });
            },
          });
        } else if (result.kind === 'script' && result.id) {
          decodeScript.mutate(result.id, {
            onSuccess: (script) => {
              setLocal({ kind: 'script', script });
            },
          });
        } else setLocal({ kind: 'none', message: result.message ?? t('explorer.search.nothing') });
      },
    });
  };
  const submit = () => {
    lookUp(query);
  };

  // A lookup asked for in the address (the command palette's) runs once the node is known.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || search.q === undefined || nodeId === undefined) return;
    asked.current = true;
    lookUp(search.q);
  });

  const failure = find.error ?? decodeRaw.error ?? decodeScript.error;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('explorer.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('explorer.description')}</p>
      </div>

      {nodes.isError ? (
        <ErrorPanel
          title={t('explorer.unavailable')}
          error={toOrchestratorError(nodes.error)}
          onRetry={() => void nodes.refetch()}
        />
      ) : !nodes.data ? (
        <Skeleton className="h-24" />
      ) : !chosen || nodeId === undefined ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="max-w-prose text-muted-foreground">{t('explorer.noNodes')}</p>
            <Button asChild>
              <Link to="/nodes/setup">{t('electrum.setUpNode')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="space-y-3"
            role="search"
          >
            <div className="flex flex-wrap items-end gap-3">
              {available.length > 1 && (
                <div className="space-y-1">
                  <Label htmlFor={`${inputId}-node`}>{t('explorer.node')}</Label>
                  <select
                    id={`${inputId}-node`}
                    value={nodeId}
                    onChange={(event) => {
                      setLocal(undefined);
                      void navigate({ to: '/explorer', search: { node: event.currentTarget.value } });
                    }}
                    className="h-9 rounded-md border bg-background px-2"
                  >
                    {available.map((node) => (
                      <option key={node.profile.id} value={node.profile.id}>
                        {node.profile.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor={inputId}>{t('explorer.search.label')}</Label>
                <Input
                  id={inputId}
                  value={query}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('explorer.search.placeholder')}
                  onChange={(event) => {
                    setQuery(event.currentTarget.value);
                  }}
                  className="font-mono"
                />
              </div>
              <Button type="submit" disabled={find.isPending || query.trim() === ''}>
                <Search aria-hidden="true" />
                {t('explorer.search.action')}
              </Button>
            </div>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <NetworkBadge network={chosen.profile.network} />
              {t('explorer.search.hint')}
            </p>
          </form>

          {failure && <ErrorPanel title={t('errors.actionFailed')} error={toOrchestratorError(failure)} />}
          {local?.kind === 'none' && (
            <Note tone="info">
              {local.message} {t('explorer.search.suggestions')}
            </Note>
          )}
          {local?.kind === 'raw' && <RawView nodeId={nodeId} check={local.check} />}
          {local?.kind === 'script' && <ScriptView script={local.script} />}

          {!local &&
            (search.block ? (
              <BlockView nodeId={nodeId} id={search.block} page={search.page ?? 0} />
            ) : search.tx ? (
              <TransactionView nodeId={nodeId} txid={search.tx} />
            ) : search.address ? (
              <AddressView nodeId={nodeId} address={search.address} />
            ) : overview.isError ? (
              <ErrorPanel
                title={t('explorer.unavailable')}
                error={toOrchestratorError(overview.error)}
                onRetry={() => void overview.refetch()}
              />
            ) : overview.data ? (
              <>
                <Overview nodeId={nodeId} overview={overview.data} />
                <RemoteExplorers />
              </>
            ) : (
              <Skeleton className="h-64" />
            ))}
        </>
      )}
    </div>
  );
}
