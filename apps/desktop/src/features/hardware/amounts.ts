// Amounts the user types. Bitcoin amounts are converted to satoshis with
// string arithmetic, never through floating point, so "0.1" is exactly
// 10 000 000 satoshis.

const MAX_SATS = 21_000_000 * 100_000_000;

/** Satoshis from a bitcoin amount such as "0.001" or "0,001" (decimal comma), or null when it is not one. */
export function parseBitcoinAmount(text: string): number | null {
  const match = /^(\d{1,8})(?:[.,](\d{1,8}))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  const satoshis = Number(match[1]) * 100_000_000 + Number((match[2] ?? '').padEnd(8, '0'));
  return satoshis > 0 && satoshis <= MAX_SATS ? satoshis : null;
}

/** A fee rate in sat/vB such as "2" or "1.5", or null when it is not one. */
export function parseFeeRate(text: string): number | null {
  const match = /^(\d{1,5})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  const rate = Number(`${match[1]}.${match[2] ?? '0'}`);
  return rate >= 0.1 && rate <= 10_000 ? rate : null;
}
