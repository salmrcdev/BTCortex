import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NodeProfile, NodeWithStatus } from '@btcortex/contracts';
import { registerNodeHandlers } from '../../apps/orchestrator/src/handlers/nodes';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { MempoolService } from '../../apps/orchestrator/src/nodes/mempool-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { PeerService } from '../../apps/orchestrator/src/nodes/peer-service';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { RpcConsoleService } from '../../apps/orchestrator/src/nodes/rpc-console-service';
import { StorageService } from '../../apps/orchestrator/src/nodes/storage-service';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import { Dispatcher } from '../../apps/orchestrator/src/rpc/dispatcher';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, removeTestRoot, startRegtestNode, TEST_ENV_RUNTIMES } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// Connecting nodes that need an RPC password, against a real regtest bitcoind
// whose bitcoin.conf sets rpcuser and rpcpassword (which switches its cookie
// off): the node found on this computer is connected with the password in its
// bitcoin.conf only once the user agrees, and the same node is connected
// through the form for nodes on other computers, which tests the password
// before keeping anything. The password is kept in the vault, never in the
// profile, and goes when the node is removed. Windows' encryption of the vault
// is played by a reversible stand-in here; DPAPI itself is tested by the
// native shell's own tests.

const bitcoind = findTestBitcoind();
const PASSWORD = { username: 'btcortex', password: 'correct horse battery staple' };

describe.skipIf(!bitcoind)('Nodes that need an RPC password (real bitcoind on regtest)', () => {
  let root: string;
  let node: RegtestNode;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let vault: SecretVault;
  let dispatcher: Dispatcher;
  const call = (method: string, params: unknown) => dispatcher.dispatch({ method, params, origin: 'ui' });

  async function runs(nodeId: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const { status } = (await call('nodes.get', { nodeId })) as NodeWithStatus;
      if (status.state === 'running') return;
      if (Date.now() > deadline) throw new Error(`The node did not answer in time; it is ${status.state}.`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-passwords-'));
    node = await startRegtestNode(bitcoind ?? '', {
      dataDirectory: join(root, 'Roaming', 'Bitcoin'),
      password: PASSWORD,
    });
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: join(root, 'BTCortex') });
    ensureAppDirectories(paths);
    const logger = new StructuredLogger([new MemorySink()], 'debug');
    database = openDatabase({ file: paths.database, migrations, logger });
    vault = new SecretVault(
      database,
      createShellCaller((method, params) => {
        if (method === 'vault.protect') {
          const { plaintext } = params as { plaintext: string };
          return Promise.resolve({ protected: Buffer.from(plaintext, 'utf8').toString('base64') });
        }
        const { protected: blob } = params as { protected: string };
        return Promise.resolve({ plaintext: Buffer.from(blob, 'base64').toString('utf8') });
      }),
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
      publish: () => undefined,
      discovery: { env: { APPDATA: join(root, 'Roaming'), LOCALAPPDATA: join(root, 'Local') } },
    });
  }, 120_000);

  afterAll(async () => {
    await nodes.shutdown();
    database.close();
    await node.stop();
    removeTestRoot(root);
  }, 60_000);

  it('connects the node found here with the password in its bitcoin.conf, only once the user agrees', async () => {
    const request = { dataDirectory: join(root, 'Roaming', 'Bitcoin'), network: 'regtest', name: 'Found here' };
    await expect(call('nodes.connectDiscovered', { ...request, useConfiguredPassword: false })).rejects.toMatchObject({
      data: { code: 'nodes.password-required' },
    });
    expect(vault.list()).toEqual([]);

    const profile = (await call('nodes.connectDiscovered', { ...request, useConfiguredPassword: true })) as NodeProfile;
    expect(profile.authentication).toMatchObject({ kind: 'password', username: PASSWORD.username });
    expect(JSON.stringify(profile)).not.toContain(PASSWORD.password);
    if (profile.authentication.kind !== 'password') throw new Error('The node was connected with a password.');
    expect(await vault.reveal(profile.authentication.secretId)).toBe(PASSWORD.password);
    await runs(profile.id);

    await call('nodes.remove', { nodeId: profile.id, confirmed: true });
    expect(vault.list()).toEqual([]);
  }, 60_000);

  it('connects a node through the form for other computers, testing the password before keeping it', async () => {
    const form = {
      name: 'Through the form',
      network: 'regtest',
      rpcEndpoint: `http://127.0.0.1:${String(node.rpcPort)}`,
    };
    await expect(
      call('nodes.connectExisting', {
        ...form,
        authentication: { kind: 'password', username: PASSWORD.username, password: 'not the password' },
      }),
    ).rejects.toMatchObject({ data: { code: 'bitcoin-core.unauthorised' } });
    expect(vault.list()).toEqual([]);
    expect(await call('nodes.list', {})).toEqual([]);

    const profile = (await call('nodes.connectExisting', {
      ...form,
      authentication: { kind: 'password', ...PASSWORD },
    })) as NodeProfile;
    expect(profile).toMatchObject({ execution: 'external', dataDirectory: null, authentication: { kind: 'password' } });
    expect(JSON.stringify(profile)).not.toContain(PASSWORD.password);
    if (profile.authentication.kind !== 'password') throw new Error('The node was connected with a password.');
    expect(await vault.reveal(profile.authentication.secretId)).toBe(PASSWORD.password);
    await runs(profile.id);

    await call('nodes.remove', { nodeId: profile.id, confirmed: true });
    expect(vault.list()).toEqual([]);
  }, 60_000);
});
