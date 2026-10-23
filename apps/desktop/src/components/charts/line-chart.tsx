import { BarChart3, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  CHART_HEIGHT,
  chartFrame,
  downsample,
  labelWidth,
  niceMaximum,
  percentOf,
  splitAtGaps,
  timeTicks,
  useChartWidth,
  valueToY,
} from './chart-scale';

// A single-series line over time (dataviz skill): a 2 px line with a light
// area wash, a crosshair that snaps to the nearest sample, keyboard access to
// every sample, and a table view of the most recent samples. The line breaks
// where nothing was measured, rather than bridging the gap, and long series
// are drawn from about one point per pixel.

export interface LinePoint {
  /** Milliseconds since the epoch. */
  x: number;
  y: number;
}

export interface LineChartProps {
  title: string;
  points: readonly LinePoint[];
  formatY: (value: number) => string;
  /** Value-axis labels, given the axis maximum so that they can share one unit; defaults to `formatY`. */
  formatTick?: (value: number, maximum: number) => string;
  /** Short time for the axis, for example "14:05". */
  formatX: (time: number) => string;
  /** Full time for the tooltip and the table. */
  formatXLong: (time: number) => string;
  xHeading: string;
  yHeading: string;
  /** The time span to show, so that several charts line up; defaults to the first and last samples. */
  domain?: readonly [number, number];
  /** A fixed top of the value axis, such as 100 for percentages. */
  maximum?: number;
  /** Neighbouring samples further apart than this are not joined. */
  gapMs?: number;
}

const TABLE_ROWS = 60;

export function LineChart({
  title,
  points,
  formatY,
  formatTick = (value) => formatY(value),
  formatX,
  formatXLong,
  xHeading,
  yHeading,
  domain,
  maximum: fixedMaximum,
  gapMs,
}: LineChartProps) {
  const { t } = useTranslation();
  const [box, width] = useChartWidth();
  const [active, setActive] = useState<number>();
  const [asTable, setAsTable] = useState(false);
  const first = domain?.[0] ?? points[0]?.x ?? 0;
  const last = domain?.[1] ?? points.at(-1)?.x ?? first + 1;
  const span = Math.max(1, last - first);
  const maximum = fixedMaximum ?? niceMaximum(Math.max(0, ...points.map((point) => point.y)));
  const ticks = [0, maximum / 2, maximum].map((value) => ({ value, label: formatTick(value, maximum) }));
  const frame = chartFrame(
    width,
    ticks.map((tick) => tick.label),
  );
  const baseline = frame.top + frame.plotHeight;
  const toX = (time: number) => frame.left + ((time - first) / span) * frame.plotWidth;
  const toY = (value: number) => valueToY(value, maximum, frame);
  // Each run of samples without a gap is drawn on its own, from about one point per pixel.
  const runs = useMemo(() => {
    const budget = Math.max(3, Math.floor(width));
    return splitAtGaps(points, gapMs).map((run) =>
      downsample(run, Math.max(3, Math.round((budget * run.length) / points.length))),
    );
  }, [points, gapMs, width]);
  const lines = runs.map((run) =>
    run.map((point, index) => `${index === 0 ? 'M' : 'L'}${String(toX(point.x))},${String(toY(point.y))}`).join(' '),
  );
  const areas = runs.map((run, index) => {
    const start = run[0];
    const end = run.at(-1);
    if (!start || !end || run.length < 2) return '';
    return `${lines[index] ?? ''} L${String(toX(end.x))},${String(baseline)} L${String(toX(start.x))},${String(baseline)} Z`;
  });
  const lonePoints = runs.flatMap((run) => (run.length === 1 ? run : []));
  // Round times only, and none whose label would run off the chart.
  const times = timeTicks(first, last, frame.plotWidth)
    .map((time) => ({ time, label: formatX(time) }))
    .filter(({ time, label }) => {
      const half = labelWidth(label) / 2;
      return toX(time) - half >= 0 && toX(time) + half <= frame.width;
    });
  const current = active === undefined ? undefined : points[active];

  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const rectangle = event.currentTarget.getBoundingClientRect();
    if (rectangle.width === 0 || points.length === 0) return;
    const x = ((event.clientX - rectangle.left) / rectangle.width) * frame.width;
    const time = first + ((x - frame.left) / frame.plotWidth) * span;
    let best = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.x - time) < Math.abs((points[best]?.x ?? 0) - time)) best = index;
    });
    setActive(best);
  };

  const step = (event: KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const position = active ?? points.length - 1;
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, position - 1)
        : event.key === 'ArrowRight'
          ? Math.min(points.length - 1, position + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? points.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  const tooltip = () => {
    if (!current) return null;
    const x = toX(current.x);
    // Beside the crosshair, on whichever side has more room.
    const toRight = x < frame.width / 2;
    return (
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute z-10 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md',
          !toRight && '-translate-x-full',
        )}
        style={{ left: percentOf(toRight ? x + 8 : x - 8, frame.width), top: percentOf(frame.top, frame.height) }}
      >
        <p className="font-semibold">{formatY(current.y)}</p>
        <p className="text-muted-foreground">{formatXLong(current.x)}</p>
      </div>
    );
  };

  return (
    <div ref={box} className="space-y-2">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          aria-pressed={asTable}
          onClick={() => {
            setAsTable(!asTable);
          }}
        >
          {asTable ? <BarChart3 aria-hidden="true" /> : <Table2 aria-hidden="true" />}
          {asTable ? t('charts.showChart') : t('charts.showTable')}
        </Button>
      </div>
      {asTable ? (
        <Table aria-label={title}>
          {points.length > TABLE_ROWS && <TableCaption>{t('charts.tableRecent', { count: TABLE_ROWS })}</TableCaption>}
          <TableHeader>
            <TableRow>
              <TableHead>{xHeading}</TableHead>
              <TableHead className="text-right">{yHeading}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points
              .slice(-TABLE_ROWS)
              .reverse()
              .map((point) => (
                <TableRow key={point.x}>
                  <TableCell className="tabular">{formatXLong(point.x)}</TableCell>
                  <TableCell className="tabular text-right">{formatY(point.y)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${String(frame.width)} ${String(CHART_HEIGHT)}`}
            className="block w-full rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring"
            role="img"
            aria-label={`${title}. ${t('charts.keyboardHint')}`}
            tabIndex={0}
            onPointerMove={nearest}
            onPointerLeave={() => {
              setActive(undefined);
            }}
            onKeyDown={step}
            onBlur={() => {
              setActive(undefined);
            }}
          >
            {ticks.map((tick) => (
              <g key={tick.value} aria-hidden="true">
                <line
                  x1={frame.left}
                  x2={frame.width - frame.right}
                  y1={toY(tick.value)}
                  y2={toY(tick.value)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={frame.left - 8}
                  y={toY(tick.value)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {times.map(({ time, label }) => (
              <text
                key={time}
                x={toX(time)}
                y={baseline + 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px] tabular"
                aria-hidden="true"
              >
                {label}
              </text>
            ))}
            {areas.map((area, index) => (
              <path key={`area-${String(index)}`} d={area} className="fill-chart-1 opacity-10" aria-hidden="true" />
            ))}
            {lines.map((line, index) => (
              <path
                key={`line-${String(index)}`}
                d={line}
                className="stroke-chart-1"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
                aria-hidden="true"
              />
            ))}
            {lonePoints.map((point) => (
              <circle
                key={point.x}
                cx={toX(point.x)}
                cy={toY(point.y)}
                r={2}
                className="fill-chart-1"
                aria-hidden="true"
              />
            ))}
            {current && (
              <g aria-hidden="true">
                <line
                  x1={toX(current.x)}
                  x2={toX(current.x)}
                  y1={frame.top}
                  y2={baseline}
                  className="stroke-muted-foreground"
                  strokeWidth={1}
                />
                {/* The surface ring keeps the dot legible where it sits on the line. */}
                <circle
                  cx={toX(current.x)}
                  cy={toY(current.y)}
                  r={5}
                  className="fill-chart-1 stroke-card"
                  strokeWidth={2}
                />
              </g>
            )}
          </svg>
          <p className="sr-only" aria-live="polite">
            {current ? `${formatY(current.y)}, ${formatXLong(current.x)}` : ''}
          </p>
          {tooltip()}
        </div>
      )}
    </div>
  );
}
