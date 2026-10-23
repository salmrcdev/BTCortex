import { describe, expect, it } from 'vitest';
import { convertFeeRate, formatAmount, formatJson, hexToText, parseAmount, reverseBytes, textToHex } from './convert';

describe('developer conversions', () => {
  it('converts amounts exactly, refusing fractions of a satoshi and more than 21 million bitcoin', () => {
    expect(parseAmount('0.1', 'btc')).toEqual({ sats: 10_000_000 });
    expect(parseAmount('1,234.5', 'bits')).toEqual({ sats: 123_450 });
    expect(parseAmount('0.000000001', 'btc')).toEqual({ error: 'below-a-satoshi' });
    expect(parseAmount('21000001', 'btc')).toEqual({ error: 'too-large' });
    expect(parseAmount('abc', 'sats')).toEqual({ error: 'not-a-number' });
    expect(formatAmount(123_456_789, 'btc')).toBe('1.23456789');
    expect(formatAmount(123_456_789, 'mbtc')).toBe('1,234.56789');
    expect(formatAmount(123_456_789, 'sats')).toBe('123,456,789');
  });

  it('converts fee rates between sat/vB, BTC/kvB and sat/kWU', () => {
    expect(convertFeeRate(10, 'sat/vB')).toEqual({ 'sat/vB': 10, 'BTC/kvB': 0.0001, 'sat/kWU': 2500 });
    expect(convertFeeRate(0.00001, 'BTC/kvB')['sat/vB']).toBeCloseTo(1);
    expect(convertFeeRate(250, 'sat/kWU')['sat/vB']).toBeCloseTo(1);
  });

  it('turns text into hexadecimal and back, and reverses byte order', () => {
    expect(textToHex('BTCortex ₿')).toBe('4254436f7274657820e282bf');
    expect(hexToText('4254436f7274657820e282bf')).toEqual({ text: 'BTCortex ₿' });
    expect(hexToText('ff')).toEqual({ error: 'not-utf8' });
    expect(hexToText('abc')).toEqual({ error: 'not-hex' });
    expect(reverseBytes('0x0011aaFF')).toEqual({ hex: 'ffaa1100' });
  });

  it('formats JSON and says where it is broken', () => {
    expect(formatJson('{"a":[1,2]}', 2)).toEqual({ json: '{\n  "a": [\n    1,\n    2\n  ]\n}' });
    expect(formatJson('{"a":}', 2)).toMatchObject({ error: expect.any(String) as string });
  });
});
