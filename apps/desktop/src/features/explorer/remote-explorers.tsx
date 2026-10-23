import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy as CopyIcon, ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ExplorerPage, RemoteExplorerKind, RemoteExplorerWithStatus } from '@btcortex/contracts';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import type { StatusTone } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Label, NativeSelect } from '@/components/ui/form-controls';
import { useNodes } from '@/features/nodes/queries';
import { formatNumber, formatRelativeTime } from '@/lib/format';
import { callOrchestrator } from '@/lib/orchestrator';
import { remoteExplorerKey, useRemoteExplorers } from './queries';

// Block explorers on other computers (specification section 12; phase 5,
// "selected Bitcoin explorers"): a mempool or Esplora instance on a node
// platform or another machine, tested before it is added and then followed
// every minute. BTCortex opens its pages for what its own explorer shows; the
// explorer then learns which transaction, block or address was opened.

const TONES: Record<RemoteExplorerWithStatus['status']['state'], StatusTone> = {
  online: 'healthy',
  unreachable: 'attention',
  'wrong-chain': 'failed',
  unknown: 'unknown',
};

function AddExplorer() {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const onError = useErrorFeedback();
  const nodes = useNodes();
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<RemoteExplorerKind>('mempool');
  const [name, setName] = useState('');
  const [tor, setTor] = useState(false);
  const [nodeId, setNodeId] = useState('');
  const endpoint = { url: url.trim(), kind, via: tor ? ('tor' as const) : ('direct' as const) };
  const valid = /^https?:\/\/[^\s/?#]+/i.test(endpoint.url);
  const test = useMutation({
    mutationFn: () => callOrchestrator('explorers.remote.test', endpoint, { timeoutMs: 90_000 }),
  });
  const result = test.data;
  const add = useMutation({
    mutationFn: () =>
      callOrchestrator(
        'explorers.remote.add',
        {
          ...endpoint,
          name: name.trim() || new URL(endpoint.url).host,
          nodeId: nodeId === '' ? null : nodeId,
        },
        { timeoutMs: 90_000 },
      ),
    onSuccess: (list) => {
      queryClient.setQueryData(remoteExplorerKey, list);
      toast.success(t('explorer.remote.added'));
      test.reset();
      setUrl('');
      setName('');
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) test.mutate(undefined, { onError });
      }}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_10rem_minmax(0,1fr)]">
        <div className="space-y-1">
          <Label htmlFor={`${id}-url`}>{t('explorer.remote.url')}</Label>
          <Input
            id={`${id}-url`}
            spellCheck={false}
            className="font-mono"
            placeholder="http://umbrel.local:3006"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              test.reset();
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-kind`}>{t('explorer.remote.kind')}</Label>
          <NativeSelect
            id={`${id}-kind`}
            className="w-full"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as RemoteExplorerKind);
              test.reset();
            }}
          >
            <option value="mempool">mempool</option>
            <option value="esplora">Esplora</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-name`}>{t('explorer.remote.name')}</Label>
          <Input
            id={`${id}-name`}
            maxLength={80}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
      </div>
      <label className="flex items-start gap-2">
        <Checkbox
          checked={tor}
          onChange={(event) => {
            setTor(event.target.checked);
            test.reset();
          }}
        />
        <span>{t('explorer.remote.tor')}</span>
      </label>
      <div className="max-w-md space-y-1">
        <Label htmlFor={`${id}-node`}>{t('explorer.remote.forNode')}</Label>
        <NativeSelect
          id={`${id}-node`}
          className="w-full"
          value={nodeId}
          onChange={(event) => {
            setNodeId(event.target.value);
          }}
        >
          <option value="">{t('explorer.remote.noNode')}</option>
          {(nodes.data ?? []).map((node) => (
            <option key={node.profile.id} value={node.profile.id}>
              {node.profile.name} ({t(`networks.${node.profile.network}`)})
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t('explorer.remote.forNodeHint')}</p>
      </div>
      <Button type="submit" variant="outline" disabled={!valid || test.isPending}>
        {test.isPending ? t('explorer.remote.testing') : t('explorer.remote.test')}
      </Button>
      {result && (
        <div role="status">
          {result.reachable ? (
            <StatusIndicator
              tone="healthy"
              label={t('explorer.remote.reached', {
                network: result.network === null ? t('explorer.remote.unknownChain') : t(`networks.${result.network}`),
                height: formatNumber(result.height ?? 0),
              })}
            />
          ) : (
            <StatusIndicator tone="attention" label={t('explorer.remote.notReached', { error: result.error ?? '' })} />
          )}
        </div>
      )}
      {result?.reachable && (
        <Button
          type="button"
          disabled={add.isPending || result.network === null}
          onClick={() => {
            add.mutate(undefined, { onError });
          }}
        >
          {t('explorer.remote.add')}
        </Button>
      )}
    </form>
  );
}

function ExplorerItem({ entry }: { entry: RemoteExplorerWithStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useErrorFeedback();
  const nodes = useNodes();
  const { explorer, status } = entry;
  const node = nodes.data?.find((candidate) => candidate.profile.id === explorer.nodeId);
  const remove = useMutation({
    mutationFn: () => callOrchestrator('explorers.remote.remove', { id: explorer.id }),
    onSuccess: (list) => {
      queryClient.setQueryData(remoteExplorerKey, list);
    },
  });
  return (
    <li className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{explorer.name}</span>
          <span className="break-all font-mono text-[12px] text-muted-foreground">{explorer.url}</span>
          <Badge variant="outline">{explorer.kind === 'mempool' ? 'mempool' : 'Esplora'}</Badge>
          {explorer.via === 'tor' && <Badge variant="outline">Tor</Badge>}
        </p>
        <StatusIndicator
          tone={TONES[status.state]}
          label={
            status.state === 'online'
              ? status.blocksBehind !== null && status.blocksBehind > 0
                ? t('explorer.remote.behind', {
                    height: formatNumber(status.height ?? 0),
                    count: status.blocksBehind,
                  })
                : t('explorer.remote.online', { height: formatNumber(status.height ?? 0) })
              : t(`explorer.remote.states.${status.state}`)
          }
        />
        {status.error !== null && status.state !== 'online' && <p className="text-muted-foreground">{status.error}</p>}
        <p className="text-muted-foreground">
          {node
            ? t('explorer.remote.serves', { node: node.profile.name })
            : t('explorer.remote.servesNetwork', { network: t(`networks.${explorer.network}`) })}
          {status.checkedAt !== null &&
            ` · ${t('explorer.remote.checked', { time: formatRelativeTime(new Date(status.checkedAt)) })}`}
        </p>
      </div>
      <ConfirmButton
        label={t('explorer.remote.remove')}
        title={t('explorer.remote.removeTitle', { name: explorer.name })}
        confirmLabel={t('explorer.remote.removeConfirm')}
        disabled={remove.isPending}
        onConfirm={() => {
          remove.mutate(undefined, { onError });
        }}
      >
        <p>{t('explorer.remote.removeBody')}</p>
      </ConfirmButton>
    </li>
  );
}

/** Explorers on other computers: those BTCortex follows, and adding one. */
export function RemoteExplorers() {
  const { t } = useTranslation();
  const list = useRemoteExplorers();
  const entries = list.data ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('explorer.remote.title')}</CardTitle>
          <CardDescription>{t('explorer.remote.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length > 0 && (
          <ul className="divide-y">
            {entries.map((entry) => (
              <ExplorerItem key={entry.explorer.id} entry={entry} />
            ))}
          </ul>
        )}
        <AddExplorer />
        <Note tone="info">{t('explorer.remote.privacy')}</Note>
      </CardContent>
    </Card>
  );
}

/**
 * "Open in" buttons for the explorers that show this node's chain: those
 * added for the node, and those added for no node in particular that follow
 * its network.
 */
export function OpenInExplorers({ nodeId, page }: { nodeId: string; page: ExplorerPage }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const network = useNodes().data?.find((candidate) => candidate.profile.id === nodeId)?.profile.network;
  const explorers = (useRemoteExplorers().data ?? []).filter(
    ({ explorer }) => explorer.nodeId === nodeId || (explorer.nodeId === null && explorer.network === network),
  );
  const open = useMutation({
    mutationFn: (id: string) => callOrchestrator('explorers.remote.open', { id, page }),
    onSuccess: async ({ opened, url }) => {
      if (opened) return;
      // Reached through Tor: the ordinary browser would connect directly (or, to an onion service, not at all).
      const copied = await navigator.clipboard.writeText(url).then(
        () => true,
        () => false,
      );
      toast.info(t(copied ? 'explorer.remote.torCopied' : 'explorer.remote.torAddress'), { description: url });
    },
  });
  if (explorers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">{t('explorer.remote.openIn')}</span>
      {explorers.map(({ explorer, status }) => (
        <Button
          key={explorer.id}
          variant="outline"
          disabled={open.isPending || status.state === 'wrong-chain'}
          onClick={() => {
            open.mutate(explorer.id, { onError });
          }}
        >
          {explorer.name}
          {explorer.via === 'tor' ? (
            <>
              <CopyIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only"> {t('explorer.remote.copiesForTorBrowser')}</span>
            </>
          ) : (
            <>
              <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only"> {t('catalogue.opensInBrowser')}</span>
            </>
          )}
        </Button>
      ))}
    </div>
  );
}
