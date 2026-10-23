import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogueEntryDetail, DependencyCheck } from '@btcortex/contracts';
import { ExternalLink } from '@/components/data/external-link';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { formatDate } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { IntegrationBadge } from './catalogue-page';
import { useCatalogueEntry } from './queries';

// One catalogue entry: what BTCortex does with it today, the verified project
// information, Windows compatibility, support levels, dependencies checked
// against this computer, security notes and the sources of the research.

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Research dates are written as YYYY-MM-DD or YYYY-MM. */
function researchDate(value: string): string {
  return /^\d{4}-\d{2}$/.test(value) ? value : formatDate(new Date(`${value}T12:00:00Z`));
}

function InBtcortex({ detail }: { detail: CatalogueEntryDetail }) {
  const { t } = useTranslation();
  const { integration, record } = detail;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalogue.inBtcortex')}</CardTitle>
        <IntegrationBadge integration={integration} />
      </CardHeader>
      <CardContent className="space-y-3">
        {integration.status === 'researched' ? (
          <p>{t('catalogue.notIntegrated', { name: record.name })}</p>
        ) : (
          <>
            <dl>
              {integration.level !== null && (
                <Field label={t('catalogue.supportHeading')}>
                  {t('catalogue.deliveredLevel', { level: t(`catalogue.levels.${integration.level}`) })}
                </Field>
              )}
              <Field label={t('catalogue.evidence')}>{t(`catalogue.status.${integration.status}`)}</Field>
            </dl>
            <div className="space-y-1.5">
              <h3 className="font-medium">{t('catalogue.capabilitiesHeading')}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {integration.capabilities.map((capability) => (
                  <li key={capability}>
                    <Badge variant="outline">{t(`catalogue.capabilities.${capability}`)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
            {integration.state ? (
              <StatusIndicator tone={integration.state.health} label={integration.state.summary} />
            ) : (
              <p className="text-muted-foreground">{t('catalogue.stateUnknown')}</p>
            )}
            {/* Each integration names the page that manages it, as alerts and findings do. */}
            {integration.route !== null && (
              <Button asChild variant="outline">
                <a href={`#${integration.route}`}>{t('catalogue.manage')}</a>
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function About({ detail }: { detail: CatalogueEntryDetail }) {
  const { t } = useTranslation();
  const { record } = detail;
  const release = record.latestStableRelease;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalogue.about')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>{record.purpose}</p>
        <dl>
          {record.website && (
            <Field label={t('catalogue.website')}>
              <ExternalLink href={record.website}>{record.website}</ExternalLink>
            </Field>
          )}
          {record.repository && (
            <Field label={t('catalogue.repository')}>
              <ExternalLink href={record.repository}>{record.repository}</ExternalLink>
            </Field>
          )}
          <Field label={t('catalogue.latestRelease')}>
            {release ? (
              <ExternalLink href={release.source}>
                {release.date
                  ? t('catalogue.releasedOn', { version: release.version, date: researchDate(release.date) })
                  : release.version}
              </ExternalLink>
            ) : (
              t('catalogue.noRelease')
            )}
          </Field>
          <Field label={t('catalogue.maintenanceHeading')}>
            <p>{t(`catalogue.maintenance.${record.maintenance.status}`)}</p>
            <p className="text-muted-foreground">{record.maintenance.evidence}</p>
            {record.maintenance.supersededBy && (
              <p>{t('catalogue.supersededBy', { name: record.maintenance.supersededBy })}</p>
            )}
          </Field>
          <Field label={t('catalogue.licence')}>{record.licence ?? t('catalogue.unknownLicence')}</Field>
        </dl>
        <p className="text-xs text-muted-foreground">
          {t('catalogue.verifiedOn', { date: researchDate(record.verifiedOn) })}
        </p>
      </CardContent>
    </Card>
  );
}

function Compatibility({ detail }: { detail: CatalogueEntryDetail }) {
  const { t } = useTranslation();
  const { record } = detail;
  const { platforms } = record;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalogue.compatibility')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl>
          <Field label={t('catalogue.windowsHeading')}>{t(`catalogue.windows.${platforms.windowsNative}`)}</Field>
          {platforms.windowsVersions && (
            <Field label={t('catalogue.windowsVersions')}>{platforms.windowsVersions}</Field>
          )}
          {platforms.windowsArchitectures.length > 0 && (
            <Field label={t('catalogue.architectures')}>{platforms.windowsArchitectures.join(', ')}</Field>
          )}
          {platforms.windowsDistribution && (
            <Field label={t('catalogue.distribution')}>{platforms.windowsDistribution}</Field>
          )}
          <Field label={t('catalogue.wsl2')}>{t(`catalogue.wsl2Values.${platforms.wsl2}`)}</Field>
          <Field label={t('catalogue.docker')}>{t(`catalogue.dockerValues.${platforms.docker}`)}</Field>
          <Field label={t('catalogue.supportHeading')}>
            <p>
              {t('catalogue.targetLevel')}: {t(`catalogue.levels.${record.recommendedSupportLevel}`)}
              <span className="text-muted-foreground"> · {t(`catalogue.feasibility.${record.feasibility}`)}</span>
            </p>
            <p className="text-muted-foreground">
              {t('catalogue.feasibleLevels')}:{' '}
              {record.supportLevels.map((level) => t(`catalogue.levels.${level}`)).join(', ')}
            </p>
          </Field>
        </dl>
      </CardContent>
    </Card>
  );
}

function DependencyItem({ check, detail }: { check: DependencyCheck; detail: CatalogueEntryDetail }) {
  const { t } = useTranslation();
  const conflict = check.relationship === 'conflicts';
  const satisfied = check.present.length > 0;
  return (
    <li className="space-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p>
          <span className="font-medium">{t(`catalogue.relationships.${check.relationship}`)}</span>{' '}
          {/* For conflicts every entry listed conflicts; elsewhere any one of them will do. */}
          {check.ids.length > 1 && !conflict && (
            <span className="text-muted-foreground">({t('catalogue.anyOf')}) </span>
          )}
          {check.ids.map((id, index) => (
            <span key={id}>
              {index > 0 && ', '}
              {detail.catalogueIds.includes(id) && id !== detail.record.id ? (
                <Link
                  to="/catalogue/$entryId"
                  params={{ entryId: id }}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {check.names[index] ?? id}
                </Link>
              ) : (
                (check.names[index] ?? id)
              )}
            </span>
          ))}
        </p>
        {conflict ? (
          satisfied && <StatusIndicator tone="attention" label={t('catalogue.conflictPresent')} />
        ) : (
          <StatusIndicator
            tone={satisfied ? 'healthy' : check.relationship === 'requires' ? 'attention' : 'inactive'}
            label={satisfied ? t('catalogue.present') : t('catalogue.missing')}
          />
        )}
      </div>
      {check.notes && <p className="text-muted-foreground">{check.notes}</p>}
    </li>
  );
}

function Dependencies({ detail }: { detail: CatalogueEntryDetail }) {
  const { t } = useTranslation();
  const { dependencies } = detail;
  const present = new Set(dependencies.checks.flatMap((check) => check.present));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalogue.dependenciesHeading')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {dependencies.checks.length === 0 ? (
          <p className="text-muted-foreground">{t('catalogue.noDependencies')}</p>
        ) : (
          <ul className="divide-y">
            {dependencies.checks.map((check) => (
              <DependencyItem key={`${check.relationship}-${check.ids.join()}`} check={check} detail={detail} />
            ))}
          </ul>
        )}
        {dependencies.cycle ? (
          <p className="text-warning">
            {t('catalogue.cycle', {
              path: dependencies.cycle.map((id) => detail.names[id] ?? id).join(' → '),
            })}
          </p>
        ) : (
          dependencies.order.length > 1 && (
            <section aria-labelledby="setup-order" className="space-y-1">
              <h3 id="setup-order" className="font-medium">
                {t('catalogue.orderHeading')}
              </h3>
              <ol className="list-inside list-decimal space-y-0.5">
                {dependencies.order.map((id) => (
                  <li key={id}>
                    {id === detail.record.id ? detail.record.name : (detail.names[id] ?? id)}
                    {present.has(id) && <span className="text-muted-foreground"> ({t('catalogue.alreadyHere')})</span>}
                  </li>
                ))}
              </ol>
            </section>
          )
        )}
      </CardContent>
    </Card>
  );
}

function SecurityAndSources({ detail }: { detail: CatalogueEntryDetail }) {
  const { t } = useTranslation();
  const { record } = detail;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalogue.securityHeading')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>{record.security}</p>
        <section aria-labelledby="research-sources" className="space-y-1">
          <h3 id="research-sources" className="font-medium">
            {t('catalogue.sourcesHeading')}
          </h3>
          <ul className="space-y-1">
            {record.sources.map((source) => (
              <li key={source.url}>
                {source.url.startsWith('https://') ? (
                  <ExternalLink href={source.url}>{source.title}</ExternalLink>
                ) : (
                  source.title
                )}{' '}
                <span className="text-xs text-muted-foreground">
                  {t('catalogue.accessed', { date: researchDate(source.accessed) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}

export function CatalogueEntryPage({ entryId }: { entryId: string }) {
  const { t } = useTranslation();
  const entry = useCatalogueEntry(entryId);
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <Breadcrumbs
        trail={[
          <Link key="catalogue" to="/catalogue">
            {t('navigation.catalogue')}
          </Link>,
        ]}
        current={entry.data?.record.name}
      />
      {entry.isError ? (
        <ErrorPanel title={t('catalogue.notFound')} error={toOrchestratorError(entry.error)} />
      ) : !entry.data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">{entry.data.record.name}</h1>
            <p className="text-muted-foreground">
              {t(`catalogue.categories.${entry.data.record.category}`)} ·{' '}
              {t('catalogue.target', { level: t(`catalogue.levels.${entry.data.record.recommendedSupportLevel}`) })}
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <InBtcortex detail={entry.data} />
            <About detail={entry.data} />
          </div>
          <Dependencies detail={entry.data} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Compatibility detail={entry.data} />
            <SecurityAndSources detail={entry.data} />
          </div>
        </>
      )}
    </div>
  );
}
