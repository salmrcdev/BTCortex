import type { TransactionDetail, TransactionInput, TransactionOutput } from '@btcortex/contracts';
import { analyseScript, bytesToHex, hexToBytes, LOCKTIME_THRESHOLD, parseScript, relativeLock } from './script';
import type { ScriptAnalysis, ScriptTimelock } from './script';

// What a decoded transaction means (specification section 14): its lock time
// and whether it is in force, each input's sequence (BIP 68 relative locks,
// BIP 125 signalling), what each input spends and how its witness is laid out
// (signatures and their sighash types, keys, the script it satisfies, the
// Taproot annex and control block of BIP 341), the witness discount, and
// outputs below Bitcoin Core's default dust limit. It reads the node's
// decoding; it checks no signature and decides nothing about validity.

export const SEQUENCE_FINAL = 0xffffffff;
/** Inputs below this signal BIP 125 replaceability. */
const SEQUENCE_REPLACEABLE_BELOW = 0xfffffffe;
/** Bitcoin Core's default -dustrelayfee, in satoshis per virtual byte. */
const DUST_RELAY_FEE_SAT_PER_VB = 3;
const TAPROOT_ANNEX_TAG = 0x50;
const TAPROOT_CONTROL_BASE = 33;
const TAPROOT_CONTROL_NODE = 32;
const TAPROOT_CONTROL_MAX_DEPTH = 128;
const TAPSCRIPT_LEAF_VERSION = 0xc0;

export type LockTimeAnalysis =
  | { kind: 'none' }
  | { kind: 'height'; height: number; enforced: boolean }
  | { kind: 'time'; time: number; enforced: boolean };

export interface SequenceAnalysis {
  value: number;
  hex: string;
  final: boolean;
  /** Below 0xfffffffe: BIP 125 signalling. */
  signalsReplaceable: boolean;
  /** BIP 68, which needs transaction version 2 or later. */
  relative: Extract<ScriptTimelock, { kind: 'relative-blocks' | 'relative-time' }> | null;
}

export interface SignatureInfo {
  kind: 'ecdsa' | 'schnorr';
  /** 0 is Taproot's SIGHASH_DEFAULT. */
  sighash: number;
}

export type SpendType =
  | 'coinbase'
  | 'p2pk'
  | 'p2pkh'
  | 'p2sh'
  | 'p2sh-p2wpkh'
  | 'p2sh-p2wsh'
  | 'p2wpkh'
  | 'p2wsh'
  | 'p2tr-key'
  | 'p2tr-script'
  | 'bare-multisig'
  | 'anchor'
  | 'unknown';

export type WitnessRole = 'signature' | 'public-key' | 'script' | 'control-block' | 'annex' | 'data';

export interface WitnessItem {
  hex: string;
  role: WitnessRole;
  signature?: SignatureInfo;
}

export interface TaprootSpend {
  annex: string | null;
  /** Script path only. */
  leafVersion: number | null;
  internalKey: string | null;
  /** Depth of the script in the tree: the number of hashes in the control block. */
  depth: number | null;
}

export interface InputAnalysis {
  index: number;
  spends: SpendType;
  /** From the shape of the input, because the coin it spends is not known. */
  inferred: boolean;
  sequence: SequenceAnalysis;
  signatures: SignatureInfo[];
  /** The script the input satisfies, when it carries one. */
  script: (ScriptAnalysis & { role: 'redeem' | 'witness' | 'tapscript' }) | null;
  taproot: TaprootSpend | null;
  witness: WitnessItem[];
}

export interface OutputAnalysis {
  n: number;
  /** Below Bitcoin Core's default dust limit for its type, which nodes do not relay. */
  dust: boolean;
  dustLimitSats: number | null;
  /** The data of an OP_RETURN output, and its text when it is printable. */
  data: { hex: string; text: string | null } | null;
}

export interface WeightAnalysis {
  baseBytes: number;
  witnessBytes: number;
  weight: number;
  vsize: number;
  /** Virtual bytes saved by the witness discount. */
  savedVbytes: number;
}

export interface TransactionAnalysis {
  lockTime: LockTimeAnalysis;
  signalsReplaceable: boolean;
  /** Inputs that signal BIP 125. */
  replaceableInputs: number[];
  relativeLocks: boolean;
  inputs: InputAnalysis[];
  outputs: OutputAnalysis[];
  weight: WeightAnalysis;
}

export function analyseSequence(value: number, version: number, coinbase = false): SequenceAnalysis {
  return {
    value,
    hex: `0x${value.toString(16).padStart(8, '0')}`,
    final: value === SEQUENCE_FINAL,
    signalsReplaceable: !coinbase && value < SEQUENCE_REPLACEABLE_BELOW,
    relative: coinbase || version < 2 ? null : relativeLock(value),
  };
}

/** The lock time, which only binds when at least one input is not final. */
export function analyseLockTime(lockTime: number, sequences: readonly number[]): LockTimeAnalysis {
  if (lockTime === 0) return { kind: 'none' };
  const enforced = sequences.some((sequence) => sequence !== SEQUENCE_FINAL);
  return lockTime < LOCKTIME_THRESHOLD
    ? { kind: 'height', height: lockTime, enforced }
    : { kind: 'time', time: lockTime, enforced };
}

/** A DER-encoded ECDSA signature (BIP 66 layout) followed by its sighash type. */
function ecdsaSignature(bytes: Uint8Array): SignatureInfo | null {
  const length = bytes.length;
  if (length < 9 || length > 73 || bytes[0] !== 0x30 || bytes[1] !== length - 3 || bytes[2] !== 0x02) return null;
  const rLength = bytes[3] ?? 0;
  if (rLength === 0 || 5 + rLength >= length || bytes[4 + rLength] !== 0x02) return null;
  const sLength = bytes[5 + rLength] ?? 0;
  if (sLength === 0 || 7 + rLength + sLength !== length) return null;
  return { kind: 'ecdsa', sighash: bytes[length - 1] ?? 0 };
}

/** A BIP 340 signature: 64 bytes, or 65 with an explicit sighash type (never 0). */
function schnorrSignature(bytes: Uint8Array): SignatureInfo | null {
  if (bytes.length === 64) return { kind: 'schnorr', sighash: 0 };
  if (bytes.length === 65 && bytes[64] !== 0) return { kind: 'schnorr', sighash: bytes[64] ?? 0 };
  return null;
}

export function signatureOf(hex: string, context: 'ecdsa' | 'schnorr' | 'either' = 'either'): SignatureInfo | null {
  const bytes = hexToBytes(hex);
  if (bytes === null) return null;
  if (context === 'ecdsa') return ecdsaSignature(bytes);
  if (context === 'schnorr') return schnorrSignature(bytes);
  return ecdsaSignature(bytes) ?? schnorrSignature(bytes);
}

const isPublicKey = (bytes: Uint8Array | null): boolean =>
  bytes !== null &&
  ((bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) || (bytes.length === 65 && bytes[0] === 0x04));

/** The pushes of a scriptSig that is push-only, or null when it is not. */
function pushes(scriptSig: TransactionInput['scriptSig']): string[] | null {
  if (!scriptSig || scriptSig.hex === '') return [];
  const bytes = hexToBytes(scriptSig.hex);
  if (bytes === null) return null;
  const { tokens, truncated } = parseScript(bytes);
  if (truncated || tokens.some((token) => token.data === undefined)) return null;
  return tokens.map((token) => bytesToHex(token.data ?? new Uint8Array()));
}

function items(hexes: readonly string[], roles: (hex: string, index: number) => WitnessItem): WitnessItem[] {
  return hexes.map((hex, index) => roles(hex, index));
}

function dataOrSignature(hex: string, context: 'ecdsa' | 'schnorr'): WitnessItem {
  if (hex === '') return { hex, role: 'data' };
  const signature = signatureOf(hex, context);
  if (signature) return { hex, role: 'signature', signature };
  return { hex, role: isPublicKey(hexToBytes(hex)) ? 'public-key' : 'data' };
}

function withScript(analysis: ScriptAnalysis | null, role: 'redeem' | 'witness' | 'tapscript') {
  return analysis ? { ...analysis, role } : null;
}

/** BIP 341: an annex is a last witness item starting with 0x50, when there are at least two. */
function splitAnnex(witness: readonly string[]): { stack: string[]; annex: string | null } {
  const last = witness[witness.length - 1];
  if (witness.length >= 2 && last?.toLowerCase().startsWith(TAPROOT_ANNEX_TAG.toString(16))) {
    return { stack: witness.slice(0, -1), annex: last };
  }
  return { stack: [...witness], annex: null };
}

function controlBlock(hex: string): { leafVersion: number; internalKey: string; depth: number } | null {
  const bytes = hexToBytes(hex);
  if (bytes === null || bytes.length < TAPROOT_CONTROL_BASE) return null;
  const rest = bytes.length - TAPROOT_CONTROL_BASE;
  if (rest % TAPROOT_CONTROL_NODE !== 0 || rest / TAPROOT_CONTROL_NODE > TAPROOT_CONTROL_MAX_DEPTH) return null;
  return {
    leafVersion: (bytes[0] ?? 0) & 0xfe,
    internalKey: bytesToHex(bytes.subarray(1, TAPROOT_CONTROL_BASE)),
    depth: rest / TAPROOT_CONTROL_NODE,
  };
}

/** Taproot's key or script path. Judged from the shape alone, only tapscript's leaf version is taken as a script path. */
function taprootInput(
  witness: readonly string[],
  fromShapeOnly = false,
): Pick<InputAnalysis, 'spends' | 'script' | 'taproot' | 'witness'> | null {
  const { stack, annex } = splitAnnex(witness);
  if (stack.length === 1) {
    const [signature] = stack;
    const info = signature === undefined ? null : signatureOf(signature, 'schnorr');
    if (!info) return null;
    return {
      spends: 'p2tr-key',
      script: null,
      taproot: { annex, leafVersion: null, internalKey: null, depth: null },
      witness: [
        { hex: signature ?? '', role: 'signature', signature: info },
        ...(annex ? [{ hex: annex, role: 'annex' as const }] : []),
      ],
    };
  }
  if (stack.length < 2) return null;
  const control = controlBlock(stack[stack.length - 1] ?? '');
  const script = stack[stack.length - 2] ?? '';
  if (!control || (fromShapeOnly && control.leafVersion !== TAPSCRIPT_LEAF_VERSION)) return null;
  return {
    spends: 'p2tr-script',
    script: withScript(analyseScript(script), 'tapscript'),
    taproot: { annex, ...control },
    witness: [
      ...items(stack.slice(0, -2), (hex) => dataOrSignature(hex, 'schnorr')),
      { hex: script, role: 'script' },
      { hex: stack[stack.length - 1] ?? '', role: 'control-block' },
      ...(annex ? [{ hex: annex, role: 'annex' as const }] : []),
    ],
  };
}

function scriptHashWitness(witness: readonly string[]): Pick<InputAnalysis, 'script' | 'witness'> {
  const script = witness[witness.length - 1] ?? '';
  return {
    script: withScript(analyseScript(script), 'witness'),
    witness: [...items(witness.slice(0, -1), (hex) => dataOrSignature(hex, 'ecdsa')), { hex: script, role: 'script' }],
  };
}

const NESTED_P2WPKH = /^0014[0-9a-f]{40}$/i;
const NESTED_P2WSH = /^0020[0-9a-f]{64}$/i;

/** What the input spends, from the type of the coin's script when the node knows it. */
function fromCoin(
  input: TransactionInput,
  type: string,
): Pick<InputAnalysis, 'spends' | 'script' | 'taproot' | 'witness'> {
  const witness = input.witness;
  const sigPushes = pushes(input.scriptSig) ?? [];
  switch (type) {
    case 'witness_v0_keyhash':
      return {
        spends: 'p2wpkh',
        script: null,
        taproot: null,
        witness: items(witness, (hex) => dataOrSignature(hex, 'ecdsa')),
      };
    case 'witness_v0_scripthash':
      return { spends: 'p2wsh', taproot: null, ...scriptHashWitness(witness) };
    case 'witness_v1_taproot':
      return (
        taprootInput(witness) ?? {
          spends: 'unknown',
          script: null,
          taproot: null,
          witness: items(witness, (hex) => ({ hex, role: 'data' })),
        }
      );
    case 'scripthash': {
      const redeem = sigPushes[sigPushes.length - 1] ?? '';
      if (NESTED_P2WPKH.test(redeem)) {
        return {
          spends: 'p2sh-p2wpkh',
          script: null,
          taproot: null,
          witness: items(witness, (hex) => dataOrSignature(hex, 'ecdsa')),
        };
      }
      if (NESTED_P2WSH.test(redeem)) return { spends: 'p2sh-p2wsh', taproot: null, ...scriptHashWitness(witness) };
      return { spends: 'p2sh', script: withScript(analyseScript(redeem), 'redeem'), taproot: null, witness: [] };
    }
    case 'pubkeyhash':
      return { spends: 'p2pkh', script: null, taproot: null, witness: [] };
    case 'pubkey':
      return { spends: 'p2pk', script: null, taproot: null, witness: [] };
    case 'multisig':
      return { spends: 'bare-multisig', script: null, taproot: null, witness: [] };
    case 'anchor':
      return { spends: 'anchor', script: null, taproot: null, witness: [] };
    default:
      return {
        spends: 'unknown',
        script: null,
        taproot: null,
        witness: items(witness, (hex) => ({ hex, role: 'data' })),
      };
  }
}

/** What the input most likely spends, from its shape alone. */
function fromShape(input: TransactionInput): Pick<InputAnalysis, 'spends' | 'script' | 'taproot' | 'witness'> {
  const witness = input.witness;
  const sigPushes = pushes(input.scriptSig);
  const unknown = {
    spends: 'unknown' as const,
    script: null,
    taproot: null,
    witness: items(witness, (hex) => ({ hex, role: 'data' as const })),
  };
  if (sigPushes === null) return unknown;
  if (sigPushes.length === 0 && witness.length > 0) {
    const [first, second] = witness;
    if (
      witness.length === 2 &&
      first !== undefined &&
      second !== undefined &&
      signatureOf(first, 'ecdsa') &&
      isPublicKey(hexToBytes(second))
    ) {
      return {
        spends: 'p2wpkh',
        script: null,
        taproot: null,
        witness: items(witness, (hex) => dataOrSignature(hex, 'ecdsa')),
      };
    }
    const taproot = taprootInput(witness, true);
    if (taproot) return taproot;
    if (witness.length >= 2) return { spends: 'p2wsh', taproot: null, ...scriptHashWitness(witness) };
    return unknown;
  }
  if (sigPushes.length === 1 && witness.length > 0) {
    const [redeem = ''] = sigPushes;
    if (NESTED_P2WPKH.test(redeem)) {
      return {
        spends: 'p2sh-p2wpkh',
        script: null,
        taproot: null,
        witness: items(witness, (hex) => dataOrSignature(hex, 'ecdsa')),
      };
    }
    if (NESTED_P2WSH.test(redeem)) return { spends: 'p2sh-p2wsh', taproot: null, ...scriptHashWitness(witness) };
  }
  if (witness.length === 0 && sigPushes.length === 2) {
    const [signature = '', key = ''] = sigPushes;
    if (signatureOf(signature, 'ecdsa') && isPublicKey(hexToBytes(key))) {
      return { spends: 'p2pkh', script: null, taproot: null, witness: [] };
    }
  }
  return unknown;
}

function scriptSigSignatures(input: TransactionInput): SignatureInfo[] {
  return (pushes(input.scriptSig) ?? []).flatMap((hex) => {
    const signature = signatureOf(hex, 'ecdsa');
    return signature ? [signature] : [];
  });
}

export function analyseInput(input: TransactionInput, index: number, version: number): InputAnalysis {
  const coinbase = input.coinbase !== undefined;
  const sequence = analyseSequence(input.sequence, version, coinbase);
  if (coinbase) {
    return {
      index,
      spends: 'coinbase',
      inferred: false,
      sequence,
      signatures: [],
      script: null,
      taproot: null,
      witness: [],
    };
  }
  const type = input.prevout?.script.type;
  const spend = type === undefined ? fromShape(input) : fromCoin(input, type);
  const signatures = [
    ...scriptSigSignatures(input),
    ...spend.witness.flatMap((item) => (item.signature ? [item.signature] : [])),
  ];
  return { index, inferred: type === undefined, sequence, signatures, ...spend };
}

/** Serialised size of an output: value, script length and script. */
function outputSize(scriptBytes: number): number {
  const lengthPrefix = scriptBytes < 0xfd ? 1 : scriptBytes <= 0xffff ? 3 : 5;
  return 8 + lengthPrefix + scriptBytes;
}

/** Bitcoin Core's dust limit at its default dust relay fee (policy/policy.cpp, GetDustThreshold). */
export function dustLimit(scriptHex: string): number | null {
  const bytes = hexToBytes(scriptHex);
  if (bytes === null) return null;
  // Unspendable outputs are never dust.
  if (bytes[0] === 0x6a) return null;
  const version = bytes[0] ?? 0xff;
  const programLength = bytes[1] ?? 0;
  const witnessProgram =
    bytes.length >= 4 &&
    bytes.length <= 42 &&
    (version === 0x00 || (version >= 0x51 && version <= 0x60)) &&
    programLength + 2 === bytes.length &&
    programLength >= 2 &&
    programLength <= 40;
  // Spending a witness output costs 67.75 virtual bytes, any other output 148 bytes.
  const spendSize = witnessProgram ? 32 + 4 + 1 + Math.floor(107 / 4) + 4 : 32 + 4 + 1 + 107 + 4;
  return (outputSize(bytes.length) + spendSize) * DUST_RELAY_FEE_SAT_PER_VB;
}

function printable(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Control characters other than spacing mean the data is not text.
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u0008\u000e-\u001f\u007f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

export function analyseOutput(output: TransactionOutput): OutputAnalysis {
  const bytes = hexToBytes(output.script.hex);
  if (bytes !== null && bytes[0] === 0x6a) {
    const data = parseScript(bytes.subarray(1)).tokens.flatMap((token) => (token.data ? [...token.data] : []));
    const joined = Uint8Array.from(data);
    return {
      n: output.n,
      dust: false,
      dustLimitSats: null,
      data: { hex: bytesToHex(joined), text: printable(joined) },
    };
  }
  const limit = dustLimit(output.script.hex);
  return { n: output.n, dust: limit !== null && output.valueSats < limit, dustLimitSats: limit, data: null };
}

/** Weight is base bytes counted four times and witness bytes once (BIP 141). */
export function analyseWeight(transaction: Pick<TransactionDetail, 'sizeBytes' | 'weight' | 'vsize'>): WeightAnalysis {
  const baseBytes = Math.round((transaction.weight - transaction.sizeBytes) / 3);
  return {
    baseBytes,
    witnessBytes: transaction.sizeBytes - baseBytes,
    weight: transaction.weight,
    vsize: transaction.vsize,
    savedVbytes: Math.max(0, transaction.sizeBytes - transaction.vsize),
  };
}

export function analyseTransaction(transaction: TransactionDetail): TransactionAnalysis {
  const inputs = transaction.inputs.map((input, index) => analyseInput(input, index, transaction.version));
  const replaceableInputs = inputs.filter((input) => input.sequence.signalsReplaceable).map((input) => input.index);
  return {
    lockTime: analyseLockTime(
      transaction.lockTime,
      transaction.inputs.map((input) => input.sequence),
    ),
    signalsReplaceable: replaceableInputs.length > 0,
    replaceableInputs,
    relativeLocks: inputs.some((input) => input.sequence.relative !== null),
    inputs,
    outputs: transaction.outputs.map(analyseOutput),
    weight: analyseWeight(transaction),
  };
}

const SIGHASH_NAMES: Record<number, string> = {
  0x00: 'SIGHASH_DEFAULT',
  0x01: 'SIGHASH_ALL',
  0x02: 'SIGHASH_NONE',
  0x03: 'SIGHASH_SINGLE',
  0x81: 'SIGHASH_ALL|ANYONECANPAY',
  0x82: 'SIGHASH_NONE|ANYONECANPAY',
  0x83: 'SIGHASH_SINGLE|ANYONECANPAY',
};

export function sighashName(sighash: number): string {
  return SIGHASH_NAMES[sighash] ?? `0x${sighash.toString(16).padStart(2, '0')}`;
}

/** Anything other than signing every input and output is worth a second look. */
export function unusualSighash(signature: SignatureInfo): boolean {
  return !(signature.sighash === 0x01 || (signature.kind === 'schnorr' && signature.sighash === 0x00));
}
