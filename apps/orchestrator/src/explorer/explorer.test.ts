import { describe, expect, it } from 'vitest';
import { coinbaseText, satPerVbyte, sats, scripthashOf } from './explorer-service';

describe('explorer helpers', () => {
  it('turns Bitcoin Core’s amounts into satoshis without floating-point drift', () => {
    expect(sats(48.49999577)).toBe(4_849_999_577);
    expect(sats(0.00000423)).toBe(423);
    expect(sats(0.1 + 0.2)).toBe(30_000_000);
  });

  it('turns BTC per kvB into sat/vB', () => {
    expect(satPerVbyte(0.00001)).toBe(1);
    expect(satPerVbyte(0.0002345)).toBe(23.45);
  });

  it('computes Electrum script hashes as the protocol documents them', () => {
    // The example in the Electrum protocol's documentation: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.
    expect(scripthashOf('76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac')).toBe(
      '8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161',
    );
  });

  it('finds the readable tag in a coinbase input', () => {
    const tag = Buffer.from('/Some Pool/mined by BTCortex', 'latin1').toString('hex');
    expect(coinbaseText(`03a5c50e${tag}0d00ff`)).toBe('/Some Pool/mined by BTCortex');
    expect(coinbaseText('016f00')).toBeNull();
  });
});
