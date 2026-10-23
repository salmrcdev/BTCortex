// Conversions for the developer tools (specification section 15): amounts,
// fee rates, hexadecimal and JSON. Pure functions, computed in the window;
// nothing here reaches the node.

export const AMOUNT_UNITS = ['btc', 'mbtc', 'bits', 'sats'] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];

const SATS_PER: Record<AmountUnit, number> = { btc: 100_000_000, mbtc: 100_000, bits: 100, sats: 1 };
const MAX_SATS = 21_000_000 * 100_000_000;

export type AmountError = 'not-a-number' | 'below-a-satoshi' | 'too-large';

/** An amount in satoshis, or why it is not one. Fractions of a satoshi are refused rather than rounded. */
export function parseAmount(text: string, unit: AmountUnit): { sats: number } | { error: AmountError } {
  const cleaned = text.trim().replaceAll(',', '').replaceAll('_', '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { error: 'not-a-number' };
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const decimals = Math.round(Math.log10(SATS_PER[unit]));
  if (fraction.length > decimals) return { error: 'below-a-satoshi' };
  // Whole and fractional parts are joined as text, so no binary rounding creeps in.
  const sats = Number(`${whole}${fraction.padEnd(decimals, '0')}`);
  if (!Number.isSafeInteger(sats) || sats > MAX_SATS) return { error: 'too-large' };
  return { sats };
}

/** The amount in a unit, with every decimal place that unit has. */
export function formatAmount(sats: number, unit: AmountUnit): string {
  const per = SATS_PER[unit];
  const decimals = Math.round(Math.log10(per));
  const whole = Math.floor(sats / per);
  const fraction = String(sats % per).padStart(decimals, '0');
  const grouped = whole.toLocaleString('en-GB');
  return decimals === 0 ? grouped : `${grouped}.${fraction}`;
}

export const FEE_UNITS = ['sat/vB', 'BTC/kvB', 'sat/kWU'] as const;
export type FeeUnit = (typeof FEE_UNITS)[number];

/** 1 sat/vB is 0.00001 BTC/kvB and 250 sat/kWU (a virtual byte is four weight units). */
const SAT_PER_VB: Record<FeeUnit, number> = { 'sat/vB': 1, 'BTC/kvB': 100_000, 'sat/kWU': 1 / 250 };

export function convertFeeRate(value: number, from: FeeUnit): Record<FeeUnit, number> {
  const satPerVb = value * SAT_PER_VB[from];
  return { 'sat/vB': satPerVb, 'BTC/kvB': satPerVb / 100_000, 'sat/kWU': satPerVb * 250 };
}

export function textToHex(text: string): string {
  return [...new TextEncoder().encode(text)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** UTF-8 text from hexadecimal, or why it cannot be read. */
export function hexToText(hex: string): { text: string } | { error: 'not-hex' | 'not-utf8' } {
  const cleaned = hex.trim().replace(/^0x/i, '').replaceAll(/\s/g, '');
  if (!/^([0-9a-fA-F]{2})*$/.test(cleaned)) return { error: 'not-hex' };
  const bytes = new Uint8Array(cleaned.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { error: 'not-utf8' };
  }
}

/** The bytes in reverse order: how transaction and block ids are shown against how they are stored. */
export function reverseBytes(hex: string): { hex: string } | { error: 'not-hex' } {
  const cleaned = hex.trim().replace(/^0x/i, '').replaceAll(/\s/g, '');
  if (!/^([0-9a-fA-F]{2})*$/.test(cleaned)) return { error: 'not-hex' };
  return { hex: (cleaned.match(/../g) ?? []).reverse().join('').toLowerCase() };
}

export function formatJson(text: string, indent: number): { json: string } | { error: string } {
  try {
    return { json: JSON.stringify(JSON.parse(text), null, indent) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
