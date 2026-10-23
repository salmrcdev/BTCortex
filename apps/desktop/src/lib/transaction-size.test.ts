import { describe, expect, it } from 'vitest';
import { estimateSize, feeFor, spendCost } from './transaction-size';

describe('transaction size estimates', () => {
  it('sizes the usual transactions as wallets do', () => {
    // One P2WPKH input to a P2WPKH payment and change: 10.5 + 68 + 2 × 31 = about 141 vB.
    expect(estimateSize({ p2wpkh: 1 }, { p2wpkh: 2 })).toEqual({ weight: 562, vsize: 141 });
    // One Taproot key-path input to two Taproot outputs: 10.5 + 57.5 + 2 × 43 = 154 vB.
    expect(estimateSize({ p2tr: 1 }, { p2tr: 2 })).toEqual({ weight: 616, vsize: 154 });
    // Legacy only: no SegWit marker, 226 bytes.
    expect(estimateSize({ p2pkh: 1 }, { p2pkh: 2 })).toEqual({ weight: 904, vsize: 226 });
    expect(estimateSize({ 'p2sh-p2wpkh': 1 }, { p2sh: 1 }).vsize).toBe(134);
  });

  it('counts three-byte counts for many inputs', () => {
    const many = estimateSize({ p2wpkh: 253 }, { p2wpkh: 1 });
    const fewer = estimateSize({ p2wpkh: 252 }, { p2wpkh: 1 });
    expect(many.weight - fewer.weight).toBe(272 + 8);
  });

  it('prices fees and the cost of spending a coin', () => {
    expect(feeFor(141, 2.5)).toBe(353);
    expect(spendCost('p2wpkh', 10)).toBe(680);
    expect(spendCost('p2tr', 10)).toBe(575);
    expect(spendCost('p2pkh', 1)).toBe(148);
    expect(spendCost('p2wsh', 10)).toBeNull();
  });
});
