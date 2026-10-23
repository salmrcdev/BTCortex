import { LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { AddLightningParams, AppError, LocalLightningNode } from '@btcortex/contracts';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { Note } from '@/components/feedback/note';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { RadioCards } from '@/components/ui/radio-cards';
import { chooseFileToOpen } from '@/lib/dialogs';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useLightningActions } from './queries';
import { accessVariant, LightningNetworkBadge } from './parts';

// Connecting a Lightning node: the LND found on this computer, with its
// read-only macaroon, takes one click; otherwise a REST address with LND's
// certificate and a macaroon file, or an lndconnect address. A macaroon that
// can move funds is refused until the user accepts it, after BTCortex has
// said why the read-only one is enough. Files are read by the orchestrator:
// the interface only learns the paths the user chose.

type Method = 'local' | 'files' | 'lndconnect';
type MacaroonKind = 'readonly' | 'invoice' | 'admin';

/** What BTCortex found of LND on this computer. */
export function LocalLndSummary({ local }: { local: LocalLightningNode }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground">{t('lightning.local.found', { directory: local.directory })}</p>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">{t('lightning.local.network')}</dt>
        <dd>{local.network ? <LightningNetworkBadge network={local.network} /> : t('common.unknown')}</dd>
        <dt className="text-muted-foreground">{t('lightning.local.restAddress')}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {local.restAddress === null ? (
            t('lightning.local.restOff')
          ) : (
            <>
              <span className="font-mono text-[13px]">{local.restAddress}</span>
              <StatusIndicator
                tone={local.running ? 'healthy' : 'inactive'}
                label={local.running ? t('lightning.local.running') : t('lightning.local.notRunning')}
              />
            </>
          )}
        </dd>
        <dt className="text-muted-foreground">{t('lightning.local.macaroons')}</dt>
        <dd>
          {local.macaroons.length === 0 ? (
            t('lightning.local.noMacaroons')
          ) : (
            <ul className="flex flex-wrap gap-2">
              {local.macaroons.map((macaroon) => (
                <li key={macaroon.kind}>
                  <Badge variant={accessVariant(macaroon.access)}>
                    {t(`lightning.macaroonKind.${macaroon.kind}`)} · {t(`lightning.access.${macaroon.access}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </div>
  );
}

function FileField({
  label,
  hint,
  path,
  onChoose,
}: {
  label: string;
  hint: string;
  path: string;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const buttonId = useId();
  const pathId = useId();
  const hintId = useId();
  return (
    <div className="space-y-1">
      <span id={labelId} className="block font-medium">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {/* Named with its field ("TLS certificate Choose…"), and described by the file chosen so far. */}
        <Button
          id={buttonId}
          type="button"
          variant="outline"
          onClick={onChoose}
          aria-labelledby={`${labelId} ${buttonId}`}
          aria-describedby={`${pathId} ${hintId}`}
        >
          {t('lightning.add.choose')}
        </Button>
        <span id={pathId} className="min-w-0 break-all font-mono text-[13px] text-muted-foreground">
          {path === '' ? t('lightning.add.noFile') : path}
        </span>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

export interface ConnectPanelProps {
  local: LocalLightningNode | null | undefined;
  /** The local LND has a card of its own next to this panel, so it is not described twice. */
  localShownApart?: boolean;
  onConnected: (connectionId: string) => void;
  onCancel?: () => void;
}

export function ConnectPanel({ local, localShownApart = false, onConnected, onCancel }: ConnectPanelProps) {
  const { t } = useTranslation();
  const actions = useLightningActions();
  const feedback = useErrorFeedback();
  const formId = useId();
  const localUsable = local !== null && local !== undefined && local.restAddress !== null && local.macaroons.length > 0;
  const [method, setMethod] = useState<Method>(
    localUsable && local.connectionId === null && !localShownApart ? 'local' : 'files',
  );
  const [name, setName] = useState('');
  const [macaroonKind, setMacaroonKind] = useState<MacaroonKind>('readonly');
  const [restAddress, setRestAddress] = useState('');
  const [certificatePath, setCertificatePath] = useState('');
  const [macaroonPath, setMacaroonPath] = useState('');
  const [uri, setUri] = useState('');
  const [spending, setSpending] = useState<{ params: AddLightningParams; error: AppError } | null>(null);

  const methodOptions = [
    ...(localUsable && local.connectionId === null
      ? [
          {
            value: 'local' as const,
            title: t('lightning.add.methodLocal'),
            description: t('lightning.add.methodLocalDescription'),
          },
        ]
      : []),
    {
      value: 'files' as const,
      title: t('lightning.add.methodFiles'),
      description: t('lightning.add.methodFilesDescription'),
    },
    {
      value: 'lndconnect' as const,
      title: t('lightning.add.methodLndconnect'),
      description: t('lightning.add.methodLndconnectDescription'),
    },
  ];

  const source = (): AddLightningParams['source'] => {
    if (method === 'local') return { kind: 'local', macaroon: macaroonKind };
    if (method === 'lndconnect') return { kind: 'lndconnect', uri: uri.trim() };
    return {
      kind: 'files',
      restAddress: restAddress.trim(),
      ...(certificatePath === '' ? {} : { tlsCertificatePath: certificatePath }),
      macaroonPath,
    };
  };
  const complete =
    name.trim() !== '' &&
    (method === 'local' ||
      (method === 'lndconnect' && uri.trim() !== '') ||
      (method === 'files' && restAddress.trim() !== '' && macaroonPath !== ''));

  const submit = (params: AddLightningParams) => {
    actions.add.mutate(params, {
      onSuccess: (added) => {
        toast.success(t('lightning.add.connected', { name: added.connection.name }));
        onConnected(added.connection.id);
      },
      onError: (error) => {
        const failure = toOrchestratorError(error);
        if (failure.appError?.code === 'lightning.spending-macaroon') {
          setSpending({ params, error: failure.appError });
          return;
        }
        feedback(error);
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('lightning.add.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (complete) submit({ name: name.trim(), source: source() });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`${formId}-name`}>{t('lightning.add.name')}</Label>
            <Input
              id={`${formId}-name`}
              value={name}
              maxLength={60}
              placeholder={t('lightning.add.namePlaceholder')}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <RadioCards
            label={t('lightning.add.method')}
            value={method}
            onValueChange={setMethod}
            options={methodOptions}
          />

          {method === 'local' && local && (
            <div className="space-y-3 rounded-lg border p-3">
              {!localShownApart && <LocalLndSummary local={local} />}
              <div className="space-y-1">
                <Label htmlFor={`${formId}-macaroon`}>{t('lightning.add.macaroon')}</Label>
                <NativeSelect
                  id={`${formId}-macaroon`}
                  value={macaroonKind}
                  onChange={(event) => {
                    setMacaroonKind(event.target.value as MacaroonKind);
                  }}
                >
                  {local.macaroons.map((macaroon) => (
                    <option key={macaroon.kind} value={macaroon.kind}>
                      {t(`lightning.macaroonKind.${macaroon.kind}`)} ({t(`lightning.access.${macaroon.access}`)})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          )}

          {method === 'files' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor={`${formId}-rest`}>{t('lightning.add.restAddress')}</Label>
                <Input
                  id={`${formId}-rest`}
                  value={restAddress}
                  placeholder="192.168.1.20:8080"
                  spellCheck={false}
                  aria-describedby={`${formId}-rest-hint`}
                  onChange={(event) => {
                    setRestAddress(event.target.value);
                  }}
                />
                <p id={`${formId}-rest-hint`} className="text-xs text-muted-foreground">
                  {t('lightning.add.restAddressHint')}
                </p>
              </div>
              <FileField
                label={t('lightning.add.certificate')}
                hint={t('lightning.add.certificateHint')}
                path={certificatePath}
                onChoose={() => {
                  void chooseFileToOpen([{ name: 'TLS certificate', extensions: ['cert', 'pem', 'crt'] }]).then(
                    (path) => {
                      if (path !== null) setCertificatePath(path);
                    },
                  );
                }}
              />
              <FileField
                label={t('lightning.add.macaroonFile')}
                hint={t('lightning.add.macaroonFileHint')}
                path={macaroonPath}
                onChoose={() => {
                  void chooseFileToOpen([{ name: 'Macaroon', extensions: ['macaroon'] }]).then((path) => {
                    if (path !== null) setMacaroonPath(path);
                  });
                }}
              />
            </div>
          )}

          {method === 'lndconnect' && (
            <div className="space-y-1">
              <Label htmlFor={`${formId}-uri`}>{t('lightning.add.uri')}</Label>
              <Textarea
                id={`${formId}-uri`}
                value={uri}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                placeholder="lndconnect://…"
                className="font-mono text-[13px]"
                aria-describedby={`${formId}-uri-hint`}
                onChange={(event) => {
                  setUri(event.target.value);
                }}
              />
              <p id={`${formId}-uri-hint`} className="text-xs text-muted-foreground">
                {t('lightning.add.uriHint')}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!complete || actions.add.isPending}>
              {actions.add.isPending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {actions.add.isPending ? t('lightning.add.connecting') : t('lightning.add.connect')}
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                {t('lightning.add.cancel')}
              </Button>
            )}
          </div>
        </form>

        <AlertDialog
          open={spending !== null}
          onOpenChange={(open) => {
            if (!open) setSpending(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogTitle>{t('lightning.add.spendingTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{spending?.error.message}</p>
                <p>{t('lightning.add.spendingWhy')}</p>
              </div>
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                destructive
                onClick={() => {
                  if (spending) submit({ ...spending.params, acceptSpendingMacaroon: true });
                  setSpending(null);
                }}
              >
                {t('lightning.add.spendingConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

/** The one-click way in when BTCortex found LND on this computer and nothing is connected yet. */
export function LocalLndCard({ local, onConnected }: { local: LocalLightningNode; onConnected: (id: string) => void }) {
  const { t } = useTranslation();
  const actions = useLightningActions();
  const feedback = useErrorFeedback();
  const readOnly = local.macaroons.find((macaroon) => macaroon.kind === 'readonly');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('lightning.local.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <LocalLndSummary local={local} />
        {local.connectionId !== null ? (
          <Note tone="info">{t('lightning.local.connected')}</Note>
        ) : (
          readOnly &&
          local.restAddress !== null && (
            <Button
              disabled={actions.add.isPending}
              onClick={() => {
                actions.add.mutate(
                  { name: t('lightning.local.title'), source: { kind: 'local', macaroon: 'readonly' } },
                  {
                    onSuccess: (added) => {
                      toast.success(t('lightning.add.connected', { name: added.connection.name }));
                      onConnected(added.connection.id);
                    },
                    onError: feedback,
                  },
                );
              }}
            >
              {actions.add.isPending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {t('lightning.local.connectReadOnly')}
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}
