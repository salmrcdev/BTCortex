import { TriangleAlert, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { LightningDashboard } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { Meter } from '@/components/data/meter';
import { StatTile } from '@/components/data/stat-tile';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  formatBitcoin,
  formatDuration,
  formatNumber,
  formatRelativeTime,
  formatSats,
  formatTimestamp,
  truncateMiddle,
} from '@/lib/format';
import { accessVariant, formatMsat, lightningState, PeerName } from './parts';
import { useLightningActions } from './queries';

// What BTCortex reads from a Lightning node (specification section 11.2),
// one tab at a time: the node and its money at a glance, channels and their
// liquidity, peers, payments and invoices, and routing.

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function ScrollTable({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

function Warnings({ dashboard }: { dashboard: LightningDashboard }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('lightning.overview.warnings')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {dashboard.warnings.length === 0 && dashboard.unavailable.length === 0 ? (
          <StatusIndicator tone="healthy" label={t('lightning.overview.noWarnings')} />
        ) : (
          <ul className="space-y-2">
            {dashboard.warnings.map((warning) => (
              <li key={warning.code} className="flex gap-2">
                {warning.severity === 'warning' ? (
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                ) : (
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
                )}
                <span>{warning.message}</span>
              </li>
            ))}
            {dashboard.unavailable.map((part) => (
              <li key={part.part} className="flex gap-2 text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t('lightning.overview.notRead')}: {part.part}. {part.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BackupCard({ dashboard }: { dashboard: LightningDashboard }) {
  const { t } = useTranslation();
  const actions = useLightningActions();
  const feedback = useErrorFeedback();
  const backup = dashboard.backup;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('lightning.backup.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          {backup === null
            ? t('lightning.backup.none')
            : t('lightning.backup.saved', {
                time: formatRelativeTime(new Date(backup.savedAt)),
                count: backup.channels,
              })}
        </p>
        {backup !== null && (
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4">
            <Detail label={t('lightning.backup.where')}>
              <CopyableValue value={backup.path} label={t('lightning.backup.where')} />
            </Detail>
          </dl>
        )}
        <p className="text-xs text-muted-foreground">{t('lightning.backup.explanation')}</p>
        <Button
          variant="outline"
          disabled={
            actions.saveBackup.isPending || (dashboard.channels.length === 0 && dashboard.pending.channels.length === 0)
          }
          onClick={() => {
            actions.saveBackup.mutate(dashboard.connection.id, {
              onSuccess: () => toast.success(t('lightning.backup.done')),
              onError: feedback,
            });
          }}
        >
          {actions.saveBackup.isPending ? t('lightning.backup.saving') : t('lightning.backup.save')}
        </Button>
      </CardContent>
    </Card>
  );
}

function ConnectionCard({ dashboard, onRemoved }: { dashboard: LightningDashboard; onRemoved: () => void }) {
  const { t } = useTranslation();
  const actions = useLightningActions();
  const feedback = useErrorFeedback();
  const { connection, status } = dashboard;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('lightning.connection.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
          <Detail label={t('lightning.connection.restAddress')}>
            <span className="break-all font-mono text-[13px]">{connection.restAddress}</span>
          </Detail>
          <Detail label={t('lightning.connection.via')}>
            {connection.via === 'tor' ? t('lightning.connection.viaTor') : t('lightning.connection.viaDirect')}
          </Detail>
          <Detail label={t('lightning.connection.certificate')}>
            {connection.certificateFingerprint === null ? (
              t('lightning.connection.certificateSystem')
            ) : (
              <span className="block break-all font-mono text-xs">{connection.certificateFingerprint}</span>
            )}
          </Detail>
          <Detail label={t('lightning.connection.access')}>
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge variant={accessVariant(connection.macaroon.access)}>
                {t(`lightning.access.${connection.macaroon.access}`)}
              </Badge>
              {connection.macaroon.expiresAt !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {t('lightning.connection.expires', { date: formatTimestamp(connection.macaroon.expiresAt) })}
                </span>
              )}
            </span>
          </Detail>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          {status.checkedAt !== null && (
            <span className="text-xs text-muted-foreground">
              {t('lightning.connection.checked', { time: formatRelativeTime(new Date(status.checkedAt)) })}
            </span>
          )}
          <Button
            variant="outline"
            disabled={actions.refresh.isPending}
            onClick={() => {
              actions.refresh.mutate(connection.id, { onError: feedback });
            }}
          >
            {t('lightning.connection.refresh')}
          </Button>
          <ConfirmButton
            label={t('lightning.connection.remove')}
            title={t('lightning.connection.removeTitle')}
            confirmLabel={t('lightning.connection.remove')}
            destructive
            disabled={actions.remove.isPending}
            onConfirm={() => {
              actions.remove.mutate(connection.id, {
                onSuccess: () => {
                  toast.success(t('lightning.connection.removed'));
                  onRemoved();
                },
                onError: feedback,
              });
            }}
          >
            <p>{t('lightning.connection.removeBody')}</p>
          </ConfirmButton>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ dashboard, onRemoved }: { dashboard: LightningDashboard; onRemoved: () => void }) {
  const { t } = useTranslation();
  const { info, balances, routing } = dashboard;
  const channelTotal = balances.channels.localSats + balances.channels.remoteSats;
  const state = lightningState(dashboard.status, t);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('lightning.overview.onChain')}
          value={formatSats(balances.onChain.confirmedSats)}
          context={t('lightning.overview.onChainContext', {
            unconfirmed: formatSats(balances.onChain.unconfirmedSats),
            reserved: formatSats(balances.onChain.reservedForAnchorsSats),
          })}
        />
        <StatTile
          label={t('lightning.overview.canSend')}
          value={formatSats(balances.channels.localSats)}
          context={t('lightning.overview.canSendContext')}
        />
        <StatTile
          label={t('lightning.overview.canReceive')}
          value={formatSats(balances.channels.remoteSats)}
          context={t('lightning.overview.canReceiveContext')}
        />
        <StatTile
          label={t('lightning.overview.feesMonth')}
          value={formatSats(routing.feesMonthSats)}
          context={t('lightning.overview.feesMonthContext', { forwards: formatNumber(routing.forwards30Days) })}
        />
      </div>

      {channelTotal > 0 && (
        <div className="space-y-1">
          <p className="font-medium">{t('lightning.overview.liquidity')}</p>
          <Meter
            value={balances.channels.localSats / channelTotal}
            tone="primary"
            label={t('lightning.overview.liquidityLabel')}
            valueText={t('lightning.overview.liquidityValue', {
              local: formatSats(balances.channels.localSats),
              remote: formatSats(balances.channels.remoteSats),
            })}
            className="h-2"
          />
          <p className="text-xs text-muted-foreground">
            {t('lightning.overview.liquidityValue', {
              local: formatSats(balances.channels.localSats),
              remote: formatSats(balances.channels.remoteSats),
            })}
          </p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('lightning.overview.identity')}</CardTitle>
            <StatusIndicator tone={state.tone} label={state.label} />
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
              <Detail label={t('lightning.overview.alias')}>
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full border"
                    style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(info.color) ? info.color : undefined }}
                  />
                  {info.alias === '' ? '—' : info.alias}
                </span>
              </Detail>
              <Detail label={t('lightning.overview.pubkey')}>
                <CopyableValue value={info.pubkey} label={t('lightning.overview.pubkey')} />
              </Detail>
              <Detail label={t('lightning.overview.version')}>{info.version}</Detail>
              <Detail label={t('lightning.overview.blockHeight')}>
                <span className="tabular">{formatNumber(info.blockHeight)}</span>
              </Detail>
              <Detail label={t('lightning.overview.synced')}>
                {info.syncedToChain && info.syncedToGraph
                  ? t('lightning.overview.syncedValue')
                  : info.syncedToChain
                    ? t('lightning.overview.syncingGraph')
                    : t('lightning.overview.syncingChain')}
              </Detail>
              <Detail label={t('lightning.overview.uris')}>
                {info.uris.length === 0 ? (
                  <span className="text-muted-foreground">{t('lightning.overview.noUris')}</span>
                ) : (
                  <ul className="space-y-1">
                    {info.uris.map((uri) => (
                      <li key={uri}>
                        <CopyableValue value={uri} label={t('lightning.overview.uris')} />
                      </li>
                    ))}
                  </ul>
                )}
              </Detail>
              {dashboard.watchtowers && (
                <Detail label={t('lightning.overview.watchtowers')}>
                  {dashboard.watchtowers.clientActive
                    ? t('lightning.overview.watchtowersOn', {
                        count: dashboard.watchtowers.towers,
                        active: dashboard.watchtowers.activeTowers,
                      })
                    : t('lightning.overview.watchtowersOff')}
                </Detail>
              )}
              {dashboard.graph && (
                <Detail label={t('lightning.overview.graph')}>
                  {t('lightning.overview.graphValue', {
                    nodes: formatNumber(dashboard.graph.nodes),
                    channels: formatNumber(dashboard.graph.channels),
                    capacity: formatBitcoin(dashboard.graph.capacitySats),
                  })}
                </Detail>
              )}
            </dl>
          </CardContent>
        </Card>
        <Warnings dashboard={dashboard} />
        <BackupCard dashboard={dashboard} />
        <ConnectionCard dashboard={dashboard} onRemoved={onRemoved} />
      </div>
    </div>
  );
}

export function ChannelsTab({ dashboard }: { dashboard: LightningDashboard }) {
  const { t } = useTranslation();
  const peerName = (pubkey: string, alias: string | null) => alias ?? truncateMiddle(pubkey, 8, 8);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('lightning.channels.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard.channels.length === 0 ? (
            <p className="text-muted-foreground">{t('lightning.channels.empty')}</p>
          ) : (
            <ScrollTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('lightning.channels.peer')}</TableHead>
                    <TableHead>{t('lightning.channels.state')}</TableHead>
                    <TableHead className="text-right">{t('lightning.channels.capacity')}</TableHead>
                    <TableHead className="min-w-56">{t('lightning.channels.liquidity')}</TableHead>
                    <TableHead>{t('lightning.channels.fees')}</TableHead>
                    <TableHead className="text-right">{t('lightning.channels.htlcs')}</TableHead>
                    <TableHead>{t('lightning.channels.opener')}</TableHead>
                    <TableHead>{t('lightning.channels.uptime')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.channels.map((channel) => {
                    const name = peerName(channel.remotePubkey, channel.peerAlias);
                    const share = channel.capacitySats > 0 ? channel.localSats / channel.capacitySats : 0;
                    return (
                      <TableRow key={channel.id}>
                        <TableCell>
                          <PeerName alias={channel.peerAlias} pubkey={channel.remotePubkey} />
                          <span className="block font-mono text-xs text-muted-foreground" title={channel.channelPoint}>
                            {channel.id}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <StatusIndicator
                              tone={channel.active ? 'healthy' : 'attention'}
                              label={channel.active ? t('lightning.channels.active') : t('lightning.channels.inactive')}
                            />
                            {channel.private && <Badge variant="outline">{t('lightning.channels.private')}</Badge>}
                          </span>
                        </TableCell>
                        <TableCell className="tabular text-right">{formatSats(channel.capacitySats)}</TableCell>
                        <TableCell>
                          <Meter
                            value={share}
                            tone="primary"
                            label={t('lightning.channels.liquidityLabel', { peer: name })}
                            valueText={`${formatSats(channel.localSats)} / ${formatSats(channel.remoteSats)}`}
                          />
                          <span className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground tabular">
                            <span>{formatSats(channel.localSats)}</span>
                            <span>{formatSats(channel.remoteSats)}</span>
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {channel.baseFeeMsat === null || channel.feePpm === null
                            ? '—'
                            : t('lightning.channels.feeValue', {
                                base: formatNumber(channel.baseFeeMsat),
                                ppm: formatNumber(channel.feePpm),
                              })}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatNumber(channel.pendingHtlcs.length)}
                        </TableCell>
                        <TableCell>
                          {channel.initiator
                            ? t('lightning.channels.openerLocal')
                            : t('lightning.channels.openerRemote')}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {channel.uptimeSeconds > 0 ? formatDuration(channel.uptimeSeconds * 1000) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollTable>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('lightning.channels.pendingTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard.pending.channels.length === 0 ? (
            <p className="text-muted-foreground">{t('lightning.channels.pendingEmpty')}</p>
          ) : (
            <ul className="space-y-3">
              {dashboard.pending.channels.map((channel) => (
                <li
                  key={channel.channelPoint}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3 last:border-0"
                >
                  <span className="space-x-2">
                    <Badge variant={channel.kind === 'force-closing' ? 'warning' : 'neutral'}>
                      {t(`lightning.channels.kind.${channel.kind}`)}
                    </Badge>
                    <PeerName alias={null} pubkey={channel.remotePubkey} />
                  </span>
                  <span className="tabular">{formatSats(channel.capacitySats)}</span>
                  <span className="w-full text-xs text-muted-foreground">
                    {channel.kind === 'opening' && channel.confirmationsUntilActive !== undefined
                      ? t('lightning.channels.confirmationsLeft', { count: channel.confirmationsUntilActive })
                      : channel.kind === 'force-closing' &&
                          channel.blocksUntilMaturity !== undefined &&
                          channel.maturityHeight !== undefined
                        ? t('lightning.channels.maturity', {
                            blocks: formatNumber(channel.blocksUntilMaturity),
                            height: formatNumber(channel.maturityHeight),
                          })
                        : channel.limboSats !== undefined
                          ? t('lightning.channels.limbo', { amount: formatSats(channel.limboSats) })
                          : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PeersTab({ dashboard }: { dashboard: LightningDashboard }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('lightning.peers.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {dashboard.peers.length === 0 ? (
          <p className="text-muted-foreground">{t('lightning.peers.empty')}</p>
        ) : (
          <ScrollTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('lightning.peers.peer')}</TableHead>
                  <TableHead>{t('lightning.peers.address')}</TableHead>
                  <TableHead>{t('lightning.peers.direction')}</TableHead>
                  <TableHead className="text-right">{t('lightning.peers.ping')}</TableHead>
                  <TableHead className="text-right">{t('lightning.peers.sent')}</TableHead>
                  <TableHead className="text-right">{t('lightning.peers.received')}</TableHead>
                  <TableHead className="text-right">{t('lightning.peers.flaps')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.peers.map((peer) => (
                  <TableRow key={peer.pubkey}>
                    <TableCell>
                      <PeerName alias={peer.alias} pubkey={peer.pubkey} />
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">{peer.address}</TableCell>
                    <TableCell>{peer.inbound ? t('lightning.peers.inbound') : t('lightning.peers.outbound')}</TableCell>
                    <TableCell className="tabular text-right">
                      {peer.pingMicros === null
                        ? '—'
                        : `${formatNumber(peer.pingMicros / 1000, { maximumFractionDigits: 1 })} ms`}
                    </TableCell>
                    <TableCell className="tabular text-right">{formatSats(peer.satsSent)}</TableCell>
                    <TableCell className="tabular text-right">{formatSats(peer.satsReceived)}</TableCell>
                    <TableCell className="tabular text-right">{formatNumber(peer.flapCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollTable>
        )}
      </CardContent>
    </Card>
  );
}

export function PaymentsTab({ dashboard }: { dashboard: LightningDashboard }) {
  const { t } = useTranslation();
  const when = (value: string | null) => (value === null ? '—' : formatRelativeTime(new Date(value)));
  return (
    <div className="space-y-6">
      <Note tone="info">{t('lightning.payments.noPreimages')}</Note>
      <Card>
        <CardHeader>
          <CardTitle>{t('lightning.payments.paymentsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard.payments.length === 0 ? (
            <p className="text-muted-foreground">{t('lightning.payments.paymentsEmpty')}</p>
          ) : (
            <ScrollTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('lightning.payments.time')}</TableHead>
                    <TableHead>{t('lightning.payments.status')}</TableHead>
                    <TableHead className="text-right">{t('lightning.payments.amount')}</TableHead>
                    <TableHead className="text-right">{t('lightning.payments.fee')}</TableHead>
                    <TableHead>{t('lightning.payments.destination')}</TableHead>
                    <TableHead className="text-right">{t('lightning.payments.hops')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.payments.map((payment) => (
                    <TableRow key={payment.paymentHash}>
                      <TableCell className="whitespace-nowrap">{when(payment.createdAt)}</TableCell>
                      <TableCell>
                        <StatusIndicator
                          tone={
                            payment.status === 'SUCCEEDED'
                              ? 'healthy'
                              : payment.status === 'FAILED'
                                ? 'failed'
                                : payment.status === 'IN_FLIGHT' || payment.status === 'INITIATED'
                                  ? 'working'
                                  : 'unknown'
                          }
                          label={t(`lightning.payments.paymentStatus.${payment.status}`)}
                        />
                        {payment.failureReason !== null && (
                          <span className="block text-xs text-muted-foreground">{payment.failureReason}</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right">{formatSats(payment.valueSats)}</TableCell>
                      <TableCell className="tabular text-right">{formatMsat(payment.feeMsat)}</TableCell>
                      <TableCell>
                        {payment.destination === null ? '—' : <PeerName alias={null} pubkey={payment.destination} />}
                      </TableCell>
                      <TableCell className="tabular text-right">{payment.hops ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollTable>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('lightning.payments.invoicesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard.invoices.length === 0 ? (
            <p className="text-muted-foreground">{t('lightning.payments.invoicesEmpty')}</p>
          ) : (
            <ScrollTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('lightning.payments.time')}</TableHead>
                    <TableHead>{t('lightning.payments.memo')}</TableHead>
                    <TableHead>{t('lightning.payments.status')}</TableHead>
                    <TableHead className="text-right">{t('lightning.payments.amount')}</TableHead>
                    <TableHead className="text-right">{t('lightning.payments.paid')}</TableHead>
                    <TableHead>{t('lightning.payments.expires')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.invoices.map((invoice) => (
                    <TableRow key={invoice.paymentHash}>
                      <TableCell className="whitespace-nowrap">{when(invoice.createdAt)}</TableCell>
                      <TableCell className="max-w-72 break-words">
                        {invoice.memo === '' ? '—' : invoice.memo}
                        {invoice.keysend && (
                          <Badge variant="outline" className="ml-2">
                            {t('lightning.payments.keysend')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusIndicator
                          tone={
                            invoice.state === 'SETTLED'
                              ? 'healthy'
                              : invoice.state === 'CANCELED'
                                ? 'inactive'
                                : 'working'
                          }
                          label={t(`lightning.payments.invoiceState.${invoice.state}`)}
                        />
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {invoice.valueSats === 0 ? '—' : formatSats(invoice.valueSats)}
                      </TableCell>
                      <TableCell className="tabular text-right">{formatSats(invoice.paidSats)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {invoice.state === 'OPEN' && invoice.expiresAt !== null
                          ? formatTimestamp(invoice.expiresAt)
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function RoutingTab({ dashboard }: { dashboard: LightningDashboard }) {
  const { t } = useTranslation();
  const { routing } = dashboard;
  const aliases = new Map(dashboard.channels.map((channel) => [channel.id, channel.peerAlias ?? channel.id]));
  const channelName = (id: string, alias: string | null) => alias ?? aliases.get(id) ?? id;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('lightning.routing.day')} value={formatSats(routing.feesDaySats)} />
        <StatTile label={t('lightning.routing.week')} value={formatSats(routing.feesWeekSats)} />
        <StatTile label={t('lightning.routing.month')} value={formatSats(routing.feesMonthSats)} />
        <StatTile
          label={t('lightning.routing.forwards')}
          value={formatNumber(routing.forwards30Days)}
          context={t('lightning.routing.forwardsContext', { amount: formatSats(routing.forwardedSats30Days) })}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('lightning.routing.recent')}</CardTitle>
        </CardHeader>
        <CardContent>
          {routing.recentForwards.length === 0 ? (
            <p className="text-muted-foreground">{t('lightning.routing.empty')}</p>
          ) : (
            <ScrollTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('lightning.routing.time')}</TableHead>
                    <TableHead>{t('lightning.routing.route')}</TableHead>
                    <TableHead className="text-right">{t('lightning.routing.amount')}</TableHead>
                    <TableHead className="text-right">{t('lightning.routing.fee')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routing.recentForwards.map((forward, index) => (
                    <TableRow key={`${forward.at ?? ''}-${String(index)}`}>
                      <TableCell className="whitespace-nowrap">
                        {forward.at === null ? '—' : formatRelativeTime(new Date(forward.at))}
                      </TableCell>
                      <TableCell>
                        {channelName(forward.channelIn, forward.peerAliasIn)} →{' '}
                        {channelName(forward.channelOut, forward.peerAliasOut)}
                      </TableCell>
                      <TableCell className="tabular text-right">{formatSats(forward.amountOutSats)}</TableCell>
                      <TableCell className="tabular text-right">{formatMsat(forward.feeMsat)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
