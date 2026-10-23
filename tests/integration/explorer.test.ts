import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppFailure } from '@btcortex/contracts';
import type { NodeProfile, NodeWithStatus } from '@btcortex/contracts';
import { cookieFilePath } from '@btcortex/integration-bitcoin-core';
import {
  buildFulcrumConfig,
  findInstalledFulcrum,
  readFulcrumInfo,
  startFulcrumProcess,
} from '@btcortex/integration-fulcrum';
import { connectionFor } from '../../apps/orchestrator/src/electrum/electrum-plan';
import { ExplorerService, scripthashOf } from '../../apps/orchestrator/src/explorer/explorer-service';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { findTestBitcoind, freePort, startRegtestNode } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// The block explorer against a real regtest bitcoind (with and without the
// transaction index) and, for address lookups, the real Fulcrum from
// .test-env: searches, blocks, transactions in the mempool and in the chain
// with the coins they spend, relatives in the mempool, raw transactions
// checked without broadcasting, scripts and an address's history.

const bitcoind = findTestBitcoind();
const FULCRUM_RUNTIMES = resolve(import.meta.dirname, '..', '..', '.test-env', 'fulcrum', 'runtimes');
const fulcrumVersion = existsSync(FULCRUM_RUNTIMES) ? readdirSync(FULCRUM_RUNTIMES)[0] : undefined;

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Condition not met in time; last value: ${JSON.stringify(value)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

function profileFor(node: RegtestNode, id: string): NodeWithStatus {
  const profile: NodeProfile = {
    id,
    name: id,
    implementation: 'bitcoin-core',
    network: 'regtest',
    execution: 'external',
    runtimeVersion: null,
    dataDirectory: node.dataDirectory,
    rpcEndpoint: `http://127.0.0.1:${String(node.rpcPort)}`,
    authentication: { kind: 'cookie', cookieFile: cookieFilePath(node.dataDirectory, 'regtest') },
    keepRunningOnExit: true,
    startWithBtcortex: false,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
  };
  return { profile, status: { nodeId: id, state: 'running', checkedAt: '2026-10-23T00:00:00.000Z' } };
}

describe.skipIf(!bitcoind || !fulcrumVersion)('the block explorer (real bitcoind and Fulcrum)', () => {
  let node: RegtestNode;
  let bare: RegtestNode;
  let home: string;
  let fulcrumPid: number | undefined;
  let electrumPort: number;
  let explorer: ExplorerService;
  let address: string;
  let payee: string;
  let confirmedTxid: string;
  let parentTxid: string;
  let childTxid: string;
  let relay: string;

  beforeAll(async () => {
    node = await startRegtestNode(bitcoind ?? '', { settings: { txindex: '1' } });
    bare = await startRegtestNode(bitcoind ?? '');
    const rpc = node.client;
    await rpc.call('createwallet', ['miner']);
    await rpc.call('createwallet', ['payee']);
    address = await rpc.call<string>('getnewaddress', [], { wallet: 'miner' });
    payee = await rpc.call<string>('getnewaddress', [], { wallet: 'payee' });
    await rpc.call('generatetoaddress', [110, address]);
    confirmedTxid = await rpc.call<string>(
      'sendtoaddress',
      { address: payee, amount: 2, fee_rate: 5 },
      { wallet: 'miner' },
    );
    await rpc.call('generatetoaddress', [1, address]);
    // An unconfirmed parent and a child spending its output, so the mempool has relatives to show.
    await rpc.call('createwallet', ['relay']);
    const relayAddress = await rpc.call<string>('getnewaddress', [], { wallet: 'relay' });
    parentTxid = await rpc.call<string>(
      'sendtoaddress',
      { address: relayAddress, amount: 1, fee_rate: 3 },
      { wallet: 'miner' },
    );
    const parent = await rpc.call<{ vout: { n: number; scriptPubKey: { address?: string } }[] }>('getrawtransaction', [
      parentTxid,
      1,
    ]);
    const vout = parent.vout.find((output) => output.scriptPubKey.address === relayAddress)?.n ?? 0;
    const unsigned = await rpc.call<string>('createrawtransaction', [
      [{ txid: parentTxid, vout }],
      [{ [address]: 0.9999 }],
    ]);
    const signed = await rpc.call<{ hex: string }>('signrawtransactionwithwallet', [unsigned], { wallet: 'relay' });
    childTxid = await rpc.call<string>('sendrawtransaction', [signed.hex]);
    relay = relayAddress;

    home = mkdtempSync(join(tmpdir(), 'btcortex-explorer-'));
    const runtime = await findInstalledFulcrum(FULCRUM_RUNTIMES, fulcrumVersion ?? '');
    if (!runtime) throw new Error('Fulcrum is not installed in .test-env.');
    const ports = { electrum: await freePort(), admin: await freePort(), stats: await freePort() };
    electrumPort = ports.electrum;
    mkdirSync(join(home, 'index'));
    writeFileSync(
      join(home, 'fulcrum.conf'),
      buildFulcrumConfig({
        dataDirectory: join(home, 'index'),
        bitcoind: { host: '127.0.0.1', port: node.rpcPort },
        cookieFile: cookieFilePath(node.dataDirectory, 'regtest'),
        ports,
        pidFile: join(home, 'fulcrum.pid'),
        databaseMemoryMiB: 256,
      }),
    );
    fulcrumPid = (
      await startFulcrumProcess({
        executable: runtime.executable,
        configFile: join(home, 'fulcrum.conf'),
        directory: join(runtime.executable, '..'),
        logFile: join(home, 'fulcrum.log'),
      })
    ).pid;
    await until(
      () =>
        readFulcrumInfo(ports.admin, 1000).then(
          () => true,
          () => false,
        ),
      (up) => up,
    );

    const nodes = { main: profileFor(node, 'main'), bare: profileFor(bare, 'bare') };
    explorer = new ExplorerService({
      nodes: {
        get: (nodeId) => (nodeId === 'bare' ? nodes.bare : nodes.main),
        rpc: (nodeId) => (nodeId === 'bare' ? bare.client : node.client),
      },
      electrum: (nodeId) => (nodeId === 'main' ? { connection: connectionFor(electrumPort), ready: true } : undefined),
      logger: new StructuredLogger([new MemorySink(1000)], 'debug'),
    });
  }, 240_000);

  afterAll(async () => {
    if (fulcrumPid) {
      try {
        process.kill(fulcrumPid);
      } catch {
        // Already gone.
      }
    }
    await node.stop();
    await bare.stop();
    rmSync(home, { recursive: true, force: true });
  }, 60_000);

  it('shows the chain at a glance', async () => {
    const overview = await explorer.overview('main');
    expect(overview).toMatchObject({
      chain: 'regtest',
      height: 111,
      pruned: false,
      transactionIndex: true,
      addressLookups: true,
    });
    expect(overview.recentBlocks).toHaveLength(10);
    expect(overview.recentBlocks[0]?.height).toBe(111);
    expect(overview.mempool.transactions).toBe(2);
    expect(overview.transactions?.count).toBeGreaterThan(110);
  });

  it('works out what was searched for', async () => {
    const tip = await node.client.call<string>('getblockhash', [111]);
    expect(await explorer.search('main', '111')).toEqual({ kind: 'block', id: tip });
    expect(await explorer.search('main', tip.toUpperCase())).toEqual({ kind: 'block', id: tip });
    expect(await explorer.search('main', confirmedTxid)).toEqual({ kind: 'transaction', id: confirmedTxid });
    expect(await explorer.search('main', payee)).toEqual({ kind: 'address', id: payee });
    const raw = await node.client.call<string>('getrawtransaction', [parentTxid, 0]);
    expect((await explorer.search('main', raw)).kind).toBe('raw-transaction');
    expect((await explorer.search('main', '0014' + '11'.repeat(20))).kind).toBe('script');
    expect((await explorer.search('main', '5000')).kind).toBe('none');
    expect((await explorer.search('main', 'hello there')).kind).toBe('none');
    // Without the transaction index, confirmed transactions are not found by id, and the reason is given.
    const bareResult = await explorer.search('bare', 'a'.repeat(64));
    expect(bareResult.message).toMatch(/transaction index/);
  });

  it('shows a block with its statistics and pages of transactions', async () => {
    const block = await explorer.block('main', '111', 0);
    expect(block).toMatchObject({ height: 111, available: true, transactionCount: 2, nextHash: null });
    expect(block.previousHash).toBe(await node.client.call<string>('getblockhash', [110]));
    expect(block.transactions[0]).toMatchObject({ coinbase: true, feeSats: null });
    expect(block.transactions[1]).toMatchObject({ txid: confirmedTxid, coinbase: false });
    expect(block.transactions[1]?.feeRate).toBeCloseTo(5, 0);
    expect(block.stats?.subsidySats).toBe(5_000_000_000);
    expect(block.stats?.totalFeeSats).toBe(block.transactions[1]?.feeSats);
    expect(block.sizeBytes).toBeGreaterThan(0);
    expect(block.page).toEqual({ index: 0, size: 25, total: 2 });
  });

  it('shows a confirmed transaction with the coins it spends and whether its outputs are spent', async () => {
    const transaction = await explorer.transaction('main', confirmedTxid);
    expect(transaction.status).toMatchObject({ state: 'confirmed', blockHeight: 111, confirmations: 1 });
    expect(transaction.inputs.every((input) => input.prevout !== undefined)).toBe(true);
    expect(transaction.feeSats).toBe((transaction.totalInputSats ?? 0) - transaction.totalOutputSats);
    expect(transaction.signalsReplaceable).toBe(true);
    // The payee's coin from it was spent by the unconfirmed parent or child? Its outputs say so either way.
    expect(transaction.outputs.every((output) => output.unspent !== null)).toBe(true);
    expect(transaction.outputs.find((output) => output.script.address === payee)?.valueSats).toBe(200_000_000);
  });

  it('shows unconfirmed transactions with their fee and relatives in the mempool', async () => {
    const parent = await explorer.transaction('main', parentTxid);
    const child = await explorer.transaction('main', childTxid);
    expect(parent.status.state).toBe('mempool');
    expect(parent.feeRate).toBeCloseTo(3, 0);
    expect(parent.mempool?.spentBy).toContain(childTxid);
    expect(child.mempool?.depends).toContain(parentTxid);
    // The child spends its unconfirmed parent's output: the coin is found in the mempool.
    expect(child.inputs.every((input) => input.prevout !== undefined)).toBe(true);
    expect(child.feeSats).toBe((child.totalInputSats ?? 0) - child.totalOutputSats);
    // The parent's output to the relay is spent by the child, in the mempool.
    expect(parent.outputs.find((output) => output.script.address === relay)?.unspent).toBe(false);
    expect(child.feeSats).toBe(10_000);
  });

  it('checks a raw transaction without broadcasting it', async () => {
    const funded = await node.client.call<{ psbt: string }>(
      'walletcreatefundedpsbt',
      [[], [{ [payee]: 0.25 }], 0, { fee_rate: 4 }],
      { wallet: 'miner' },
    );
    const processed = await node.client.call<{ psbt: string }>('walletprocesspsbt', [funded.psbt], { wallet: 'miner' });
    const final = await node.client.call<{ hex: string }>('finalizepsbt', [processed.psbt]);
    const check = await explorer.decodeRaw('main', final.hex);
    expect(check.transaction.status.state).toBe('not-seen');
    expect(check.acceptance).toEqual({ allowed: true });
    expect(check.transaction.feeRate).toBeCloseTo(4, 0);
    expect(check.transaction.outputs.every((output) => output.unspent === null)).toBe(true);
    expect((await node.client.call<{ size: number }>('getmempoolinfo', [])).size).toBe(2);
  });

  it('decodes scripts', async () => {
    expect(await explorer.decodeScript('main', '0014' + '11'.repeat(20))).toMatchObject({
      type: 'witness_v0_keyhash',
      asm: `0 ${'11'.repeat(20)}`,
    });
  });

  it('looks an address up through the node’s own Electrum server, and only there', async () => {
    const detail = await until(
      () => explorer.address('main', payee),
      (found) => found.history.length >= 1,
    );
    expect(detail.source).toBe('electrum-server');
    expect(detail.scripthash).toBe(scripthashOf(detail.script.hex));
    expect(detail.history.map((entry) => entry.txid)).toEqual([confirmedTxid]);
    expect(detail.unspent).toEqual([expect.objectContaining({ txid: confirmedTxid, valueSats: 200_000_000 })]);
    expect(detail.balance?.confirmedSats).toBe(200_000_000);
    expect(await explorer.address('bare', payee)).toMatchObject({ source: 'unavailable', balance: null, history: [] });
    await expect(explorer.address('main', 'bc1qnotanaddress')).rejects.toBeInstanceOf(AppFailure);
  });

  it('says why a confirmed transaction cannot be found without the transaction index', async () => {
    const txid = await bare.client.call<string>('getblockhash', [0]);
    await expect(explorer.transaction('bare', txid)).rejects.toThrow(/keeps no transaction index/);
  });
});
