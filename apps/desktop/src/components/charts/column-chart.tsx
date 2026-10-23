import { BarChart3, Table2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  CHART_HEIGHT,
  chartFrame,
  columnPath,
  labelWidth,
  niceMaximum,
  percentOf,
  useChartWidth,
  valueToY,
} from './chart-scale';

// A single-series column chart (dataviz skill): the chart's title names the
// series, so there is no legend; each column is its own hover and focus target;
// every value is also in the table view.

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  /** Extra line in the tooltip and the table, for example the fees in that bucket. */
  detail?: string;
}

export interface ColumnChartProps {
  /** Accessible name; the visible title is the card's. */
  title: string;
  data: readonly ColumnDatum[];
  formatValue: (value: number) => string;
  /** Value-axis labels, given the axis maximum so that they can share one unit; defaults to `formatValue`. */
  formatTick?: (value: number, maximum: number) => string;
  categoryHeading: string;
  valueHeading: string;
  detailHeading?: string;
}

const MAX_COLUMN_WIDTH = 24;
const LABEL_GAP = 8;
/** Half the height of a three-line tooltip, to keep it inside the chart. */
const TOOLTIP_HALF_HEIGHT = 32;

export function ColumnChart({
  title,
  data,
  formatValue,
  formatTick = (value) => formatValue(value),
  categoryHeading,
  valueHeading,
  detailHeading,
}: ColumnChartProps) {
  const { t } = useTranslation();
  const [box, width] = useChartWidth();
  const [active, setActive] = useState<number>();
  const [asTable, setAsTable] = useState(false);
  const maximum = niceMaximum(Math.max(0, ...data.map((datum) => datum.value)));
  const ticks = [0, maximum / 2, maximum].map((value) => ({ value, label: formatTick(value, maximum) }));
  const frame = chartFrame(
    width,
    ticks.map((tick) => tick.label),
  );
  const baseline = frame.top + frame.plotHeight;
  const slot = frame.plotWidth / Math.max(1, data.length);
  const columnWidth = Math.min(MAX_COLUMN_WIDTH, slot * 0.6);
  // Category labels are thinned out rather than allowed to touch; every value
  // is still in its column's tooltip, its accessible name and the table.
  const widestLabel = Math.max(0, ...data.map((datum) => labelWidth(datum.label)));
  const labelEvery = Math.max(1, Math.ceil((widestLabel + LABEL_GAP) / slot));
  const hovered = active === undefined ? undefined : data[active];

  const tooltip = () => {
    if (!hovered || active === undefined) return null;
    const centre = frame.left + slot * active + slot / 2;
    // Beside the column, never over it: to the right in the left half, to the left in the right half.
    const toRight = centre < frame.width / 2;
    const x = toRight ? centre + columnWidth / 2 + 8 : centre - columnWidth / 2 - 8;
    const y = Math.min(
      Math.max(valueToY(hovered.value, maximum, frame), frame.top + TOOLTIP_HALF_HEIGHT),
      baseline - TOOLTIP_HALF_HEIGHT,
    );
    return (
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute z-10 -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md',
          !toRight && '-translate-x-full',
        )}
        style={{ left: percentOf(x, frame.width), top: percentOf(y, frame.height) }}
      >
        <p className="font-semibold">{formatValue(hovered.value)}</p>
        <p className="text-muted-foreground">{hovered.label}</p>
        {hovered.detail && <p className="text-muted-foreground">{hovered.detail}</p>}
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
          <TableHeader>
            <TableRow>
              <TableHead>{categoryHeading}</TableHead>
              <TableHead className="text-right">{valueHeading}</TableHead>
              {detailHeading && <TableHead className="text-right">{detailHeading}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((datum) => (
              <TableRow key={datum.key}>
                <TableCell>{datum.label}</TableCell>
                <TableCell className="tabular text-right">{formatValue(datum.value)}</TableCell>
                {detailHeading && <TableCell className="tabular text-right">{datum.detail ?? '—'}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${String(frame.width)} ${String(CHART_HEIGHT)}`}
            className="block w-full"
            role="group"
            aria-label={title}
          >
            {ticks.map((tick) => (
              <g key={tick.value} aria-hidden="true">
                <line
                  x1={frame.left}
                  x2={frame.width - frame.right}
                  y1={valueToY(tick.value, maximum, frame)}
                  y2={valueToY(tick.value, maximum, frame)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={frame.left - 8}
                  y={valueToY(tick.value, maximum, frame)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {data.map((datum, index) => {
              const x = frame.left + slot * index + (slot - columnWidth) / 2;
              const top = valueToY(datum.value, maximum, frame);
              const height = baseline - top;
              return (
                <g
                  key={datum.key}
                  tabIndex={0}
                  role="img"
                  aria-label={`${datum.label}: ${formatValue(datum.value)}${datum.detail ? `, ${datum.detail}` : ''}`}
                  className="cursor-default outline-none [&:focus-visible>rect]:stroke-ring [&:focus-visible>rect]:stroke-2"
                  onPointerEnter={() => {
                    setActive(index);
                  }}
                  onPointerLeave={() => {
                    setActive(undefined);
                  }}
                  onFocus={() => {
                    setActive(index);
                  }}
                  onBlur={() => {
                    setActive(undefined);
                  }}
                >
                  {/* The hit area is the whole slot, not just the painted column. */}
                  <rect
                    x={frame.left + slot * index}
                    y={frame.top}
                    width={slot}
                    height={frame.plotHeight}
                    fill="transparent"
                  />
                  {height > 0 && (
                    <path
                      d={columnPath(x, top, columnWidth, height)}
                      className={cn(
                        'fill-chart-1 transition-opacity duration-150',
                        active !== undefined && active !== index && 'opacity-50',
                      )}
                    />
                  )}
                  {index % labelEvery === 0 && (
                    <text
                      x={x + columnWidth / 2}
                      y={baseline + 18}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[11px] tabular"
                    >
                      {datum.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {tooltip()}
        </div>
      )}
    </div>
  );
}
