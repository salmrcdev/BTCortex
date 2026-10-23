import { UR, URDecoder, UREncoder } from '@ngraveio/bc-ur';
import QRCode from 'qrcode';

// PSBTs as QR codes for devices that sign without a cable (specification
// section 9: air-gapped QR workflows, UR and animated QR): Uniform Resources
// (BCR-2020-005) of type `crypto-psbt`, the PSBT as a CBOR byte string, split
// into fountain-coded parts when it does not fit one code, as Passport,
// Keystone, SeedSigner, Krux and Jade read them. Parts are shown in upper case
// so that the QR code can use its compact alphanumeric mode.

/** About 250 characters per code keeps each frame readable by phone-grade cameras. */
const DEFAULT_FRAGMENT_LENGTH = 250;
const PSBT_MAGIC = Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]);

export interface QrMatrix {
  size: number;
  /** One string per row, `1` for a dark module. */
  rows: string[];
}

function cborByteString(data: Buffer): Buffer {
  const length = data.length;
  let header: Buffer;
  if (length < 24) header = Buffer.from([0x40 + length]);
  else if (length < 0x100) header = Buffer.from([0x58, length]);
  else if (length < 0x10000) header = Buffer.from([0x59, length >> 8, length & 0xff]);
  else {
    header = Buffer.alloc(5);
    header[0] = 0x5a;
    header.writeUInt32BE(length, 1);
  }
  return Buffer.concat([header, data]);
}

function readCborByteString(cbor: Buffer): Buffer {
  const first = cbor[0] ?? 0;
  if (first >> 5 !== 2) throw new Error('The QR code does not carry a byte string.');
  const info = first & 0x1f;
  let offset = 1;
  let length = info;
  if (info === 24) {
    length = cbor.readUInt8(1);
    offset = 2;
  } else if (info === 25) {
    length = cbor.readUInt16BE(1);
    offset = 3;
  } else if (info === 26) {
    length = cbor.readUInt32BE(1);
    offset = 5;
  } else if (info > 26) {
    throw new Error('The QR code’s data is malformed.');
  }
  if (offset + length > cbor.length) throw new Error('The QR code’s data is cut short.');
  return cbor.subarray(offset, offset + length);
}

/** One QR code for a short text, such as an address or a server to enter in a wallet. */
export function qrMatrix(text: string, errorCorrectionLevel: 'L' | 'M' = 'L'): QrMatrix {
  const code = QRCode.create(text, { errorCorrectionLevel });
  const { size, data } = code.modules;
  const rows: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let line = '';
    for (let column = 0; column < size; column += 1) line += data[row * size + column] ? '1' : '0';
    rows.push(line);
  }
  return { size, rows };
}

/**
 * The UR parts for a PSBT, in upper case: one when it fits, otherwise twice
 * the number of fragments, so that a reader that missed some frames still
 * completes it from the fountain-coded extras.
 */
export function psbtToUrParts(psbtBase64: string, fragmentLength = DEFAULT_FRAGMENT_LENGTH): string[] {
  const psbt = Buffer.from(psbtBase64, 'base64');
  if (!psbt.subarray(0, PSBT_MAGIC.length).equals(PSBT_MAGIC)) throw new Error('This is not a PSBT.');
  const encoder = new UREncoder(new UR(cborByteString(psbt), 'crypto-psbt'), fragmentLength);
  const count = encoder.fragmentsLength === 1 ? 1 : encoder.fragmentsLength * 2;
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) parts.push(encoder.nextPart().toUpperCase());
  return parts;
}

/** The QR codes to show for a PSBT, one per UR part. */
export function psbtToQrFrames(psbtBase64: string, fragmentLength = DEFAULT_FRAGMENT_LENGTH): QrMatrix[] {
  return psbtToUrParts(psbtBase64, fragmentLength).map((part) => qrMatrix(part));
}

export interface QrScanProgress {
  /** 0 to 1. */
  progress: number;
  complete: boolean;
  /** The PSBT in base64, once complete. */
  psbt?: string;
  /** Why the scanned codes cannot become a PSBT. */
  error?: string;
}

/**
 * Turns the codes scanned so far into a PSBT. Stateless: the interface sends
 * every distinct code it has read, and learns how far it has got. A plain
 * base64 PSBT in a single code is accepted as well.
 */
export function psbtFromQrParts(parts: readonly string[]): QrScanProgress {
  const urParts = parts.map((part) => part.trim()).filter((part) => /^ur:/i.test(part));
  if (urParts.length === 0) {
    const single = parts.map((part) => part.trim()).find((part) => part !== '');
    if (single !== undefined && Buffer.from(single, 'base64').subarray(0, 5).equals(PSBT_MAGIC)) {
      return { progress: 1, complete: true, psbt: single };
    }
    return { progress: 0, complete: false };
  }
  const decoder = new URDecoder();
  for (const part of urParts) decoder.receivePart(part.toLowerCase());
  if (!decoder.isComplete()) return { progress: decoder.estimatedPercentComplete(), complete: false };
  if (!decoder.isSuccess()) return { progress: 1, complete: false, error: decoder.resultError() };
  const result = decoder.resultUR();
  if (result.type !== 'crypto-psbt' && result.type !== 'psbt') {
    return { progress: 1, complete: false, error: `The codes carry ${result.type}, not a PSBT.` };
  }
  const psbt = readCborByteString(result.cbor);
  if (!psbt.subarray(0, PSBT_MAGIC.length).equals(PSBT_MAGIC)) {
    return { progress: 1, complete: false, error: 'The codes do not carry a PSBT.' };
  }
  return { progress: 1, complete: true, psbt: psbt.toString('base64') };
}
