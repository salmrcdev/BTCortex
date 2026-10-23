// Bitcoin Script read for display (specification section 14): opcodes with
// their pushes, script numbers, and the patterns worth naming — m-of-n
// multisig in its legacy and its tapscript form (BIP 387 multi_a), and the
// timelocks of OP_CHECKLOCKTIMEVERIFY and OP_CHECKSEQUENCEVERIFY. Nothing here
// validates or runs a script; that stays with the node.

export interface ScriptToken {
  opcode: number;
  /** The bytes pushed, for OP_0 and the push operations. */
  data?: Uint8Array;
}

export interface ParsedScript {
  tokens: ScriptToken[];
  /** A push ran past the end of the script. */
  truncated: boolean;
}

export interface Multisig {
  required: number;
  keys: string[];
  /** OP_CHECKMULTISIG, or tapscript's OP_CHECKSIGADD chain. */
  form: 'checkmultisig' | 'checksigadd';
}

export type ScriptTimelock =
  | { kind: 'absolute-height'; height: number }
  | { kind: 'absolute-time'; time: number }
  | { kind: 'relative-blocks'; blocks: number }
  | { kind: 'relative-time'; seconds: number };

export interface ScriptAnalysis {
  hex: string;
  asm: string;
  multisig: Multisig | null;
  timelocks: ScriptTimelock[];
  truncated: boolean;
}

/** Below this, a lock time is a block height; from it, a Unix time. */
export const LOCKTIME_THRESHOLD = 500_000_000;
/** BIP 68: relative lock times count units of 512 seconds when this flag is set. */
const SEQUENCE_TYPE_FLAG_BIT = 22;
/** BIP 68: a sequence with this bit set has no relative lock time. */
const SEQUENCE_DISABLE_FLAG_BIT = 31;
const SEQUENCE_VALUE_MASK = 0xffff;
const SEQUENCE_GRANULARITY_SECONDS = 512;

const OP_0 = 0x00;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;
const OP_1NEGATE = 0x4f;
const OP_1 = 0x51;
const OP_16 = 0x60;
const OP_NUMEQUAL = 0x9c;
const OP_NUMEQUALVERIFY = 0x9d;
const OP_CHECKSIG = 0xac;
const OP_CHECKMULTISIG = 0xae;
const OP_CHECKMULTISIGVERIFY = 0xaf;
const OP_CHECKLOCKTIMEVERIFY = 0xb1;
const OP_CHECKSEQUENCEVERIFY = 0xb2;
const OP_CHECKSIGADD = 0xba;

const NAMES: Record<number, string> = {
  0x00: 'OP_0',
  0x4c: 'OP_PUSHDATA1',
  0x4d: 'OP_PUSHDATA2',
  0x4e: 'OP_PUSHDATA4',
  0x4f: 'OP_1NEGATE',
  0x50: 'OP_RESERVED',
  0x61: 'OP_NOP',
  0x62: 'OP_VER',
  0x63: 'OP_IF',
  0x64: 'OP_NOTIF',
  0x65: 'OP_VERIF',
  0x66: 'OP_VERNOTIF',
  0x67: 'OP_ELSE',
  0x68: 'OP_ENDIF',
  0x69: 'OP_VERIFY',
  0x6a: 'OP_RETURN',
  0x6b: 'OP_TOALTSTACK',
  0x6c: 'OP_FROMALTSTACK',
  0x6d: 'OP_2DROP',
  0x6e: 'OP_2DUP',
  0x6f: 'OP_3DUP',
  0x70: 'OP_2OVER',
  0x71: 'OP_2ROT',
  0x72: 'OP_2SWAP',
  0x73: 'OP_IFDUP',
  0x74: 'OP_DEPTH',
  0x75: 'OP_DROP',
  0x76: 'OP_DUP',
  0x77: 'OP_NIP',
  0x78: 'OP_OVER',
  0x79: 'OP_PICK',
  0x7a: 'OP_ROLL',
  0x7b: 'OP_ROT',
  0x7c: 'OP_SWAP',
  0x7d: 'OP_TUCK',
  0x7e: 'OP_CAT',
  0x7f: 'OP_SUBSTR',
  0x80: 'OP_LEFT',
  0x81: 'OP_RIGHT',
  0x82: 'OP_SIZE',
  0x83: 'OP_INVERT',
  0x84: 'OP_AND',
  0x85: 'OP_OR',
  0x86: 'OP_XOR',
  0x87: 'OP_EQUAL',
  0x88: 'OP_EQUALVERIFY',
  0x89: 'OP_RESERVED1',
  0x8a: 'OP_RESERVED2',
  0x8b: 'OP_1ADD',
  0x8c: 'OP_1SUB',
  0x8d: 'OP_2MUL',
  0x8e: 'OP_2DIV',
  0x8f: 'OP_NEGATE',
  0x90: 'OP_ABS',
  0x91: 'OP_NOT',
  0x92: 'OP_0NOTEQUAL',
  0x93: 'OP_ADD',
  0x94: 'OP_SUB',
  0x95: 'OP_MUL',
  0x96: 'OP_DIV',
  0x97: 'OP_MOD',
  0x98: 'OP_LSHIFT',
  0x99: 'OP_RSHIFT',
  0x9a: 'OP_BOOLAND',
  0x9b: 'OP_BOOLOR',
  0x9c: 'OP_NUMEQUAL',
  0x9d: 'OP_NUMEQUALVERIFY',
  0x9e: 'OP_NUMNOTEQUAL',
  0x9f: 'OP_LESSTHAN',
  0xa0: 'OP_GREATERTHAN',
  0xa1: 'OP_LESSTHANOREQUAL',
  0xa2: 'OP_GREATERTHANOREQUAL',
  0xa3: 'OP_MIN',
  0xa4: 'OP_MAX',
  0xa5: 'OP_WITHIN',
  0xa6: 'OP_RIPEMD160',
  0xa7: 'OP_SHA1',
  0xa8: 'OP_SHA256',
  0xa9: 'OP_HASH160',
  0xaa: 'OP_HASH256',
  0xab: 'OP_CODESEPARATOR',
  0xac: 'OP_CHECKSIG',
  0xad: 'OP_CHECKSIGVERIFY',
  0xae: 'OP_CHECKMULTISIG',
  0xaf: 'OP_CHECKMULTISIGVERIFY',
  0xb0: 'OP_NOP1',
  0xb1: 'OP_CHECKLOCKTIMEVERIFY',
  0xb2: 'OP_CHECKSEQUENCEVERIFY',
  0xb3: 'OP_NOP4',
  0xb4: 'OP_NOP5',
  0xb5: 'OP_NOP6',
  0xb6: 'OP_NOP7',
  0xb7: 'OP_NOP8',
  0xb8: 'OP_NOP9',
  0xb9: 'OP_NOP10',
  0xba: 'OP_CHECKSIGADD',
  0xff: 'OP_INVALIDOPCODE',
};

export function hexToBytes(hex: string): Uint8Array | null {
  const text = hex.trim();
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function opcodeName(opcode: number): string {
  if (opcode >= OP_1 && opcode <= OP_16) return `OP_${String(opcode - 0x50)}`;
  return NAMES[opcode] ?? `OP_UNKNOWN_0x${opcode.toString(16).padStart(2, '0')}`;
}

export function parseScript(bytes: Uint8Array): ParsedScript {
  const tokens: ScriptToken[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const opcode = bytes[offset] ?? 0;
    offset += 1;
    let length: number | null = null;
    if (opcode === OP_0) length = 0;
    else if (opcode < OP_PUSHDATA1) length = opcode;
    else if (opcode <= OP_PUSHDATA4) {
      const width = opcode === OP_PUSHDATA1 ? 1 : opcode === OP_PUSHDATA2 ? 2 : 4;
      if (offset + width > bytes.length) return { tokens, truncated: true };
      length = 0;
      for (let index = 0; index < width; index += 1) length += (bytes[offset + index] ?? 0) * 2 ** (8 * index);
      offset += width;
    }
    if (length === null) {
      tokens.push({ opcode });
      continue;
    }
    if (offset + length > bytes.length) return { tokens, truncated: true };
    tokens.push({ opcode, data: bytes.subarray(offset, offset + length) });
    offset += length;
  }
  return { tokens, truncated: false };
}

export function disassemble(tokens: readonly ScriptToken[]): string {
  return tokens
    .map((token) =>
      token.data === undefined || token.opcode === OP_0 ? opcodeName(token.opcode) : bytesToHex(token.data),
    )
    .join(' ');
}

/** A script number: OP_0, OP_1NEGATE, OP_1 to OP_16, or a push of at most five bytes (little-endian, sign in the top bit). */
export function scriptNumber(token: ScriptToken | undefined): number | null {
  if (!token) return null;
  if (token.opcode === OP_1NEGATE) return -1;
  if (token.opcode >= OP_1 && token.opcode <= OP_16) return token.opcode - 0x50;
  const data = token.data;
  if (data === undefined || data.length > 5) return null;
  if (data.length === 0) return 0;
  let value = 0;
  data.forEach((byte, index) => {
    value += byte * 2 ** (8 * index);
  });
  const top = 2 ** (8 * data.length - 1);
  return value >= top ? -(value - top) : value;
}

const isKey = (
  token: ScriptToken | undefined,
  lengths: readonly number[],
): token is ScriptToken & { data: Uint8Array } =>
  token?.data !== undefined && token.opcode !== OP_0 && lengths.includes(token.data.length);

function legacyMultisig(tokens: readonly ScriptToken[]): Multisig | null {
  for (let start = 0; start < tokens.length; start += 1) {
    const required = scriptNumber(tokens[start]);
    if (required === null || required < 1 || tokens[start]?.data !== undefined) continue;
    const keys: string[] = [];
    let index = start + 1;
    while (isKey(tokens[index], [33, 65])) {
      keys.push(bytesToHex((tokens[index] as ScriptToken & { data: Uint8Array }).data));
      index += 1;
    }
    const count = scriptNumber(tokens[index]);
    const check = tokens[index + 1]?.opcode;
    if (
      keys.length > 0 &&
      count === keys.length &&
      required <= count &&
      (check === OP_CHECKMULTISIG || check === OP_CHECKMULTISIGVERIFY)
    ) {
      return { required, keys, form: 'checkmultisig' };
    }
  }
  return null;
}

function tapscriptMultisig(tokens: readonly ScriptToken[]): Multisig | null {
  for (let start = 0; start < tokens.length; start += 1) {
    if (!isKey(tokens[start], [32]) || tokens[start + 1]?.opcode !== OP_CHECKSIG) continue;
    const keys = [bytesToHex((tokens[start] as ScriptToken & { data: Uint8Array }).data)];
    let index = start + 2;
    while (isKey(tokens[index], [32]) && tokens[index + 1]?.opcode === OP_CHECKSIGADD) {
      keys.push(bytesToHex((tokens[index] as ScriptToken & { data: Uint8Array }).data));
      index += 2;
    }
    const required = scriptNumber(tokens[index]);
    const check = tokens[index + 1]?.opcode;
    if (
      keys.length > 1 &&
      required !== null &&
      required >= 1 &&
      required <= keys.length &&
      (check === OP_NUMEQUAL || check === OP_NUMEQUALVERIFY)
    ) {
      return { required, keys, form: 'checksigadd' };
    }
  }
  return null;
}

export function findMultisig(tokens: readonly ScriptToken[]): Multisig | null {
  return legacyMultisig(tokens) ?? tapscriptMultisig(tokens);
}

/** What a BIP 68 relative lock of this value means; null when the value disables it. */
export function relativeLock(
  value: number,
): Extract<ScriptTimelock, { kind: 'relative-blocks' | 'relative-time' }> | null {
  if ((value >>> SEQUENCE_DISABLE_FLAG_BIT) & 1) return null;
  const units = value & SEQUENCE_VALUE_MASK;
  return (value >>> SEQUENCE_TYPE_FLAG_BIT) & 1
    ? { kind: 'relative-time', seconds: units * SEQUENCE_GRANULARITY_SECONDS }
    : { kind: 'relative-blocks', blocks: units };
}

export function findTimelocks(tokens: readonly ScriptToken[]): ScriptTimelock[] {
  const found: ScriptTimelock[] = [];
  tokens.forEach((token, index) => {
    if (token.opcode !== OP_CHECKLOCKTIMEVERIFY && token.opcode !== OP_CHECKSEQUENCEVERIFY) return;
    const value = scriptNumber(tokens[index - 1]);
    if (value === null || value < 0) return;
    if (token.opcode === OP_CHECKLOCKTIMEVERIFY) {
      found.push(
        value < LOCKTIME_THRESHOLD
          ? { kind: 'absolute-height', height: value }
          : { kind: 'absolute-time', time: value },
      );
      return;
    }
    const relative = relativeLock(value);
    if (relative) found.push(relative);
  });
  return found;
}

export function analyseScript(hex: string): ScriptAnalysis | null {
  const bytes = hexToBytes(hex);
  if (bytes === null) return null;
  const { tokens, truncated } = parseScript(bytes);
  return {
    hex: hex.toLowerCase(),
    asm: disassemble(tokens) + (truncated ? ' [truncated]' : ''),
    multisig: findMultisig(tokens),
    timelocks: findTimelocks(tokens),
    truncated,
  };
}
