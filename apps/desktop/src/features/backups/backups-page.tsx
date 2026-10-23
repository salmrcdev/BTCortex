import { Eye, EyeOff, FolderOpen, LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { BackupItem, BackupKind, BackupOverview, BackupSummary, BackupVerification } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { JobProgress } from '@/components/feedback/job-progress';
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
import { Checkbox, Input, Label, NativeSelect } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { chooseFolder } from '@/lib/dialogs';
import { formatBytes, formatRelativeTime, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useJob } from '@/features/nodes/queries';
import { useBackupActions, useBackupOverview, useRestorePreview } from './queries';

// The backup centre (specification section 22): what can be backed up, kept
// apart by kind, and what is deliberately left out; where backups go, how
// many are kept and when they run; backing up now; and, for each backup,
// verification and a restore preview before anything is put back.

const MIN_PASSPHRASE = 12;
const KIND_ORDER: readonly BackupKind[] = ['configuration', 'wallet', 'descriptors', 'channel', 'credentials'];
const SCHEDULES = [
  { hours: 0, label: 'backups.schedule.off' },
  { hours: 6, label: 'backups.schedule.every6' },
  { hours: 12, label: 'backups.schedule.every12' },
  { hours: 24, label: 'backups.schedule.daily' },
  { hours: 168, label: 'backups.schedule.weekly' },
] as const;
const BACKUP_STAGES = ['collecting', 'writing', 'verifying'] as const;

function PassphraseField({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | undefined;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [visible, setVisible] = useState(false);
  const describedBy = [hint === undefined ? '' : `${id}-hint`, error === undefined ? '' : `${id}-error`]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={error !== undefined}
          {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={visible ? t('backups.passphrase.hide') : t('backups.passphrase.show')}
          aria-pressed={visible}
          onClick={() => {
            setVisible(!visible);
          }}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function passphraseError(
  passphrase: string,
  confirmation: string,
  messages: { tooShort: string; mismatch: string },
): string | undefined {
  if (passphrase === '') return undefined;
  if (passphrase.length < MIN_PASSPHRASE) return messages.tooShort;
  if (confirmation !== '' && confirmation !== passphrase) return messages.mismatch;
  return undefined;
}

function KindBadge({ kind }: { kind: BackupKind }) {
  const { t } = useTranslation();
  return (
    <Badge variant={kind === 'wallet' || kind === 'credentials' ? 'warning' : 'neutral'}>
      {t(`backups.kind.${kind}`)}
    </Badge>
  );
}

function InventoryCard({ overview }: { overview: BackupOverview }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('backups.inventory.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Note tone="warning">{t('backups.inventory.fundsWarning')}</Note>
        <dl className="space-y-3">
          {KIND_ORDER.map((kind) => (
            <div key={kind} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt>
                <KindBadge kind={kind} />
              </dt>
              <dd className="text-muted-foreground">{t(`backups.kindDescription.${kind}`)}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2">
          <h3 className="font-medium">{t('backups.inventory.notBackedUp')}</h3>
          <ul className="space-y-1">
            {overview.notBackedUp.map((item) => (
              <li key={item.kind}>
                <span className="font-medium">{item.title}.</span>{' '}
                <span className="text-muted-foreground">{item.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function DestinationCard({ overview }: { overview: BackupOverview }) {
  const { t } = useTranslation();
  const actions = useBackupActions();
  const feedback = useErrorFeedback();
  const formId = useId();
  const { settings } = overview;
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const error = passphraseError(passphrase, confirmation, {
    tooShort: t('backups.passphrase.tooShort'),
    mismatch: t('backups.passphrase.mismatch'),
  });
  const passphraseReady = passphrase.length >= MIN_PASSPHRASE && confirmation === passphrase;

  const change = (value: Parameters<typeof actions.configure.mutate>[0], success?: string) => {
    actions.configure.mutate(value, {
      onSuccess: () => {
        if (success !== undefined) toast.success(success);
      },
      onError: feedback,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('backups.destination.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="font-medium">{t('backups.destination.folder')}</p>
          <div className="flex flex-wrap items-center gap-2">
            {settings.destination === null ? (
              <span className="text-muted-foreground">{t('backups.destination.none')}</span>
            ) : (
              <CopyableValue value={settings.destination} label={t('backups.destination.folder')} />
            )}
            <Button
              variant="outline"
              disabled={actions.configure.isPending}
              onClick={() => {
                void chooseFolder(settings.destination ?? undefined).then((folder) => {
                  if (folder !== null) change({ destination: folder }, t('backups.destination.saved'));
                });
              }}
            >
              <FolderOpen aria-hidden="true" />
              {t('backups.destination.choose')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('backups.destination.hint')}</p>
          {overview.sameDiskAsData && <Note tone="warning">{t('backups.destination.sameDisk')}</Note>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${formId}-schedule`}>{t('backups.destination.schedule')}</Label>
            <NativeSelect
              id={`${formId}-schedule`}
              value={String(settings.schedule.everyHours)}
              disabled={settings.destination === null || actions.configure.isPending}
              onChange={(event) => {
                change({ schedule: { ...settings.schedule, everyHours: Number(event.target.value) } });
              }}
            >
              {SCHEDULES.map(({ hours, label }) => (
                <option key={hours} value={hours}>
                  {t(label)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-retention`}>{t('backups.destination.retention')}</Label>
            <NativeSelect
              id={`${formId}-retention`}
              value={String(settings.retention)}
              disabled={actions.configure.isPending}
              onChange={(event) => {
                change({ retention: Number(event.target.value) });
              }}
            >
              {[3, 5, 10, 20, 50].map((count) => (
                <option key={count} value={count}>
                  {t('backups.destination.keep', { count })}
                </option>
              ))}
            </NativeSelect>
            <p className="text-sm text-muted-foreground">{t('backups.destination.retentionHint')}</p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="font-medium">{t('backups.destination.encryptedTitle')}</p>
          <p className="text-muted-foreground">{t('backups.destination.encryptedHint')}</p>
          {settings.passphraseStored ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusIndicator tone="healthy" label={t('backups.destination.passphraseStored')} />
              <label className="inline-flex items-center gap-2">
                <Checkbox
                  checked={settings.schedule.encrypted}
                  disabled={actions.configure.isPending}
                  onChange={(event) => {
                    change({ schedule: { ...settings.schedule, encrypted: event.target.checked } });
                  }}
                />
                {t('backups.destination.encryptScheduled')}
              </label>
              <Button
                variant="ghost"
                disabled={actions.configure.isPending}
                onClick={() => {
                  change(
                    { forgetPassphrase: true, schedule: { ...settings.schedule, encrypted: false } },
                    t('backups.destination.forgotten'),
                  );
                }}
              >
                {t('backups.destination.forget')}
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!passphraseReady) return;
                change(
                  { passphrase, schedule: { ...settings.schedule, encrypted: true } },
                  t('backups.destination.passphraseSaved'),
                );
                setPassphrase('');
                setConfirmation('');
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <PassphraseField
                  label={t('backups.passphrase.label')}
                  value={passphrase}
                  onChange={setPassphrase}
                  hint={t('backups.passphrase.hint')}
                  error={error}
                />
                <PassphraseField
                  label={t('backups.passphrase.confirm')}
                  value={confirmation}
                  onChange={setConfirmation}
                />
              </div>
              <Button type="submit" variant="outline" disabled={!passphraseReady || actions.configure.isPending}>
                {t('backups.destination.storePassphrase')}
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  checked,
  disabled,
  onChange,
  note,
}: {
  item: BackupItem;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  note?: string | undefined;
}) {
  const id = useId();
  return (
    <li className="flex items-start gap-3 border-b py-2 last:border-0">
      <Checkbox
        id={id}
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-medium">
          {item.title}
          <span className="font-normal text-muted-foreground">· {item.component}</span>
          <KindBadge kind={item.kind} />
        </label>
        <p className="text-xs text-muted-foreground">{note ?? item.unavailableReason ?? item.description}</p>
      </div>
    </li>
  );
}

function BackUpNowCard({ overview }: { overview: BackupOverview }) {
  const { t } = useTranslation();
  const actions = useBackupActions();
  const feedback = useErrorFeedback();
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const job = useJob(jobId);
  const encrypted = passphrase.length >= MIN_PASSPHRASE && confirmation === passphrase;
  const error = passphraseError(passphrase, confirmation, {
    tooShort: t('backups.passphrase.tooShort'),
    mismatch: t('backups.passphrase.mismatch'),
  });
  const selected =
    chosen ?? new Set(overview.items.filter((item) => item.available && !item.secret).map((item) => item.id));
  const usable = (item: BackupItem) => item.available && (!item.secret || encrypted);
  const toRun = overview.items.filter((item) => selected.has(item.id) && usable(item)).map((item) => item.id);
  const running = job.data !== undefined && (job.data.state === 'queued' || job.data.state === 'running');
  const lastRun = overview.settings.lastRun;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('backups.now.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {overview.settings.destination === null ? (
          <Note tone="info">{t('backups.now.chooseFirst')}</Note>
        ) : (
          <>
            <ul>
              {overview.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  checked={selected.has(item.id) && usable(item)}
                  disabled={!usable(item) || running}
                  note={item.available && item.secret && !encrypted ? t('backups.now.needsPassphrase') : undefined}
                  onChange={(checked) => {
                    const next = new Set(selected);
                    if (checked) next.add(item.id);
                    else next.delete(item.id);
                    setChosen(next);
                  }}
                />
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <PassphraseField
                label={t('backups.passphrase.optional')}
                value={passphrase}
                onChange={setPassphrase}
                hint={t('backups.passphrase.hint')}
                error={error}
              />
              <PassphraseField
                label={t('backups.passphrase.confirm')}
                value={confirmation}
                onChange={setConfirmation}
              />
            </div>
            <Button
              disabled={toRun.length === 0 || running || actions.create.isPending || error !== undefined}
              onClick={() => {
                actions.create.mutate(
                  { items: toRun, ...(encrypted ? { passphrase } : {}) },
                  {
                    onSuccess: ({ jobId: started }) => {
                      setJobId(started);
                    },
                    onError: feedback,
                  },
                );
              }}
            >
              {(running || actions.create.isPending) && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {encrypted ? t('backups.now.runEncrypted') : t('backups.now.run')}
            </Button>
            {job.data && (
              <div className="space-y-2">
                <JobProgress
                  job={job.data}
                  stages={BACKUP_STAGES.map((id) => ({ id, label: t(`backups.stage.${id}`) }))}
                />
                {job.data.state === 'failed' && job.data.error && (
                  <ErrorPanel
                    title={t('backups.now.failed')}
                    error={toOrchestratorError({ code: -32000, message: job.data.error.message, data: job.data.error })}
                  />
                )}
              </div>
            )}
          </>
        )}
        {lastRun && (
          <div className="space-y-1 rounded-lg border p-3" role="status">
            <StatusIndicator
              tone={lastRun.outcome === 'succeeded' ? 'healthy' : 'failed'}
              label={t(lastRun.outcome === 'succeeded' ? 'backups.now.lastSucceeded' : 'backups.now.lastFailed', {
                time: formatRelativeTime(new Date(lastRun.at)),
                trigger: t(`backups.trigger.${lastRun.trigger}`),
              })}
            />
            {lastRun.message !== undefined && <p className="text-muted-foreground">{lastRun.message}</p>}
            {lastRun.skipped.length > 0 && (
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {lastRun.skipped.map((item) => (
                  <li key={item.id}>{t('backups.now.skipped', { title: item.title, reason: item.reason })}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VerifyResult({ result }: { result: BackupVerification }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1" role="status">
      <StatusIndicator
        tone={result.ok ? 'healthy' : 'failed'}
        label={
          result.ok
            ? t(result.decrypted ? 'backups.verify.okFull' : 'backups.verify.okStored', { count: result.checkedFiles })
            : t('backups.verify.problems', { count: result.problems.length })
        }
      />
      {result.problems.length > 0 && (
        <ul className="list-inside list-disc text-xs text-danger">
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A bitcoin.conf whose restore stopped at settings that need the user's confirmation. */
interface SettingsToConfirm {
  itemId: string;
  settings: string[];
}

function RestoreDialog({
  backup,
  confirm,
  onClose,
}: {
  backup: BackupSummary;
  confirm?: SettingsToConfirm;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const preview = useRestorePreview(backup.path);
  const actions = useBackupActions();
  const feedback = useErrorFeedback();
  const [chosen, setChosen] = useState<Set<string>>(new Set(confirm ? [confirm.itemId] : []));
  const [passphrase, setPassphrase] = useState('');
  const [settingsAccepted, setSettingsAccepted] = useState(false);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const job = useJob(jobId);
  const restorable =
    preview.data?.items.filter((item) => item.action === 'restore' && item.blockedReason === undefined) ?? [];
  const ready =
    chosen.size > 0 && (!backup.encrypted || passphrase !== '') && (confirm === undefined || settingsAccepted);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <AlertDialogTitle>{t('backups.restore.title', { time: formatTimestamp(backup.createdAt) })}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-3">
            <p>{t('backups.restore.intro')}</p>
            {preview.isError && (
              <ErrorPanel title={t('backups.restore.unreadable')} error={toOrchestratorError(preview.error)} />
            )}
            {!preview.data && !preview.isError && <Skeleton className="h-32" />}
            {preview.data && (
              <ul className="space-y-2">
                {preview.data.items.map((item) => {
                  const canRestore = item.action === 'restore' && item.blockedReason === undefined;
                  return (
                    <li key={item.id} className="rounded-lg border p-2">
                      <label className="flex items-start gap-2">
                        {canRestore ? (
                          <Checkbox
                            className="mt-1"
                            checked={chosen.has(item.id)}
                            disabled={jobId !== undefined}
                            onChange={(event) => {
                              const next = new Set(chosen);
                              if (event.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              setChosen(next);
                            }}
                          />
                        ) : (
                          <span className="w-4" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                            {item.title}
                            <span className="font-normal text-muted-foreground">· {item.component}</span>
                            <KindBadge kind={item.kind} />
                          </span>
                          <span className="block text-xs">{item.explanation}</span>
                          {item.blockedReason !== undefined && (
                            <span className="block text-xs text-warning">{item.blockedReason}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {confirm && (
              <div className="space-y-2 rounded-lg border border-warning/40 p-3">
                <p className="text-foreground">
                  {t('backups.restore.settingsToConfirm', { settings: confirm.settings.join(', ') })}
                </p>
                <label className="flex items-start gap-2 text-foreground">
                  <Checkbox
                    className="mt-1"
                    checked={settingsAccepted}
                    disabled={jobId !== undefined}
                    onChange={(event) => {
                      setSettingsAccepted(event.target.checked);
                    }}
                  />
                  <span>{t('backups.restore.acceptSettings')}</span>
                </label>
              </div>
            )}
            {backup.encrypted && restorable.length > 0 && (
              <PassphraseField label={t('backups.passphrase.label')} value={passphrase} onChange={setPassphrase} />
            )}
            {job.data && (
              <div className="space-y-1">
                <StatusIndicator
                  tone={job.data.state === 'succeeded' ? 'healthy' : job.data.state === 'failed' ? 'failed' : 'working'}
                  label={
                    job.data.state === 'succeeded'
                      ? t('backups.restore.done')
                      : job.data.state === 'failed'
                        ? (job.data.error?.message ?? t('backups.restore.failed'))
                        : job.data.progress.message
                  }
                />
              </div>
            )}
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>{jobId === undefined ? t('common.cancel') : t('backups.restore.close')}</AlertDialogCancel>
          {jobId === undefined && restorable.length > 0 && (
            <AlertDialogAction
              destructive
              disabled={!ready || actions.restore.isPending}
              onClick={(event) => {
                event.preventDefault();
                actions.restore.mutate(
                  {
                    path: backup.path,
                    items: [...chosen],
                    ...(backup.encrypted ? { passphrase } : {}),
                    ...(confirm && settingsAccepted ? { acceptedSettings: confirm.settings } : {}),
                  },
                  {
                    onSuccess: ({ jobId: started }) => {
                      setJobId(started);
                    },
                    onError: feedback,
                  },
                );
              }}
            >
              {t('backups.restore.confirm', { count: chosen.size })}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BackupRow({ backup, onRestore }: { backup: BackupSummary; onRestore: () => void }) {
  const { t } = useTranslation();
  const actions = useBackupActions();
  const feedback = useErrorFeedback();
  const [passphrase, setPassphrase] = useState('');
  const [result, setResult] = useState<BackupVerification | undefined>(undefined);
  return (
    <li className="space-y-2 border-b py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {formatTimestamp(backup.createdAt)}
            <Badge variant={backup.encrypted ? 'success' : 'neutral'}>
              {backup.encrypted ? t('backups.list.encrypted') : t('backups.list.notEncrypted')}
            </Badge>
            <span className="font-normal text-muted-foreground">{t(`backups.trigger.${backup.trigger}`)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t('backups.list.summary', {
              count: backup.items.length,
              size: formatBytes(backup.bytes),
              version: backup.appVersion,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={actions.verify.isPending}
            onClick={() => {
              actions.verify.mutate(
                { path: backup.path, ...(passphrase === '' ? {} : { passphrase }) },
                {
                  onSuccess: setResult,
                  onError: feedback,
                },
              );
            }}
          >
            {t('backups.list.verify')}
          </Button>
          <Button variant="outline" onClick={onRestore}>
            {t('backups.list.restore')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              actions.reveal.mutate(backup.path, { onError: feedback });
            }}
          >
            {t('backups.list.show')}
          </Button>
        </div>
      </div>
      {backup.encrypted && (
        <div className="max-w-md">
          <PassphraseField
            label={t('backups.verify.passphrase')}
            value={passphrase}
            onChange={setPassphrase}
            hint={t('backups.verify.passphraseHint')}
          />
        </div>
      )}
      {result && <VerifyResult result={result} />}
    </li>
  );
}

function Section({ children }: { children: ReactNode }) {
  // grid-cols-1 lets a column shrink below its content, so a long folder path wraps instead of widening the page.
  return <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">{children}</div>;
}

export function BackupsPage() {
  const { t } = useTranslation();
  const overview = useBackupOverview();
  const [restoring, setRestoring] = useState<{ backup: BackupSummary; confirm?: SettingsToConfirm } | undefined>(
    undefined,
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('backups.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('backups.description')}</p>
      </div>
      {overview.isError ? (
        <ErrorPanel
          title={t('backups.unavailable')}
          error={toOrchestratorError(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : !overview.data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Section>
            <BackUpNowCard overview={overview.data} />
            <DestinationCard overview={overview.data} />
          </Section>
          <Card>
            <CardHeader>
              <CardTitle>{t('backups.list.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.data.backups.length === 0 ? (
                <p className="text-muted-foreground">{t('backups.list.empty')}</p>
              ) : (
                <ul>
                  {overview.data.backups.map((backup) => (
                    <BackupRow
                      key={backup.path}
                      backup={backup}
                      onRestore={() => {
                        setRestoring({ backup });
                      }}
                    />
                  ))}
                </ul>
              )}
              {overview.data.lastRestore && (
                <div className="mt-4 space-y-1 rounded-lg border p-3" role="status">
                  <p className="font-medium">
                    {t('backups.restore.last', { time: formatRelativeTime(new Date(overview.data.lastRestore.at)) })}
                  </p>
                  <ul className="space-y-1">
                    {overview.data.lastRestore.results.map((result) => {
                      const backup = overview.data.backups.find(
                        (candidate) => candidate.path === overview.data.lastRestore?.backupPath,
                      );
                      const settings = result.settingsToConfirm;
                      return (
                        <li key={result.id} className="space-y-1">
                          <StatusIndicator
                            tone={result.outcome === 'restored' ? 'healthy' : 'failed'}
                            label={`${result.title}: ${result.message}`}
                          />
                          {settings && backup && (
                            <Button
                              variant="outline"
                              onClick={() => {
                                setRestoring({ backup, confirm: { itemId: result.id, settings } });
                              }}
                            >
                              {t('backups.restore.reviewSettings')}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          <InventoryCard overview={overview.data} />
        </>
      )}
      {restoring && (
        <RestoreDialog
          backup={restoring.backup}
          {...(restoring.confirm ? { confirm: restoring.confirm } : {})}
          onClose={() => {
            setRestoring(undefined);
          }}
        />
      )}
    </div>
  );
}
