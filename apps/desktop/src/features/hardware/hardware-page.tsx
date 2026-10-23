import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { Info, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type {
  AttachedDevice,
  BitcoinNetworkId,
  IdentifiedDevice,
  NodeWithStatus,
  PsbtReview,
} from '@btcortex/contracts';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { JobProgress } from '@/components/feedback/job-progress';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { chooseFileToOpen } from '@/lib/dialogs';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useJob, useNodes } from '@/features/nodes/queries';
import { PsbtActions, PsbtReviewTable } from './psbt';
import { QrScanner } from './qr';
import { hardwareKeys, useHardwareActions, useHardwareOverview, useNodeSigners, usePsbtActions } from './queries';
import { SignerWalletCard } from './signer-wallet';

// Hardware wallets (specification section 9): devices recognised from
// Windows' device list, Trezor's own software for set-up and firmware, a
// watch-only wallet on the user's node bound to the device through Bitcoin
// Core and HWI, and PSBTs for devices that sign without a cable. BTCortex
// never asks for a recovery phrase and never signs without the user asking
// and the device confirming.

const INSTALL_STAGES = [
  'resolving',
  'fetching-checksums',
  'verifying-signatures',
  'downloading',
  'extracting',
  'verifying-executables',
  'installing',
  'finalising',
] as const;
const PSBT_FILES = [{ name: 'PSBT', extensions: ['psbt', 'txt'] }];

function Note({ tone, children }: { tone: 'info' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <p className="flex max-w-prose items-start gap-2">
      <Icon
        aria-hidden="true"
        className={tone === 'info' ? 'mt-0.5 size-4 shrink-0 text-info' : 'mt-0.5 size-4 shrink-0 text-warning'}
      />
      <span>{children}</span>
    </p>
  );
}

/** A background installation with its stages, reported once when it finishes. */
function useInstallJob(onDone: () => void) {
  const [jobId, setJobId] = useState<string>();
  const job = useJob(jobId);
  const reported = useRef<string>(undefined);
  const state = job.data?.state;
  useEffect(() => {
    if (state !== 'succeeded' || jobId === undefined || reported.current === jobId) return;
    reported.current = jobId;
    onDone();
  }, [state, jobId, onDone]);
  return { job: job.data, start: setJobId };
}

function InstallProgress({ job }: { job: NonNullable<ReturnType<typeof useInstallJob>['job']> }) {
  const { t } = useTranslation();
  if (job.state === 'failed' && job.error) {
    return (
      <ErrorPanel
        title={t('hardware.installFailed')}
        error={toOrchestratorError({ code: -32000, message: job.error.message, data: job.error })}
      />
    );
  }
  if (job.state !== 'queued' && job.state !== 'running') return null;
  return (
    <JobProgress
      job={job}
      stages={INSTALL_STAGES.map((stage) => ({ id: stage, label: t(`hardware.stages.${stage}`) }))}
    />
  );
}

function deviceName(device: AttachedDevice, t: TFunction): string {
  const vendor = t(`hardware.vendors.${device.vendor}`);
  return device.model ? `${vendor} ${device.model}` : vendor;
}

function DevicesCard({ network }: { network: BitcoinNetworkId }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const overview = useHardwareOverview();
  const actions = useHardwareActions();
  const onError = useErrorFeedback();
  const [identified, setIdentified] = useState<IdentifiedDevice[]>();
  const install = useInstallJob(() => {
    toast.success(t('hardware.hwiInstalled'));
    void queryClient.invalidateQueries({ queryKey: hardwareKeys.all });
  });
  const data = overview.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hardware.devicesTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {overview.isError ? (
          <ErrorPanel
            title={t('hardware.unavailable')}
            error={toOrchestratorError(overview.error)}
            onRetry={() => void overview.refetch()}
          />
        ) : !data ? (
          <Skeleton className="h-16" />
        ) : data.devices.length === 0 ? (
          <p className="max-w-prose text-muted-foreground">{t('hardware.noDevices')}</p>
        ) : (
          <ul className="space-y-3">
            {data.devices.map((device) => (
              <li key={device.id} className="space-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{deviceName(device, t)}</span>
                  {device.confidence === 'possible' && <Badge variant="outline">{t('hardware.possibleJade')}</Badge>}
                  {device.mode === 'bootloader' && <Badge variant="warning">{t('hardware.bootloader')}</Badge>}
                </span>
                <StatusIndicator
                  tone={device.driver.ok ? 'healthy' : 'failed'}
                  label={
                    device.driver.ok
                      ? t('hardware.driverOk')
                      : t('hardware.driverProblem', { code: device.driver.problemCode ?? '?' })
                  }
                  className="text-muted-foreground"
                />
                {!device.driver.ok && <Note tone="warning">{t('hardware.driverAdvice')}</Note>}
                {device.mode === 'bootloader' && <Note tone="info">{t('hardware.bootloaderAdvice')}</Note>}
                {device.vendor === 'trezor' && device.model === null && (
                  <p className="text-xs text-muted-foreground">{t('hardware.trezorModelHint')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {data?.trezorSuite.holdsDevice && <Note tone="warning">{t('hardware.suiteHoldsDevice')}</Note>}
        {data?.hwi === null ? (
          <div className="space-y-2">
            <p className="max-w-prose text-muted-foreground">{t('hardware.hwiNeeded')}</p>
            {install.job ? (
              <InstallProgress job={install.job} />
            ) : (
              <Button
                disabled={actions.installHwi.isPending}
                onClick={() => {
                  actions.installHwi.mutate(undefined, {
                    onSuccess: ({ jobId }) => {
                      install.start(jobId);
                    },
                    onError,
                  });
                }}
              >
                {t('hardware.installHwi')}
              </Button>
            )}
          </div>
        ) : data ? (
          <div className="space-y-3">
            <Button
              variant="outline"
              disabled={actions.identify.isPending}
              onClick={() => {
                actions.identify.mutate(network, { onSuccess: setIdentified, onError });
              }}
            >
              {t('hardware.identify')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('hardware.identifyHint', { version: data.hwi.version })}</p>
            {identified?.length === 0 && <p className="text-muted-foreground">{t('hardware.identifiedNone')}</p>}
            {identified && identified.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('hardware.model')}</TableHead>
                    <TableHead>{t('hardware.fingerprint')}</TableHead>
                    <TableHead>{t('hardware.state')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {identified.map((device, index) => (
                    <TableRow key={`${device.model}-${String(index)}`}>
                      <TableCell>
                        {device.model}
                        {device.label && <span className="block text-xs text-muted-foreground">{device.label}</span>}
                      </TableCell>
                      <TableCell className="font-mono text-[13px]">{device.fingerprint ?? '—'}</TableCell>
                      <TableCell>
                        {device.error
                          ? t('hardware.deviceError', { error: device.error })
                          : device.locked
                            ? t('hardware.deviceLocked')
                            : device.needsPassphrase
                              ? t('hardware.devicePassphrase')
                              : t('hardware.deviceReady')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TrezorCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const overview = useHardwareOverview();
  const actions = useHardwareActions();
  const onError = useErrorFeedback();
  const install = useInstallJob(() => {
    toast.success(t('hardware.suiteInstalled'));
    void queryClient.invalidateQueries({ queryKey: hardwareKeys.all });
  });
  const suite = overview.data?.trezorSuite;
  const bridge = overview.data?.trezorBridge;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hardware.trezorTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="max-w-prose list-disc space-y-1.5 pl-5">
          <li>{t('hardware.trezor.suite')}</li>
          <li>{t('hardware.trezor.node')}</li>
          <li>{t('hardware.trezor.safe7')}</li>
          <li>{t('hardware.trezor.seed')}</li>
        </ul>
        {suite?.installed ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusIndicator
              tone="healthy"
              label={t('hardware.suiteInstalledVersion', { version: suite.installed.version ?? '?' })}
            />
            <Button
              variant="outline"
              disabled={actions.openTrezorSuite.isPending || suite.running}
              onClick={() => {
                actions.openTrezorSuite.mutate(undefined, { onError });
              }}
            >
              {suite.running ? t('hardware.suiteRunning') : t('hardware.openSuite')}
            </Button>
          </div>
        ) : suite ? (
          <div className="space-y-2">
            <p className="max-w-prose text-muted-foreground">{t('hardware.suiteMissing')}</p>
            {install.job ? (
              <InstallProgress job={install.job} />
            ) : (
              <Button
                variant="outline"
                disabled={actions.installTrezorSuite.isPending}
                onClick={() => {
                  actions.installTrezorSuite.mutate(undefined, {
                    onSuccess: ({ jobId }) => {
                      install.start(jobId);
                    },
                    onError,
                  });
                }}
              >
                {t('hardware.installSuite')}
              </Button>
            )}
          </div>
        ) : (
          <Skeleton className="h-8" />
        )}
        {bridge?.present && <Note tone="warning">{t('hardware.bridgeDeprecated')}</Note>}
      </CardContent>
    </Card>
  );
}

function Steps({ current }: { current: number }) {
  const { t } = useTranslation();
  const steps = ['hwi', 'node', 'device', 'wallet'] as const;
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-1" aria-label={t('hardware.steps.label')}>
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? 'step' : undefined}
          className={
            index === current
              ? 'font-medium'
              : index < current
                ? 'text-muted-foreground line-through'
                : 'text-muted-foreground'
          }
        >
          {t('hardware.steps.item', { number: index + 1, total: steps.length, name: t(`hardware.steps.${step}`) })}
        </li>
      ))}
    </ol>
  );
}

function NodeSigners({ node, hwiInstalled }: { node: NodeWithStatus; hwiInstalled: boolean }) {
  const { t } = useTranslation();
  const status = useNodeSigners(node.profile.id);
  const actions = useHardwareActions();
  const onError = useErrorFeedback();
  const [name, setName] = useState('Trezor');
  const nameId = useId();
  const data = status.data;
  if (status.isError) {
    return (
      <ErrorPanel
        title={t('hardware.node.unavailable')}
        error={toOrchestratorError(status.error)}
        onRetry={() => void status.refetch()}
      />
    );
  }
  if (!data) return <Skeleton className="h-24" />;
  const signerCount = data.signers?.length ?? 0;
  const step = !hwiInstalled
    ? 0
    : !data.configured || data.restartRequired
      ? 1
      : data.wallets.length === 0 && signerCount !== 1
        ? 2
        : 3;

  return (
    <div className="space-y-4">
      <Steps current={step} />
      {!data.manageable && data.readOnlyReason && <Note tone="info">{data.readOnlyReason}</Note>}
      {data.walletUnavailableReason && <Note tone="warning">{data.walletUnavailableReason}</Note>}
      {!data.running && <Note tone="info">{t('hardware.node.start')}</Note>}
      {data.manageable && !hwiInstalled && <Note tone="info">{t('hardware.node.hwiFirst')}</Note>}
      {data.manageable && hwiInstalled && !data.configured && (
        <ConfirmButton
          label={t('hardware.node.enable')}
          title={t('hardware.node.enableTitle', { node: node.profile.name })}
          confirmLabel={t('hardware.node.enableConfirm')}
          disabled={actions.enable.isPending}
          onConfirm={() => {
            actions.enable.mutate(node.profile.id, {
              onSuccess: ({ restarting }) => {
                toast.success(restarting ? t('hardware.node.enabledRestarting') : t('hardware.node.enabled'));
              },
              onError,
            });
          }}
        >
          <p>{t('hardware.node.enableBody')}</p>
        </ConfirmButton>
      )}
      {data.restartRequired && <Note tone="warning">{t('hardware.node.restartRequired')}</Note>}
      {data.configured && data.running && !data.restartRequired && (
        <div className="space-y-2">
          {signerCount === 0 && <Note tone="info">{t('hardware.node.connectDevice')}</Note>}
          {signerCount > 1 && <Note tone="warning">{t('hardware.node.oneAtATime')}</Note>}
          {signerCount === 1 && data.signers?.[0] && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                actions.createWallet.mutate(
                  { nodeId: node.profile.id, name: name.trim() },
                  { onSuccess: () => toast.success(t('hardware.node.walletCreated')), onError },
                );
              }}
            >
              <div className="space-y-1">
                <Label htmlFor={nameId}>{t('hardware.node.walletName')}</Label>
                <Input
                  id={nameId}
                  value={name}
                  maxLength={64}
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                  }}
                />
              </div>
              <Button
                type="submit"
                disabled={
                  actions.createWallet.isPending || name.trim() === '' || !/^[A-Za-z0-9 _-]+$/.test(name.trim())
                }
              >
                {t('hardware.node.createWallet', { model: data.signers[0].name })}
              </Button>
              {actions.createWallet.isPending && <StatusIndicator tone="working" label={t('hardware.node.creating')} />}
            </form>
          )}
        </div>
      )}
      {data.wallets.map((wallet) => (
        <SignerWalletCard key={wallet.name} nodeId={node.profile.id} wallet={wallet.name} />
      ))}
    </div>
  );
}

function PsbtImport({ node, wallets }: { node: NodeWithStatus; wallets: readonly string[] }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const psbt = usePsbtActions(node.profile.id);
  const [text, setText] = useState('');
  const [wallet, setWallet] = useState('');
  const [review, setReview] = useState<PsbtReview>();
  const [hex, setHex] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const ids = { text: useId(), wallet: useId() };

  const read = (value: string) => {
    psbt.decode.mutate(
      { psbt: value.trim(), ...(wallet === '' ? {} : { wallet }) },
      {
        onSuccess: (decoded) => {
          setReview(decoded);
          setHex(null);
          if (decoded.complete) {
            psbt.finalize.mutate(decoded.psbt, {
              onSuccess: ({ hex: final }) => {
                setHex(final);
              },
              onError,
            });
          }
        },
        onError,
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hardware.import.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="max-w-prose text-muted-foreground">{t('hardware.import.description')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={psbt.readFile.isPending}
            onClick={() => {
              void chooseFileToOpen(PSBT_FILES).then((path) => {
                if (path === null) return;
                psbt.readFile.mutate(path, {
                  onSuccess: ({ psbt: loaded }) => {
                    setText(loaded);
                    read(loaded);
                  },
                  onError,
                });
              });
            }}
          >
            {t('hardware.import.openFile')}
          </Button>
          <Button
            variant="outline"
            disabled={scanning}
            onClick={() => {
              setScanning(true);
            }}
          >
            {t('hardware.qr.scan')}
          </Button>
        </div>
        {scanning && (
          <QrScanner
            onPsbt={(scanned) => {
              setScanning(false);
              setText(scanned);
              read(scanned);
            }}
            onCancel={() => {
              setScanning(false);
            }}
          />
        )}
        <div className="space-y-1">
          <Label htmlFor={ids.text}>{t('hardware.import.paste')}</Label>
          <Textarea
            id={ids.text}
            rows={3}
            value={text}
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(event) => {
              setText(event.currentTarget.value);
            }}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {wallets.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor={ids.wallet}>{t('hardware.import.wallet')}</Label>
              <NativeSelect
                id={ids.wallet}
                value={wallet}
                onChange={(event) => {
                  setWallet(event.currentTarget.value);
                }}
              >
                <option value="">{t('hardware.import.noWallet')}</option>
                {wallets.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <Button
            disabled={text.trim() === '' || psbt.decode.isPending}
            onClick={() => {
              read(text);
            }}
          >
            {t('hardware.import.read')}
          </Button>
        </div>
        {review && (
          <div className="space-y-3">
            <PsbtReviewTable review={review} />
            {/* A new PSBT, or another node, starts afresh: no QR codes or "sent" state carried over. */}
            <PsbtActions
              key={`${node.profile.id}:${review.psbt}`}
              nodeId={node.profile.id}
              {...(wallet === '' ? {} : { wallet })}
              review={review}
              hex={hex}
              onSigned={(signed, signedHex) => {
                setReview(signed);
                setHex(signedHex);
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NodeCard() {
  const { t } = useTranslation();
  const nodes = useNodes();
  const overview = useHardwareOverview();
  const [chosen, setChosen] = useState<string>();
  const selectId = useId();
  const list = nodes.data ?? [];
  const node = list.find((candidate) => candidate.profile.id === chosen) ?? list[0];
  const signers = useNodeSigners(node?.profile.id);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('hardware.node.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-prose text-muted-foreground">{t('hardware.node.description')}</p>
          {nodes.isPending ? (
            <Skeleton className="h-8" />
          ) : list.length === 0 ? (
            <p className="text-muted-foreground">
              {t('hardware.node.noNodes')}{' '}
              <Link to="/nodes" className="underline underline-offset-2">
                {t('navigation.nodes')}
              </Link>
            </p>
          ) : (
            <>
              {list.length > 1 && (
                <div className="space-y-1">
                  <Label htmlFor={selectId}>{t('hardware.node.choose')}</Label>
                  <NativeSelect
                    id={selectId}
                    value={node?.profile.id}
                    onChange={(event) => {
                      setChosen(event.currentTarget.value);
                    }}
                  >
                    {list.map((candidate) => (
                      <option key={candidate.profile.id} value={candidate.profile.id}>
                        {candidate.profile.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              {node && (
                <NodeSigners node={node} hwiInstalled={overview.data?.hwi !== null && overview.data !== undefined} />
              )}
            </>
          )}
        </CardContent>
      </Card>
      {node?.status.state === 'running' && (
        <PsbtImport
          key={node.profile.id}
          node={node}
          wallets={signers.data?.wallets.map((wallet) => wallet.name) ?? []}
        />
      )}
    </>
  );
}

function CompatibilityCard() {
  const { t } = useTranslation();
  const rows = ['trezor', 'trezorSafe7', 'ledger', 'bitbox', 'coldcard', 'jade', 'airgapped'] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hardware.compatibility.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('hardware.compatibility.device')}</TableHead>
              <TableHead>{t('hardware.compatibility.withNode')}</TableHead>
              <TableHead>{t('hardware.compatibility.notes')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row} className="align-top">
                <TableCell className="font-medium">{t(`hardware.compatibility.rows.${row}.device`)}</TableCell>
                <TableCell>{t(`hardware.compatibility.rows.${row}.node`)}</TableCell>
                <TableCell className="max-w-prose">{t(`hardware.compatibility.rows.${row}.notes`)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function HardwarePage() {
  const { t } = useTranslation();
  const nodes = useNodes();
  const network = nodes.data?.[0]?.profile.network ?? 'mainnet';
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('hardware.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('hardware.description')}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <DevicesCard network={network} />
        <TrezorCard />
      </div>
      <NodeCard />
      <CompatibilityCard />
    </div>
  );
}
