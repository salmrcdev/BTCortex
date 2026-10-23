import { describe, expect, it } from 'vitest';
import type { NodeWithStatus, PsbtAnalysis, TrackedTransaction } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { addressType, TransactionToolsService } from './transaction-tools';

const logger = new StructuredLogger([new MemorySink()], 'debug');
const ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const PROGRAM = '751e76e8199196d454941c45d1b3a323f1433bd6';

const PSBT_A = `cHNidP8BAH${'A'.repeat(40)}`;
const PSBT_B = `cHNidP8BAH${'B'.repeat(40)}`;
const COMBINED = `cHNidP8BAH${'C'.repeat(40)}`;
const TXID = 'ab'.repeat(32);
const TRACKED: TrackedTransaction = {
  nodeId: 'n1',
  txid: TXID,
  addedAt: '2026-10-23T12:00:00.000Z',
  state: 'mempool',
  confirmations: 0,
  blockHash: null,
  blockHeight: null,
  checkedAt: '2026-10-23T12:00:00.000Z',
};

function service(answers: Record<string, unknown>) {
  const node = {
    profile: { id: 'n1', name: 'Regtest node', network: 'regtest', implementation: 'bitcoin-core' },
  } as unknown as NodeWithStatus;
  const calls: { method: string; params: unknown[] }[] = [];
  const followed: string[] = [];
  const tools = new TransactionToolsService({
    nodes: {
      get: () => node,
      rpc: () => ({
        call: <T>(method: string, params: unknown[]) => {
          calls.push({ method, params });
          switch (method) {
            case 'combinepsbt':
              return Promise.resolve(COMBINED as T);
            case 'finalizepsbt':
              return Promise.resolve(
                (params[0] === COMBINED
                  ? { hex: '0200000001', complete: true }
                  : { psbt: params[0], complete: false }) as T,
              );
            case 'sendrawtransaction':
              return Promise.resolve(TXID as T);
          }
          const address = typeof params[0] === 'string' ? params[0] : '';
          return Promise.resolve(
            (answers[address] ?? {
              isvalid: false,
              error: 'Invalid or unsupported Segwit (Bech32) or Base58 encoding.',
            }) as T,
          );
        },
      }),
    },
    analysePsbt: (_nodeId, psbt) =>
      Promise.resolve({ txid: null, next: 'finalizer', raw: psbt } as unknown as PsbtAnalysis),
    tracker: {
      add: (_nodeId, txid) => {
        followed.push(txid);
        return Promise.resolve([TRACKED]);
      },
      remove: () => [],
      list: () => [TRACKED],
    },
    logger,
  });
  return { tools, calls, followed };
}

const VALID = {
  isvalid: true,
  address: ADDRESS,
  scriptPubKey: `0014${PROGRAM}`,
  isscript: false,
  iswitness: true,
  witness_version: 0,
  witness_program: PROGRAM,
};

describe('addresses and payment URIs with the node', () => {
  it('names output scripts by their templates', () => {
    expect(addressType(`76a914${'00'.repeat(20)}88ac`)).toBe('p2pkh');
    expect(addressType(`a914${'00'.repeat(20)}87`)).toBe('p2sh');
    expect(addressType(`0014${'00'.repeat(20)}`)).toBe('p2wpkh');
    expect(addressType(`0020${'00'.repeat(32)}`)).toBe('p2wsh');
    expect(addressType(`5120${'00'.repeat(32)}`)).toBe('p2tr');
    expect(addressType('51024e73')).toBe('p2a');
    expect(addressType(`5220${'00'.repeat(32)}`)).toBe('witness-unknown');
    expect(addressType('6a00')).toBe('unknown');
  });

  it('reports what the node says of an address, valid or not', async () => {
    const { tools } = service({
      [ADDRESS]: VALID,
      bcrt1qbroken: { isvalid: false, error: 'Invalid checksum', error_locations: [7, 12] },
    });
    expect(await tools.address('n1', ` ${ADDRESS} `)).toEqual({
      address: ADDRESS,
      valid: true,
      error: null,
      errorLocations: [],
      type: 'p2wpkh',
      scriptPubKey: `0014${PROGRAM}`,
      witnessVersion: 0,
      witnessProgram: PROGRAM,
    });
    expect(await tools.address('n1', 'bcrt1qbroken')).toMatchObject({
      valid: false,
      error: 'Invalid checksum',
      errorLocations: [7, 12],
      type: null,
    });
  });

  it('makes a URI and its QR code only for an address the node accepts', async () => {
    const { tools } = service({ [ADDRESS]: VALID });
    const made = await tools.createUri({ nodeId: 'n1', address: ADDRESS, amountSats: 25_000, label: ' Rent ' });
    expect(made.uri).toBe(`bitcoin:${ADDRESS}?amount=0.00025&label=Rent`);
    expect(made.qr.size).toBeGreaterThan(20);
    expect(made.qr.rows).toHaveLength(made.qr.size);
    await expect(
      tools.createUri({ nodeId: 'n1', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }),
    ).rejects.toMatchObject({ error: { code: 'devtools.invalid-address' } });
  });

  it('reads a URI and checks its address, but checks nothing when there is none', async () => {
    const { tools, calls } = service({ [ADDRESS]: VALID });
    expect(await tools.readUri('n1', `bitcoin:${ADDRESS}?amount=1`)).toMatchObject({
      problems: [],
      amountSats: 100_000_000,
      addressCheck: { valid: true, type: 'p2wpkh' },
    });
    expect(await tools.readUri('n1', 'bitcoin:?lno=lno1example')).toMatchObject({ addressCheck: null, problems: [] });
    expect(calls).toHaveLength(1);
  });
});

describe('PSBTs and sending', () => {
  it('combines PSBTs with the node and analyses the result, refusing what is not a PSBT', async () => {
    const { tools, calls } = service({});
    const combined = await tools.combinePsbts('n1', [PSBT_A, PSBT_B]);
    expect(combined).toMatchObject({ psbt: COMBINED, analysis: { next: 'finalizer' } });
    expect(calls).toEqual([{ method: 'combinepsbt', params: [[PSBT_A, PSBT_B]] }]);
    await expect(tools.combinePsbts('n1', [PSBT_A, 'not a psbt'])).rejects.toMatchObject({
      error: { code: 'devtools.not-a-psbt' },
    });
  });

  it('gives the transaction only once every input is final', async () => {
    const { tools } = service({});
    expect(await tools.finalisePsbt('n1', COMBINED)).toEqual({ complete: true, psbt: null, hex: '0200000001' });
    expect(await tools.finalisePsbt('n1', PSBT_A)).toEqual({ complete: false, psbt: PSBT_A, hex: null });
  });

  it('sends a confirmed transaction and follows it at once', async () => {
    const { tools, calls, followed } = service({});
    expect(await tools.broadcast('n1', 'AABB'.repeat(40))).toEqual({ txid: TXID, tracked: TRACKED });
    expect(calls).toEqual([{ method: 'sendrawtransaction', params: ['aabb'.repeat(40)] }]);
    expect(followed).toEqual([TXID]);
  });
});
