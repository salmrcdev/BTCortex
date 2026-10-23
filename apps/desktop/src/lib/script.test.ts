import { describe, expect, it } from 'vitest';
import { analyseScript, hexToBytes, opcodeName, parseScript, relativeLock, scriptNumber } from './script';

const KEY_A = `02${'aa'.repeat(32)}`;
const KEY_B = `03${'bb'.repeat(32)}`;
const KEY_C = `02${'cc'.repeat(32)}`;
const X_A = 'aa'.repeat(32);
const X_B = 'bb'.repeat(32);
const X_C = 'cc'.repeat(32);

describe('reading scripts', () => {
  it('names a legacy 2-of-3 multisig and disassembles it', () => {
    const script = analyseScript(`5221${KEY_A}21${KEY_B}21${KEY_C}53ae`);
    expect(script?.multisig).toEqual({ required: 2, keys: [KEY_A, KEY_B, KEY_C], form: 'checkmultisig' });
    expect(script?.asm).toBe(`OP_2 ${KEY_A} ${KEY_B} ${KEY_C} OP_3 OP_CHECKMULTISIG`);
  });

  it('names a tapscript multi_a (BIP 387) 2-of-3', () => {
    const script = analyseScript(`20${X_A}ac20${X_B}ba20${X_C}ba529c`);
    expect(script?.multisig).toEqual({ required: 2, keys: [X_A, X_B, X_C], form: 'checksigadd' });
  });

  it('does not take a key-hash check for a multisig', () => {
    expect(analyseScript(`76a914${'11'.repeat(20)}88ac`)?.multisig).toBeNull();
  });

  it('reads the timelocks of OP_CHECKLOCKTIMEVERIFY and OP_CHECKSEQUENCEVERIFY', () => {
    // 100 000 blocks, 1 700 000 000 seconds, 144 blocks, 10 × 512 seconds, and a disabled relative lock.
    const script = analyseScript(
      ['03a08601b175', '0400f15365b175', '029000b275', '040a004000b275', '050000008000b2'].join(''),
    );
    expect(script?.timelocks).toEqual([
      { kind: 'absolute-height', height: 100_000 },
      { kind: 'absolute-time', time: 1_700_000_000 },
      { kind: 'relative-blocks', blocks: 144 },
      { kind: 'relative-time', seconds: 5120 },
    ]);
  });

  it('reads script numbers, including small and negative ones', () => {
    expect(scriptNumber({ opcode: 0x00, data: new Uint8Array() })).toBe(0);
    expect(scriptNumber({ opcode: 0x4f })).toBe(-1);
    expect(scriptNumber({ opcode: 0x60 })).toBe(16);
    expect(scriptNumber({ opcode: 0x01, data: Uint8Array.of(0x81) })).toBe(-1);
    expect(scriptNumber({ opcode: 0x02, data: Uint8Array.of(0xff, 0x00) })).toBe(255);
    expect(scriptNumber({ opcode: 0x06, data: new Uint8Array(6) })).toBeNull();
  });

  it('handles every push form and says when a push runs past the end', () => {
    const bytes = hexToBytes('4c02aabb4d0300010203');
    expect(bytes).not.toBeNull();
    const parsed = parseScript(bytes ?? new Uint8Array());
    expect(parsed.truncated).toBe(false);
    expect(parsed.tokens.map((token) => token.data?.length)).toEqual([2, 3]);
    expect(analyseScript('4c05aabb')).toMatchObject({ truncated: true, asm: ' [truncated]' });
    expect(hexToBytes('abc')).toBeNull();
    expect(hexToBytes('zz')).toBeNull();
  });

  it('names opcodes, unknown ones by value', () => {
    expect(opcodeName(0x60)).toBe('OP_16');
    expect(opcodeName(0xba)).toBe('OP_CHECKSIGADD');
    expect(opcodeName(0xbb)).toBe('OP_UNKNOWN_0xbb');
  });

  it('reads BIP 68 relative locks', () => {
    expect(relativeLock(144)).toEqual({ kind: 'relative-blocks', blocks: 144 });
    expect(relativeLock(0x00400001)).toEqual({ kind: 'relative-time', seconds: 512 });
    expect(relativeLock(0xfffffffd)).toBeNull();
  });
});
