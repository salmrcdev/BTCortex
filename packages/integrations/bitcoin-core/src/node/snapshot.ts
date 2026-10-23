import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import type { NodeSnapshot, PeerSummary } from '@btcortex/contracts';

// Converts RPC results into the shared domain model. Units are made explicit
// here (bytes, BTC/kvB) so the interface never has to guess.

const MB = 1_000_000;

export async function takeSnapshot(
  client: BitcoinRpcClient,
  now: () => Date = () => new Date(),
): Promise<NodeSnapshot> {
  const [blockchain, network, mempool, traffic, uptime] = await Promise.all([
    client.getBlockchainInfo(),
    client.getNetworkInfo(),
    client.getMempoolInfo(),
    client.getNetTotals(),
    client.uptime(),
  ]);

  return {
    takenAt: now().toISOString(),
    blockchain: {
      chain: blockchain.chain,
      blocks: blockchain.blocks,
      headers: blockchain.headers,
      bestBlockHash: blockchain.bestblockhash,
      difficulty: blockchain.difficulty,
      medianTime: blockchain.mediantime,
      verificationProgress: blockchain.verificationprogress,
      initialBlockDownload: blockchain.initialblockdownload,
      sizeOnDiskBytes: blockchain.size_on_disk,
      pruned: blockchain.pruned,
      ...(blockchain.pruneheight === undefined ? {} : { pruneHeight: blockchain.pruneheight }),
      ...(blockchain.prune_target_size === undefined ? {} : { pruneTargetBytes: blockchain.prune_target_size }),
      warnings: blockchain.warnings,
    },
    network: {
      version: network.version,
      subversion: network.subversion,
      protocolVersion: network.protocolversion,
      connections: network.connections,
      connectionsIn: network.connections_in,
      connectionsOut: network.connections_out,
      networkActive: network.networkactive,
      relayFeeBtcPerKvB: network.relayfee,
      reachableNetworks: network.networks.filter((entry) => entry.reachable).map((entry) => entry.name),
      localServices: network.localservicesnames ?? [],
      warnings: network.warnings,
    },
    mempool: {
      loaded: mempool.loaded,
      transactions: mempool.size,
      virtualBytes: mempool.bytes,
      memoryUsageBytes: mempool.usage,
      // getmempoolinfo reports maxmempool in bytes.
      maxMemoryBytes: mempool.maxmempool,
      minimumFeeBtcPerKvB: mempool.mempoolminfee,
      minimumRelayFeeBtcPerKvB: mempool.minrelaytxfee,
      ...(mempool.total_fee === undefined ? {} : { totalFeeBtc: mempool.total_fee }),
    },
    traffic: { bytesReceived: traffic.totalbytesrecv, bytesSent: traffic.totalbytessent },
    uptimeSeconds: uptime,
  };
}

export async function listPeers(client: BitcoinRpcClient): Promise<PeerSummary[]> {
  const peers = await client.getPeerInfo();
  return peers.map((peer) => ({
    id: peer.id,
    address: peer.addr,
    network: peer.network,
    inbound: peer.inbound,
    ...(peer.connection_type === undefined ? {} : { connectionType: peer.connection_type }),
    ...(peer.transport_protocol_type === undefined ? {} : { transport: peer.transport_protocol_type }),
    userAgent: peer.subver,
    protocolVersion: peer.version,
    services: peer.servicesnames ?? [],
    ...(peer.pingtime === undefined ? {} : { pingSeconds: peer.pingtime }),
    bytesSent: peer.bytessent,
    bytesReceived: peer.bytesrecv,
    connectedSince: peer.conntime,
    ...(peer.synced_headers === undefined ? {} : { syncedHeaders: peer.synced_headers }),
    ...(peer.synced_blocks === undefined ? {} : { syncedBlocks: peer.synced_blocks }),
    relaysTransactions: peer.relaytxes,
    permissions: peer.permissions ?? [],
    ...(peer.minping === undefined ? {} : { minPingSeconds: peer.minping }),
    ...(peer.last_block === undefined ? {} : { lastBlockAt: peer.last_block }),
    ...(peer.last_transaction === undefined ? {} : { lastTransactionAt: peer.last_transaction }),
  }));
}

/** Upstream `maxmempool` option is in MB; RPC reports bytes. */
export function maxMempoolOptionToBytes(megabytes: number): number {
  return megabytes * MB;
}
