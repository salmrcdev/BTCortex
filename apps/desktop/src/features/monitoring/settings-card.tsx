import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigureMonitoringParams, MonitoringSettings } from '@btcortex/contracts';
import { toast } from 'sonner';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, NativeSelect } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPercent } from '@/lib/format';
import { durationLabel } from './history-card';
import { useConfigureMonitoring, useMonitoringSettings } from './queries';

// How long metrics are kept, when alerts are raised and which ones become
// Windows notifications (specification sections 19.1 and 19.2). Each choice
// applies as soon as it is made.

const DETAILED_HOURS = [6, 12, 24, 48, 72, 168];
const HISTORY_DAYS = [7, 30, 90, 180, 365];
const DISK_WARNING_GIB = [5, 10, 20, 50, 100, 200];
const DISK_CRITICAL_GIB = [1, 2, 5, 10, 20, 50];
const RESOURCE_PERCENT = [80, 90, 95];

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function SettingsForm({ settings }: { settings: MonitoringSettings }) {
  const { t } = useTranslation();
  const id = useId();
  const configure = useConfigureMonitoring();
  const feedback = useErrorFeedback();
  const change = (changes: ConfigureMonitoringParams) => {
    configure.mutate(changes, {
      onSuccess: () => {
        toast.success(t('monitoring.settings.saved'));
      },
      onError: feedback,
    });
  };
  const busy = configure.isPending;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${id}-detailed`} label={t('monitoring.settings.detailed')}>
        <NativeSelect
          id={`${id}-detailed`}
          className="w-full"
          value={String(settings.detailedHours)}
          disabled={busy}
          onChange={(event) => {
            change({ detailedHours: Number(event.target.value) });
          }}
        >
          {DETAILED_HOURS.map((hours) => (
            <option key={hours} value={hours}>
              {durationLabel(t, hours)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-history`} label={t('monitoring.settings.history')}>
        <NativeSelect
          id={`${id}-history`}
          className="w-full"
          value={String(settings.historyDays)}
          disabled={busy}
          onChange={(event) => {
            change({ historyDays: Number(event.target.value) });
          }}
        >
          {HISTORY_DAYS.map((days) => (
            <option key={days} value={days}>
              {t('monitoring.duration.days', { count: days })}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-warning`} label={t('monitoring.settings.diskWarning')}>
        <NativeSelect
          id={`${id}-warning`}
          className="w-full"
          value={String(settings.diskWarningGiB)}
          disabled={busy}
          onChange={(event) => {
            const warning = Number(event.target.value);
            // The critical level stays below the warning level.
            const critical =
              settings.diskCriticalGiB < warning
                ? settings.diskCriticalGiB
                : (DISK_CRITICAL_GIB.filter((value) => value < warning).at(-1) ?? 1);
            change({ diskWarningGiB: warning, diskCriticalGiB: critical });
          }}
        >
          {DISK_WARNING_GIB.map((gib) => (
            <option key={gib} value={gib}>
              {t('monitoring.settings.gib', { count: gib })}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-critical`} label={t('monitoring.settings.diskCritical')}>
        <NativeSelect
          id={`${id}-critical`}
          className="w-full"
          value={String(settings.diskCriticalGiB)}
          disabled={busy}
          onChange={(event) => {
            change({ diskCriticalGiB: Number(event.target.value) });
          }}
        >
          {DISK_CRITICAL_GIB.filter((gib) => gib < settings.diskWarningGiB).map((gib) => (
            <option key={gib} value={gib}>
              {t('monitoring.settings.gib', { count: gib })}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-resource`} label={t('monitoring.settings.resource')}>
        <NativeSelect
          id={`${id}-resource`}
          className="w-full"
          value={settings.resourceWarningPercent === null ? 'never' : String(settings.resourceWarningPercent)}
          disabled={busy}
          onChange={(event) => {
            change({
              resourceWarningPercent: event.target.value === 'never' ? null : Number(event.target.value),
            });
          }}
        >
          {RESOURCE_PERCENT.map((percent) => (
            <option key={percent} value={percent}>
              {t('monitoring.settings.resourceOption', { percent: formatPercent(percent / 100) })}
            </option>
          ))}
          <option value="never">{t('monitoring.settings.never')}</option>
        </NativeSelect>
      </Field>
      <Field id={`${id}-notifications`} label={t('monitoring.settings.notifications')}>
        <NativeSelect
          id={`${id}-notifications`}
          className="w-full"
          value={settings.desktopNotifications}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'all' || value === 'critical' || value === 'off') change({ desktopNotifications: value });
          }}
        >
          <option value="all">{t('monitoring.settings.notificationsAll')}</option>
          <option value="critical">{t('monitoring.settings.notificationsCritical')}</option>
          <option value="off">{t('monitoring.settings.notificationsOff')}</option>
        </NativeSelect>
      </Field>
    </div>
  );
}

export function MonitoringSettingsCard() {
  const { t } = useTranslation();
  const settings = useMonitoringSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('monitoring.settings.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">{t('monitoring.settings.hint')}</p>
        {settings.data ? <SettingsForm settings={settings.data} /> : <Skeleton className="h-32" />}
      </CardContent>
    </Card>
  );
}
