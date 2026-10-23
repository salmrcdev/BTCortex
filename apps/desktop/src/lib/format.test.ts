import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatPercent, formatTimestamp } from './format';

describe('formatting', () => {
  it('uses unambiguous binary units', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(6_340_771_840)).toBe('5.9 GiB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('formats timestamps in British style with an explicit time zone', () => {
    expect(formatTimestamp('2026-10-21T02:00:53.511Z', { timeZone: 'Europe/London' })).toBe(
      '21 Oct 2026, 03:00:53 BST',
    );
    expect(formatTimestamp('2026-12-01T09:15:00.000Z', { timeZone: 'Europe/London' })).toBe('1 Dec 2026, 09:15:00 GMT');
    expect(formatTimestamp('not a date')).toBe('—');
  });

  it('formats durations and percentages', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3 h 12 min');
    expect(formatDuration(2 * 86_400_000 + 5 * 3_600_000)).toBe('2 d 5 h');
    expect(formatPercent(0.273)).toBe('27%');
  });
});

describe('Bitcoin-specific formatting', () => {
  it('converts fee rates to sat/vB', async () => {
    const { formatFeeRate } = await import('./format');
    expect(formatFeeRate(0.000001)).toBe('0.10 sat/vB');
    expect(formatFeeRate(0.00025)).toBe('25.0 sat/vB');
  });

  it('uses Bitcoin Core’s decimal virtual-byte units and exact amounts', async () => {
    const { formatBitcoin, formatSatPerVb, formatSats, formatVirtualBytes, formatVirtualBytesAxis } =
      await import('./format');
    // Axis labels share the unit of the axis maximum.
    expect(formatVirtualBytesAxis(0, 120_000_000)).toBe('0 MvB');
    expect(formatVirtualBytesAxis(60_000_000, 120_000_000)).toBe('60 MvB');
    expect(formatVirtualBytesAxis(1_250_000, 2_500_000)).toBe('1.25 MvB');
    expect(formatVirtualBytesAxis(500, 1000)).toBe('0.5 kvB');
    expect(formatVirtualBytes(141)).toBe('141 vB');
    expect(formatVirtualBytes(1_250_000)).toBe('1.25 MvB');
    // Rounding never prints "1,000.00 kvB".
    expect(formatVirtualBytes(999_999)).toBe('1.00 MvB');
    expect(formatVirtualBytes(-5)).toBe('—');
    expect(formatSatPerVb(1)).toBe('1.00 sat/vB');
    expect(formatSatPerVb(152.34)).toBe('152.3 sat/vB');
    expect(formatBitcoin(12_345)).toBe('0.00012345 BTC');
    expect(formatBitcoin(2_100_000_000_000_000)).toBe('21,000,000.00000000 BTC');
    expect(formatSats(1)).toBe('1 sat');
    expect(formatSats(1410)).toBe('1,410 sats');
  });

  it('formats compact figures, middle truncation and relative times', async () => {
    const { formatCompact, formatRelativeTime, truncateMiddle } = await import('./format');
    expect(formatCompact(1284)).toBe('1,284');
    expect(formatCompact(12_900)).toBe('12.9k');
    expect(truncateMiddle('0000000000000000000207d83b6a93a2b8c06ecb41bb3a8a8e1f3c2c5e3f2a1b')).toBe(
      '0000000000…5e3f2a1b',
    );
    const now = new Date('2026-10-21T12:00:00Z');
    expect(formatRelativeTime(new Date('2026-10-21T11:48:00Z'), now)).toBe('12 minutes ago');
    expect(formatRelativeTime(new Date('2026-10-21T12:00:00Z'), now)).toBe('now');
  });
});
