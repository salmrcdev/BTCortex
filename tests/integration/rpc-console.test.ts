import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NodeProfile } from '@btcortex/contracts';
import { cookieFilePath, defaultRpcEndpoint } from '@btcortex/integration-bitcoin-core';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { RpcConsoleService } from '../../apps/orchestrator/src/nodes/rpc-console-service';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, startRegtestNode, TEST_ENV_RUNTIMES } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// The RPC console against a real regtest bitcoind (specification section 5.7).

const bitcoind = findTestBitcoind();

describe.skipIf(!bitcoind)('RPC console (real bitcoind on regtest)', () => {
  let root: string;
  let node: RegtestNode;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let rpcConsole: RpcConsoleService;
  const sink = new MemorySink();
  const nodeId = 'regtest-console';

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-console-'));
    node = await startRegtestNode(bitcoind ?? '');
    const logger = new StructuredLogger([sink], 'debug');
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
      name: 'Regtest console',
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
    rpcConsole = new RpcConsoleService({ nodes, logger });
  });

  afterAll(async () => {
    await nodes.shutdown();
    database.close();
    await node.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists the node’s methods with their categories and risks', async () => {
    const catalogue = await rpcConsole.catalogue(nodeId);
    expect(catalogue).toContainEqual({
      name: 'getblockchaininfo',
      category: 'Blockchain',
      risk: 'read',
      secret: false,
    });
    expect(catalogue.find((entry) => entry.name === 'stop')?.blockedReason).toContain('Stop in BTCortex');
    expect((await rpcConsole.help(nodeId, 'getblockcount')).startsWith('getblockcount')).toBe(true);
  });

  it('runs calls, enforces confirmation and refusals, and logs no parameters', async () => {
    expect(await rpcConsole.call(nodeId, { method: 'getblockcount', params: [], confirmed: false })).toMatchObject({
      result: 0,
    });
    await expect(rpcConsole.call(nodeId, { method: 'stop', params: [], confirmed: true })).rejects.toMatchObject({
      error: { code: 'rpc.blocked' },
    });
    await expect(
      rpcConsole.call(nodeId, { method: 'setnetworkactive', params: [false], confirmed: false }),
    ).rejects.toMatchObject({ error: { code: 'rpc.confirmation-required' } });
    await expect(
      rpcConsole.call(nodeId, { method: 'getblockhash', params: [99], confirmed: false }),
    ).rejects.toMatchObject({ error: { code: 'rpc.node-error', message: 'Block height out of range' } });

    await rpcConsole.call(nodeId, { method: 'createwallet', params: ['console-test', true, true], confirmed: false });
    expect(
      await rpcConsole.call(nodeId, { method: 'getwalletinfo', params: [], wallet: 'console-test', confirmed: false }),
    ).toMatchObject({ result: expect.objectContaining({ walletname: 'console-test' }) as unknown });
    await expect(
      rpcConsole.call(nodeId, { method: 'listdescriptors', params: [true], wallet: 'console-test', confirmed: false }),
    ).rejects.toMatchObject({ error: { code: 'rpc.blocked' } });

    const logged = JSON.stringify(sink.entries);
    expect(logged).toContain('"method":"getblockhash"');
    expect(logged).not.toContain('console-test');
    expect(nodes.rpcStatistics(nodeId).find((entry) => entry.method === 'getblockcount')?.calls).toBeGreaterThan(0);
  });
});
