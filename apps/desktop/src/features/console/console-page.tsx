import { useQuery } from '@tanstack/react-query';
import { CircleX, Copy, Lock, Play, Search, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeWithStatus, RpcCatalogueEntry, RpcRiskLevel } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, NativeSelect } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { CommandSyntaxError, parseCommand } from './parse-command';
import type { ParsedCommand } from './parse-command';
import { consoleKeys, useRpcCall, useRpcCatalogue, useRpcHelp, useRpcStatistics } from './queries';

// RPC console (specification section 5.7). Read-only mode is on by default;
// dangerous methods need confirmation; methods whose parameters can hold
// secrets are shown without them in the history and cannot be recalled.

interface ConsoleEntry {
  id: number;
  command: string;
  result?: string;
  error?: string;
  durationMs?: number;
}

/** What an unknown method is treated as, matching the orchestrator. */
const UNKNOWN: Pick<RpcCatalogueEntry, 'risk' | 'secret'> = { risk: 'dangerous', secret: true };

// The default wallet's name is empty, so choosing no wallet is kept apart from choosing it.
const NO_WALLET = 'none';
const WALLET_PREFIX = 'wallet:';

function RiskBadge({ entry }: { entry: Pick<RpcCatalogueEntry, 'risk' | 'blockedReason'> }) {
  const { t } = useTranslation();
  if (entry.blockedReason !== undefined) {
    return (
      <Badge>
        <Lock aria-hidden="true" />
        {t('console.risk.blocked')}
      </Badge>
    );
  }
  const variants: Record<RpcRiskLevel, 'neutral' | 'outline' | 'warning' | 'danger' | undefined> = {
    read: undefined,
    heavy: 'neutral',
    state: 'outline',
    dangerous: 'danger',
  };
  const variant = variants[entry.risk];
  return variant ? <Badge variant={variant}>{t(`console.risk.${entry.risk}`)}</Badge> : null;
}

function format(result: unknown): string {
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

export function ConsolePage({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const ids = { line: useId(), wallet: useId(), search: useId() };
  const nodeId = node.profile.id;
  const running = node.status.state === 'running';
  const catalogue = useRpcCatalogue(nodeId, running);
  const statistics = useRpcStatistics(nodeId, running);
  const call = useRpcCall(nodeId);
  const [readOnly, setReadOnly] = useState(true);
  const [line, setLine] = useState('');
  const [walletChoice, setWalletChoice] = useState(NO_WALLET);
  const wallet = walletChoice === NO_WALLET ? undefined : walletChoice.slice(WALLET_PREFIX.length);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [recall, setRecall] = useState<string[]>([]);
  const [recallIndex, setRecallIndex] = useState<number>();
  const [confirming, setConfirming] = useState<{ command: ParsedCommand; text: string }>();
  const input = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const help = useRpcHelp(nodeId, selected);
  const wallets = useQuery({
    queryKey: [...consoleKeys.catalogue(nodeId), 'wallets'],
    queryFn: () => callOrchestrator('nodes.rpc.call', { nodeId, method: 'listwallets', params: [], confirmed: false }),
    enabled: running,
    refetchInterval: 30_000,
  });
  const walletNames = Array.isArray(wallets.data?.result)
    ? wallets.data.result.filter((name): name is string => typeof name === 'string')
    : [];

  const byName = useMemo(() => new Map((catalogue.data ?? []).map((entry) => [entry.name, entry])), [catalogue.data]);
  const term = search.trim().toLowerCase();
  const visible = (catalogue.data ?? []).filter((entry) => term === '' || entry.name.includes(term));
  const categories = [...new Set(visible.map((entry) => entry.category))];

  useEffect(() => {
    // Keep the newest result in view, as a terminal does.
    const element = output.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries]);

  const add = (entry: Omit<ConsoleEntry, 'id'>) => {
    const id = nextId.current;
    nextId.current += 1;
    setEntries((current) => [...current, { id, ...entry }]);
  };

  const execute = (command: ParsedCommand, text: string, confirmed: boolean) => {
    const info = byName.get(command.method) ?? UNKNOWN;
    const shown =
      info.secret && command.params.length > 0 ? `${command.method} ${t('console.hiddenParameters')}` : text;
    if (!info.secret) setRecall((current) => [...current.filter((previous) => previous !== text), text]);
    setRecallIndex(undefined);
    setLine('');
    call.mutate(
      { ...command, wallet, confirmed },
      {
        onSuccess: ({ result, durationMs }) => {
          add({ command: shown, result: format(result), durationMs });
        },
        onError: (error) => {
          const failure = toOrchestratorError(error);
          add({ command: shown, error: failure.appError?.message ?? failure.message });
        },
      },
    );
  };

  const run = () => {
    const text = line.trim();
    if (text === '') return;
    let command: ParsedCommand;
    try {
      command = parseCommand(text);
    } catch (error) {
      add({ command: text, error: error instanceof CommandSyntaxError ? error.message : String(error) });
      return;
    }
    const info = byName.get(command.method);
    if (info?.blockedReason !== undefined) {
      add({ command: text, error: t('console.blocked', { method: command.method, reason: info.blockedReason }) });
      return;
    }
    const risk = (info ?? UNKNOWN).risk;
    if (readOnly && (risk === 'state' || risk === 'dangerous')) {
      add({ command: command.method, error: t('console.readOnlyRefused', { method: command.method }) });
      return;
    }
    if (risk === 'dangerous') {
      setConfirming({ command, text });
      return;
    }
    execute(command, text, false);
  };

  if (!running) return <p className="py-6 text-muted-foreground">{t('console.notRunning')}</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="xl:max-h-[46rem] xl:overflow-hidden">
          <CardHeader>
            <CardTitle>{t('console.catalogueTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <label htmlFor={ids.search} className="sr-only">
                {t('console.searchMethods')}
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id={ids.search}
                type="search"
                value={search}
                placeholder={t('console.searchMethods')}
                className="pl-8"
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </div>
            {catalogue.isError ? (
              <ErrorPanel title={t('console.catalogueFailed')} error={toOrchestratorError(catalogue.error)} />
            ) : !catalogue.data ? (
              <Skeleton className="h-64" />
            ) : (
              <div className="space-y-3 xl:max-h-[36rem] xl:overflow-y-auto">
                {categories.map((category) => (
                  <section key={category} aria-label={category}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
                    <ul className="mt-1">
                      {visible
                        .filter((entry) => entry.category === category)
                        .map((entry) => (
                          <li key={entry.name}>
                            <button
                              type="button"
                              aria-current={selected === entry.name ? 'true' : undefined}
                              className={cn(
                                'flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-left font-mono text-[13px] hover:bg-muted',
                                selected === entry.name && 'bg-muted',
                              )}
                              onClick={() => {
                                setSelected(entry.name);
                                setLine(`${entry.name} `);
                                input.current?.focus();
                              }}
                            >
                              <span className="truncate">{entry.name}</span>
                              <RiskBadge entry={entry} />
                            </button>
                          </li>
                        ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <div className="space-y-1">
                <CardTitle>{t('console.title')}</CardTitle>
                <CardDescription>{t('console.description')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-start gap-2">
                  <Checkbox
                    checked={readOnly}
                    onChange={(event) => {
                      setReadOnly(event.target.checked);
                    }}
                  />
                  <span>{t('console.readOnly')}</span>
                </label>
                <div className="flex items-center gap-2">
                  <label htmlFor={ids.wallet} className="text-sm font-medium">
                    {t('console.wallet')}
                  </label>
                  <NativeSelect
                    id={ids.wallet}
                    value={walletChoice}
                    onChange={(event) => {
                      setWalletChoice(event.target.value);
                    }}
                  >
                    <option value={NO_WALLET}>{t('console.noWallet')}</option>
                    {walletNames.map((name) => (
                      <option key={name} value={`${WALLET_PREFIX}${name}`}>
                        {name === '' ? t('console.defaultWallet') : name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div
                ref={output}
                role="log"
                aria-label={t('console.outputLabel')}
                aria-live="polite"
                className="h-80 overflow-y-auto rounded-md border bg-background p-3 font-mono text-[13px]"
              >
                {entries.length === 0 ? (
                  <p className="font-sans text-muted-foreground">{t('console.empty')}</p>
                ) : (
                  entries.map((entry) => (
                    <div key={entry.id} className="mb-3">
                      <p className="text-muted-foreground">› {entry.command}</p>
                      {entry.error !== undefined ? (
                        <p className="flex items-start gap-2 whitespace-pre-wrap break-words font-sans text-danger">
                          <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                          <span>{entry.error}</span>
                        </p>
                      ) : (
                        <div className="group relative">
                          <pre className="whitespace-pre-wrap break-words">{entry.result}</pre>
                          <div className="mt-1 flex items-center gap-2 font-sans text-xs text-muted-foreground">
                            <span>{t('console.duration', { ms: formatNumber(entry.durationMs ?? 0) })}</span>
                            <button
                              type="button"
                              className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
                              onClick={() => {
                                void navigator.clipboard.writeText(entry.result ?? '').then(() => {
                                  toast.success(t('common.copied'));
                                });
                              }}
                            >
                              <Copy aria-hidden="true" className="size-3" />
                              {t('console.copyResult')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run();
                }}
              >
                <div className="min-w-72 flex-1 space-y-1">
                  <label htmlFor={ids.line} className="text-sm font-medium">
                    {t('console.command')}
                  </label>
                  <Input
                    ref={input}
                    id={ids.line}
                    value={line}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="getblockchaininfo"
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      setLine(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                      if (recall.length === 0) return;
                      event.preventDefault();
                      const last = recall.length - 1;
                      const next =
                        event.key === 'ArrowUp'
                          ? Math.max(0, (recallIndex ?? recall.length) - 1)
                          : Math.min(last + 1, (recallIndex ?? last) + 1);
                      setRecallIndex(next > last ? undefined : next);
                      setLine(next > last ? '' : (recall[next] ?? ''));
                    }}
                  />
                </div>
                <Button type="submit" disabled={call.isPending || line.trim() === ''}>
                  <Play aria-hidden="true" />
                  {call.isPending ? t('console.running') : t('console.run')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={entries.length === 0}
                  onClick={() => {
                    setEntries([]);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  {t('console.clear')}
                </Button>
              </form>
            </CardContent>
          </Card>

          {selected !== undefined && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="font-mono">{selected}</CardTitle>
                  {byName.get(selected) && <RiskBadge entry={byName.get(selected) ?? UNKNOWN} />}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {byName.get(selected)?.blockedReason && <p>{byName.get(selected)?.blockedReason}</p>}
                {help.isError ? (
                  <ErrorPanel
                    title={t('console.helpFailed')}
                    error={toOrchestratorError(help.error)}
                    onRetry={() => void help.refetch()}
                  />
                ) : help.data ? (
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[13px]">
                    {help.data.text}
                  </pre>
                ) : (
                  <Skeleton className="h-24" />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t('console.statisticsTitle')}</CardTitle>
            <CardDescription>{t('console.statisticsDescription')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {statistics.isError ? (
            <ErrorPanel
              title={t('console.statisticsFailed')}
              error={toOrchestratorError(statistics.error)}
              onRetry={() => void statistics.refetch()}
            />
          ) : !statistics.data ? (
            <Skeleton className="h-16" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('console.statisticsMethod')}</TableHead>
                  <TableHead className="text-right">{t('console.statisticsCalls')}</TableHead>
                  <TableHead className="text-right">{t('console.statisticsErrors')}</TableHead>
                  <TableHead className="text-right">{t('console.statisticsAverage')}</TableHead>
                  <TableHead className="text-right">{t('console.statisticsSlowest')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statistics.data.slice(0, 15).map((row) => (
                  <TableRow key={row.method}>
                    <TableCell className="font-mono text-[13px]">{row.method}</TableCell>
                    <TableCell className="tabular text-right">{formatNumber(row.calls)}</TableCell>
                    <TableCell className="tabular text-right">{formatNumber(row.errors)}</TableCell>
                    <TableCell className="tabular text-right">{`${formatNumber(row.averageMs)} ms`}</TableCell>
                    <TableCell className="tabular text-right">{`${formatNumber(row.maxMs)} ms`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{t('console.confirmTitle', { method: confirming?.command.method ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t('console.confirmBody')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (confirming) execute(confirming.command, confirming.text, true);
              }}
            >
              {t('console.confirmRun')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
