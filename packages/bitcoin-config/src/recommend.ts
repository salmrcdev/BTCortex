import type { BitcoinNetwork } from './networks';
import { NETWORK_PARAMETERS } from './networks';

// Hardware-aware configuration for zero-touch set-up. These are BTCortex
// policy choices derived from upstream defaults, not upstream rules
// (docs/research/notes/full-nodes-core.md §6.9). Sizes are estimates and are
// presented to the user as such.

const GB = 1_000_000_000;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Approximate chain sizes from the Bitcoin Core 31.1 release estimates. */
export const CHAIN_SIZE_ESTIMATES: Record<BitcoinNetwork, { blocksBytes: number; chainstateBytes: number }> = {
  mainnet: { blocksBytes: 856 * GB, chainstateBytes: 14 * GB },
  testnet3: { blocksBytes: 245 * GB, chainstateBytes: 19 * GB },
  testnet4: { blocksBytes: 31 * GB, chainstateBytes: 2 * GB },
  signet: { blocksBytes: 24 * GB, chainstateBytes: 4 * GB },
  regtest: { blocksBytes: 0, chainstateBytes: 0 },
};

/**
 * Indexes an Electrum server relies on, compared with the block files (estimates,
 * docs/research/notes/electrum-indexers-explorers.md §3.7): Bitcoin Core's
 * transaction index (about 66 GiB for mainnet in 2026) and Fulcrum's own index
 * (170–200 GB expected for mainnet in late 2026, about a quarter of the block
 * files; a little more is allowed for growth).
 */
export const INDEX_SIZE_RATIOS = { transactionIndex: 0.1, electrumIndex: 0.3 } as const;

const MISCELLANEOUS_BYTES = 2 * GB;
const MIN_RESERVE_BYTES = 10 * GB;
const RESERVE_FRACTION = 0.1;
const MIN_PRUNE_MIB = 550;
const PRUNE_FLOOR_MIB = 2000; // the GUI's default prune size
const PRUNE_CEILING_MIB = 50_000;
const PRUNE_STEP_MIB = 1000;

export type NodeUsage = 'general' | 'wallet-backend' | 'electrum-backend';

export interface HardwareProfile {
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  /** Free space on the volume that will hold the data directory. */
  freeDiskBytes: number;
  /** Size of that volume. */
  volumeBytes: number;
  logicalProcessors: number;
}

export interface RecommendationInput {
  network: BitcoinNetwork;
  usage: NodeUsage;
  hardware: HardwareProfile;
}

export interface SettingRecommendation {
  key: string;
  value: string;
  reason: string;
}

export interface ConfigurationRecommendation {
  feasible: boolean;
  /** Why the plan cannot proceed, when not feasible. */
  blockers: string[];
  settings: SettingRecommendation[];
  pruned: boolean;
  pruneTargetMiB: number | undefined;
  /** Disk space the node is expected to use once synchronised (estimate). */
  estimatedFootprintBytes: number;
  /** Consequences the user must accept before approving the plan. */
  consequences: string[];
}

function formatGb(bytes: number): string {
  return `${Math.round(bytes / GB).toLocaleString('en-GB')} GB`;
}

export function recommendConfiguration({ network, usage, hardware }: RecommendationInput): ConfigurationRecommendation {
  const sizes = CHAIN_SIZE_ESTIMATES[network];
  const settings: SettingRecommendation[] = [];
  const consequences: string[] = [];
  const blockers: string[] = [];
  const add = (key: string, value: string, reason: string) => settings.push({ key, value, reason });

  add('server', '1', 'BTCortex and connected wallets talk to the node over RPC.');

  // Disk: decide whether the full chain fits, otherwise size the prune target.
  const reserve = Math.max(MIN_RESERVE_BYTES, RESERVE_FRACTION * hardware.volumeBytes);
  const available = hardware.freeDiskBytes - sizes.chainstateBytes - reserve - MISCELLANEOUS_BYTES;
  // An Electrum server's indexes go on the same disk by default.
  const electrumBytes =
    usage === 'electrum-backend'
      ? Math.round(sizes.blocksBytes * (INDEX_SIZE_RATIOS.transactionIndex + INDEX_SIZE_RATIOS.electrumIndex))
      : 0;
  const fullChainFits = network === 'regtest' || available >= sizes.blocksBytes + electrumBytes;
  let pruned = false;
  let pruneTargetMiB: number | undefined;

  if (usage === 'electrum-backend' && !fullChainFits) {
    blockers.push(
      `An Electrum server needs the complete ${NETWORK_PARAMETERS[network].label} blockchain and its indexes (about ${formatGb(sizes.blocksBytes + sizes.chainstateBytes + electrumBytes)}), but only ${formatGb(hardware.freeDiskBytes)} is free.`,
    );
  }

  if (!fullChainFits) {
    const minimumBytes = MIN_PRUNE_MIB * MIB;
    if (available < minimumBytes) {
      blockers.push(
        `Even a pruned ${NETWORK_PARAMETERS[network].label} node needs about ${formatGb(sizes.chainstateBytes + minimumBytes + reserve + MISCELLANEOUS_BYTES)} of free space; ${formatGb(hardware.freeDiskBytes)} is available.`,
      );
    } else {
      pruned = true;
      const halfMiB = (0.5 * available) / MIB;
      const clamped = Math.min(PRUNE_CEILING_MIB, Math.max(PRUNE_FLOOR_MIB, halfMiB));
      const bounded = Math.min(clamped, available / MIB);
      pruneTargetMiB = Math.max(MIN_PRUNE_MIB, Math.floor(bounded / PRUNE_STEP_MIB) * PRUNE_STEP_MIB);
      add(
        'prune',
        String(pruneTargetMiB),
        `The full chain (about ${formatGb(sizes.blocksBytes)}) does not fit in the free space, so only the most recent blocks are kept.`,
      );
      consequences.push(
        'Pruning keeps only recent blocks: Electrum servers, transaction indexes and explorers that need the whole chain cannot use this node.',
        'Wallets can only see history after the node was set up; restoring an older wallet will not find earlier transactions.',
        'Switching back to a full node later means downloading the whole blockchain again.',
        'The whole blockchain is still downloaded and verified once during the initial synchronisation.',
      );
    }
  }

  // Memory.
  const maxMempoolMB = hardware.totalMemoryBytes < 4 * GIB ? 150 : 300;
  const upstreamDbcacheMiB = hardware.totalMemoryBytes >= 4 * GIB ? 1024 : 450;
  const memoryHeadroomMiB = (hardware.availableMemoryBytes - 1.5 * GIB) / MIB - maxMempoolMB;
  const quarterOfMemoryMiB = (0.25 * hardware.totalMemoryBytes) / MIB;
  let dbcacheMiB = upstreamDbcacheMiB;
  if (Math.min(quarterOfMemoryMiB, memoryHeadroomMiB) < upstreamDbcacheMiB) {
    dbcacheMiB = Math.max(450, Math.floor(Math.min(quarterOfMemoryMiB, memoryHeadroomMiB) / 50) * 50);
  }
  add(
    'dbcache',
    String(dbcacheMiB),
    dbcacheMiB === upstreamDbcacheMiB
      ? 'Matches the Bitcoin Core default for this amount of memory.'
      : 'Reduced from the Bitcoin Core default because little memory is free.',
  );
  add(
    'maxmempool',
    String(maxMempoolMB),
    maxMempoolMB === 300
      ? 'Bitcoin Core default; keeps fee estimation accurate.'
      : 'Reduced because this computer has less than 4 GiB of memory.',
  );

  // Connections: modest, outbound-only by default (no router mapping, no firewall prompt).
  add('maxconnections', '40', 'Ample for a desktop node and unaffected by the 32.0 default change.');
  add(
    'listen',
    '0',
    'No incoming connections by default: no router port mapping and no firewall prompt. Can be enabled later.',
  );
  add('natpmp', '0', 'Router port mapping stays off while incoming connections are disabled.');

  if (usage === 'wallet-backend') {
    consequences.push(
      'Wallets such as Sparrow connected directly to this node use its wallet functions, so the node wallet stays enabled.',
    );
  }
  if (usage === 'electrum-backend' && fullChainFits) {
    add(
      'txindex',
      '1',
      'The Electrum server (Fulcrum) needs every transaction indexed; building the index while the node synchronises saves building it afterwards.',
    );
    consequences.push(
      'BTCortex also sets up Fulcrum, an Electrum server, after checking its signature. It starts indexing once the node has caught up with the network, and wallets such as Sparrow, Electrum and Trezor Suite can then use your node.',
    );
  }

  const blocksOnDisk = pruned && pruneTargetMiB !== undefined ? pruneTargetMiB * MIB : sizes.blocksBytes;
  const estimatedFootprintBytes =
    network === 'regtest' ? 100 * MIB : blocksOnDisk + sizes.chainstateBytes + GB + (pruned ? 0 : electrumBytes);

  return {
    feasible: blockers.length === 0,
    blockers,
    settings,
    pruned,
    pruneTargetMiB,
    estimatedFootprintBytes,
    consequences,
  };
}
