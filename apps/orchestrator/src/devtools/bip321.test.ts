import { describe, expect, it } from 'vitest';
import { buildPaymentUri, formatBtcAmount, parseBtcAmount, parsePaymentUri } from './bip321';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LEGACY = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

describe('reading payment URIs by BIP 321', () => {
  it('reads the address, amount, label and message', () => {
    expect(parsePaymentUri(`bitcoin:${ADDRESS}?amount=0.0005&label=Shop%20order&message=Thanks%21`)).toMatchObject({
      problems: [],
      address: ADDRESS,
      amountSats: 50_000,
      label: 'Shop order',
      message: 'Thanks!',
    });
  });

  it('accepts the scheme and keys in any case, and UTF-8 in values', () => {
    expect(parsePaymentUri(`BITCOIN:${ADDRESS.toUpperCase()}?AMOUNT=1&Label=%C3%A9t%C3%A9`)).toMatchObject({
      problems: [],
      address: ADDRESS.toUpperCase(),
      amountSats: 100_000_000,
      label: 'été',
    });
  });

  it('allows an empty address when a payment instruction is given, and several instructions of a kind', () => {
    const parsed = parsePaymentUri('bitcoin:?lightning=lnbc1example&bc=bc1qfirst&bc=bc1psecond&sp=sp1example');
    expect(parsed.problems).toEqual([]);
    expect(parsed.address).toBeNull();
    expect(parsed.instructions.map((instruction) => instruction.kind)).toEqual([
      'lightning',
      'on-chain',
      'on-chain',
      'silent-payment',
    ]);
    expect(parsePaymentUri('bitcoin:?label=Nothing to pay').problems).toEqual([
      'It has neither an address nor a payment instruction.',
    ]);
  });

  it('refuses a URI whose required parameters it does not understand, and ignores unknown optional ones', () => {
    const required = parsePaymentUri(
      `bitcoin:${LEGACY}?req-somethingyoudontunderstand=50&req-somethingelseyoudontget=999`,
    );
    expect(required.problems).toHaveLength(2);
    expect(required.problems[0]).toMatch(/requires “somethingyoudontunderstand”/);
    const optional = parsePaymentUri(`bitcoin:${LEGACY}?somethingyoudontunderstand=50&somethingelseyoudontget=999`);
    expect(optional.problems).toEqual([]);
    expect(optional.ignored).toEqual([
      { key: 'somethingyoudontunderstand', value: '50' },
      { key: 'somethingelseyoudontget', value: '999' },
    ]);
  });

  it('refuses amounts that are not decimal BTC, and keys that may appear once', () => {
    expect(parsePaymentUri(`bitcoin:${LEGACY}?amount=50,000.00`).problems[0]).toMatch(/not decimal BTC/);
    expect(parsePaymentUri(`bitcoin:${LEGACY}?amount=1e3`).problems).toHaveLength(1);
    expect(parsePaymentUri(`bitcoin:${LEGACY}?amount=0.123456789`).problems).toHaveLength(1);
    expect(parsePaymentUri(`bitcoin:${LEGACY}?amount=1&amount=1`).problems).toEqual([
      '“amount” appears 2 times; BIP 321 allows it once.',
    ]);
    expect(parsePaymentUri(`bitcoin:${LEGACY}?pop=callback%3a&req-pop=callback%3a`).problems).toEqual([
      '“pop” appears 2 times; BIP 321 allows it once.',
    ]);
  });

  it('notes proof-of-payment callbacks and refuses schemes that would open a browser', () => {
    expect(parsePaymentUri(`bitcoin:${LEGACY}?pop=callbackuri%3a`).proofOfPayment).toEqual({
      callback: 'callbackuri:',
      required: false,
      allowedScheme: true,
    });
    const forbidden = parsePaymentUri(`bitcoin:${LEGACY}?req-pop=https%3A%2F%2Fexample.com%2Fpaid`);
    expect(forbidden.proofOfPayment).toMatchObject({ required: true, allowedScheme: false });
    expect(forbidden.problems[0]).toMatch(/uses https:, which BIP 321 forbids/);
  });

  it('says what is wrong with things that are not payment URIs', () => {
    expect(parsePaymentUri(ADDRESS).problems[0]).toMatch(/does not start with bitcoin:/);
    expect(parsePaymentUri('bitcoin:bc1q<script>').problems[0]).toMatch(/characters no Bitcoin address has/);
    expect(parsePaymentUri(`bitcoin:${LEGACY}?label=%E0%A4%A`).problems[0]).toMatch(/not percent-encoded correctly/);
  });
});

describe('making payment URIs', () => {
  it('writes the amount in BTC and percent-encodes the label and message, which read back the same', () => {
    const uri = buildPaymentUri({ address: ADDRESS, amountSats: 50_000, label: 'Shop order', message: 'Thanks & bye' });
    expect(uri).toBe(`bitcoin:${ADDRESS}?amount=0.0005&label=Shop%20order&message=Thanks%20%26%20bye`);
    expect(parsePaymentUri(uri)).toMatchObject({ problems: [], amountSats: 50_000, message: 'Thanks & bye' });
    expect(buildPaymentUri({ address: ADDRESS })).toBe(`bitcoin:${ADDRESS}`);
  });

  it('converts amounts between satoshis and decimal BTC exactly', () => {
    expect(formatBtcAmount(100_000_000)).toBe('1');
    expect(formatBtcAmount(1)).toBe('0.00000001');
    expect(formatBtcAmount(123_456_789)).toBe('1.23456789');
    expect(parseBtcAmount('50')).toBe(5_000_000_000);
    expect(parseBtcAmount('50.00')).toBe(5_000_000_000);
    expect(parseBtcAmount('.5')).toBe(50_000_000);
    expect(parseBtcAmount('0.1')).toBe(10_000_000);
    expect(parseBtcAmount('.')).toBeNull();
    expect(parseBtcAmount('21000001')).toBeNull();
  });
});
