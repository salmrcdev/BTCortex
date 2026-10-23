import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { RemoteElectrumTest, RemoteElectrumWithStatus } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
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
import { remoteElectrumKey, useRemoteElectrumServers } from './queries';

// Electrum servers on other computers (specification sections 7 and 37):
// electrs, Fulcrum or ElectrumX on a node platform or another machine, tested
// before they are added, with their certificate shown and accepted by the
// user when no public authority vouches for it, then followed every minute.
// A server added for a node answers its address lookups while the node's own
// Electrum server is not ready (none set up, still indexing, stopped or failed).

const remoteKey = remoteElectrumKey;

const TONES: Record<RemoteElectrumWithStatus['status']['state'], StatusTone> = {
  online: 'healthy',
  unreachable: 'attention',
  'wrong-chain': 'failed',
  'certificate-changed': 'failed',
  unknown: 'unknown',
};

function TestResult({ result }: { result: RemoteElectrumTest }) {
  const { t } = useTranslation();
  if (!result.reachable) {
    return (
      <StatusIndicator tone="attention" label={t('electrum.remoteServers.notReached', { error: result.error ?? '' })} />
    );
  }
  return (
    <div className="space-y-2">
      <StatusIndicator
        tone="healthy"
        label={t('electrum.remoteServers.reached', {
          software: result.serverVersion ?? '?',
          network: result.network === null ? t('electrum.remoteServers.unknownChain') : t(`networks.${result.network}`),
          height: formatNumber(result.height ?? 0),
        })}
      />
      {result.certificate && (
        <div className="space-y-1 rounded-md border p-3">
          <p className="font-medium">
            {result.certificate.publiclyTrusted
              ? t('electrum.remoteServers.trusted')
              : t('electrum.remoteServers.selfSigned')}
          </p>
          <p className="text-muted-foreground">
            {t('electrum.remoteServers.certificate', {
              subject: result.certificate.subject,
              issuer: result.certificate.issuer,
              until: result.certificate.validTo,
            })}
          </p>
          <CopyableValue value={result.certificate.fingerprint} label={t('electrum.remoteServers.fingerprint')} />
        </div>
      )}
    </div>
  );
}

function AddServer() {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const onError = useErrorFeedback();
  const nodes = useNodes();
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('50002');
  const [tls, setTls] = useState(true);
  const [tor, setTor] = useState(false);
  const [nodeId, setNodeId] = useState('');
  const [accepted, setAccepted] = useState(false);
  const portNumber = Number(port);
  const endpointValid = host.trim() !== '' && Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65_536;
  const endpoint = { host: host.trim(), port: portNumber, tls, via: tor ? ('tor' as const) : ('direct' as const) };
  const test = useMutation({
    mutationFn: () => callOrchestrator('electrum.remote.test', endpoint, { timeoutMs: 90_000 }),
  });
  const result = test.data;
  const needsAcceptance =
    result?.certificate !== null && result?.certificate !== undefined && !result.certificate.publiclyTrusted;
  const add = useMutation({
    mutationFn: () =>
      callOrchestrator(
        'electrum.remote.add',
        {
          ...endpoint,
          name: name.trim() || host.trim(),
          certificateFingerprint: needsAcceptance ? (result.certificate?.fingerprint ?? null) : null,
          nodeId: nodeId === '' ? null : nodeId,
        },
        { timeoutMs: 90_000 },
      ),
    onSuccess: (list) => {
      queryClient.setQueryData(remoteKey, list);
      toast.success(t('electrum.remoteServers.added'));
      test.reset();
      setAccepted(false);
      setHost('');
      setName('');
    },
  });
  const reset = () => {
    test.reset();
    setAccepted(false);
  };
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (endpointValid) test.mutate(undefined, { onError });
      }}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_8rem_minmax(0,1fr)]">
        <div className="space-y-1">
          <Label htmlFor={`${id}-host`}>{t('electrum.remoteServers.host')}</Label>
          <Input
            id={`${id}-host`}
            spellCheck={false}
            className="font-mono"
            placeholder="umbrel.local"
            value={host}
            onChange={(event) => {
              setHost(event.target.value);
              reset();
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-port`}>{t('electrum.remoteServers.port')}</Label>
          <Input
            id={`${id}-port`}
            inputMode="numeric"
            value={port}
            onChange={(event) => {
              setPort(event.target.value);
              reset();
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-name`}>{t('electrum.remoteServers.name')}</Label>
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
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-start gap-2">
          <Checkbox
            checked={tls}
            onChange={(event) => {
              setTls(event.target.checked);
              setPort(event.target.checked ? '50002' : '50001');
              reset();
            }}
          />
          <span>{t('electrum.remoteServers.tls')}</span>
        </label>
        <label className="flex items-start gap-2">
          <Checkbox
            checked={tor}
            onChange={(event) => {
              setTor(event.target.checked);
              reset();
            }}
          />
          <span>{t('electrum.remoteServers.tor')}</span>
        </label>
      </div>
      <div className="max-w-md space-y-1">
        <Label htmlFor={`${id}-node`}>{t('electrum.remoteServers.forNode')}</Label>
        <NativeSelect
          id={`${id}-node`}
          className="w-full"
          value={nodeId}
          onChange={(event) => {
            setNodeId(event.target.value);
          }}
        >
          <option value="">{t('electrum.remoteServers.noNode')}</option>
          {(nodes.data ?? []).map((node) => (
            <option key={node.profile.id} value={node.profile.id}>
              {node.profile.name} ({t(`networks.${node.profile.network}`)})
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t('electrum.remoteServers.forNodeHint')}</p>
      </div>
      <Button type="submit" variant="outline" disabled={!endpointValid || test.isPending}>
        {test.isPending ? t('electrum.remoteServers.testing') : t('electrum.remoteServers.test')}
      </Button>
      {result && <TestResult result={result} />}
      {result?.reachable && needsAcceptance && (
        <label className="flex items-start gap-2">
          <Checkbox
            checked={accepted}
            onChange={(event) => {
              setAccepted(event.target.checked);
            }}
          />
          <span>{t('electrum.remoteServers.accept')}</span>
        </label>
      )}
      {result?.reachable && (
        <Button
          type="button"
          disabled={add.isPending || (needsAcceptance && !accepted)}
          onClick={() => {
            add.mutate(undefined, { onError });
          }}
        >
          {t('electrum.remoteServers.add')}
        </Button>
      )}
    </form>
  );
}

function ServerItem({ entry }: { entry: RemoteElectrumWithStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useErrorFeedback();
  const nodes = useNodes();
  const { server, status } = entry;
  const node = nodes.data?.find((candidate) => candidate.profile.id === server.nodeId);
  const remove = useMutation({
    mutationFn: () => callOrchestrator('electrum.remote.remove', { id: server.id }),
    onSuccess: (list) => {
      queryClient.setQueryData(remoteKey, list);
    },
  });
  return (
    <li className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{server.name}</span>
          <span className="break-all font-mono text-[12px] text-muted-foreground">
            {server.host}:{server.port}
          </span>
          {server.tls && <Badge variant="outline">TLS</Badge>}
          {server.via === 'tor' && <Badge variant="outline">Tor</Badge>}
        </p>
        <StatusIndicator
          tone={TONES[status.state]}
          label={
            status.state === 'online'
              ? t('electrum.remoteServers.online', {
                  software: status.serverVersion ?? '?',
                  height: formatNumber(status.height ?? 0),
                })
              : t(`electrum.remoteServers.states.${status.state}`)
          }
        />
        {status.error !== null && status.state !== 'online' && <p className="text-muted-foreground">{status.error}</p>}
        <p className="text-muted-foreground">
          {node
            ? t('electrum.remoteServers.serves', { node: node.profile.name })
            : t('electrum.remoteServers.servesNone')}
          {status.checkedAt !== null &&
            ` · ${t('electrum.remoteServers.checked', { time: formatRelativeTime(new Date(status.checkedAt)) })}`}
        </p>
      </div>
      <ConfirmButton
        label={t('electrum.remoteServers.remove')}
        title={t('electrum.remoteServers.removeTitle', { name: server.name })}
        confirmLabel={t('electrum.remoteServers.removeConfirm')}
        disabled={remove.isPending}
        onConfirm={() => {
          remove.mutate(undefined, { onError });
        }}
      >
        <p>{t('electrum.remoteServers.removeBody')}</p>
      </ConfirmButton>
    </li>
  );
}

export function RemoteServers() {
  const { t } = useTranslation();
  const list = useRemoteElectrumServers();
  const entries = list.data ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('electrum.remoteServers.title')}</CardTitle>
          <CardDescription>{t('electrum.remoteServers.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length > 0 && (
          <ul className="divide-y">
            {entries.map((entry) => (
              <ServerItem key={entry.server.id} entry={entry} />
            ))}
          </ul>
        )}
        <AddServer />
        <Note tone="info">{t('electrum.remoteServers.privacy')}</Note>
      </CardContent>
    </Card>
  );
}
