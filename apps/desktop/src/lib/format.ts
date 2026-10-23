// British English presentation of values (specification section 4).
// Timestamps always carry their time zone so that they are unambiguous.

export const LOCALE = 'en-GB';

const BINARY_UNITS = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/** IEC binary units, which are unambiguous (1 GiB = 1024³ bytes). */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${new Intl.NumberFormat(LOCALE).format(bytes)} bytes`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BINARY_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits }).format(value)} ${BINARY_UNITS[unit] ?? ''}`;
}

/** Transfer rates, for example "1.2 MiB/s". */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Chart-axis labels that share the unit of the axis maximum, for example "0 MiB", "5 MiB", "10 MiB". */
export function formatBytesAxis(bytes: number, maximum: number): string {
  let size = 1;
  let unit = 0;
  while (maximum / size >= 1024 && unit < BINARY_UNITS.length - 1) {
    size *= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(bytes / size)} ${BINARY_UNITS[unit] ?? ''}`;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

export function formatPercent(fraction: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(fraction);
}

export interface TimestampOptions {
  /** IANA time zone; defaults to the system time zone. */
  timeZone?: string;
}

/** For example "21 Oct 2026, 04:05:12 BST". */
export function formatTimestamp(value: Date | string, options: TimestampOptions = {}): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

/** A calendar date without the time, for example "21 Oct 2026". */
export function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** Compact time for log lists, for example "21 Oct 14:05:12"; the full timestamp belongs in a tooltip. */
export function formatLogTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** Human duration such as "3 h 12 min" or "45 s". */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds % 60} s`;
  return `${seconds} s`;
}

/** Compact figures for stat tiles, for example 1,284 / 12.9K / 4.2M. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 10_000) return new Intl.NumberFormat(LOCALE).format(value);
  return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Fee rates as people read them, for example "1.00 sat/vB" or "12.5 sat/vB". */
export function formatSatPerVb(satPerVbyte: number): string {
  if (!Number.isFinite(satPerVbyte) || satPerVbyte < 0) return '—';
  const digits = satPerVbyte < 10 ? 2 : 1;
  return `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(satPerVbyte)} sat/vB`;
}

/** Bitcoin Core reports fee rates in BTC/kvB; people read sat/vB (1 sat/vB = 0.00001 BTC/kvB). */
export function formatFeeRate(btcPerKvB: number): string {
  return formatSatPerVb(btcPerKvB * 100_000);
}

const VIRTUAL_BYTE_UNITS = ['vB', 'kvB', 'MvB', 'GvB'] as const;

/** Transaction and mempool sizes in Bitcoin Core's decimal units (1 kvB = 1,000 vB), for example "1.25 MvB". */
export function formatVirtualBytes(virtualBytes: number, fractionDigits = 2): string {
  if (!Number.isFinite(virtualBytes) || virtualBytes < 0) return '—';
  if (virtualBytes < 1000)
    return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(virtualBytes)} vB`;
  // Step up before rounding would print "1,000.00 kvB".
  const threshold = 1000 - 0.5 * 10 ** -fractionDigits;
  let value = virtualBytes;
  let unit = 0;
  while (value >= threshold && unit < VIRTUAL_BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits }).format(value)} ${VIRTUAL_BYTE_UNITS[unit] ?? ''}`;
}

/** Chart-axis labels that share the unit of the axis maximum, for example "0 MvB", "60 MvB", "120 MvB". */
export function formatVirtualBytesAxis(virtualBytes: number, maximum: number): string {
  let size = 1;
  let unit = 0;
  while (maximum / size >= 1000 && unit < VIRTUAL_BYTE_UNITS.length - 1) {
    size *= 1000;
    unit += 1;
  }
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(virtualBytes / size)} ${VIRTUAL_BYTE_UNITS[unit] ?? ''}`;
}

/** Amounts in bitcoin with all eight decimal places, for example "0.00012345 BTC". */
export function formatBitcoin(satoshis: number): string {
  if (!Number.isFinite(satoshis)) return '—';
  return `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 8, maximumFractionDigits: 8 }).format(satoshis / 100_000_000)} BTC`;
}

/** Small amounts such as fees, for example "1,410 sats". */
export function formatSats(satoshis: number): string {
  if (!Number.isFinite(satoshis)) return '—';
  return `${new Intl.NumberFormat(LOCALE).format(satoshis)} ${satoshis === 1 ? 'sat' : 'sats'}`;
}

/** Hours and minutes for chart axes, for example "14:05". */
export function formatClockTime(value: Date | number): string {
  const date = typeof value === 'number' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** Day and month for chart axes spanning days, for example "23 Oct". */
export function formatDayMonth(value: Date | number): string {
  const date = typeof value === 'number' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' }).format(date);
}

/** For example "Testnet3 and Signet". */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(LOCALE, { style: 'long', type: 'conjunction' }).format(items);
}

/** Keeps both ends of long identifiers such as block hashes: `00000000…3f2a1b`. */
export function truncateMiddle(value: string, head = 10, tail = 8): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

/** For example "12 minutes ago", relative to `now`. */
export function formatRelativeTime(value: Date | number, now: Date = new Date()): string {
  const time = typeof value === 'number' ? value : value.getTime();
  const seconds = Math.round((time - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, 'second');
}
