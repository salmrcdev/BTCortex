import { Ban, Info, Lock, LockOpen, PlugZap, Unplug } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeWithStatus, PeerSummary } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { StatusIndicator } from '@/components/status/status-indicator';
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
import { Input, NativeSelect } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDuration, formatLogTime, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { usePeers } from '@/features/nodes/queries';
import { useNetworkOverview, usePeerActions, usePeerHistory } from './queries';
import { useErrorFeedback } from '@/components/feedback/confirm-button';

// Network and peers of one node (specification section 5.8). Peer addresses
// belong to other people: they are shown here only, and no location is ever
// guessed from them.

const BAN_DURATIONS = [
  { id: 'hour', seconds: 3600 },
  { id: 'day', seconds: 86_400 },
  { id: 'week', seconds: 7 * 86_400 },
  { id: 'month', seconds: 30 * 86_400 },
  { id: 'year', seconds: 365 * 86_400 },
] as const;

const NETWORK_NAMES = ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns', 'not_publicly_routable'] as const;
const CONNECTION_TYPES = [
  'outbound-full-relay',
  'block-relay-only',
  'inbound',
  'manual',
  'addr-fetch',
  'feeler',
  'private-broadcast',
] as const;

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

function useLabels() {
  const { t } = useTranslation();
  return {
    network: (name: string) => (isOneOf(NETWORK_NAMES, name) ? t(`peers.networkNames.${name}`) : name),
    connectionType: (type: string | undefined) =>
      type === undefined ? '—' : isOneOf(CONNECTION_TYPES, type) ? t(`peers.connectionTypes.${type}`) : type,
  };
}

/** Incoming Tor and I2P peers all arrive from this computer's own address. */
function arrivesThroughProxy(peer: PeerSummary): boolean {
  return peer.inbound && /^(127\.|\[::1\]|::1)/.test(peer.address);
}

function useFeedback() {
  return { onError: useErrorFeedback() };
}

function NetworkCard({ nodeId, enabled }: { nodeId: string; enabled: boolean }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const overview = useNetworkOverview(nodeId, enabled);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('peers.networksTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {overview.isError ? (
          <ErrorPanel title={t('errors.nodeUnavailable')} error={toOrchestratorError(overview.error)} />
        ) : !overview.data ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {overview.data.networks.map((network) => (
                <li key={network.name} className="rounded-md border p-3">
                  <p className="font-medium">{labels.network(network.name)}</p>
                  <StatusIndicator
                    className="mt-1"
                    tone={network.reachable ? 'healthy' : 'inactive'}
                    label={
                      network.limited
                        ? t('peers.networkLimited')
                        : network.reachable
                          ? t('peers.networkReachable')
                          : t('peers.networkUnreachable')
                    }
                  />
                  {network.proxy && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('peers.throughProxy', { proxy: network.proxy })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm">
              {overview.data.localAddresses.length === 0
                ? t('peers.noIncoming')
                : t('peers.incoming', {
                    addresses: overview.data.localAddresses
                      .map((address) => `${address.address}:${String(address.port)}`)
                      .join(', '),
                  })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BanDialog({
  peer,
  open,
  onOpenChange,
  onBan,
}: {
  peer: PeerSummary | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBan: (seconds: number) => void;
}) {
  const { t } = useTranslation();
  const durationId = useId();
  const [duration, setDuration] = useState<(typeof BAN_DURATIONS)[number]['id']>('day');
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>{t('peers.banTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('peers.banBody', { address: peer?.address ?? '' })}</AlertDialogDescription>
        <div className="mt-3 space-y-1">
          <label htmlFor={durationId} className="text-sm font-medium">
            {t('peers.banDuration')}
          </label>
          <NativeSelect
            id={durationId}
            className="block w-56"
            value={duration}
            onChange={(event) => {
              const choice = BAN_DURATIONS.find((option) => option.id === event.target.value);
              if (choice) setDuration(choice.id);
            }}
          >
            {BAN_DURATIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {t(`peers.durations.${option.id}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            destructive
            onClick={() => {
              onBan(BAN_DURATIONS.find((option) => option.id === duration)?.seconds ?? 86_400);
            }}
          >
            {t('peers.banConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PeerRow({
  peer,
  now,
  onDisconnect,
  onBan,
}: {
  peer: PeerSummary;
  now: number;
  onDisconnect: () => void;
  onBan: () => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const encrypted = peer.transport === 'v2';
  const anonymous = peer.network === 'onion' || peer.network === 'i2p' || peer.network === 'cjdns';
  return (
    <>
      <TableRow>
        <TableCell className="max-w-64">
          <span className="block truncate font-mono text-[13px]" title={peer.address}>
            {peer.address}
          </span>
        </TableCell>
        <TableCell>
          {anonymous ? <Badge variant="outline">{labels.network(peer.network)}</Badge> : labels.network(peer.network)}
        </TableCell>
        <TableCell>{peer.inbound ? t('node.peerInbound') : t('node.peerOutbound')}</TableCell>
        <TableCell>{labels.connectionType(peer.connectionType)}</TableCell>
        <TableCell>
          <span className="inline-flex items-center gap-1.5">
            {encrypted ? (
              <Lock aria-hidden="true" className="size-4 text-success" />
            ) : (
              <LockOpen aria-hidden="true" className="size-4 text-muted-foreground" />
            )}
            {encrypted ? t('peers.encrypted') : t('peers.unencrypted')}
          </span>
        </TableCell>
        <TableCell className="max-w-48 truncate" title={peer.userAgent}>
          {peer.userAgent}
        </TableCell>
        <TableCell className="tabular text-right">
          {peer.pingSeconds === undefined ? '—' : `${String(Math.round(peer.pingSeconds * 1000))} ms`}
        </TableCell>
        <TableCell className="tabular text-right">{formatBytes(peer.bytesReceived)}</TableCell>
        <TableCell className="tabular text-right">{formatBytes(peer.bytesSent)}</TableCell>
        <TableCell className="tabular text-right">{formatDuration(now - peer.connectedSince * 1000)}</TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={t('peers.detailsFor', { address: peer.address })}
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              <Info aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('peers.disconnectPeer', { address: peer.address })}
              onClick={onDisconnect}
            >
              <Unplug aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={arrivesThroughProxy(peer)}
              aria-label={t('peers.banPeer', { address: peer.address })}
              title={arrivesThroughProxy(peer) ? t('peers.cannotBanProxy') : undefined}
              onClick={onBan}
            >
              <Ban aria-hidden="true" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow id={detailsId} className="hover:bg-transparent">
          <TableCell colSpan={11} className="whitespace-normal bg-muted/40">
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t('peers.services')}</dt>
                <dd>{peer.services.join(', ') || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('peers.protocolVersion')}</dt>
                <dd className="tabular">{peer.protocolVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('peers.synced')}</dt>
                <dd className="tabular">
                  {t('peers.syncedValue', {
                    headers: peer.syncedHeaders ?? '—',
                    blocks: peer.syncedBlocks ?? '—',
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('peers.relaysTransactions')}</dt>
                <dd>{peer.relaysTransactions ? t('common.yes') : t('common.no')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('peers.permissions')}</dt>
                <dd>{peer.permissions.join(', ') || t('peers.noPermissions')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('peers.lastBlock')}</dt>
                <dd>{peer.lastBlockAt ? formatTimestamp(new Date(peer.lastBlockAt * 1000)) : t('peers.never')}</dd>
              </div>
            </dl>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function PeersCard({ nodeId, enabled }: { nodeId: string; enabled: boolean }) {
  const { t } = useTranslation();
  const peers = usePeers(nodeId, enabled);
  const actions = usePeerActions(nodeId);
  const feedback = useFeedback();
  const [disconnecting, setDisconnecting] = useState<PeerSummary>();
  const [banning, setBanning] = useState<PeerSummary>();
  const list = peers.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('peers.connectedTitle', { count: list.length })}</CardTitle>
          <CardDescription>{t('node.peersPrivacy')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {peers.isError ? (
          <ErrorPanel title={t('errors.nodeUnavailable')} error={toOrchestratorError(peers.error)} />
        ) : !peers.data ? (
          <Skeleton className="h-24" />
        ) : list.length === 0 ? (
          <p className="text-muted-foreground">{t('node.peersEmpty')}</p>
        ) : (
          <Table>
            <TableCaption>{t('peers.tableCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('node.peerAddress')}</TableHead>
                <TableHead>{t('node.peerNetwork')}</TableHead>
                <TableHead>{t('node.peerDirection')}</TableHead>
                <TableHead>{t('node.peerType')}</TableHead>
                <TableHead>{t('node.peerTransport')}</TableHead>
                <TableHead>{t('node.peerSoftware')}</TableHead>
                <TableHead className="text-right">{t('node.peerPing')}</TableHead>
                <TableHead className="text-right">{t('node.peerReceived')}</TableHead>
                <TableHead className="text-right">{t('node.peerSent')}</TableHead>
                <TableHead className="text-right">{t('node.peerConnected')}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{t('peers.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((peer) => (
                <PeerRow
                  key={peer.id}
                  peer={peer}
                  now={peers.dataUpdatedAt}
                  onDisconnect={() => {
                    setDisconnecting(peer);
                  }}
                  onBan={() => {
                    setBanning(peer);
                  }}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog
        open={disconnecting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{t('peers.disconnectTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('peers.disconnectBody', { address: disconnecting?.address ?? '' })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (disconnecting) actions.disconnect.mutate(disconnecting.id, feedback);
              }}
            >
              {t('peers.disconnectConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BanDialog
        peer={banning}
        open={banning !== undefined}
        onOpenChange={(open) => {
          if (!open) setBanning(undefined);
        }}
        onBan={(durationSeconds) => {
          if (banning) {
            actions.ban.mutate(
              { target: banning.address, durationSeconds },
              { ...feedback, onSuccess: () => toast.success(t('peers.banned', { address: banning.address })) },
            );
          }
        }}
      />
    </Card>
  );
}

function ManualConnectionsCard({ nodeId, enabled }: { nodeId: string; enabled: boolean }) {
  const { t } = useTranslation();
  const addressId = useId();
  const overview = useNetworkOverview(nodeId, enabled);
  const actions = usePeerActions(nodeId);
  const feedback = useFeedback();
  const [address, setAddress] = useState('');
  const submit = (keep: boolean) => {
    const target = address.trim();
    if (target === '') return;
    actions.connect.mutate(
      { address: target, keep },
      {
        ...feedback,
        onSuccess: () => {
          setAddress('');
          toast.success(keep ? t('peers.kept', { address: target }) : t('peers.tried', { address: target }));
        },
      },
    );
  };
  const added = overview.data?.added ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('peers.manualTitle')}</CardTitle>
          <CardDescription>{t('peers.manualDescription')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-72 flex-1 space-y-1">
            <label htmlFor={addressId} className="text-sm font-medium">
              {t('peers.address')}
            </label>
            <Input
              id={addressId}
              value={address}
              spellCheck={false}
              placeholder="203.0.113.7:8333"
              className="font-mono text-[13px]"
              onChange={(event) => {
                setAddress(event.target.value);
              }}
            />
          </div>
          <Button
            variant="outline"
            disabled={address.trim() === '' || actions.connect.isPending}
            onClick={() => {
              submit(false);
            }}
          >
            <PlugZap aria-hidden="true" />
            {t('peers.connectOnce')}
          </Button>
          <Button
            disabled={address.trim() === '' || actions.connect.isPending}
            onClick={() => {
              submit(true);
            }}
          >
            {t('peers.keepConnected')}
          </Button>
        </div>
        {added.length > 0 && (
          <ul className="space-y-1">
            {added.map((entry) => (
              <li key={entry.address} className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[13px]">{entry.address}</span>
                <StatusIndicator
                  tone={entry.connected ? 'healthy' : 'inactive'}
                  label={entry.connected ? t('peers.addedConnected') : t('peers.addedWaiting')}
                />
                <Button
                  variant="ghost"
                  onClick={() => {
                    actions.forget.mutate(entry.address, feedback);
                  }}
                >
                  {t('peers.forget')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BansCard({ nodeId, enabled }: { nodeId: string; enabled: boolean }) {
  const { t } = useTranslation();
  const overview = useNetworkOverview(nodeId, enabled);
  const actions = usePeerActions(nodeId);
  const feedback = useFeedback();
  const [confirmClear, setConfirmClear] = useState(false);
  const banned = overview.data?.banned ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('peers.bansTitle')}</CardTitle>
          <CardDescription>{t('peers.bansDescription')}</CardDescription>
        </div>
        {banned.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              setConfirmClear(true);
            }}
          >
            {t('peers.clearBans')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {banned.length === 0 ? (
          <p className="text-muted-foreground">{t('peers.noBans')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('peers.bannedAddress')}</TableHead>
                <TableHead>{t('peers.bannedUntil')}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{t('peers.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {banned.map((entry) => (
                <TableRow key={entry.address}>
                  <TableCell className="font-mono text-[13px]">{entry.address}</TableCell>
                  <TableCell>{formatTimestamp(new Date(entry.bannedUntil * 1000))}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        actions.unban.mutate(entry.address, feedback);
                      }}
                    >
                      {t('peers.unban')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('peers.clearBansTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('peers.clearBansBody', { count: banned.length })}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                actions.clearBans.mutate(undefined, feedback);
              }}
            >
              {t('peers.clearBans')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function HistoryCard({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const history = usePeerHistory(nodeId);
  const events = (history.data ?? []).slice(0, 50);
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('peers.historyTitle')}</CardTitle>
          <CardDescription>{t('peers.historyDescription')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-muted-foreground">{t('peers.noHistory')}</p>
        ) : (
          <ul className="space-y-1">
            {events.map((event) => (
              <li key={`${event.at}-${String(event.peerId)}-${event.kind}`} className="flex flex-wrap gap-x-3">
                <span className="tabular text-muted-foreground" title={formatTimestamp(event.at)}>
                  {formatLogTime(event.at)}
                </span>
                <StatusIndicator
                  tone={event.kind === 'connected' ? 'healthy' : 'inactive'}
                  label={event.kind === 'connected' ? t('peers.eventConnected') : t('peers.eventDisconnected')}
                />
                <span className="font-mono text-[13px]">{event.address}</span>
                <span className="text-muted-foreground">
                  {event.inbound ? t('node.peerInbound') : t('node.peerOutbound')}
                  {event.durationSeconds !== undefined &&
                    ` · ${t('peers.lasted', { duration: formatDuration(event.durationSeconds * 1000) })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function PeersPage({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const running = node.status.state === 'running';
  const nodeId = node.profile.id;
  if (!running) {
    return <p className="py-6 text-muted-foreground">{t('peers.notRunning')}</p>;
  }
  return (
    <div className="space-y-4">
      <NetworkCard nodeId={nodeId} enabled={running} />
      <PeersCard nodeId={nodeId} enabled={running} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ManualConnectionsCard nodeId={nodeId} enabled={running} />
        <BansCard nodeId={nodeId} enabled={running} />
      </div>
      <HistoryCard nodeId={nodeId} />
    </div>
  );
}
