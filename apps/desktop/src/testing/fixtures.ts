import type { NodeSnapshot, NodeWithStatus, SetupPlan, SparrowStatus } from '@btcortex/contracts';

// Realistic data shaped exactly like the orchestrator's contract. Values are
// typical of a pruned mainnet node part-way through its initial download.

export const snapshot: NodeSnapshot = {
  takenAt: '2026-10-21T10:00:00.000Z',
  blockchain: {
    chain: 'main',
    blocks: 612_345,
    headers: 945_210,
    bestBlockHash: '00000000000000000011c2d6a1d33b4bb6b3c2d0f4c8b9e5a8a7f0e1d2c3b4a5',
    difficulty: 15_486_913_440_292.87,
    medianTime: 1_576_000_000,
    verificationProgress: 0.4217,
    initialBlockDownload: true,
    sizeOnDiskBytes: 18_400_000_000,
    pruned: true,
    pruneHeight: 598_000,
    pruneTargetBytes: 20_971_520_000,
    warnings: [],
  },
  network: {
    version: 310_100,
    subversion: '/Satoshi:31.1.0/',
    protocolVersion: 70_016,
    connections: 11,
    connectionsIn: 0,
    connectionsOut: 11,
    networkActive: true,
    relayFeeBtcPerKvB: 0.000001,
    reachableNetworks: ['ipv4', 'ipv6'],
    localServices: ['NETWORK_LIMITED', 'WITNESS', 'COMPACT_FILTERS', 'P2P_V2'],
    warnings: [],
  },
  mempool: {
    loaded: true,
    transactions: 1_284,
    virtualBytes: 2_100_000,
    memoryUsageBytes: 9_800_000,
    maxMemoryBytes: 300_000_000,
    minimumFeeBtcPerKvB: 0.000001,
    minimumRelayFeeBtcPerKvB: 0.000001,
  },
  traffic: { bytesReceived: 52_000_000_000, bytesSent: 310_000_000 },
  uptimeSeconds: 7_260,
};

export const runningNode: NodeWithStatus = {
  profile: {
    id: 'node-1',
    name: 'My Bitcoin node',
    implementation: 'bitcoin-core',
    network: 'mainnet',
    execution: 'managed',
    runtimeVersion: '31.1',
    dataDirectory: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\nodes\\mainnet-1',
    rpcEndpoint: 'http://127.0.0.1:8332',
    authentication: {
      kind: 'cookie',
      cookieFile: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\nodes\\mainnet-1\\.cookie',
    },
    keepRunningOnExit: false,
    startWithBtcortex: false,
    createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z',
  },
  status: {
    nodeId: 'node-1',
    state: 'running',
    checkedAt: '2026-10-21T10:00:00.000Z',
    snapshot,
    syncEstimate: {
      remainingSeconds: 5 * 3600 + 20 * 60,
      basis: 'Extrapolated from verification progress over the last 10 minutes.',
    },
  },
};

export const plan: SetupPlan = {
  network: 'mainnet',
  usage: 'wallet-backend',
  implementation: 'bitcoin-core',
  differentChain: false,
  version: '31.1',
  approximateDownloadBytes: 55_000_000,
  dataDirectory: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\nodes\\mainnet-1',
  hardware: {
    totalMemoryBytes: 6_340_771_840,
    availableMemoryBytes: 2_500_000_000,
    freeDiskBytes: 73_000_000_000,
    volumeBytes: 136_000_000_000,
    logicalProcessors: 6,
    volumePath: 'C:\\',
  },
  feasible: true,
  blockers: [],
  settings: [
    { key: 'server', value: '1', reason: 'BTCortex and connected wallets talk to the node over RPC.' },
    { key: 'prune', value: '20000', reason: 'The full chain does not fit in the free space.' },
  ],
  pruned: true,
  pruneTargetMiB: 20_000,
  estimatedFootprintBytes: 36_000_000_000,
  consequences: ['Pruning keeps only recent blocks: Electrum servers cannot use this node.'],
  existing: {
    dataDirectories: [
      {
        path: 'C:\\Users\\Dev\\AppData\\Roaming\\Bitcoin',
        source: 'roaming-app-data',
        hasConfigFile: true,
        networksWithChainData: [],
        walletFiles: 0,
        nodeRunning: false,
      },
    ],
    installations: [],
  },
};

export const sparrowNotConnected: SparrowStatus = {
  installed: null,
  running: false,
  settingsFound: false,
  connection: { usesThisNode: false },
};

export const sparrowUsingPublicServer: SparrowStatus = {
  installed: { version: '2.5.5', verifiedAt: '2026-10-21T09:00:00.000Z' },
  running: false,
  settingsFound: true,
  connection: {
    usesThisNode: false,
    otherServer: { serverType: 'PUBLIC_ELECTRUM_SERVER', server: 'ssl://electrum.blockstream.info:50002' },
  },
};

export const sparrowFixedOnTestnet4: SparrowStatus = {
  installed: { version: '2.5.5', verifiedAt: '2026-10-21T09:00:00.000Z' },
  running: false,
  settingsFound: true,
  connection: { usesThisNode: false, fixedStartupNetworks: ['testnet4'] },
};
