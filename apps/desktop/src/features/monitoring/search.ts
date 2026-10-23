// What the monitoring page keeps in the address: the period and the metrics
// compared, so going back returns to the same view.

export const RANGES = [1, 6, 24, 168, 720, 2160, 8760] as const;
export type RangeHours = (typeof RANGES)[number];

export interface MonitoringSearch {
  range?: RangeHours;
  series?: string;
}

export function validateMonitoringSearch(search: Record<string, unknown>): MonitoringSearch {
  const range = (RANGES as readonly unknown[]).includes(search['range']) ? (search['range'] as RangeHours) : undefined;
  const series = typeof search['series'] === 'string' && search['series'].length <= 600 ? search['series'] : undefined;
  return { ...(range === undefined ? {} : { range }), ...(series === undefined ? {} : { series }) };
}
