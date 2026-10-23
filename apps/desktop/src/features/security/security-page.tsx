import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Info, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SecurityArea, SecurityFinding, SecuritySeverity } from '@btcortex/contracts';
import { StatTile } from '@/components/data/stat-tile';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTimestamp } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';

// The security centre (specification sections 21 and 24.1, area 23): every
// finding with how serious it is, what to do and where, grouped by what it is
// about, and the controls BTCortex applies itself. Severity is shown by icon
// and word, never by colour alone.

const AREAS: readonly SecurityArea[] = [
  'nodes',
  'tor',
  'electrum',
  'lightning',
  'software',
  'secrets',
  'backups',
  'computer',
];

export const securityKeys = { overview: ['security', 'overview'] as const };

function useSecurityOverview() {
  return useQuery({
    queryKey: securityKeys.overview,
    queryFn: () => callOrchestrator('security.overview', {}, { timeoutMs: 60_000 }),
    refetchInterval: 5 * 60_000,
  });
}

function SeverityIcon({ severity }: { severity: SecuritySeverity }) {
  const className = 'mt-0.5 size-4 shrink-0';
  if (severity === 'critical') return <CircleAlert aria-hidden="true" className={`${className} text-danger`} />;
  if (severity === 'warning') return <TriangleAlert aria-hidden="true" className={`${className} text-warning`} />;
  if (severity === 'info') return <Info aria-hidden="true" className={`${className} text-info`} />;
  return <CircleCheck aria-hidden="true" className={`${className} text-success`} />;
}

function FindingRow({ finding }: { finding: SecurityFinding }) {
  const { t } = useTranslation();
  return (
    <li className="flex gap-3 border-b py-3 last:border-0">
      <SeverityIcon severity={finding.severity} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{finding.title}</span>
          <span className="text-xs text-muted-foreground">
            {t(`security.severity.${finding.severity}`)} · {finding.subject}
          </span>
        </p>
        <p className="text-muted-foreground">{finding.detail}</p>
        {finding.action !== null && <p>{finding.action}</p>}
      </div>
      {finding.route !== null && (
        <Button asChild variant="outline" className="shrink-0">
          <a href={`#${finding.route}`}>{t('security.open')}</a>
        </Button>
      )}
    </li>
  );
}

export function SecurityPage() {
  const { t } = useTranslation();
  const overview = useSecurityOverview();
  const data = overview.data;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl font-semibold">{t('security.title')}</h1>
          <p className="max-w-3xl text-muted-foreground">{t('security.description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={overview.isFetching}
          onClick={() => {
            void overview.refetch();
          }}
        >
          <RefreshCw aria-hidden="true" className={overview.isFetching ? 'motion-safe:animate-spin' : undefined} />
          {t('security.checkAgain')}
        </Button>
      </div>

      {overview.isError ? (
        <ErrorPanel
          title={t('security.unavailable')}
          error={toOrchestratorError(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('security.counts.critical')} value={data.counts.critical} />
            <StatTile label={t('security.counts.warning')} value={data.counts.warning} />
            <StatTile label={t('security.counts.info')} value={data.counts.info} />
            <StatTile label={t('security.counts.ok')} value={data.counts.ok} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('security.checkedAt', { time: formatTimestamp(data.checkedAt) })}
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {AREAS.map((area) => {
              const findings = data.findings.filter((finding) => finding.area === area);
              if (findings.length === 0) return null;
              return (
                <Card key={area}>
                  <CardHeader>
                    <CardTitle>{t(`security.areas.${area}`)}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul>
                      {findings.map((finding) => (
                        <FindingRow key={finding.id} finding={finding} />
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('security.controls')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {data.controls.map((control) => (
                  <li key={control.id} className="flex gap-3">
                    <ShieldCheck
                      aria-hidden="true"
                      className={`mt-0.5 size-4 shrink-0 ${control.state === 'active' ? 'text-success' : 'text-muted-foreground'}`}
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{control.title}</span>
                        <Badge variant={control.state === 'active' ? 'success' : 'neutral'}>
                          {t(`security.controlStates.${control.state}`)}
                        </Badge>
                      </p>
                      <p className="text-muted-foreground">{control.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
