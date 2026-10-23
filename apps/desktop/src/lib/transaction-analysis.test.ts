import { describe, expect, it } from 'vitest';
import type { TransactionDetail, TransactionInput, TransactionOutput } from '@btcortex/contracts';
import {
  analyseInput,
  analyseLockTime,
  analyseOutput,
  analyseSequence,
  analyseTransaction,
  analyseWeight,
  dustLimit,
  sighashName,
  unusualSighash,
} from './transaction-analysis';

/** A DER signature with 32-byte r and s, followed by its sighash type. */
const der = (sighash = '01') => `30440220${'11'.repeat(32)}0220${'22'.repeat(32)}${sighash}`;
const PUBKEY = `02${'ab'.repeat(32)}`;
const SCHNORR = 'cd'.repeat(64);
const MULTISIG = `522102${'aa'.repeat(32)}2103${'bb'.repeat(32)}2102${'cc'.repeat(32)}53ae`;
const TAPSCRIPT = `20${'ee'.repeat(32)}ac`;
const CONTROL = `c1${'99'.repeat(32)}${'88'.repeat(32)}`;

const coin = (type: string): NonNullable<TransactionInput['prevout']> => ({
  valueSats: 10_000,
  script: { hex: '', asm: '', type },
  coinbase: false,
});

const input = (change: Partial<TransactionInput>): TransactionInput => ({
  previous: { txid: 'ab'.repeat(32), vout: 0 },
  sequence: 0xffffffff,
  witness: [],
  ...change,
});

const output = (hex: string, valueSats: number): TransactionOutput => ({
  n: 0,
  valueSats,
  script: { hex, asm: '', type: 'unknown' },
  unspent: null,
});

describe('lock times and sequences', () => {
  it('binds the lock time only when an input is not final', () => {
    expect(analyseLockTime(0, [0xfffffffd])).toEqual({ kind: 'none' });
    expect(analyseLockTime(850_000, [0xffffffff])).toEqual({ kind: 'height', height: 850_000, enforced: false });
    expect(analyseLockTime(850_000, [0xffffffff, 0xfffffffe])).toEqual({
      kind: 'height',
      height: 850_000,
      enforced: true,
    });
    expect(analyseLockTime(1_700_000_000, [0])).toEqual({ kind: 'time', time: 1_700_000_000, enforced: true });
  });

  it('reads each sequence for BIP 125 signalling and BIP 68 relative locks', () => {
    expect(analyseSequence(0xffffffff, 2)).toMatchObject({ final: true, signalsReplaceable: false, relative: null });
    expect(analyseSequence(0xfffffffe, 2)).toMatchObject({ final: false, signalsReplaceable: false, relative: null });
    expect(analyseSequence(0xfffffffd, 2)).toMatchObject({
      hex: '0xfffffffd',
      signalsReplaceable: true,
      relative: null,
    });
    expect(analyseSequence(144, 2).relative).toEqual({ kind: 'relative-blocks', blocks: 144 });
    expect(analyseSequence(0x00400002, 2).relative).toEqual({ kind: 'relative-time', seconds: 1024 });
    // Relative locks need version 2, and a coinbase input has none.
    expect(analyseSequence(144, 1).relative).toBeNull();
    expect(analyseSequence(0, 2, true)).toMatchObject({ signalsReplaceable: false, relative: null });
  });
});

describe('what each input spends', () => {
  it('reads a P2WPKH spend from the coin it spends', () => {
    const analysis = analyseInput(
      input({ witness: [der(), PUBKEY], prevout: coin('witness_v0_keyhash'), sequence: 0xfffffffd }),
      0,
      2,
    );
    expect(analysis).toMatchObject({ spends: 'p2wpkh', inferred: false, signatures: [{ kind: 'ecdsa', sighash: 1 }] });
    expect(analysis.witness.map((item) => item.role)).toEqual(['signature', 'public-key']);
  });

  it('recognises a Taproot key-path spend from its shape when the coin is unknown', () => {
    const analysis = analyseInput(input({ witness: [SCHNORR] }), 1, 2);
    expect(analysis).toMatchObject({
      spends: 'p2tr-key',
      inferred: true,
      signatures: [{ kind: 'schnorr', sighash: 0 }],
    });
  });

  it('reads a Taproot script-path spend: annex, control block, tapscript and an unusual sighash', () => {
    const analysis = analyseInput(
      input({ witness: [`${SCHNORR}83`, TAPSCRIPT, CONTROL, '50ee'], prevout: coin('witness_v1_taproot') }),
      0,
      2,
    );
    expect(analysis.spends).toBe('p2tr-script');
    expect(analysis.taproot).toEqual({ annex: '50ee', leafVersion: 0xc0, internalKey: '99'.repeat(32), depth: 1 });
    expect(analysis.script).toMatchObject({ role: 'tapscript', asm: `${'ee'.repeat(32)} OP_CHECKSIG` });
    expect(analysis.witness.map((item) => item.role)).toEqual(['signature', 'script', 'control-block', 'annex']);
    const [signature] = analysis.signatures;
    expect(signature && sighashName(signature.sighash)).toBe('SIGHASH_SINGLE|ANYONECANPAY');
    expect(signature && unusualSighash(signature)).toBe(true);
  });

  it('reads a nested P2SH-P2WSH 2-of-3 multisig', () => {
    const analysis = analyseInput(
      input({
        scriptSig: { hex: `220020${'77'.repeat(32)}`, asm: '' },
        witness: ['', der(), der(), MULTISIG],
        prevout: coin('scripthash'),
      }),
      0,
      2,
    );
    expect(analysis.spends).toBe('p2sh-p2wsh');
    expect(analysis.script?.role).toBe('witness');
    expect(analysis.script?.multisig).toMatchObject({ required: 2, form: 'checkmultisig' });
    expect(analysis.signatures).toHaveLength(2);
  });

  it('tells P2PKH and P2WSH apart by their shape, and never reads a P2WSH script as a control block', () => {
    expect(analyseInput(input({ scriptSig: { hex: `47${der()}21${PUBKEY}`, asm: '' } }), 0, 2)).toMatchObject({
      spends: 'p2pkh',
      inferred: true,
    });
    const wsh = analyseInput(input({ witness: ['', der(), MULTISIG] }), 0, 2);
    expect(wsh).toMatchObject({ spends: 'p2wsh', inferred: true });
    expect(wsh.script?.multisig?.keys).toHaveLength(3);
  });

  it('says nothing more of a coinbase input than that it is one', () => {
    expect(analyseInput({ coinbase: '0101', sequence: 0xffffffff, witness: [] }, 0, 2)).toMatchObject({
      spends: 'coinbase',
      signatures: [],
    });
  });
});

describe('outputs and weight', () => {
  it('uses Bitcoin Core’s dust limits at its default dust relay fee', () => {
    expect(dustLimit(`0014${'00'.repeat(20)}`)).toBe(294);
    expect(dustLimit(`5120${'00'.repeat(32)}`)).toBe(330);
    expect(dustLimit(`0020${'00'.repeat(32)}`)).toBe(330);
    expect(dustLimit(`76a914${'00'.repeat(20)}88ac`)).toBe(546);
    expect(dustLimit(`a914${'00'.repeat(20)}87`)).toBe(540);
    expect(dustLimit('51024e73')).toBe(240);
    expect(analyseOutput(output(`0014${'00'.repeat(20)}`, 293)).dust).toBe(true);
    expect(analyseOutput(output(`0014${'00'.repeat(20)}`, 294)).dust).toBe(false);
  });

  it('shows the data of an OP_RETURN output, as text when it is text', () => {
    expect(analyseOutput(output('6a0b68656c6c6f20776f726c64', 0))).toMatchObject({
      dust: false,
      data: { hex: '68656c6c6f20776f726c64', text: 'hello world' },
    });
    expect(analyseOutput(output('6a04deadbeef', 0)).data).toEqual({ hex: 'deadbeef', text: null });
  });

  it('splits the size into base and witness bytes and the discount', () => {
    expect(analyseWeight({ sizeBytes: 222, weight: 561, vsize: 141 })).toEqual({
      baseBytes: 113,
      witnessBytes: 109,
      weight: 561,
      vsize: 141,
      savedVbytes: 81,
    });
  });

  it('sums up a transaction', () => {
    const transaction = {
      version: 2,
      lockTime: 850_000,
      sizeBytes: 222,
      weight: 561,
      vsize: 141,
      inputs: [
        input({ witness: [der(), PUBKEY], prevout: coin('witness_v0_keyhash'), sequence: 0xfffffffd }),
        input({ witness: [SCHNORR], sequence: 0xfffffffe }),
      ],
      outputs: [output(`0014${'00'.repeat(20)}`, 1000)],
    } as unknown as TransactionDetail;
    expect(analyseTransaction(transaction)).toMatchObject({
      lockTime: { kind: 'height', height: 850_000, enforced: true },
      signalsReplaceable: true,
      replaceableInputs: [0],
      relativeLocks: false,
    });
  });
});
