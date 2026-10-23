import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cookieFilePath,
  isProcessAlive,
  listPeers,
  readRunningPid,
  SyncEstimator,
  takeSnapshot,
  waitForExit,
} from '@btcortex/integration-bitcoin-core';
import { findTestBitcoind, startRegtestNode } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

const bitcoind = findTestBitcoind();

if (!bitcoind) {
  console.warn(
    'Skipping Bitcoin Core regtest tests: run `npx tsx scripts/dev/install-bitcoin-core.ts` to install a verified runtime.',
  );
}

describe.skipIf(!bitcoind)('Bitcoin Core on regtest (real bitcoind)', () => {
  let node: RegtestNode;

  beforeAll(async () => {
    node = await startRegtestNode(bitcoind ?? '');
  });

  afterAll(async () => {
    await node.stop();
  });

  it('starts detached, writes its pid and authenticates with the cookie', () => {
    expect(isProcessAlive(node.pid)).toBe(true);
    expect(readRunningPid(node.dataDirectory, 'regtest')).toBe(node.pid);
    expect(existsSync(cookieFilePath(node.dataDirectory, 'regtest'))).toBe(true);
  });

  it('reports a consistent snapshot of a fresh chain', async () => {
    const snapshot = await takeSnapshot(node.client);
    expect(snapshot.blockchain.chain).toBe('regtest');
    expect(snapshot.blockchain.blocks).toBe(0);
    expect(snapshot.network.subversion).toMatch(/^\/Satoshi:\d+\.\d+/);
    expect(snapshot.network.connections).toBe(0);
    expect(snapshot.mempool.transactions).toBe(0);
    expect(snapshot.mempool.maxMemoryBytes).toBe(300_000_000);
    expect(await listPeers(node.client)).toEqual([]);
  });

  it('mines blocks and sees the tip advance', async () => {
    const info = await node.client.call<{ descriptor: string }>('getdescriptorinfo', ['raw(51)']);
    const hashes = await node.client.call<string[]>('generatetodescriptor', [101, info.descriptor]);
    expect(hashes).toHaveLength(101);
    const snapshot = await takeSnapshot(node.client);
    expect(snapshot.blockchain.blocks).toBe(101);
    expect(snapshot.blockchain.bestBlockHash).toBe(hashes.at(-1));
    expect(snapshot.blockchain.initialBlockDownload).toBe(false);
  });

  it('estimates nothing once the chain is synchronised', async () => {
    const estimator = new SyncEstimator();
    const snapshot = await takeSnapshot(node.client);
    estimator.record({
      atMs: Date.now(),
      verificationProgress: snapshot.blockchain.verificationProgress,
      blocks: snapshot.blockchain.blocks,
    });
    expect(estimator.estimate()).toBeUndefined();
  });

  it('stops gracefully through RPC and removes its cookie', async () => {
    const answer = await node.client.stop();
    expect(answer).toMatch(/stopping/i);
    expect(await waitForExit(node.pid, { timeoutMs: 60_000 })).toBe(true);
    expect(existsSync(cookieFilePath(node.dataDirectory, 'regtest'))).toBe(false);
  });
});
