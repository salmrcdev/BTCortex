import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeProfile } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { NetworkBadge } from '@/components/status/network-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/form-controls';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useNodes } from '@/features/nodes/queries';
import { useSystemInfo } from '@/features/system/use-system-info';
import { isDesktopRuntime, toOrchestratorError } from '@/lib/orchestrator';
import { THEME_PREFERENCES, usePreferences } from '@/stores/preferences';
import { useConfigureLifecycle, useShellSettings, useUpdateShellSettings } from './queries';

// Settings (specification sections 3.4, 24.1 area 24 and 32): how BTCortex
// looks, whether it starts with Windows and keeps running in the notification
// area, which nodes start with it and keep running after it quits, where its
// data lives and what it sends. Every choice applies at once.

function Toggle({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
  children,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 border-b py-3 last:border-0">
      <Checkbox
        id={id}
        className="mt-1"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-muted-foreground">
          {hint}
        </p>
        {children}
      </div>
    </div>
  );
}

function AppearanceCard() {
  const { t } = useTranslation();
  const theme = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearance.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <RadioCards
          label={t('settings.appearance.theme')}
          value={theme}
          onValueChange={setTheme}
          className="md:grid-cols-3"
          options={THEME_PREFERENCES.map((value) => ({
            value,
            title: t(`settings.appearance.themes.${value}.title`),
            description: t(`settings.appearance.themes.${value}.description`),
          }))}
        />
      </CardContent>
    </Card>
  );
}

function StartupCard() {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const settings = useShellSettings();
  const update = useUpdateShellSettings();
  const body = !isDesktopRuntime() ? (
    <p className="text-muted-foreground">{t('settings.startup.unavailable')}</p>
  ) : settings.isError ? (
    <ErrorPanel
      title={t('settings.startup.failed')}
      error={toOrchestratorError(settings.error)}
      onRetry={() => void settings.refetch()}
    />
  ) : !settings.data ? (
    <Skeleton className="h-32" />
  ) : (
    <div>
      {settings.data.autostartSupported && (
        <Toggle
          label={t('settings.startup.startWithWindows')}
          hint={t('settings.startup.startWithWindowsHint')}
          checked={settings.data.startWithWindows}
          disabled={update.isPending}
          onChange={(startWithWindows) => {
            update.mutate({ startWithWindows }, { onError });
          }}
        >
          {settings.data.disabledByWindows && <Note tone="warning">{t('settings.startup.disabledByWindows')}</Note>}
        </Toggle>
      )}
      {settings.data.autostartSupported && (
        <Toggle
          label={t('settings.startup.startMinimised')}
          hint={t('settings.startup.startMinimisedHint')}
          checked={settings.data.startMinimised}
          disabled={update.isPending || !settings.data.startWithWindows}
          onChange={(startMinimised) => {
            update.mutate({ startMinimised }, { onError });
          }}
        />
      )}
      <Toggle
        label={t('settings.startup.closeToTray')}
        hint={t('settings.startup.closeToTrayHint')}
        checked={settings.data.closeToTray}
        disabled={update.isPending}
        onChange={(closeToTray) => {
          update.mutate({ closeToTray }, { onError });
        }}
      />
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.startup.title')}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function LifecycleRow({ profile }: { profile: NodeProfile }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const configure = useConfigureLifecycle();
  return (
    <TableRow>
      <TableCell>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{profile.name}</span>
          <NetworkBadge network={profile.network} />
        </span>
      </TableCell>
      <TableCell>
        <Checkbox
          aria-label={t('settings.lifecycle.startLabel', { name: profile.name })}
          checked={profile.startWithBtcortex}
          disabled={configure.isPending}
          onChange={(event) => {
            configure.mutate({ nodeId: profile.id, startWithBtcortex: event.target.checked }, { onError });
          }}
        />
      </TableCell>
      <TableCell>
        <Checkbox
          aria-label={t('settings.lifecycle.keepLabel', { name: profile.name })}
          checked={profile.keepRunningOnExit}
          disabled={configure.isPending}
          onChange={(event) => {
            configure.mutate({ nodeId: profile.id, keepRunningOnExit: event.target.checked }, { onError });
          }}
        />
      </TableCell>
    </TableRow>
  );
}

function LifecycleCard() {
  const { t } = useTranslation();
  const nodes = useNodes();
  const profiles = (nodes.data ?? []).map((node) => node.profile);
  const managed = profiles.filter((profile) => profile.execution === 'managed');
  const external = profiles.filter((profile) => profile.execution !== 'managed');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.lifecycle.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="max-w-prose text-muted-foreground">{t('settings.lifecycle.description')}</p>
        {nodes.isError ? (
          <ErrorPanel
            title={t('settings.lifecycle.unavailable')}
            error={toOrchestratorError(nodes.error)}
            onRetry={() => void nodes.refetch()}
          />
        ) : !nodes.data ? (
          <Skeleton className="h-24" />
        ) : managed.length === 0 ? (
          <p className="text-muted-foreground">{t('settings.lifecycle.none')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.lifecycle.node')}</TableHead>
                <TableHead>{t('settings.lifecycle.start')}</TableHead>
                <TableHead>{t('settings.lifecycle.keep')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managed.map((profile) => (
                <LifecycleRow key={profile.id} profile={profile} />
              ))}
            </TableBody>
          </Table>
        )}
        {external.length > 0 && (
          <p className="text-muted-foreground">
            {t('settings.lifecycle.external', { names: external.map((profile) => profile.name).join(', ') })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NotificationsCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.notifications.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="max-w-prose text-muted-foreground">{t('settings.notifications.description')}</p>
        <Button asChild variant="outline">
          <Link to="/monitoring">{t('settings.notifications.open')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function DataCard() {
  const { t } = useTranslation();
  const info = useSystemInfo();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.data.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="font-medium">{t('settings.data.folder')}</p>
          {info.data ? (
            <CopyableValue value={info.data.orchestrator.dataDirectory} label={t('settings.data.folder')} />
          ) : (
            <Skeleton className="h-6 w-96" />
          )}
          <p className="max-w-prose text-muted-foreground">{t('settings.data.folderHint')}</p>
        </div>
        <Note tone="info">{t('settings.data.privacy')}</Note>
      </CardContent>
    </Card>
  );
}

function AboutCard() {
  const { t } = useTranslation();
  const info = useSystemInfo();
  const data = info.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.about.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {data ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">{t('settings.about.version')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{data.product.version}</span>
              {data.orchestrator.developmentMode && <Badge variant="warning">{t('settings.about.development')}</Badge>}
            </dd>
            <dt className="text-muted-foreground">{t('settings.about.orchestrator')}</dt>
            <dd className="font-mono">
              {data.orchestrator.version} · {data.orchestrator.runtime}
            </dd>
            <dt className="text-muted-foreground">{t('settings.about.system')}</dt>
            <dd className="font-mono">
              {data.platform.release} · {data.platform.architecture}
            </dd>
          </dl>
        ) : (
          <Skeleton className="h-20" />
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-mono text-xl font-semibold">{t('settings.title')}</h1>
        <p className="max-w-prose text-muted-foreground">{t('settings.description')}</p>
      </div>
      <AppearanceCard />
      <StartupCard />
      <LifecycleCard />
      <NotificationsCard />
      <DataCard />
      <AboutCard />
    </div>
  );
}
