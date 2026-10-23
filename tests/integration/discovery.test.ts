import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DiscoveredNode, NodeProfile, NodeWithStatus } from '@btcortex/contracts';
import { registerNodeHandlers } from '../../apps/orchestrator/src/handlers/nodes';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { MempoolService } from '../../apps/orchestrator/src/nodes/mempool-service';
import { StorageService } from '../../apps/orchestrator/src/nodes/storage-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { PeerService } from '../../apps/orchestrator/src/nodes/peer-service';
import { RpcConsoleService } from '../../apps/orchestrator/src/nodes/rpc-console-service';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import { Dispatcher } from '../../apps/orchestrator/src/rpc/dispatcher';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, startRegtestNode, TEST_ENV_RUNTIMES } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// Zero-touch connection to Bitcoin Core that is already on the computer, end
// to end against a real regtest bitcoind: the node runs in what looks like
// %APPDATA%\Bitcoin, and BTCortex finds it, works out the address and cookie,
// and connects without being told anything.

const bitcoind = findTestBitcoind();

describe.skipIf(!bitcoind)('Bitcoin Core found on this computer (real bitcoind on regtest)', () => {
  let root: string;
  let node: RegtestNode;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let dispatcher: Dispatcher;
  const call = (method: string, params: unknown) => dispatcher.dispatch({ method, params, origin: 'ui' });
  const forgotten: string[] = [];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-discovery-'));
    node = await startRegtestNode(bitcoind ?? '', { dataDirectory: join(root, 'Roaming', 'Bitcoin') });
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: join(root, 'BTCortex') });
    ensureAppDirectories(paths);
    const logger = new StructuredLogger([new MemorySink()], 'debug');
    database = openDatabase({ file: paths.database, migrations, logger });
    const vault = new SecretVault(
      database,
      createShellCaller(() => Promise.reject(new Error('No vault needed.'))),
    );
    const repository = new NodeRepository(database);
    nodes = new NodeManager({
      repository,
      vault,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      publish: () => undefined,
      logger,
    });
    dispatcher = new Dispatcher(logger);
    const config = new NodeConfigService({ nodes, logger });
    registerNodeHandlers(dispatcher, {
      nodes,
      config,
      peers: new PeerService({ nodes, logger }),
      console: new RpcConsoleService({ nodes, logger }),
      mempool: new MempoolService({ nodes }),
      storage: new StorageService({ nodes, config, logger, appDataDirectory: paths.root }),
      repository,
      vault,
      electrum: {
        forgetNode: (nodeId) => {
          forgotten.push(nodeId);
          return Promise.resolve(join(root, 'Roaming', 'Bitcoin-electrum'));
        },
      },
      publish: () => undefined,
      discovery: { env: { APPDATA: join(root, 'Roaming'), LOCALAPPDATA: join(root, 'Local') } },
    });
  });

  afterAll(async () => {
    await nodes.shutdown();
    database.close();
    await node.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the running node and connects to it without being told anything', async () => {
    const found = ((await call('nodes.discover', {})) as DiscoveredNode[]).filter((candidate) =>
      candidate.dataDirectory.startsWith(root),
    );
    expect(found).toEqual([
      expect.objectContaining({
        network: 'regtest',
        running: true,
        program: 'bitcoind',
        rpcServer: 'on',
        rpcEndpoint: `http://127.0.0.1:${String(node.rpcPort)}`,
        authentication: 'cookie',
      }),
    ]);
    expect(found[0]).not.toHaveProperty('cookieFile');

    const profile = (await call('nodes.connectDiscovered', {
      dataDirectory: join(root, 'Roaming', 'Bitcoin'),
      network: 'regtest',
      name: 'Bitcoin Core (Regtest)',
      useConfiguredPassword: false,
    })) as NodeProfile;
    expect(profile).toMatchObject({ execution: 'external', network: 'regtest', authentication: { kind: 'cookie' } });

    const again = (await call('nodes.discover', {})) as DiscoveredNode[];
    expect(again.find((candidate) => candidate.dataDirectory.startsWith(root))?.registeredAs).toBe(profile.id);
    await expect(
      call('nodes.connectDiscovered', {
        dataDirectory: join(root, 'Roaming', 'Bitcoin'),
        network: 'regtest',
        name: 'Twice',
        useConfiguredPassword: false,
      }),
    ).rejects.toMatchObject({ data: { code: 'nodes.already-registered' } });
  });

  it('refuses directories it did not find itself', async () => {
    await expect(
      call('nodes.connectDiscovered', {
        dataDirectory: join(root, 'Elsewhere'),
        network: 'regtest',
        name: 'Elsewhere',
        useConfiguredPassword: false,
      }),
    ).rejects.toMatchObject({ data: { code: 'nodes.not-found-on-computer' } });
  });

  it('removes a node it does not run while it runs, with its Electrum server, and deletes no data', async () => {
    const listed = (await call('nodes.list', {})) as NodeWithStatus[];
    const nodeId = listed.find((candidate) => candidate.profile.name === 'Bitcoin Core (Regtest)')?.profile.id ?? '';
    expect(nodeId).not.toBe('');
    // BTCortex only connects to this node, so it keeps no data folder of its own for it.
    // Like every dangerous method, it runs only when the call says the user confirmed it.
    await expect(call('nodes.remove', { nodeId })).rejects.toMatchObject({ code: -32602 });
    await expect(call('nodes.remove', { nodeId, confirmed: true })).resolves.toEqual({
      removed: true,
      dataDirectoryKept: null,
      electrumIndexKept: join(root, 'Roaming', 'Bitcoin-electrum'),
    });
    expect(forgotten).toEqual([nodeId]);
    expect(((await call('nodes.list', {})) as NodeWithStatus[]).map((candidate) => candidate.profile.id)).not.toContain(
      nodeId,
    );
    expect(existsSync(join(root, 'Roaming', 'Bitcoin', 'regtest'))).toBe(true);
  });
});
