import { useLayoutEffect, useRef, useState } from 'react';

// Shared geometry for the hand-drawn SVG charts (dataviz mark specs: columns
// at most 24 px wide with a 4 px rounded data end and a square baseline,
// hairline gridlines, one value axis). Charts draw at one SVG unit per CSS
// pixel, so their 11 px labels stay 11 px whatever the window width.

export const CHART_HEIGHT = 220;
/** A generous width for one 11 px character, used to lay out labels. */
const CHARACTER_WIDTH = 6.6;
const TICK_GAP = 8;
/** Width before the first measurement, and where there is no layout (tests). */
const FALLBACK_WIDTH = 640;

export interface ChartFrame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  plotWidth: number;
  plotHeight: number;
}

/** The plot area of a chart, leaving room on the left for its widest value label. */
export function chartFrame(width: number, valueLabels: readonly string[]): ChartFrame {
  const left = Math.ceil(Math.max(1, ...valueLabels.map((label) => label.length)) * CHARACTER_WIDTH) + TICK_GAP;
  const right = 12;
  const top = 14;
  const bottom = 30;
  return {
    width,
    height: CHART_HEIGHT,
    left,
    right,
    top,
    bottom,
    plotWidth: Math.max(1, width - left - right),
    plotHeight: CHART_HEIGHT - top - bottom,
  };
}

export function labelWidth(label: string): number {
  return label.length * CHARACTER_WIDTH;
}

/** Round axis maxima whose halves are round too, so the middle gridline reads well. */
const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

/** A round upper bound for the value axis, close above the largest value. */
export function niceMaximum(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  return (NICE_STEPS.find((step) => fraction <= step) ?? 10) * exponent;
}

const MINUTE = 60_000;
const TIME_STEPS_MINUTES = [
  1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080, 20160, 43200,
] as const;
/** Room for one "14:05" label and the space around it. */
const TIME_TICK_SPACING = 110;

/** Round local times (on the minute, quarter, hour…) spread across `first`–`last`. */
export function timeTicks(first: number, last: number, plotWidth: number): number[] {
  const wanted = Math.max(2, Math.floor(plotWidth / TIME_TICK_SPACING));
  const span = Math.max(MINUTE, last - first);
  const stepMinutes = TIME_STEPS_MINUTES.find((step) => span / (step * MINUTE) <= wanted) ?? 43200;
  const step = stepMinutes * MINUTE;
  // Align to the local clock, so ticks fall on 14:00 rather than on UTC boundaries.
  const offset = -new Date(first).getTimezoneOffset() * MINUTE;
  const ticks: number[] = [];
  for (let tick = Math.ceil((first + offset) / step) * step - offset; tick <= last; tick += step) ticks.push(tick);
  return ticks;
}

const average = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Largest-triangle-three-buckets: a long series cut down to `threshold`
 * points that keep its shape, peaks included, so that a chart draws about
 * one point per pixel however many samples there are.
 */
export function downsample<T extends { x: number; y: number }>(points: readonly T[], threshold: number): readonly T[] {
  const first = points[0];
  const last = points.at(-1);
  if (threshold < 3 || points.length <= threshold || first === undefined || last === undefined) return points;
  const sampled: T[] = [first];
  const bucket = (points.length - 2) / (threshold - 2);
  let anchor: { x: number; y: number } = first;
  for (let index = 0; index < threshold - 2; index += 1) {
    const start = Math.floor(index * bucket) + 1;
    const end = Math.floor((index + 1) * bucket) + 1;
    // The average of the next bucket is the triangle's third corner.
    const next = points.slice(end, Math.min(Math.floor((index + 2) * bucket) + 1, points.length - 1));
    const corner =
      next.length === 0 ? last : { x: average(next.map((point) => point.x)), y: average(next.map((point) => point.y)) };
    let best: T | undefined;
    let largest = -1;
    for (const point of points.slice(start, end)) {
      const area = Math.abs(
        (anchor.x - corner.x) * (point.y - anchor.y) - (anchor.x - point.x) * (corner.y - anchor.y),
      );
      if (area > largest) {
        largest = area;
        best = point;
      }
    }
    if (best) {
      sampled.push(best);
      anchor = best;
    }
  }
  sampled.push(last);
  return sampled;
}

/** Runs of points without a gap longer than `gap` between neighbours; a gap is a time nothing was measured. */
export function splitAtGaps<T extends { x: number }>(points: readonly T[], gap: number | undefined): T[][] {
  const runs: T[][] = [];
  let run: T[] = [];
  let previous: T | undefined;
  for (const point of points) {
    if (previous && gap !== undefined && point.x - previous.x > gap) {
      runs.push(run);
      run = [];
    }
    run.push(point);
    previous = point;
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** A column grown from the baseline, rounded only at its data end. */
export function columnPath(x: number, y: number, width: number, height: number): string {
  const radius = Math.min(4, width / 2, height);
  return [
    `M${String(x)},${String(y + height)}`,
    `V${String(y + radius)}`,
    `Q${String(x)},${String(y)} ${String(x + radius)},${String(y)}`,
    `H${String(x + width - radius)}`,
    `Q${String(x + width)},${String(y)} ${String(x + width)},${String(y + radius)}`,
    `V${String(y + height)}`,
    'Z',
  ].join(' ');
}

export function valueToY(value: number, maximum: number, frame: ChartFrame): number {
  return frame.top + frame.plotHeight - (Math.max(0, value) / maximum) * frame.plotHeight;
}

/** Percentage of the chart's box, for positioning HTML tooltips over the SVG. */
export function percentOf(value: number, total: number): string {
  return `${String((value / total) * 100)}%`;
}

/** The rendered width of the element holding a chart, kept up to date as the window resizes. */
export function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const next = Math.floor(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width] as const;
}
