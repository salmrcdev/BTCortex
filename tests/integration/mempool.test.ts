import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NodeProfile } from '@btcortex/contracts';
import { cookieFilePath, defaultRpcEndpoint } from '@btcortex/integration-bitcoin-core';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { MempoolService } from '../../apps/orchestrator/src/nodes/mempool-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, startRegtestNode, TEST_ENV_RUNTIMES } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// Mempool analysis against a real regtest bitcoind (specification section 5.9),
// including a child that pays for its parent.

const bitcoind = findTestBitcoind();

describe.skipIf(!bitcoind)('Mempool analysis (real bitcoind on regtest)', () => {
  let root: string;
  let node: RegtestNode;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let mempool: MempoolService;
  let parent: string;
  let child: string;
  let parked: string;
  const nodeId = 'regtest-mempool';
  const wallet = { wallet: 'mempool-test' };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-mempool-'));
    node = await startRegtestNode(bitcoind ?? '');
    const logger = new StructuredLogger([new MemorySink()], 'debug');
    database = openDatabase({ file: join(root, 'btcortex.db'), migrations, logger });
    const vault = new SecretVault(
      database,
      createShellCaller(() => Promise.reject(new Error('No vault needed.'))),
    );
    nodes = new NodeManager({
      repository: new NodeRepository(database),
      vault,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      publish: () => undefined,
      logger,
    });
    const timestamp = new Date().toISOString();
    const profile: NodeProfile = {
      id: nodeId,
      name: 'Regtest mempool',
      implementation: 'bitcoin-core',
      network: 'regtest',
      execution: 'external',
      runtimeVersion: null,
      dataDirectory: null,
      rpcEndpoint: defaultRpcEndpoint('regtest', node.rpcPort),
      authentication: { kind: 'cookie', cookieFile: cookieFilePath(node.dataDirectory, 'regtest') },
      keepRunningOnExit: true,
      startWithBtcortex: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    nodes.track(profile);
    mempool = new MempoolService({ nodes });

    // A wallet with mature coins, a parent paying 1 sat/vB and a child paying 50 sat/vB for it.
    const client = node.client;
    await client.call('createwallet', ['mempool-test']);
    const mining = await client.call<string>('getnewaddress', [], wallet);
    await client.call('generatetoaddress', [110, mining]);
    parked = await client.call<string>('getnewaddress', [], wallet);
    parent = await client.call<string>('sendtoaddress', { address: parked, amount: 1, fee_rate: 1 }, wallet);
    const [output] = await client.call<{ txid: string; vout: number }[]>('listunspent', [0, 0, [parked]], wallet);
    const destination = await client.call<string>('getnewaddress', [], wallet);
    const sent = await client.call<{ txid: string }>(
      'send',
      {
        outputs: [{ [destination]: 0.5 }],
        options: { inputs: [output], add_inputs: false, fee_rate: 50 },
      },
      wallet,
    );
    child = sent.txid;
    for (const rate of [3, 7]) {
      await client.call('sendtoaddress', { address: destination, amount: 0.1, fee_rate: rate }, wallet);
    }
  });

  afterAll(async () => {
    await nodes.shutdown();
    database.close();
    await node.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('describes the mempool, its policy and fee-rate distribution', async () => {
    const overview = await mempool.overview(nodeId);
    expect(overview).toMatchObject({ loaded: true, transactions: 4, fullRbf: true, nextBlockMinimumSatPerVb: null });
    expect(overview.minimumRelayFeeSatPerVb).toBeCloseTo(0.1);
    const filled = (overview.feeRateBuckets ?? [])
      .filter((bucket) => bucket.virtualBytes > 0)
      .map((bucket) => bucket.minimum);
    // The parent and child form one chunk well above 1 sat/vB: the child pays for its parent.
    expect(filled).not.toContain(1);
    expect(filled).toEqual(expect.arrayContaining([3, 5]));
    // Regtest has no history for estimates.
    expect(overview.estimates.every((estimate) => estimate.satPerVb === null)).toBe(true);
    // Bitcoin Core 31.1 has every version-dependent relay feature BTCortex describes.
    expect(overview.policyFeatures?.every((feature) => feature.supported)).toBe(true);
  });

  it('shows that a child pays for its parent', async () => {
    const detail = await mempool.transaction(nodeId, parent);
    expect(detail.satPerVb).toBeCloseTo(1, 0);
    expect(detail.children).toEqual([child]);
    expect(detail.descendants.count).toBe(2);
    expect(detail.chunk.satPerVb).toBeGreaterThan(10);
    expect(detail.cluster?.transactions).toBe(2);
    expect(detail.replaceable).toBe(true);
    expect(detail.outputs.length).toBeGreaterThan(0);
    await expect(mempool.transaction(nodeId, '00'.repeat(32))).rejects.toMatchObject({
      error: { code: 'mempool.not-found' },
    });
  });

  it('states the least a replacement must pay, exactly as the node enforces it', async () => {
    const detail = await mempool.transaction(nodeId, parent);
    const terms = detail.replacement;
    expect(terms).toMatchObject({ evicts: 1, mustImproveDiagram: true, replacedFeeSats: detail.descendants.feeSats });
    if (!terms) return;
    // The same inputs and outputs as the parent, with the change reduced to pay the given fee.
    const original = await node.client.call<{
      vin: { txid: string; vout: number }[];
      vout: { value: number; scriptPubKey: { address: string } }[];
    }>('getrawtransaction', [parent, true]);
    const tryReplacement = async (feeSats: number) => {
      const extra = feeSats - detail.feeSats;
      const outputs = original.vout.map((output) => {
        const valueSats = Math.round(output.value * 100_000_000) - (output.scriptPubKey.address === parked ? 0 : extra);
        return { [output.scriptPubKey.address]: Number((valueSats / 100_000_000).toFixed(8)) };
      });
      const inputs = original.vin.map((input) => ({ txid: input.txid, vout: input.vout }));
      const unsigned = await node.client.call<string>('createrawtransaction', [inputs, outputs]);
      const signed = await node.client.call<{ hex: string }>('signrawtransactionwithwallet', [unsigned], wallet);
      const [result] = await node.client.call<{ allowed: boolean; vsize?: number; 'reject-reason'?: string }[]>(
        'testmempoolaccept',
        [[signed.hex]],
      );
      return result;
    };
    const short = await tryReplacement(terms.minimumFeeSats - 1);
    expect(short?.allowed).toBe(false);
    expect(short?.['reject-reason']).toMatch(/insufficient fee/);
    expect(await tryReplacement(terms.minimumFeeSats)).toMatchObject({ allowed: true, vsize: detail.virtualBytes });
  });
});
