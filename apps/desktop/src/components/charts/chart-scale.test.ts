import { describe, expect, it } from 'vitest';
import { chartFrame, columnPath, downsample, niceMaximum, splitAtGaps, timeTicks } from './chart-scale';

describe('chart scales', () => {
  it('picks a round axis maximum close above the data', () => {
    expect(niceMaximum(0)).toBe(1);
    expect(niceMaximum(42_000_000)).toBe(50_000_000);
    expect(niceMaximum(110_000_000)).toBe(120_000_000);
    expect(niceMaximum(1000)).toBe(1000);
  });

  it('puts time ticks on round local times inside the window', () => {
    const first = new Date(2026, 9, 21, 8, 3).getTime();
    const last = new Date(2026, 9, 21, 17, 59).getTime();
    const ticks = timeTicks(first, last, 1000).map((tick) => new Date(tick));
    expect(ticks.map((tick) => tick.getHours())).toEqual([10, 12, 14, 16]);
    expect(ticks.every((tick) => tick.getMinutes() === 0)).toBe(true);
    // A narrow chart gets fewer, wider steps.
    expect(timeTicks(first, last, 300).length).toBeLessThan(ticks.length);
  });

  it('leaves room on the left for the widest value label', () => {
    const narrow = chartFrame(640, ['0', '5']);
    const wide = chartFrame(640, ['0 MvB', '120 MvB']);
    expect(wide.left).toBeGreaterThan(narrow.left);
    expect(wide.plotWidth).toBe(640 - wide.left - wide.right);
  });

  it('rounds a column only at its data end', () => {
    expect(columnPath(10, 20, 24, 100)).toBe('M10,120 V24 Q10,20 14,20 H30 Q34,20 34,24 V120 Z');
  });

  it('cuts a long series down to about one point per pixel, keeping its ends and its peaks', () => {
    const points = Array.from({ length: 2880 }, (_, index) => ({ x: index, y: index === 1500 ? 100 : 1 }));
    const sampled = downsample(points, 300);
    expect(sampled.length).toBeLessThanOrEqual(300);
    expect(sampled[0]).toBe(points[0]);
    expect(sampled.at(-1)).toBe(points.at(-1));
    expect(sampled.some((point) => point.y === 100)).toBe(true);
    expect(downsample(points.slice(0, 10), 300)).toHaveLength(10);
  });

  it('breaks a series where nothing was measured', () => {
    const runs = splitAtGaps([{ x: 0 }, { x: 60 }, { x: 120 }, { x: 900 }, { x: 960 }], 180);
    expect(runs.map((run) => run.map((point) => point.x))).toEqual([
      [0, 60, 120],
      [900, 960],
    ]);
    expect(splitAtGaps([{ x: 0 }, { x: 900 }], undefined)).toHaveLength(1);
  });
});
