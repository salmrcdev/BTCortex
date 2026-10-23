import type { AddressType } from '@btcortex/contracts';

// Transaction sizes for estimates (specification section 14), in weight units
// (BIP 141: non-witness bytes count four times, witness bytes once). Each
// input and output type is taken at its usual size — ECDSA signatures of 72
// bytes, Schnorr signatures of 64, compressed keys — so real transactions
// differ by a byte or two per input.

export const INPUT_TYPES = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as const;
export type InputType = (typeof INPUT_TYPES)[number];
export const OUTPUT_TYPES = ['p2pkh', 'p2sh', 'p2wpkh', 'p2wsh', 'p2tr'] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

/** Outpoint, script length and sequence: 41 bytes before any script. */
const INPUT_BASE_BYTES = 41;

/** Weight of spending one coin of each type. */
export const INPUT_WEIGHT: Record<InputType, number> = {
  // scriptSig: a signature and a public key, 107 bytes.
  p2pkh: (INPUT_BASE_BYTES + 107) * 4,
  // scriptSig: the 22-byte redeem script; witness: item count, signature and key, 108 bytes.
  'p2sh-p2wpkh': (INPUT_BASE_BYTES + 23) * 4 + 108,
  p2wpkh: INPUT_BASE_BYTES * 4 + 108,
  // Witness: item count and a 64-byte signature.
  p2tr: INPUT_BASE_BYTES * 4 + 66,
};

const WITNESS_INPUTS: ReadonlySet<InputType> = new Set(['p2sh-p2wpkh', 'p2wpkh', 'p2tr']);

/** Weight of each output: value, script length and script. */
export const OUTPUT_WEIGHT: Record<OutputType, number> = {
  p2pkh: 34 * 4,
  p2sh: 32 * 4,
  p2wpkh: 31 * 4,
  p2wsh: 43 * 4,
  p2tr: 43 * 4,
};

/** Version, one-byte input and output counts, and lock time. */
const BASE_WEIGHT = 10 * 4;
/** The SegWit marker and flag. */
const SEGWIT_MARKER_WEIGHT = 2;
/** Counts above this take three bytes instead of one. */
const ONE_BYTE_COUNT = 252;

export interface SizeEstimate {
  weight: number;
  vsize: number;
}

export function estimateSize(
  inputs: Partial<Record<InputType, number>>,
  outputs: Partial<Record<OutputType, number>>,
): SizeEstimate {
  let weight = BASE_WEIGHT;
  let inputCount = 0;
  let outputCount = 0;
  let witness = false;
  for (const type of INPUT_TYPES) {
    const count = inputs[type] ?? 0;
    inputCount += count;
    weight += count * INPUT_WEIGHT[type];
    if (count > 0 && WITNESS_INPUTS.has(type)) witness = true;
  }
  for (const type of OUTPUT_TYPES) {
    const count = outputs[type] ?? 0;
    outputCount += count;
    weight += count * OUTPUT_WEIGHT[type];
  }
  if (inputCount > ONE_BYTE_COUNT) weight += 2 * 4;
  if (outputCount > ONE_BYTE_COUNT) weight += 2 * 4;
  if (witness) weight += SEGWIT_MARKER_WEIGHT;
  return { weight, vsize: Math.ceil(weight / 4) };
}

export function feeFor(vsize: number, satPerVb: number): number {
  return Math.ceil(vsize * satPerVb);
}

/** The input type a coin of this output type is spent with; null when it depends on a script BTCortex cannot see. */
export function inputTypeOf(type: AddressType): InputType | null {
  if (type === 'p2pkh' || type === 'p2wpkh' || type === 'p2tr') return type;
  return null;
}

/** What spending one coin adds to a transaction's fee at a fee rate, or null when its size is not known. */
export function spendCost(type: AddressType, satPerVb: number): number | null {
  const input = inputTypeOf(type);
  return input === null ? null : Math.ceil((INPUT_WEIGHT[input] / 4) * satPerVb);
}
