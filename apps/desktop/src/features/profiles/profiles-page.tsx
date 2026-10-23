import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { DeploymentProfile, DeploymentRecord } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { NetworkBadge } from '@/components/status/network-badge';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { DeploymentSteps, deploymentOutcome } from './deployment-steps';
import { useProfilesOverview } from './queries';

// Deployment profiles (specification sections 18 and 24.1, area 15): every
// profile with what it brings and whether BTCortex can deploy it, and the
// latest deployments with what became of each step.

const OUTCOME_TONE = { running: 'working', done: 'healthy', attention: 'attention', failed: 'failed' } as const;

function ProfileCard({ profile }: { profile: DeploymentProfile }) {
  const { t } = useTranslation();
  const parts = profile.components.filter((part) => part.kind !== 'unavailable');
  const missing = profile.components.filter((part) => part.kind === 'unavailable');
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>
          <span className="mr-2 font-mono text-muted-foreground">{profile.letter}</span>
          {profile.title}
        </CardTitle>
        {profile.available ? (
          <Badge variant="success">{t('profiles.available')}</Badge>
        ) : (
          <Badge variant="warning">{t('profiles.unavailable')}</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-muted-foreground">{profile.summary}</p>
        <ul className="flex flex-wrap gap-1.5" aria-label={t('profiles.componentsLabel')}>
          {parts.map((part) => (
            <li key={part.component}>
              <Badge variant="outline">{t(`profiles.components.${part.component}`)}</Badge>
            </li>
          ))}
        </ul>
        {missing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('profiles.notYet', {
              parts: missing.map((part) => t(`profiles.components.${part.component}`)).join(', '),
            })}
          </p>
        )}
        {!profile.available && profile.unavailableReason !== undefined && (
          <p className="text-sm">{profile.unavailableReason}</p>
        )}
        {profile.needsDockerOrWsl2 && <p className="text-sm text-muted-foreground">{t('profiles.needsDocker')}</p>}
        <div className="mt-auto pt-1">
          <Button asChild variant={profile.available ? 'default' : 'outline'}>
            <Link to="/profiles/$profileId" params={{ profileId: profile.id }}>
              {profile.available ? t('profiles.choose') : t('profiles.details')}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeploymentCard({ record, profile }: { record: DeploymentRecord; profile: DeploymentProfile | undefined }) {
  const { t } = useTranslation();
  const outcome = deploymentOutcome(record);
  return (
    <li className="space-y-3 border-b pb-4 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {profile ? `${profile.letter} · ${profile.title}` : record.profileId}
          <span className="ml-2 font-normal text-muted-foreground">{record.nodeName}</span>
        </p>
        <div className="flex items-center gap-2">
          <NetworkBadge network={record.network} />
          <StatusIndicator
            tone={OUTCOME_TONE[outcome]}
            label={
              outcome === 'running'
                ? t('profiles.deployments.running')
                : t(`profiles.deployments.${outcome}`, { time: formatTimestamp(record.finishedAt ?? record.startedAt) })
            }
          />
        </div>
      </div>
      <DeploymentSteps record={record} />
    </li>
  );
}

export function ProfilesPage() {
  const { t } = useTranslation();
  const overview = useProfilesOverview();
  const profiles = overview.data?.profiles ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('profiles.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('profiles.description')}</p>
      </div>
      {overview.isError ? (
        <ErrorPanel
          title={t('profiles.unavailableTitle')}
          error={toOrchestratorError(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : !overview.data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {profiles.map((profile) => (
              <ProfileCard key={profile.id} profile={profile} />
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('profiles.deployments.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.data.deployments.length === 0 ? (
                <p className="text-muted-foreground">{t('profiles.deployments.empty')}</p>
              ) : (
                <ul className="space-y-4">
                  {overview.data.deployments.map((record) => (
                    <DeploymentCard
                      key={record.id}
                      record={record}
                      profile={profiles.find((profile) => profile.id === record.profileId)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
