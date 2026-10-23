import { z } from 'zod';
import { AppErrorSchema } from './errors';

// Bitcoin node domain shared by the interface and the orchestrator.

export const BitcoinNetworkSchema = z.enum(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest']);
export type BitcoinNetworkId = z.infer<typeof BitcoinNetworkSchema>;

/** Each network's genesis block, which tells which chain a server follows (signet: the default signet). */
export const GENESIS_HASHES: Record<BitcoinNetworkId, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  testnet3: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};

export function networkOfGenesis(hash: string): BitcoinNetworkId | null {
  return (
    (Object.keys(GENESIS_HASHES) as BitcoinNetworkId[]).find((network) => GENESIS_HASHES[network] === hash) ?? null
  );
}

export const NodeImplementationSchema = z.enum(['bitcoin-core', 'bitcoin-knots']);
export type NodeImplementation = z.infer<typeof NodeImplementationSchema>;

/**
 * - `managed`: BTCortex installed the runtime and owns the data directory.
 * - `external`: an existing node BTCortex connects to over RPC without managing its process.
 */
export const NodeExecutionSchema = z.enum(['managed', 'external']);
export type NodeExecution = z.infer<typeof NodeExecutionSchema>;

export const RpcAuthenticationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cookie'), cookieFile: z.string().min(1) }),
  /** The password itself stays in the DPAPI vault; only its id is shared. */
  z.object({ kind: z.literal('password'), username: z.string().min(1), secretId: z.string().min(1) }),
]);
export type RpcAuthentication = z.infer<typeof RpcAuthenticationSchema>;

export const NodeProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  implementation: NodeImplementationSchema,
  network: BitcoinNetworkSchema,
  execution: NodeExecutionSchema,
  runtimeVersion: z.string().nullable(),
  dataDirectory: z.string().nullable(),
  rpcEndpoint: z.string().min(1),
  authentication: RpcAuthenticationSchema,
  /** Whether the node keeps running after BTCortex closes (specification section 32). */
  keepRunningOnExit: z.boolean(),
  /** Whether BTCortex starts the node when BTCortex itself starts; managed nodes only. */
  startWithBtcortex: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type NodeProfile = z.infer<typeof NodeProfileSchema>;

export const NodeLifecycleStateSchema = z.enum([
  'starting',
  'running',
  'stopping',
  'stopped',
  'unreachable',
  'unauthorised',
  'failed',
  'unknown',
]);
export type NodeLifecycleState = z.infer<typeof NodeLifecycleStateSchema>;

export const BlockchainSummarySchema = z.object({
  chain: z.string(),
  blocks: z.number().int().nonnegative(),
  headers: z.number().int().nonnegative(),
  bestBlockHash: z.string(),
  difficulty: z.number(),
  medianTime: z.number().int(),
  verificationProgress: z.number(),
  initialBlockDownload: z.boolean(),
  sizeOnDiskBytes: z.number().nonnegative(),
  pruned: z.boolean(),
  pruneHeight: z.number().int().optional(),
  pruneTargetBytes: z.number().optional(),
  warnings: z.array(z.string()),
});
export type BlockchainSummary = z.infer<typeof BlockchainSummarySchema>;

export const NetworkSummarySchema = z.object({
  version: z.number().int(),
  subversion: z.string(),
  protocolVersion: z.number().int(),
  connections: z.number().int().nonnegative(),
  connectionsIn: z.number().int().nonnegative(),
  connectionsOut: z.number().int().nonnegative(),
  networkActive: z.boolean(),
  relayFeeBtcPerKvB: z.number(),
  reachableNetworks: z.array(z.string()),
  localServices: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type NetworkSummary = z.infer<typeof NetworkSummarySchema>;

export const MempoolSummarySchema = z.object({
  loaded: z.boolean(),
  transactions: z.number().int().nonnegative(),
  virtualBytes: z.number().nonnegative(),
  memoryUsageBytes: z.number().nonnegative(),
  maxMemoryBytes: z.number().nonnegative(),
  minimumFeeBtcPerKvB: z.number(),
  minimumRelayFeeBtcPerKvB: z.number(),
  totalFeeBtc: z.number().optional(),
});
export type MempoolSummary = z.infer<typeof MempoolSummarySchema>;

export const TrafficSummarySchema = z.object({
  bytesReceived: z.number().nonnegative(),
  bytesSent: z.number().nonnegative(),
});

export const SyncEstimateSchema = z.object({
  /** Always an estimate; the interface must label it so (specification section 5.5). */
  remainingSeconds: z.number().nonnegative(),
  basis: z.string(),
});

export const NodeSnapshotSchema = z.object({
  takenAt: z.iso.datetime(),
  blockchain: BlockchainSummarySchema,
  network: NetworkSummarySchema,
  mempool: MempoolSummarySchema,
  traffic: TrafficSummarySchema,
  uptimeSeconds: z.number().int().nonnegative(),
});
export type NodeSnapshot = z.infer<typeof NodeSnapshotSchema>;

export const NodeStatusSchema = z.object({
  nodeId: z.string(),
  state: NodeLifecycleStateSchema,
  /** Progress text while starting, for example "Loading block index…". */
  detail: z.string().optional(),
  checkedAt: z.iso.datetime(),
  /** Last successful snapshot; kept while the node is unreachable and marked stale by `checkedAt`. */
  snapshot: NodeSnapshotSchema.optional(),
  syncEstimate: SyncEstimateSchema.optional(),
  error: AppErrorSchema.optional(),
  /**
   * For a managed node that does not answer as it should: whether its bitcoind
   * still runs, so that it can be stopped (and is not removed) whatever its
   * last RPC answer was.
   */
  processRunning: z.boolean().optional(),
});
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const PeerSummarySchema = z.object({
  id: z.number().int(),
  address: z.string(),
  network: z.string(),
  inbound: z.boolean(),
  connectionType: z.string().optional(),
  transport: z.string().optional(),
  userAgent: z.string(),
  protocolVersion: z.number().int(),
  services: z.array(z.string()),
  pingSeconds: z.number().optional(),
  bytesSent: z.number().nonnegative(),
  bytesReceived: z.number().nonnegative(),
  connectedSince: z.number().int(),
  syncedHeaders: z.number().int().optional(),
  syncedBlocks: z.number().int().optional(),
  relaysTransactions: z.boolean(),
  /** Special permissions granted to this peer (whitelist), for example noban or relay. */
  permissions: z.array(z.string()),
  minPingSeconds: z.number().optional(),
  /** Unix times of the last block and transaction this peer sent first; 0 when never. */
  lastBlockAt: z.number().int().optional(),
  lastTransactionAt: z.number().int().optional(),
});
export type PeerSummary = z.infer<typeof PeerSummarySchema>;

export const NodeWithStatusSchema = z.object({ profile: NodeProfileSchema, status: NodeStatusSchema });
export type NodeWithStatus = z.infer<typeof NodeWithStatusSchema>;

/**
 * Bitcoin Knots 29.4.1 and later enforce rules Bitcoin Core does not — the
 * BIP110 softfork and, from mainnet block 961,640, a BLAKE2b proof of work —
 * so they follow a chain Bitcoin Core rejects (docs/research/data/full-nodes-core.json).
 */
export const KNOTS_FORK_VERSION = 290_401;

/** The node runs a Bitcoin Knots that follows a different chain from Bitcoin Core, as far as its last snapshot shows. */
export function followsKnotsFork(node: Pick<NodeWithStatus, 'profile' | 'status'>): boolean {
  const network = node.status.snapshot?.network;
  if (!network) return false;
  const knots = node.profile.implementation === 'bitcoin-knots' || network.subversion.includes('Knots');
  return knots && network.version >= KNOTS_FORK_VERSION;
}

/** Loopback addresses: only programs on this computer can listen there. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

/** Addresses that stay inside the local network (including Tailscale's 100.64.0.0/10). */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isLoopbackHost(host) || host.endsWith('.local')) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }
  return /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith('fe80:');
}

/** A Bitcoin Core data directory found on this computer, and how BTCortex could connect to it. */
export const DiscoveredNodeSchema = z.object({
  dataDirectory: z.string(),
  network: BitcoinNetworkSchema,
  source: z.enum(['roaming-app-data', 'local-app-data', 'registry']),
  /** bitcoind is running on this data directory and network right now. */
  running: z.boolean(),
  hasChainData: z.boolean(),
  walletFiles: z.number().int().nonnegative(),
  /** Which program runs the node, when it runs. */
  program: z.enum(['bitcoind', 'bitcoin-qt', 'unknown']),
  /**
   * Whether the node accepts RPC connections. Bitcoin Core's window (bitcoin-qt)
   * leaves its RPC server off unless "Enable RPC server" is ticked.
   */
  rpcServer: z.enum(['on', 'off', 'unknown']),
  rpcEndpoint: z.string(),
  /**
   * - `cookie`: BTCortex can connect on its own.
   * - `password-in-config`: rpcuser/rpcpassword switch the cookie off; the password must be entered.
   */
  authentication: z.enum(['cookie', 'password-in-config']),
  /** The node is already registered in BTCortex. */
  registeredAs: z.string().optional(),
});
export type DiscoveredNode = z.infer<typeof DiscoveredNodeSchema>;

/** Protocol and host name of an http(s) address that has already been validated as a URL. */
export function endpointParts(endpoint: string): { protocol: string; hostname: string } {
  const match = /^(https?):\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(endpoint);
  return { protocol: `${(match?.[1] ?? '').toLowerCase()}:`, hostname: (match?.[2] ?? '').toLowerCase() };
}
