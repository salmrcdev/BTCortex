import { useNavigate } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MetricSeriesSchema } from '@btcortex/contracts';
import type { MetricSeries } from '@btcortex/contracts';
import { toast } from 'sonner';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { Button } from '@/components/ui/button';
import { AlertsCard, HealthCard, RecentErrorsCard } from './health-panels';
import { DEFAULT_SERIES, HistoryCard, MAX_COMPARED } from './history-card';
import { useExportMonitoring, useRevealExport } from './queries';
import type { MonitoringSearch } from './search';
import { MonitoringSettingsCard } from './settings-card';

// Monitoring & Analytics (specification sections 19 and 24.1, area 17): the
// health summary, alerts and recent errors, the history of every recorded
// metric, a plain-text report and the monitoring settings. The chosen period
// and metrics live in the address, so going back returns to the same view.

/** The metrics named in the address, without unknown or repeated ones, at most four. */
export function chosenSeries(text: string | undefined): readonly MetricSeries[] {
  const chosen = (text ?? '')
    .split(',')
    .flatMap((name) => {
      const parsed = MetricSeriesSchema.safeParse(name);
      return parsed.success ? [parsed.data] : [];
    })
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, MAX_COMPARED);
  return chosen.length > 0 ? chosen : DEFAULT_SERIES;
}

export function MonitoringPage({ search }: { search: MonitoringSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const exporting = useExportMonitoring();
  const reveal = useRevealExport();
  const feedback = useErrorFeedback();
  const range = search.range ?? 24;
  const series = chosenSeries(search.series);

  const show = (next: MonitoringSearch) => {
    void navigate({ to: '/monitoring', search: { ...search, ...next }, replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl font-semibold">{t('monitoring.pageTitle')}</h1>
          <p className="max-w-3xl text-muted-foreground">{t('monitoring.pageDescription')}</p>
        </div>
        <Button
          variant="outline"
          disabled={exporting.isPending}
          onClick={() => {
            exporting.mutate(
              { kind: 'report', hours: range },
              {
                onSuccess: (result) => {
                  toast.success(t('monitoring.history.exported', { name: result.path.split(/[\\/]/).at(-1) ?? '' }), {
                    action: {
                      label: t('monitoring.history.showFile'),
                      onClick: () => {
                        reveal.mutate(result.path, { onError: feedback });
                      },
                    },
                  });
                },
                onError: feedback,
              },
            );
          }}
        >
          <FileText aria-hidden="true" />
          {t('monitoring.history.exportReport')}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <HealthCard />
        <AlertsCard />
        <RecentErrorsCard />
      </div>

      <HistoryCard
        range={range}
        series={series}
        onRangeChange={(next) => {
          show({ range: next });
        }}
        onSeriesChange={(next) => {
          show({ series: next.join(',') });
        }}
      />

      <MonitoringSettingsCard />
    </div>
  );
}
