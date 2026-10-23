import { randomBytes } from 'node:crypto';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { psbtFromQrParts, psbtToQrFrames, psbtToUrParts } from './qr';
import type { QrMatrix } from './qr';

// A PSBT out to QR codes and back: UR parts, fountain coding, CBOR, and QR
// matrices read by jsQR, the decoder the camera scanner uses.

const MAGIC = Buffer.from('70736274ff', 'hex');
const psbtOf = (bytes: number) => Buffer.concat([MAGIC, randomBytes(bytes)]).toString('base64');

/** Renders a matrix the way the interface draws it (with a quiet zone), as RGBA pixels. */
function render(frame: QrMatrix, scale = 4, quiet = 4) {
  const size = (frame.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  frame.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== '1') continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    }
  });
  return { pixels, size };
}

describe('PSBTs as QR codes', () => {
  it('fits a small PSBT in one code', () => {
    const psbt = psbtOf(60);
    const parts = psbtToUrParts(psbt);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatch(/^UR:CRYPTO-PSBT\//);
    expect(psbtFromQrParts(parts)).toEqual({ progress: 1, complete: true, psbt });
  });

  it('splits a large PSBT into fountain-coded parts and puts it together from any sufficient subset', () => {
    const psbt = psbtOf(2000);
    const parts = psbtToUrParts(psbt, 200);
    expect(parts.length).toBeGreaterThan(10);
    const partial = psbtFromQrParts(parts.slice(0, 3));
    expect(partial.complete).toBe(false);
    expect(partial.progress).toBeGreaterThan(0);
    expect(partial.progress).toBeLessThan(1);
    // Two plain fragments were missed and the order is mixed: the fountain-coded extras still complete it.
    const seen = parts.filter((_, index) => index !== 1 && index !== 4).reverse();
    expect(psbtFromQrParts(seen)).toMatchObject({ complete: true, psbt });
  });

  it('accepts a plain base64 PSBT in a single code, and refuses what is not a PSBT', () => {
    const psbt = psbtOf(40);
    expect(psbtFromQrParts([psbt])).toEqual({ progress: 1, complete: true, psbt });
    expect(psbtFromQrParts(['hello'])).toEqual({ progress: 0, complete: false });
    const bytes = new UREncoder(new UR(Buffer.from([0x43, 1, 2, 3]), 'bytes'), 200).nextPart();
    expect(psbtFromQrParts([bytes]).error).toMatch(/carry bytes, not a PSBT/);
    expect(() => psbtToUrParts(Buffer.from('not a psbt').toString('base64'))).toThrow(/not a PSBT/);
  });

  it('draws codes that a camera-style decoder reads back exactly', () => {
    const psbt = psbtOf(900);
    const parts = psbtToUrParts(psbt, 250);
    const frames = psbtToQrFrames(psbt, 250);
    expect(frames).toHaveLength(parts.length);
    const read = frames.map((frame) => {
      const { pixels, size } = render(frame);
      return jsQR(pixels, size, size)?.data;
    });
    expect(read).toEqual(parts);
    expect(psbtFromQrParts(read.filter((part): part is string => part !== undefined))).toMatchObject({
      complete: true,
      psbt,
    });
  });
});
