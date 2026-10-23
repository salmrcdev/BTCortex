import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CoinScan, ScannedCoin } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/form-controls';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TransactionLink } from '@/features/explorer/parts';
import { formatBitcoin, formatNumber } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';
import { dustLimit } from '@/lib/transaction-analysis';
import { estimateSize, feeFor, inputTypeOf, spendCost } from '@/lib/transaction-size';
import type { InputType } from '@/lib/transaction-size';

// Coins (specification section 14): one output looked up in the node's UTXO
// set, or every coin of addresses and public descriptors, weighed against
// what spending it costs at the node's fee estimates — coins that cost more
// to spend than they are worth, new coins not yet spendable, coins that share
// an address, and what spending them all together would cost.

/** New coins (coinbase outputs) can be spent after this many confirmations. */
const COINBASE_MATURITY = 100;
const OUTPOINT = /^([0-9a-fA-F]{64}):(\d{1,6})$/;

function LookUpOutput({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [outpoint, setOutpoint] = useState('');
  const match = OUTPOINT.exec(outpoint.trim());
  const lookUp = useMutation({
    mutationFn: () =>
      callOrchestrator('devtools.output', {
        nodeId,
        txid: (match?.[1] ?? '').toLowerCase(),
        vout: Number(match?.[2] ?? 0),
      }),
  });
  const result = lookUp.data;
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('developer.coins.lookUp')}</CardTitle>
          <CardDescription>{t('developer.coins.lookUpHint')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (match) lookUp.mutate();
          }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`${id}-outpoint`}>{t('developer.coins.outpoint')}</Label>
            <Input
              id={`${id}-outpoint`}
              spellCheck={false}
              className="font-mono"
              placeholder="txid:0"
              value={outpoint}
              onChange={(event) => {
                setOutpoint(event.target.value);
              }}
            />
          </div>
          <Button type="submit" disabled={!match || lookUp.isPending}>
            {t('developer.coins.lookUpSubmit')}
          </Button>
        </form>
        {lookUp.isError && <ErrorPanel title={t('developer.coins.failed')} error={toOrchestratorError(lookUp.error)} />}
        {result &&
          (result.unspent ? (
            <div className="space-y-1">
              <StatusIndicator
                tone="healthy"
                label={
                  result.confirmations === 0
                    ? t('developer.coins.unspentMempool')
                    : t('developer.coins.unspent', { count: result.confirmations ?? 0 })
                }
              />
              <p>
                {formatBitcoin(result.valueSats ?? 0)} · {t(`developer.uri.types.${result.script?.type ?? 'unknown'}`)}
                {result.coinbase ? ` · ${t('developer.coins.coinbase')}` : ''}
              </p>
              {result.script?.address && (
                <p className="break-all font-mono text-[12px] text-muted-foreground">{result.script.address}</p>
              )}
            </div>
          ) : (
            <StatusIndicator tone="inactive" label={t('developer.coins.spent')} />
          ))}
      </CardContent>
    </Card>
  );
}

interface CoinView {
  coin: ScannedCoin;
  confirmations: number;
  costs: (number | null)[];
  dust: boolean;
  immature: boolean;
  /** Costs more to spend than it is worth at the slowest of the fee rates. */
  uneconomical: boolean;
}

function viewCoins(scan: CoinScan): CoinView[] {
  const slowest = Math.min(...scan.feeRates.map((rate) => rate.satPerVb));
  return (
    [...scan.coins]
      // Largest first, and the oldest first among coins of the same value.
      .sort((a, b) => b.valueSats - a.valueSats || a.height - b.height)
      .map((coin) => {
        const limit = dustLimit(coin.script);
        const slowCost = spendCost(coin.type, slowest);
        const confirmations = scan.height - coin.height + 1;
        return {
          coin,
          confirmations,
          costs: scan.feeRates.map((rate) => spendCost(coin.type, rate.satPerVb)),
          dust: limit !== null && coin.valueSats < limit,
          immature: coin.coinbase && confirmations < COINBASE_MATURITY,
          uneconomical: slowCost !== null && slowCost >= coin.valueSats,
        };
      })
  );
}

function ScanResult({ scan, nodeId }: { scan: CoinScan; nodeId: string }) {
  const { t } = useTranslation();
  const coins = viewCoins(scan);
  const shared = new Map<string, number>();
  for (const coin of scan.coins) shared.set(coin.script, (shared.get(coin.script) ?? 0) + 1);
  const reused = [...shared.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  // Spending every spendable coin of a known type at once, into one output of the commonest type.
  const spendable = coins.filter((view) => !view.immature && inputTypeOf(view.coin.type) !== null);
  const inputs: Partial<Record<InputType, number>> = {};
  for (const view of spendable) {
    const type = inputTypeOf(view.coin.type);
    if (type) inputs[type] = (inputs[type] ?? 0) + 1;
  }
  const size = estimateSize(inputs, { p2wpkh: 1 });
  const slowest = scan.feeRates.reduce(
    (low, rate) => (rate.satPerVb < low.satPerVb ? rate : low),
    scan.feeRates[0] ?? { blocks: 144, satPerVb: 1 },
  );
  const spendableSats = spendable.reduce((sum, view) => sum + view.coin.valueSats, 0);
  return (
    <div className="space-y-4">
      <p>
        {t('developer.coins.found', {
          count: scan.coins.length,
          total: formatBitcoin(scan.totalSats),
          height: formatNumber(scan.height),
        })}
      </p>
      <p className="text-muted-foreground">
        {t(scan.estimated ? 'developer.coins.ratesEstimated' : 'developer.coins.ratesExample', {
          rates: scan.feeRates
            .map((rate) => t('developer.coins.rate', { count: rate.blocks, rate: formatNumber(rate.satPerVb) }))
            .join(', '),
        })}
      </p>
      {coins.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('developer.coins.coin')}</TableHead>
                <TableHead>{t('developer.coins.type')}</TableHead>
                <TableHead className="text-right">{t('developer.coins.value')}</TableHead>
                <TableHead className="text-right">{t('developer.coins.confirmations')}</TableHead>
                {scan.feeRates.map((rate) => (
                  <TableHead key={rate.blocks} className="text-right">
                    {t('developer.coins.costAt', { rate: formatNumber(rate.satPerVb) })}
                  </TableHead>
                ))}
                <TableHead>{t('developer.coins.notes')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coins.map((view) => (
                <TableRow key={`${view.coin.txid}:${String(view.coin.vout)}`}>
                  <TableCell className="whitespace-nowrap">
                    <TransactionLink nodeId={nodeId} txid={view.coin.txid} />
                    <span className="text-muted-foreground">:{view.coin.vout}</span>
                  </TableCell>
                  <TableCell>{t(`developer.uri.types.${view.coin.type}`)}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right">
                    {formatBitcoin(view.coin.valueSats)}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatNumber(view.confirmations)}</TableCell>
                  {view.costs.map((cost, index) => (
                    <TableCell
                      key={scan.feeRates[index]?.blocks ?? index}
                      className="tabular whitespace-nowrap text-right"
                    >
                      {cost === null ? '—' : t('developer.coins.sats', { count: cost, value: formatNumber(cost) })}
                    </TableCell>
                  ))}
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {view.immature && <Badge variant="outline">{t('developer.coins.immature')}</Badge>}
                      {view.dust && <Badge variant="outline">{t('developer.coins.dust')}</Badge>}
                      {view.uneconomical && <Badge variant="outline">{t('developer.coins.uneconomical')}</Badge>}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {spendable.length > 1 && (
        <p>
          {t('developer.coins.together', {
            count: spendable.length,
            vsize: formatNumber(size.vsize),
            fee: formatBitcoin(feeFor(size.vsize, slowest.satPerVb)),
            rate: formatNumber(slowest.satPerVb),
            left: formatBitcoin(Math.max(0, spendableSats - feeFor(size.vsize, slowest.satPerVb))),
          })}
        </p>
      )}
      {reused > 1 && <Note tone="warning">{t('developer.coins.reused', { count: reused })}</Note>}
      {coins.some((view) => inputTypeOf(view.coin.type) === null) && (
        <Note tone="info">{t('developer.coins.unknownSize')}</Note>
      )}
    </div>
  );
}

function FindCoins({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const targets = text
    .split(/\s+/)
    .map((target) => target.trim())
    .filter((target) => target !== '');
  const scan = useMutation({
    mutationFn: () =>
      callOrchestrator('devtools.scan', { nodeId, targets: targets.slice(0, 20) }, { timeoutMs: 660_000 }),
  });
  const abort = useMutation({ mutationFn: () => callOrchestrator('devtools.scan.abort', { nodeId }) });
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('developer.coins.find')}</CardTitle>
          <CardDescription>{t('developer.coins.findHint')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (targets.length > 0) scan.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`${id}-targets`}>{t('developer.coins.targets')}</Label>
            <Textarea
              id={`${id}-targets`}
              rows={3}
              spellCheck={false}
              className="font-mono text-[12px]"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">{t('developer.decode.noPrivateKeys')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={targets.length === 0 || scan.isPending}>
              {t('developer.coins.findSubmit')}
            </Button>
            {scan.isPending && (
              <Button
                type="button"
                variant="outline"
                disabled={abort.isPending}
                onClick={() => {
                  abort.mutate();
                }}
              >
                {t('developer.coins.stop')}
              </Button>
            )}
          </div>
        </form>
        {scan.isPending && <p className="text-muted-foreground">{t('developer.coins.scanning')}</p>}
        {scan.isError && <ErrorPanel title={t('developer.coins.failed')} error={toOrchestratorError(scan.error)} />}
        {scan.data && <ScanResult scan={scan.data} nodeId={nodeId} />}
      </CardContent>
    </Card>
  );
}

export function CoinsTab({ nodeId }: { nodeId: string }) {
  return (
    <div className="space-y-6">
      <LookUpOutput nodeId={nodeId} />
      <FindCoins nodeId={nodeId} />
    </div>
  );
}
