import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  AppFailure,
  GENESIS_HASHES,
  isLocalNetworkHost,
  networkOfGenesis,
  RemoteExplorerSchema,
} from '@btcortex/contracts';
import type {
  AddRemoteExplorerParams,
  ExplorerPage,
  NodeWithStatus,
  RemoteExplorer,
  RemoteExplorerEndpoint,
  RemoteExplorerStatus,
  RemoteExplorerTest,
  RemoteExplorerWithStatus,
} from '@btcortex/contracts';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { EsploraClient, probeExplorer } from '@btcortex/integration-esplora';
import type { EsploraClientOptions } from '@btcortex/integration-esplora';
import { connectThroughSocks } from '@btcortex/integration-tor';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../persistence/settings';
import { isOnionHost } from '@btcortex/core';

// Block explorers on other computers (specification section 12; phase 5,
// "selected Bitcoin explorers"): a mempool or Esplora instance on a node
// platform or another machine, reached directly or through BTCortex's tor.
// It is tested before it is added, then checked every minute — does it
// answer, does it follow the expected chain, how far behind the node is it —
// and its pages are opened in the user's browser for what BTCortex's own
// explorer shows. It is asked for nothing but the chain tip and block hashes,
// and never managed.

const SETTINGS_KEY = 'explorers.remote';
const CHECK_EVERY_MS = 60_000;
/** Tor circuits can take their time. */
const TIMEOUT_MS = 30_000;
const MAX_EXPLORERS = 20;
const COMPONENT = 'Block explorers';

const execFileAsync = promisify(execFile);

export interface RemoteExplorerOptions {
  settings: Pick<SettingsStore, 'get' | 'set'>;
  nodes: { get(nodeId: string): NodeWithStatus; rpc(nodeId: string): Pick<BitcoinRpcClient, 'call'> };
  /** BTCortex's tor's SOCKS port for programs, while it runs. */
  socksPort: () => number | undefined;
  logger: Logger;
  now?: () => Date;
  /** Opens an address in the user's browser; replaced in tests. */
  openInBrowser?: (url: string) => Promise<void>;
}

/** The explorer's address without a trailing slash, in lower case up to the path. */
function normalise(url: string): string {
  const parsed = new URL(url.trim());
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
}

const isOnion = (url: string) => isOnionHost(new URL(url).hostname);

/** The pages mempool and Esplora serve for a transaction, a block and an address. */
export function explorerPageUrl(explorer: Pick<RemoteExplorer, 'url'>, page: ExplorerPage): string {
  const base = explorer.url.replace(/\/+$/, '');
  switch (page.kind) {
    case 'transaction':
      return `${base}/tx/${page.txid}`;
    case 'block':
      return `${base}/block/${page.hash}`;
    case 'address':
      return `${base}/address/${page.address}`;
  }
}

/** Windows' own handler for web addresses: the default browser, without a shell. */
async function openWithWindows(url: string): Promise<void> {
  await execFileAsync('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, timeout: 15_000 });
}

const messageOf = (error: unknown) =>
  error instanceof AppFailure ? error.error.message : error instanceof Error ? error.message : String(error);

export class RemoteExplorerService {
  private explorers: RemoteExplorer[];
  private readonly statuses = new Map<string, RemoteExplorerStatus>();
  private timer: NodeJS.Timeout | undefined;
  private checking: Promise<void> | undefined;

  constructor(private readonly options: RemoteExplorerOptions) {
    this.explorers = options.settings.get(SETTINGS_KEY, z.array(RemoteExplorerSchema)) ?? [];
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private failure(code: string, message: string): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [] });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkAll();
    }, CHECK_EVERY_MS);
    this.timer.unref();
    void this.checkAll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** How the explorer is reached: directly, or through BTCortex's tor. */
  private clientOptions(endpoint: Pick<RemoteExplorerEndpoint, 'url' | 'via'>): Omit<EsploraClientOptions, 'apiUrl'> {
    const parsed = new URL(endpoint.url);
    const host = parsed.hostname;
    // Plain http:// only where nobody on the internet is in between: this network, or an onion service.
    if (parsed.protocol === 'http:' && !isOnion(endpoint.url) && !isLocalNetworkHost(host)) {
      throw this.failure(
        'explorers.remote.plain-internet',
        'Plain http:// would send what you look up across the internet in clear, where anyone on the way could read or change it. Use the explorer’s https:// address, or its onion address through Tor.',
      );
    }
    if (isOnion(endpoint.url) && endpoint.via !== 'tor') {
      throw this.failure(
        'explorers.remote.onion-needs-tor',
        'Onion addresses are reached through Tor: choose “through Tor”.',
      );
    }
    if (endpoint.via !== 'tor') return { timeoutMs: TIMEOUT_MS };
    const proxyPort = this.options.socksPort();
    if (proxyPort === undefined) {
      throw this.failure(
        'explorers.remote.tor-not-running',
        'BTCortex’s tor is not running: start it on the Tor & Privacy page.',
      );
    }
    return {
      timeoutMs: TIMEOUT_MS,
      connect: (target) =>
        connectThroughSocks(target, { proxyPort, isolation: `explorer-${host}`, timeoutMs: TIMEOUT_MS }),
    };
  }

  async test(endpoint: RemoteExplorerEndpoint): Promise<RemoteExplorerTest> {
    try {
      const probe = await probeExplorer(endpoint.url, endpoint.kind, this.clientOptions(endpoint));
      return {
        reachable: true,
        apiUrl: probe.apiUrl,
        genesisHash: probe.genesisHash,
        network: networkOfGenesis(probe.genesisHash),
        height: probe.height,
        error: null,
      };
    } catch (error) {
      return {
        reachable: false,
        apiUrl: null,
        genesisHash: null,
        network: null,
        height: null,
        error: messageOf(error),
      };
    }
  }

  /**
   * Whether the explorer's block near the lower of the two tips is the node's:
   * Bitcoin Knots since 29.4.1 shares Bitcoin Core's genesis block but not its
   * later blocks. Without an answer from the node, nothing can be compared.
   */
  private async sameRecentBlock(nodeId: string | null, client: EsploraClient, height: number): Promise<boolean> {
    if (nodeId === null) return true;
    const rpc = this.options.nodes.rpc(nodeId);
    const nodeHeight = await rpc.call<number>('getblockcount').catch(() => undefined);
    if (nodeHeight === undefined) return true;
    const at = Math.max(0, Math.min(height, nodeHeight) - 2);
    const [ours, theirs] = await Promise.all([
      rpc.call<string>('getblockhash', [at]).catch(() => undefined),
      client.blockHash(at),
    ]);
    return ours === undefined || ours === theirs;
  }

  /** How many blocks the explorer is behind the node, while the node answers. */
  private blocksBehind(nodeId: string | null, height: number): number | null {
    if (nodeId === null) return null;
    try {
      const blocks = this.options.nodes.get(nodeId).status.snapshot?.blockchain.blocks;
      return blocks === undefined ? null : blocks - height;
    } catch {
      return null;
    }
  }

  async add(params: AddRemoteExplorerParams): Promise<RemoteExplorerWithStatus[]> {
    if (this.explorers.length >= MAX_EXPLORERS) {
      throw this.failure(
        'explorers.remote.too-many',
        `BTCortex follows at most ${String(MAX_EXPLORERS)} explorers on other computers.`,
      );
    }
    const url = normalise(params.url);
    const duplicate = this.explorers.find((explorer) => explorer.url === url);
    if (duplicate) throw this.failure('explorers.remote.duplicate', `${duplicate.name} is this explorer already.`);
    const probe = await probeExplorer(url, params.kind, this.clientOptions(params));
    const network = networkOfGenesis(probe.genesisHash);
    if (network === null) {
      throw this.failure('explorers.remote.unknown-chain', 'This explorer follows a chain BTCortex does not know.');
    }
    if (params.nodeId !== null) {
      const node = this.options.nodes.get(params.nodeId);
      const genesis = await this.options.nodes.rpc(params.nodeId).call<string>('getblockhash', [0]);
      const client = new EsploraClient({ ...this.clientOptions(params), apiUrl: probe.apiUrl });
      if (genesis !== probe.genesisHash || !(await this.sameRecentBlock(params.nodeId, client, probe.height))) {
        throw this.failure(
          'explorers.remote.wrong-chain',
          `This explorer follows another chain from ${node.profile.name}, so it cannot show its blocks and transactions.`,
        );
      }
    }
    const explorer: RemoteExplorer = {
      id: randomUUID(),
      name: params.name,
      url,
      apiUrl: probe.apiUrl,
      kind: params.kind,
      via: params.via,
      network,
      nodeId: params.nodeId,
      addedAt: this.now().toISOString(),
    };
    this.explorers = [...this.explorers, explorer];
    this.options.settings.set(SETTINGS_KEY, this.explorers);
    this.statuses.set(explorer.id, {
      state: 'online',
      network,
      height: probe.height,
      blocksBehind: this.blocksBehind(explorer.nodeId, probe.height),
      checkedAt: this.now().toISOString(),
      error: null,
      unreachableSince: null,
    });
    this.options.logger.info('Added a block explorer on another computer', {
      id: explorer.id,
      kind: explorer.kind,
      via: explorer.via,
      network,
    });
    return this.list();
  }

  remove(id: string): RemoteExplorerWithStatus[] {
    this.explorers = this.explorers.filter((explorer) => explorer.id !== id);
    this.statuses.delete(id);
    this.options.settings.set(SETTINGS_KEY, this.explorers);
    return this.list();
  }

  list(): RemoteExplorerWithStatus[] {
    return this.explorers.map((explorer) => ({
      explorer,
      status: this.statuses.get(explorer.id) ?? {
        state: 'unknown',
        network: null,
        height: null,
        blocksBehind: null,
        checkedAt: null,
        error: null,
        unreachableSince: null,
      },
    }));
  }

  private async check(explorer: RemoteExplorer): Promise<void> {
    const previous = this.statuses.get(explorer.id);
    const checkedAt = this.now().toISOString();
    try {
      const client = new EsploraClient({ ...this.clientOptions(explorer), apiUrl: explorer.apiUrl });
      const height = await client.tipHeight();
      const genesis = await client.blockHash(0);
      const wrongChain =
        genesis !== GENESIS_HASHES[explorer.network] || !(await this.sameRecentBlock(explorer.nodeId, client, height));
      this.statuses.set(explorer.id, {
        state: wrongChain ? 'wrong-chain' : 'online',
        network: networkOfGenesis(genesis),
        height,
        blocksBehind: this.blocksBehind(explorer.nodeId, height),
        checkedAt,
        error: wrongChain ? 'It follows another chain from the one it followed when it was added.' : null,
        unreachableSince: null,
      });
    } catch (error) {
      this.statuses.set(explorer.id, {
        state: 'unreachable',
        network: previous?.network ?? null,
        height: previous?.height ?? null,
        blocksBehind: null,
        checkedAt,
        error: messageOf(error),
        unreachableSince: previous?.unreachableSince ?? checkedAt,
      });
    }
  }

  /** Checks one explorer now, as the Remote infrastructure page's test does. */
  async checkOne(id: string): Promise<RemoteExplorerStatus> {
    const explorer = this.explorers.find((candidate) => candidate.id === id);
    if (!explorer) throw this.failure('explorers.remote.unknown', 'This explorer is not known, or no longer exists.');
    await this.check(explorer);
    const status = this.statuses.get(id);
    if (!status) throw this.failure('explorers.remote.unknown', 'This explorer could not be checked.');
    return status;
  }

  /** Checks every explorer; one round at a time. */
  checkAll(): Promise<void> {
    this.checking ??= (async () => {
      for (const explorer of this.explorers) await this.check(explorer);
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  /**
   * Opens the explorer's page for a transaction, block or address in the
   * user's browser. An explorer reached through Tor is not opened there: the
   * browser would connect to it directly, tying this computer's internet
   * address to what is looked up (and cannot reach an onion service at all),
   * so its address is returned instead, to open in Tor Browser.
   */
  async open(id: string, page: ExplorerPage): Promise<{ opened: boolean; url: string }> {
    const explorer = this.explorers.find((candidate) => candidate.id === id);
    if (!explorer) throw this.failure('explorers.remote.unknown', 'This explorer is not known, or no longer exists.');
    const url = explorerPageUrl(explorer, page);
    if (explorer.via === 'tor' || isOnion(url)) return { opened: false, url };
    await (this.options.openInBrowser ?? openWithWindows)(url);
    return { opened: true, url };
  }
}
