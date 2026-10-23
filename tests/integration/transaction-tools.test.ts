import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { NodeConfigDocument, NodeWithStatus } from '@btcortex/contracts';
import { DevToolsService } from '../../apps/orchestrator/src/devtools/devtools-service';
import { TransactionTracker } from '../../apps/orchestrator/src/devtools/tracker';
import { TransactionToolsService } from '../../apps/orchestrator/src/devtools/transaction-tools';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { findTestBitcoind, removeTestRoot, startRegtestNode } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// The transaction tools against a real regtest bitcoind: addresses checked
// by the node, a payment URI made and read, a PSBT signed by a throwaway
// wallet in the test's own data directory, combined with its unsigned
// original and finalised, the transaction sent and followed from the mempool
// into a block — without a transaction index.

const bitcoind = findTestBitcoind();
const logger = new StructuredLogger([new MemorySink()], 'debug');

function memorySettings() {
  const values = new Map<string, string>();
  return {
    get: <T>(key: string, schema: z.ZodType<T>): T | undefined => {
      const value = values.get(key);
      return value === undefined ? undefined : schema.parse(JSON.parse(value));
    },
    set: (key: string, value: unknown) => {
      values.set(key, JSON.stringify(value));
    },
  };
}

describe.skipIf(!bitcoind)('transaction tools (real bitcoind)', () => {
  let node: RegtestNode;
  let tools: TransactionToolsService;
  let tracker: TransactionTracker;
  let address: string;

  beforeAll(async () => {
    node = await startRegtestNode(bitcoind ?? '');
    const profile = {
      id: 'tx',
      name: 'Transaction node',
      implementation: 'bitcoin-core',
      network: 'regtest',
      execution: 'external',
      runtimeVersion: null,
      dataDirectory: node.dataDirectory,
      rpcEndpoint: `http://127.0.0.1:${String(node.rpcPort)}`,
    } as unknown as NodeWithStatus['profile'];
    const nodes = {
      get: () => ({
        profile,
        status: { nodeId: 'tx', state: 'running' as const, checkedAt: '2026-10-23T00:00:00.000Z' },
      }),
      rpc: () => node.client,
    };
    const devtools = new DevToolsService({
      nodes,
      config: {
        get: () =>
          Promise.resolve({
            path: null,
            exists: false,
            editable: false,
            text: '',
            revision: 'r',
            restartRequired: false,
            commandLine: [],
          } satisfies NodeConfigDocument),
      },
      socksPort: () => undefined,
      logger,
    });
    tracker = new TransactionTracker({ settings: memorySettings(), nodes, logger });
    tools = new TransactionToolsService({
      nodes,
      analysePsbt: (nodeId, psbt) => devtools.psbt(nodeId, psbt),
      tracker,
      logger,
    });
    await node.client.call('createwallet', ['tools']);
    address = await node.client.call<string>('getnewaddress', ['', 'bech32'], { wallet: 'tools' });
    await node.client.call('generatetoaddress', [101, address]);
  }, 180_000);

  afterAll(async () => {
    await node.stop();
    removeTestRoot(node.dataDirectory);
  }, 60_000);

  it('checks addresses with the node, refusing other networks and pointing at mistakes', async () => {
    expect(await tools.address('tx', address)).toMatchObject({ valid: true, type: 'p2wpkh', witnessVersion: 0 });
    const mainnet = await tools.address('tx', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(mainnet.valid).toBe(false);
    // One character changed: bech32's checksum finds it.
    const last = address.at(-1) === 'q' ? 'p' : 'q';
    const typo = await tools.address('tx', `${address.slice(0, -1)}${last}`);
    expect(typo.valid).toBe(false);
    expect(typo.errorLocations.length).toBeGreaterThan(0);
  });

  it('makes a payment URI for a wallet address and reads it back', async () => {
    const made = await tools.createUri({ nodeId: 'tx', address, amountSats: 150_000, label: 'Test payment' });
    expect(made.uri).toBe(`bitcoin:${address}?amount=0.0015&label=Test%20payment`);
    const read = await tools.readUri('tx', made.uri);
    expect(read).toMatchObject({
      problems: [],
      amountSats: 150_000,
      label: 'Test payment',
      addressCheck: { valid: true },
    });
  });

  it('combines, finalises, sends and follows a transaction into a block', async () => {
    const payee = await node.client.call<string>('getnewaddress', [], { wallet: 'tools' });
    const funded = await node.client.call<{ psbt: string }>(
      'walletcreatefundedpsbt',
      [[], [{ [payee]: 0.5 }], 0, { fee_rate: 2 }],
      { wallet: 'tools' },
    );
    const signed = await node.client.call<{ psbt: string }>(
      'walletprocesspsbt',
      [funded.psbt, true, 'ALL', true, false],
      {
        wallet: 'tools',
      },
    );
    const combined = await tools.combinePsbts('tx', [funded.psbt, signed.psbt]);
    expect(combined.analysis.next).toBe('finalizer');

    const finalised = await tools.finalisePsbt('tx', combined.psbt);
    expect(finalised.complete).toBe(true);
    expect(finalised.hex).toMatch(/^02000000/);
    const unsigned = await tools.finalisePsbt('tx', funded.psbt);
    expect(unsigned).toMatchObject({ complete: false, hex: null });

    const sent = await tools.broadcast('tx', finalised.hex ?? '');
    expect(sent.tracked).toMatchObject({ txid: sent.txid, state: 'mempool', confirmations: 0 });

    // The coin it spends is gone from the UTXO set; the payment it makes is there, unconfirmed.
    const decoded = await node.client.call<{ vin: { txid: string; vout: number }[] }>('decoderawtransaction', [
      finalised.hex,
    ]);
    const spent = decoded.vin[0];
    expect(spent && (await tools.lookupOutput('tx', spent.txid, spent.vout))).toMatchObject({
      unspent: false,
      valueSats: null,
    });
    expect(await tools.lookupOutput('tx', sent.txid, 0)).toMatchObject({ unspent: true, confirmations: 0 });

    await node.client.call('generatetoaddress', [1, address]);
    await tracker.refresh();
    expect(tools.tracked().find((entry) => entry.txid === sent.txid)).toMatchObject({
      state: 'confirmed',
      blockHeight: 102,
      confirmations: 1,
    });
  });

  it('finds the coins of an address in the UTXO set, with example fee rates on regtest', async () => {
    const scan = await tools.scanCoins('tx', [address]);
    expect(scan.coins.length).toBeGreaterThan(90);
    expect(scan.coins.every((coin) => coin.type === 'p2wpkh')).toBe(true);
    expect(scan.totalSats).toBe(scan.coins.reduce((sum, coin) => sum + coin.valueSats, 0));
    // Regtest has no fee estimates, so the rates are examples and said to be.
    expect(scan.estimated).toBe(false);
    expect(scan.feeRates.map((rate) => rate.blocks)).toEqual([2, 6, 144]);
    const [first] = scan.coins;
    expect(first && (await tools.lookupOutput('tx', first.txid, first.vout))).toMatchObject({
      unspent: true,
      valueSats: first?.valueSats,
      script: { type: 'p2wpkh', address },
    });
    await expect(
      tools.scanCoins('tx', ['wpkh(cVt4o7BGAig1UXywgGSmARhxMdzP5qvQsxKkSsc1XEkw3tDTQFpy)']),
    ).rejects.toMatchObject({ error: { code: 'devtools.private-key' } });
  });
});
