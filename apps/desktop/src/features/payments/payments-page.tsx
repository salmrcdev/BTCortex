import { RefreshCw, ShieldCheck, Store } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { btcpayAuthorizeUrl, BTCPAY_READ_ONLY_PERMISSIONS } from '@btcortex/contracts';
import type {
  PaymentDashboard,
  PaymentInvoice,
  PaymentInvoiceStatus,
  PaymentServerVia,
  PaymentServerWithStatus,
  PaymentStore,
} from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { ExternalLink } from '@/components/data/external-link';
import { StatTile } from '@/components/data/stat-tile';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import type { StatusTone } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form-controls';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { usePaymentActions, usePaymentDashboard, usePaymentServers } from './queries';

// Payments & merchants (specification sections 13 and 24.1, area 12): the
// BTCPay Server installations BTCortex watches through the Greenfield API
// with a read-only key — their state, and for each store its payment methods,
// on-chain balance and the invoices of the last 30 days. BTCPay Server runs
// on Linux, so BTCortex connects to one rather than installing it.

const STATE_TONES: Record<PaymentServerWithStatus['status']['state'], StatusTone> = {
  checking: 'working',
  online: 'healthy',
  synchronising: 'working',
  unreachable: 'failed',
  unauthorised: 'attention',
};
const INVOICE_TONES: Record<PaymentInvoiceStatus, StatusTone> = {
  New: 'unknown',
  Processing: 'working',
  Settled: 'healthy',
  Expired: 'inactive',
  Invalid: 'failed',
};
const COUNTED: readonly PaymentInvoiceStatus[] = ['Settled', 'Processing', 'New', 'Expired', 'Invalid'];

/** An amount in its currency; BTCPay gives decimal strings, and BTC is not an ISO currency. */
export function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  if (currency === 'BTC' || currency === 'SATS') return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

function ConnectCard({ onConnected }: { onConnected: (serverId: string) => void }) {
  const { t } = useTranslation();
  const formId = useId();
  const onError = useErrorFeedback();
  const actions = usePaymentActions();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [via, setVia] = useState<PaymentServerVia>('direct');
  const trimmed = url.trim();
  const onion = /^https?:\/\/[^/]+\.onion(?::\d+)?(\/|$)/i.test(trimmed);
  const looksValid = /^https?:\/\/[^/\s]+/i.test(trimmed);
  const effectiveVia = onion ? 'tor' : via;
  const complete = name.trim() !== '' && looksValid && apiKey.trim().length >= 10;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('payments.connect.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!complete) return;
            actions.add.mutate(
              { name: name.trim(), url: trimmed, apiKey: apiKey.trim(), via: effectiveVia },
              {
                onSuccess: (added) => {
                  toast.success(t('payments.connect.connected', { name: added.server.name }));
                  setApiKey('');
                  onConnected(added.server.id);
                },
                onError,
              },
            );
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-name`}>{t('payments.connect.name')}</Label>
              <Input
                id={`${formId}-name`}
                value={name}
                maxLength={80}
                placeholder={t('payments.connect.namePlaceholder')}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-url`}>{t('payments.connect.url')}</Label>
              <Input
                id={`${formId}-url`}
                value={url}
                spellCheck={false}
                placeholder="https://pay.example.com"
                aria-describedby={`${formId}-url-hint`}
                onChange={(event) => {
                  setUrl(event.target.value);
                }}
              />
              <p id={`${formId}-url-hint`} className="text-xs text-muted-foreground">
                {t('payments.connect.urlHint')}
              </p>
            </div>
          </div>
          {!onion && (
            <RadioCards
              label={t('payments.connect.via')}
              value={via}
              onValueChange={setVia}
              className="md:grid-cols-2"
              options={(['direct', 'tor'] as const).map((value) => ({
                value,
                title: t(`payments.connect.vias.${value}.title`),
                description: t(`payments.connect.vias.${value}.description`),
              }))}
            />
          )}
          {onion && <Note tone="info">{t('payments.connect.onion')}</Note>}
          <div className="space-y-2 rounded-lg border p-3">
            <p className="flex items-center gap-2 font-medium">
              <ShieldCheck aria-hidden="true" className="size-4 text-success" />
              {t('payments.connect.keyTitle')}
            </p>
            <p className="max-w-prose text-muted-foreground">{t('payments.connect.keyHelp')}</p>
            <ul className="list-inside list-disc font-mono text-xs text-muted-foreground">
              {BTCPAY_READ_ONLY_PERMISSIONS.map((permission) => (
                <li key={permission}>{permission}</li>
              ))}
            </ul>
            {looksValid ? (
              <ExternalLink href={btcpayAuthorizeUrl(trimmed)}>{t('payments.connect.createKey')}</ExternalLink>
            ) : (
              <p className="text-xs text-muted-foreground">{t('payments.connect.createKeyHint')}</p>
            )}
            <div className="max-w-md space-y-1 pt-1">
              <Label htmlFor={`${formId}-key`}>{t('payments.connect.apiKey')}</Label>
              <Input
                id={`${formId}-key`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                }}
              />
            </div>
          </div>
          <Button type="submit" disabled={!complete || actions.add.isPending}>
            {actions.add.isPending ? t('payments.connect.testing') : t('payments.connect.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SetUpGuidance() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('payments.setUp.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="max-w-prose text-muted-foreground">{t('payments.setUp.body')}</p>
        <ExternalLink href="https://docs.btcpayserver.org/Deployment/">{t('payments.setUp.link')}</ExternalLink>
      </CardContent>
    </Card>
  );
}

function BackupGuidance() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('payments.backup.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>{t('payments.backup.script')}</li>
          <li>{t('payments.backup.lightning')}</li>
          <li>{t('payments.backup.test')}</li>
        </ul>
        <ExternalLink href="https://docs.btcpayserver.org/Docker/backup-restore/">
          {t('payments.backup.link')}
        </ExternalLink>
      </CardContent>
    </Card>
  );
}

function ServerCard({
  entry,
  selected,
  onSelect,
}: {
  entry: PaymentServerWithStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const { server, status } = entry;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'w-full space-y-1 rounded-lg border bg-card p-3 text-left transition-colors duration-150 hover:bg-muted',
        selected && 'border-primary bg-primary/5',
      )}
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{server.name}</span>
        <StatusIndicator tone={STATE_TONES[status.state]} label={t(`payments.states.${status.state}`)} />
      </span>
      <span className="block break-all font-mono text-xs text-muted-foreground">{server.url}</span>
      {status.version !== null && (
        <span className="block text-xs text-muted-foreground">
          {t('payments.server.version', { version: status.version })}
        </span>
      )}
    </button>
  );
}

function InvoicesTable({ invoices }: { invoices: readonly PaymentInvoice[] }) {
  const { t } = useTranslation();
  if (invoices.length === 0) return <p className="text-muted-foreground">{t('payments.store.noInvoices')}</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('payments.store.created')}</TableHead>
            <TableHead>{t('payments.store.status')}</TableHead>
            <TableHead className="text-right">{t('payments.store.amount')}</TableHead>
            <TableHead>{t('payments.store.order')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell className="whitespace-nowrap">{formatTimestamp(invoice.createdAt)}</TableCell>
              <TableCell>
                <StatusIndicator
                  tone={INVOICE_TONES[invoice.status]}
                  label={t(`payments.invoiceStates.${invoice.status}`)}
                />
              </TableCell>
              <TableCell className="tabular text-right">{formatAmount(invoice.amount, invoice.currency)}</TableCell>
              <TableCell className="font-mono text-xs">{invoice.orderId ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StoreCard({ store, permissions }: { store: PaymentStore; permissions: PaymentDashboard['permissions'] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Store aria-hidden="true" className="size-4" />
          {store.name}
        </CardTitle>
        <span className="flex flex-wrap items-center gap-2">
          {store.currency && <Badge variant="outline">{store.currency}</Badge>}
          {store.archived && <Badge variant="neutral">{t('payments.store.archived')}</Badge>}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" aria-label={t('payments.store.methods')}>
          {store.paymentMethods === null ? (
            <p className="text-muted-foreground">{t('payments.store.noMethods')}</p>
          ) : (
            store.paymentMethods.map((method) => (
              <Badge key={method.id} variant={method.enabled ? 'success' : 'outline'}>
                {t(`payments.methods.${method.id}`, { defaultValue: method.id })} ·{' '}
                {method.enabled ? t('payments.store.enabled') : t('payments.store.disabled')}
              </Badge>
            ))
          )}
        </div>
        {store.balance ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label={t('payments.store.balance')} value={`${store.balance.total} BTC`} />
            <StatTile label={t('payments.store.confirmed')} value={`${store.balance.confirmed} BTC`} />
            <StatTile label={t('payments.store.unconfirmed')} value={`${store.balance.unconfirmed} BTC`} />
          </div>
        ) : (
          !permissions.wallet && <p className="text-muted-foreground">{t('payments.store.noWallet')}</p>
        )}
        {store.invoices === null ? (
          <p className="text-muted-foreground">{t('payments.store.noInvoicePermission')}</p>
        ) : (
          <div className="space-y-3">
            <p className="font-medium">{t('payments.store.lastDays')}</p>
            <div className="grid gap-3 sm:grid-cols-5">
              {COUNTED.map((status) => (
                <StatTile
                  key={status}
                  label={t(`payments.invoiceStates.${status}`)}
                  value={String(store.invoices?.counts[status] ?? 0)}
                />
              ))}
            </div>
            {store.invoices.settled.length > 0 && (
              <p>
                {t('payments.store.settled', {
                  amounts: store.invoices.settled.map((entry) => formatAmount(entry.amount, entry.currency)).join(', '),
                })}
              </p>
            )}
            {!store.invoices.complete && <Note tone="info">{t('payments.store.incomplete')}</Note>}
            <InvoicesTable invoices={store.invoices.recent} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ServerDetail({ entry, onRemoved }: { entry: PaymentServerWithStatus; onRemoved: () => void }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const actions = usePaymentActions();
  const dashboard = usePaymentDashboard(entry.server.id);
  const { server, status } = entry;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{server.name}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={actions.refresh.isPending}
              onClick={() => {
                actions.refresh.mutate(server.id, { onError });
              }}
            >
              <RefreshCw
                aria-hidden="true"
                className={actions.refresh.isPending ? 'motion-safe:animate-spin' : undefined}
              />
              {t('payments.server.refresh')}
            </Button>
            <ConfirmButton
              label={t('payments.server.remove')}
              title={t('payments.server.removeTitle', { name: server.name })}
              confirmLabel={t('payments.server.removeConfirm')}
              disabled={actions.remove.isPending}
              onConfirm={() => {
                actions.remove.mutate(server.id, {
                  onSuccess: () => {
                    toast.success(t('payments.server.removed', { name: server.name }));
                    onRemoved();
                  },
                  onError,
                });
              }}
            >
              <p>{t('payments.server.removeBody')}</p>
            </ConfirmButton>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusIndicator tone={STATE_TONES[status.state]} label={t(`payments.states.${status.state}`)} />
          {status.error && <p className="text-muted-foreground">{status.error}</p>}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">{t('payments.server.address')}</dt>
            <dd className="break-all font-mono text-[13px]">{server.url}</dd>
            <dt className="text-muted-foreground">{t('payments.server.via')}</dt>
            <dd>{t(`payments.connect.vias.${server.via}.title`)}</dd>
            {status.version && (
              <>
                <dt className="text-muted-foreground">{t('payments.server.versionLabel')}</dt>
                <dd>BTCPay Server {status.version}</dd>
              </>
            )}
            {status.onion && (
              <>
                <dt className="text-muted-foreground">{t('payments.server.onion')}</dt>
                <dd>
                  <CopyableValue value={status.onion} label={t('payments.server.onion')} />
                </dd>
              </>
            )}
            {status.checkedAt && (
              <>
                <dt className="text-muted-foreground">{t('payments.server.checked')}</dt>
                <dd>{formatTimestamp(status.checkedAt)}</dd>
              </>
            )}
          </dl>
          {status.chains.length > 0 && (
            <ul className="space-y-1">
              {status.chains.map((chain) => (
                <li key={chain.paymentMethodId}>
                  <StatusIndicator
                    tone={chain.available ? 'healthy' : 'working'}
                    label={t(chain.available ? 'payments.server.chainReady' : 'payments.server.chainSyncing', {
                      method: t(`payments.methods.${chain.paymentMethodId}`, { defaultValue: chain.paymentMethodId }),
                      height: chain.syncHeight ?? '—',
                      tip: chain.chainHeight ?? '—',
                    })}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {dashboard.isError ? (
        <ErrorPanel
          title={t('payments.store.unavailable')}
          error={toOrchestratorError(dashboard.error)}
          onRetry={() => void dashboard.refetch()}
        />
      ) : !dashboard.data ? (
        <Skeleton className="h-64" />
      ) : !dashboard.data.permissions.stores ? (
        <Note tone="warning">{t('payments.store.noStorePermission')}</Note>
      ) : dashboard.data.stores.length === 0 ? (
        <p className="text-muted-foreground">{t('payments.store.none')}</p>
      ) : (
        dashboard.data.stores.map((store) => (
          <StoreCard key={store.id} store={store} permissions={dashboard.data.permissions} />
        ))
      )}
    </div>
  );
}

export function PaymentsPage() {
  const { t } = useTranslation();
  const servers = usePaymentServers();
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const list = servers.data ?? [];
  const current = list.find((entry) => entry.server.id === selected) ?? list[0];
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-semibold">{t('payments.title')}</h1>
          <p className="max-w-prose text-muted-foreground">{t('payments.description')}</p>
        </div>
        {list.length > 0 && !adding && (
          <Button
            variant="outline"
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('payments.connect.another')}
          </Button>
        )}
      </div>
      {servers.isError ? (
        <ErrorPanel
          title={t('payments.unavailable')}
          error={toOrchestratorError(servers.error)}
          onRetry={() => void servers.refetch()}
        />
      ) : !servers.data ? (
        <Skeleton className="h-48" />
      ) : list.length === 0 || adding ? (
        <div className="space-y-6">
          <ConnectCard
            onConnected={(serverId) => {
              setSelected(serverId);
              setAdding(false);
            }}
          />
          <SetUpGuidance />
        </div>
      ) : null}
      {list.length > 0 && current && (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label={t('payments.servers')} className="space-y-2">
            {list.map((entry) => (
              <ServerCard
                key={entry.server.id}
                entry={entry}
                selected={entry.server.id === current.server.id}
                onSelect={() => {
                  setSelected(entry.server.id);
                }}
              />
            ))}
          </nav>
          <div className="min-w-0 space-y-6">
            <ServerDetail
              key={current.server.id}
              entry={current}
              onRemoved={() => {
                setSelected(undefined);
              }}
            />
            <BackupGuidance />
          </div>
        </div>
      )}
    </div>
  );
}
