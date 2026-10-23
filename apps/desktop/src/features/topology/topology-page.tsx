import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServiceHealth, Topology, TopologyLink } from '@btcortex/contracts';
import { useChartWidth } from '@/components/charts/chart-scale';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatTimestamp } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { BOX_HEIGHT, BOX_WIDTH, layoutTopology } from './layout';

// The network topology (specification sections 10.2 and 24.1, area 16): the
// real connections between BTCortex, wallets, servers, nodes, tor and the
// networks, drawn in rows from programs at the top to networks at the bottom.
// A live connection is a solid line, one not in use is dashed; health is told
// by word as well as colour, and every connection is listed in a table too.
// It refreshes every 15 seconds, so changes show by themselves.

export const topologyKeys = { all: ['topology'] as const };

const LAYERS = ['programs', 'services', 'nodes', 'privacy', 'networks'] as const;
const CHARACTER_WIDTH = 6.6;

const HEALTH_STROKE: Record<ServiceHealth, string> = {
  healthy: 'stroke-success',
  working: 'stroke-info',
  attention: 'stroke-warning',
  failed: 'stroke-danger',
  inactive: 'stroke-muted-foreground',
  unknown: 'stroke-muted-foreground',
};

const HEALTH_FILL: Record<ServiceHealth, string> = {
  healthy: 'fill-success',
  working: 'fill-info',
  attention: 'fill-warning',
  failed: 'fill-danger',
  inactive: 'fill-muted-foreground',
  unknown: 'fill-muted-foreground',
};

function useTopology() {
  return useQuery({
    queryKey: topologyKeys.all,
    queryFn: () => callOrchestrator('topology.graph', {}, { timeoutMs: 60_000 }),
    refetchInterval: 15_000,
  });
}

function truncate(text: string, characters: number): string {
  return text.length <= characters ? text : `${text.slice(0, characters - 1)}…`;
}

function Diagram({ topology }: { topology: Topology }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [box, measured] = useChartWidth();
  const [focus, setFocus] = useState<string>();
  const layout = useMemo(() => layoutTopology(topology, measured), [topology, measured]);
  const related = (link: TopologyLink) => focus === undefined || link.from === focus || link.to === focus;

  return (
    <div ref={box} className="overflow-x-auto">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
        role="img"
        aria-label={t('topology.diagram', { elements: topology.elements.length, links: topology.links.length })}
        className="block"
      >
        {layout.rows.map((row) => (
          <text
            key={row.layer}
            x={16}
            y={row.y - 8}
            className="fill-muted-foreground text-[11px] font-medium uppercase tracking-wide"
          >
            {t(`topology.layers.${LAYERS[row.layer] ?? 'networks'}`)}
          </text>
        ))}
        {layout.links.map((link) => {
          const label = `${link.protocol}${link.port === null ? '' : ` :${String(link.port)}`}`;
          const labelWidth = label.length * CHARACTER_WIDTH + 12;
          return (
            <g key={link.id} className={cn('transition-opacity duration-150', !related(link) && 'opacity-15')}>
              <title>{`${link.protocol}${link.port === null ? '' : ` ${String(link.port)}`}: ${t(`topology.protection.${link.protection}`)}, ${link.active ? t('topology.live') : t('topology.idle')}. ${link.detail}`}</title>
              <path
                d={link.path}
                fill="none"
                strokeWidth={2}
                strokeDasharray={link.active ? undefined : '5 5'}
                className={link.active ? 'stroke-foreground/60' : 'stroke-muted-foreground/60'}
              />
              <rect
                x={link.label.x - labelWidth / 2}
                y={link.label.y - 9}
                width={labelWidth}
                height={18}
                rx={4}
                className="fill-card stroke-border"
              />
              <text
                x={link.label.x}
                y={link.label.y}
                dy="0.35em"
                textAnchor="middle"
                className="fill-muted-foreground text-[11px] tabular"
              >
                {label}
              </text>
            </g>
          );
        })}
        {layout.elements.map((element) => (
          <g
            key={element.id}
            transform={`translate(${String(element.x)},${String(element.y)})`}
            tabIndex={0}
            role="button"
            aria-label={`${element.label}, ${element.detail}, ${t(`topology.health.${element.health}`)}`}
            className={cn(
              'outline-none focus-visible:[&>rect]:stroke-ring',
              element.route !== null && 'cursor-pointer',
            )}
            onPointerEnter={() => {
              setFocus(element.id);
            }}
            onPointerLeave={() => {
              setFocus(undefined);
            }}
            onFocus={() => {
              setFocus(element.id);
            }}
            onBlur={() => {
              setFocus(undefined);
            }}
            onClick={() => {
              if (element.route !== null) void navigate({ href: element.route });
            }}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && element.route !== null) {
                event.preventDefault();
                void navigate({ href: element.route });
              }
            }}
          >
            <rect
              width={BOX_WIDTH}
              height={BOX_HEIGHT}
              rx={8}
              strokeWidth={2}
              className={cn('fill-card', HEALTH_STROKE[element.health])}
            />
            <text x={12} y={21} className="fill-foreground text-[13px] font-semibold">
              {truncate(element.label, 26)}
            </text>
            <text x={12} y={38} className="fill-muted-foreground text-[11px]">
              {truncate(element.detail, 32)}
            </text>
            <circle cx={16} cy={53} r={4} className={HEALTH_FILL[element.health]} />
            <text x={26} y={53} dy="0.35em" className="fill-muted-foreground text-[11px]">
              {t(`topology.health.${element.health}`)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function Connections({ topology }: { topology: Topology }) {
  const { t } = useTranslation();
  const name = (id: string) => topology.elements.find((element) => element.id === id)?.label ?? id;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('topology.from')}</TableHead>
          <TableHead>{t('topology.to')}</TableHead>
          <TableHead>{t('topology.protocol')}</TableHead>
          <TableHead className="text-right">{t('topology.port')}</TableHead>
          <TableHead>{t('topology.protectionHeading')}</TableHead>
          <TableHead>{t('topology.state')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {topology.links.map((link) => (
          <TableRow key={link.id}>
            <TableCell>{name(link.from)}</TableCell>
            <TableCell>{name(link.to)}</TableCell>
            <TableCell>
              <span className="font-medium">{link.protocol}</span>
              <span className="block text-xs text-muted-foreground">{link.detail}</span>
            </TableCell>
            <TableCell className="tabular text-right font-mono text-[13px]">{link.port ?? '—'}</TableCell>
            <TableCell>{t(`topology.protection.${link.protection}`)}</TableCell>
            <TableCell>
              <StatusIndicator
                tone={link.active ? 'healthy' : 'inactive'}
                label={link.active ? t('topology.live') : t('topology.idle')}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TopologyPage() {
  const { t } = useTranslation();
  const topology = useTopology();
  const data = topology.data;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('topology.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('topology.description')}</p>
      </div>
      {topology.isError ? (
        <ErrorPanel
          title={t('topology.unavailable')}
          error={toOrchestratorError(topology.error)}
          onRetry={() => void topology.refetch()}
        />
      ) : !data ? (
        <Skeleton className="h-80" />
      ) : data.elements.length <= 1 ? (
        <p className="text-muted-foreground">{t('topology.empty')}</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('topology.diagramTitle')}</CardTitle>
              <span className="text-xs text-muted-foreground">
                {t('topology.updated', { time: formatTimestamp(data.checkedAt) })}
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              <Diagram topology={data} />
              <p className="text-xs text-muted-foreground">{t('topology.legend')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('topology.connections')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Connections topology={data} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
