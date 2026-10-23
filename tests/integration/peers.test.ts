import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NodeProfile } from '@btcortex/contracts';
import { cookieFilePath, defaultRpcEndpoint } from '@btcortex/integration-bitcoin-core';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { PeerService } from '../../apps/orchestrator/src/nodes/peer-service';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, startRegtestNode, TEST_ENV_RUNTIMES } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// Peer management against a real regtest bitcoind (specification section 5.8).
// Regtest has no peers of its own, but bans and manual peers behave exactly as
// on the real networks.

const bitcoind = findTestBitcoind();

describe.skipIf(!bitcoind)('Peer management (real bitcoind on regtest)', () => {
  let root: string;
  let node: RegtestNode;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let peers: PeerService;
  const nodeId = 'regtest-peers';

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-peers-'));
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
      name: 'Regtest peers',
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
    peers = new PeerService({ nodes, logger });
  });

  afterAll(async () => {
    await nodes.shutdown();
    database.close();
    await node.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('bans an address given with its port, lists it and lifts it', async () => {
    await peers.ban(nodeId, '203.0.113.7:18444', 3600);
    const banned = (await peers.network(nodeId)).banned;
    expect(banned).toEqual([expect.objectContaining({ address: '203.0.113.7/32' })]);
    await expect(peers.ban(nodeId, '203.0.113.7', 3600)).rejects.toMatchObject({ error: { code: 'peers.refused' } });
    await peers.unban(nodeId, '203.0.113.7/32');
    expect((await peers.network(nodeId)).banned).toEqual([]);
    await peers.ban(nodeId, '198.51.100.0/24', 3600);
    await peers.clearBans(nodeId);
    expect((await peers.network(nodeId)).banned).toEqual([]);
  });

  it('refuses a ban that would cut off every Tor connection', async () => {
    await expect(peers.ban(nodeId, '127.0.0.1:50000', 3600)).rejects.toMatchObject({
      error: { code: 'peers.ban-refused' },
    });
  });

  it('keeps and forgets manual peers', async () => {
    await peers.connect(nodeId, '203.0.113.9:18444', true);
    expect((await peers.network(nodeId)).added).toEqual([{ address: '203.0.113.9:18444', connected: false }]);
    await expect(peers.connect(nodeId, '203.0.113.9:18444', true)).rejects.toMatchObject({
      error: { code: 'peers.refused' },
    });
    await peers.forget(nodeId, '203.0.113.9:18444');
    expect((await peers.network(nodeId)).added).toEqual([]);
    // A one-off attempt is not remembered.
    await peers.connect(nodeId, '203.0.113.10:18444', false);
    expect((await peers.network(nodeId)).added).toEqual([]);
    expect(await peers.peers(nodeId)).toEqual([]);
  });
});
