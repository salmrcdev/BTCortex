import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BitcoinConfig } from '@btcortex/bitcoin-config';
import {
  BitcoinRpcClient,
  BitcoinRpcError,
  cookieCredentials,
  RpcTransportError,
  CookieFileError,
  staticCredentials,
} from '@btcortex/bitcoin-rpc';
import {
  configFilePath,
  cookieFilePath,
  defaultRpcEndpoint,
  readConsoleTail,
  readRunningPid,
  startBitcoind,
  waitForExit,
} from '@btcortex/integration-bitcoin-core';
import type { NodeManager } from '../../../apps/orchestrator/src/nodes/node-manager';

// Disposable regtest nodes for integration tests (specification section 31.1).
// They use the verified runtime installed by scripts/dev/install-bitcoin-core.ts
// and never touch real networks or funds.

export const TEST_ENV_RUNTIMES = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.test-env',
  'bitcoin-core',
  'runtimes',
);

export function findTestBitcoind(): string | undefined {
  if (!existsSync(TEST_ENV_RUNTIMES)) return undefined;
  for (const version of readdirSync(TEST_ENV_RUNTIMES).sort().reverse()) {
    const candidate = join(TEST_ENV_RUNTIMES, version, `bitcoin-${version}`, 'bin', 'bitcoind.exe');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolvePort(port);
      });
    });
  });
}

export interface RegtestNode {
  dataDirectory: string;
  pid: number;
  rpcPort: number;
  client: BitcoinRpcClient;
  stop(): Promise<void>;
}

export async function waitUntilReady(client: BitcoinRpcClient, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await client.getBlockchainInfo();
      return;
    } catch (error) {
      const transient =
        (error instanceof BitcoinRpcError && error.isWarmingUp) ||
        (error instanceof RpcTransportError && error.failure === 'unreachable') ||
        error instanceof CookieFileError;
      if (!transient) throw error;
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`The regtest node did not become ready: ${String(lastError)}`);
}

export interface RegtestNodeOptions {
  /** Where the node keeps its data; a new temporary directory by default. */
  dataDirectory?: string;
  /** Extra settings for the [regtest] section, for example indexes or pruning. */
  settings?: Record<string, string>;
  /** An RPC user name and password in bitcoin.conf, which switch the cookie off. */
  password?: { username: string; password: string };
}

export async function startRegtestNode(bitcoind: string, options: RegtestNodeOptions = {}): Promise<RegtestNode> {
  const dataDirectory = options.dataDirectory ?? mkdtempSync(join(tmpdir(), 'btcortex-regtest-'));
  mkdirSync(dataDirectory, { recursive: true });
  const rpcPort = await freePort();
  const config = BitcoinConfig.empty();
  config.prependComment('Disposable regtest node created by the BTCortex integration tests.');
  config.set('listen', '0', { scope: null });
  config.set('fallbackfee', '0.0002', { scope: 'regtest' });
  config.set('rpcport', String(rpcPort), { scope: 'regtest' });
  for (const [name, value] of Object.entries(options.settings ?? {})) config.set(name, value, { scope: 'regtest' });
  if (options.password) {
    config.set('rpcuser', options.password.username, { scope: 'regtest' });
    config.set('rpcpassword', options.password.password, { scope: 'regtest' });
  }
  writeFileSync(configFilePath(dataDirectory), config.toString());

  const started = startBitcoind({ bitcoind, dataDirectory, network: 'regtest' });
  const client = new BitcoinRpcClient({
    endpoint: defaultRpcEndpoint('regtest', rpcPort),
    credentials: options.password
      ? staticCredentials(options.password)
      : cookieCredentials(cookieFilePath(dataDirectory, 'regtest')),
  });
  try {
    await waitUntilReady(client);
  } catch (error) {
    const tail = readConsoleTail(dataDirectory, 'regtest').join('\n');
    throw new Error(`${String(error)}\nConsole output:\n${tail}`, { cause: error });
  }

  return {
    dataDirectory,
    pid: started.pid,
    rpcPort,
    client,
    async stop() {
      try {
        await client.stop();
      } catch {
        // Already stopping or stopped.
      }
      await waitForExit(started.pid, { timeoutMs: 60_000 });
      rmSync(dataDirectory, { recursive: true, force: true });
    },
  };
}

/**
 * Shuts BTCortex's node manager down after a test and waits until the bitcoind
 * processes of its managed nodes have exited. A node still warming up refuses
 * `stop`, so it is asked again, and one that never stops is killed: no test may
 * leave a node running, or its folder half deleted, behind it.
 */
export async function shutDownNodeManager(nodes: NodeManager, timeoutMs = 30_000): Promise<void> {
  const managed = nodes
    .list()
    .map(({ profile }) => profile)
    .filter((profile) => profile.execution === 'managed' && profile.dataDirectory !== null);
  await nodes.shutdown();
  const deadline = Date.now() + timeoutMs;
  await Promise.all(
    managed.map(async (profile) => {
      const dataDirectory = profile.dataDirectory ?? '';
      const pid = readRunningPid(dataDirectory, profile.network);
      if (pid === undefined) return;
      const client = new BitcoinRpcClient({
        endpoint: profile.rpcEndpoint,
        credentials: cookieCredentials(cookieFilePath(dataDirectory, profile.network)),
      });
      while (Date.now() < deadline) {
        if (await waitForExit(pid, { timeoutMs: 2_000 })) return;
        await client.stop().catch(() => undefined);
      }
      try {
        process.kill(pid);
      } catch {
        // Already gone.
      }
      await waitForExit(pid, { timeoutMs: 10_000 });
    }),
  );
}

/** Removes a test's folder, retrying while processes that have just exited still hold files in it. */
export function removeTestRoot(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
