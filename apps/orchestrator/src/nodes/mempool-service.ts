import { z } from 'zod';
import { BitcoinRpcError } from '@btcortex/bitcoin-rpc';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { AppFailure } from '@btcortex/contracts';
import type {
  FeeEstimate,
  FeeRateBucket,
  MempoolOverview,
  MempoolTransaction,
  PolicyFeature,
  PolicyFeatureId,
} from '@btcortex/contracts';
import { describeNodeError, nodeComponent } from './node-errors';
import type { NodeManager } from './node-manager';

// Mempool analysis (specification section 5.9), from this node's own mempool:
// the fee-rate distribution comes from the cluster mempool's feerate diagram
// (getmempoolfeeratediagram, 31.0+), so the whole mempool is never downloaded;
// a transaction's real priority is the fee rate of its chunk, which already
// accounts for child-pays-for-parent.

const SATS_PER_BTC = 100_000_000;
/** BTC/kvB to sat/vB. */
const BTC_PER_KVB_IN_SAT_PER_VB = 100_000;
const BLOCK_WEIGHT = 4_000_000;
/** Bitcoin Core keeps this much of a block for the coinbase by default (blockreservedweight, 30.0+). */
const RESERVED_WEIGHT = 8_000;
const ESTIMATE_TARGETS = [1, 2, 3, 6, 12, 24, 144, 1008];
/** Lower edges of the fee-rate buckets, sat/vB; the last one is open-ended. */
const BUCKET_EDGES = [0, 1, 2, 3, 5, 10, 20, 50, 100, 200];
/** "Transaction not in mempool" and "No such mempool or blockchain transaction". */
const NOT_IN_MEMPOOL = -5;
/** Relay features that came with a Bitcoin Core release rather than a setting (release notes 28.0 to 31.0). */
const POLICY_FEATURES: readonly { id: PolicyFeatureId; since: number }[] = [
  { id: 'package-relay', since: 280_000 },
  { id: 'truc', since: 280_000 },
  { id: 'pay-to-anchor', since: 280_000 },
  { id: 'ephemeral-dust', since: 290_000 },
  { id: 'cluster-mempool', since: 310_000 },
];

const MempoolInfoSchema = z.looseObject({
  loaded: z.boolean(),
  size: z.number(),
  bytes: z.number(),
  usage: z.number(),
  total_fee: z.number().optional(),
  maxmempool: z.number(),
  mempoolminfee: z.number(),
  minrelaytxfee: z.number(),
  incrementalrelayfee: z.number().optional(),
  unbroadcastcount: z.number().optional(),
  fullrbf: z.boolean().optional(),
  limitclustercount: z.number().optional(),
  limitclustersize: z.number().optional(),
  maxdatacarriersize: z.number().optional(),
});
const NetworkInfoSchema = z.looseObject({ version: z.number(), subversion: z.string() });
const DiagramSchema = z.array(z.looseObject({ weight: z.number(), fee: z.number() }));
const EstimateSchema = z.looseObject({ feerate: z.number().optional(), blocks: z.number().optional() });
const EntrySchema = z.looseObject({
  vsize: z.number(),
  weight: z.number(),
  time: z.number(),
  height: z.number(),
  descendantcount: z.number(),
  descendantsize: z.number(),
  ancestorcount: z.number(),
  ancestorsize: z.number(),
  wtxid: z.string(),
  chunkweight: z.number().optional(),
  fees: z.looseObject({
    base: z.number(),
    modified: z.number(),
    ancestor: z.number(),
    descendant: z.number(),
    chunk: z.number().optional(),
  }),
  depends: z.array(z.string()),
  spentby: z.array(z.string()),
  'bip125-replaceable': z.boolean().optional(),
  unbroadcast: z.boolean().optional(),
});
const ClusterSchema = z.looseObject({
  clusterweight: z.number(),
  txcount: z.number(),
  chunks: z.array(z.looseObject({ chunkfee: z.number(), chunkweight: z.number(), txs: z.array(z.string()) })),
});
const RawTransactionSchema = z.looseObject({
  vin: z.array(z.unknown()),
  vout: z.array(
    z.looseObject({
      value: z.number(),
      n: z.number(),
      scriptPubKey: z.looseObject({ address: z.string().optional(), type: z.string() }),
    }),
  ),
});

function sats(btc: number): number {
  return Math.round(btc * SATS_PER_BTC);
}

/** sat/vB from a fee in BTC and a weight in weight units. */
function feeRate(feeBtc: number, weight: number): number {
  return weight > 0 ? Math.round(((sats(feeBtc) * 4) / weight) * 100) / 100 : 0;
}

/** Fee-rate buckets and the next block's lowest fee rate from the cumulative feerate diagram. */
export function readFeeRateDiagram(points: readonly { weight: number; fee: number }[]): {
  buckets: FeeRateBucket[];
  nextBlockMinimumSatPerVb: number | null;
} {
  const buckets: FeeRateBucket[] = BUCKET_EDGES.map((minimum, index) => ({
    minimum,
    maximum: BUCKET_EDGES[index + 1] ?? null,
    virtualBytes: 0,
    feeSats: 0,
  }));
  let nextBlockMinimum: number | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point) continue;
    const weight = point.weight - previous.weight;
    if (weight <= 0) continue;
    const feeSats = sats(point.fee - previous.fee);
    const rate = (feeSats * 4) / weight;
    const bucket = [...buckets].reverse().find((candidate) => rate >= candidate.minimum) ?? buckets[0];
    if (bucket) {
      bucket.virtualBytes += weight / 4;
      bucket.feeSats += feeSats;
    }
    // The diagram is in mining order, so the segment crossing the block boundary sets the bar for the next block.
    if (nextBlockMinimum === null && point.weight >= BLOCK_WEIGHT - RESERVED_WEIGHT) {
      nextBlockMinimum = Math.round(rate * 100) / 100;
    }
  }
  return { buckets, nextBlockMinimumSatPerVb: nextBlockMinimum };
}

/**
 * Which version-dependent relay features a node has. `null` unless it is Bitcoin Core: Bitcoin Knots
 * reports similar version numbers with a different policy.
 */
export function policyFeatures(version: number, subversion: string): PolicyFeature[] | null {
  if (!/^\/Satoshi:\d/.test(subversion) || /knots/i.test(subversion)) return null;
  return POLICY_FEATURES.map((feature) => ({
    id: feature.id,
    supported: version >= feature.since,
    since: `${String(Math.floor(feature.since / 10_000))}.${String(Math.floor(feature.since / 100) % 100)}`,
  }));
}

/**
 * The least a replacement of the same size must pay (replacement rules 3 and 4): at least the fees of
 * everything it replaces, that is this transaction and its descendants, plus the incremental relay fee
 * for its own size, rounded up as Bitcoin Core rounds it.
 */
export function replacementTerms(options: {
  virtualBytes: number;
  descendantFeeSats: number;
  descendantCount: number;
  incrementalRelayFeeBtcPerKvB: number;
  clusterMempool: boolean;
}): NonNullable<MempoolTransaction['replacement']> {
  const satsPerKvB = Math.round(options.incrementalRelayFeeBtcPerKvB * SATS_PER_BTC);
  const minimumFeeSats = options.descendantFeeSats + Math.ceil((satsPerKvB * options.virtualBytes) / 1000);
  return {
    minimumFeeSats,
    minimumSatPerVb: Math.round((minimumFeeSats / Math.max(1, options.virtualBytes)) * 100) / 100,
    replacedFeeSats: options.descendantFeeSats,
    evicts: Math.max(0, options.descendantCount - 1),
    mustImproveDiagram: options.clusterMempool,
  };
}

export interface MempoolServiceOptions {
  nodes: Pick<NodeManager, 'get' | 'rpc'>;
}

export class MempoolService {
  constructor(private readonly options: MempoolServiceOptions) {}

  async overview(nodeId: string): Promise<MempoolOverview> {
    return this.withNode(nodeId, async (client) => {
      const info = MempoolInfoSchema.parse(await client.call('getmempoolinfo'));
      const network = NetworkInfoSchema.parse(await client.call('getnetworkinfo'));
      let diagram: ReturnType<typeof readFeeRateDiagram> | undefined;
      try {
        diagram = readFeeRateDiagram(DiagramSchema.parse(await client.call('getmempoolfeeratediagram')));
      } catch (error) {
        // Older versions and other implementations do not have it; everything else still works.
        if (!(error instanceof BitcoinRpcError && error.isMethodNotFound)) throw error;
      }
      const estimates: FeeEstimate[] = [];
      for (const target of ESTIMATE_TARGETS) {
        const estimate = EstimateSchema.parse(await client.call('estimatesmartfee', [target, 'economical']));
        estimates.push({
          target,
          satPerVb:
            estimate.feerate === undefined
              ? null
              : Math.round(estimate.feerate * BTC_PER_KVB_IN_SAT_PER_VB * 100) / 100,
          blocks: estimate.blocks ?? null,
        });
      }
      return {
        loaded: info.loaded,
        transactions: info.size,
        virtualBytes: info.bytes,
        memoryUsageBytes: info.usage,
        maxMemoryBytes: info.maxmempool,
        totalFeeBtc: info.total_fee ?? 0,
        minimumFeeSatPerVb: info.mempoolminfee * BTC_PER_KVB_IN_SAT_PER_VB,
        minimumRelayFeeSatPerVb: info.minrelaytxfee * BTC_PER_KVB_IN_SAT_PER_VB,
        incrementalRelayFeeSatPerVb: (info.incrementalrelayfee ?? 0) * BTC_PER_KVB_IN_SAT_PER_VB,
        unbroadcast: info.unbroadcastcount ?? 0,
        fullRbf: info.fullrbf ?? true,
        ...(info.limitclustercount === undefined ? {} : { clusterLimitCount: info.limitclustercount }),
        ...(info.limitclustersize === undefined ? {} : { clusterLimitVirtualBytes: info.limitclustersize }),
        ...(info.maxdatacarriersize === undefined ? {} : { maxDataCarrierBytes: info.maxdatacarriersize }),
        feeRateBuckets: diagram?.buckets ?? null,
        nextBlockMinimumSatPerVb: diagram?.nextBlockMinimumSatPerVb ?? null,
        estimates,
        policyFeatures: policyFeatures(network.version, network.subversion),
      };
    });
  }

  async transaction(nodeId: string, txid: string): Promise<MempoolTransaction> {
    const id = txid.toLowerCase();
    return this.withNode(nodeId, async (client) => {
      let entry: z.infer<typeof EntrySchema>;
      try {
        entry = EntrySchema.parse(await client.call('getmempoolentry', [id]));
      } catch (error) {
        if (error instanceof BitcoinRpcError && error.code === NOT_IN_MEMPOOL) {
          throw new AppFailure({
            code: 'mempool.not-found',
            message:
              'This transaction is not in this node’s mempool. It may have been confirmed, replaced or evicted, or the node never received it.',
            component: nodeComponent(this.options.nodes.get(nodeId).profile),
            dataRisk: 'none',
            recoveryActions: [],
          });
        }
        throw error;
      }
      const [info, cluster, raw] = await Promise.all([
        client.call('getmempoolinfo').then((value) => MempoolInfoSchema.parse(value)),
        client
          .call('getmempoolcluster', [id])
          .then((value) => ClusterSchema.parse(value))
          .catch((error: unknown) => {
            if (error instanceof BitcoinRpcError && error.isMethodNotFound) return undefined;
            throw error;
          }),
        client.call('getrawtransaction', [id, true]).then((value) => RawTransactionSchema.parse(value)),
      ]);
      const chunkWeight = entry.chunkweight ?? entry.weight;
      const chunkFee = entry.fees.chunk ?? entry.fees.ancestor;
      // Full RBF has been the default since 28.0; signalling still counts where it is switched off.
      const replaceable = entry['bip125-replaceable'] === true || (info.fullrbf ?? true);
      return {
        txid: id,
        wtxid: entry.wtxid,
        virtualBytes: entry.vsize,
        weight: entry.weight,
        feeSats: sats(entry.fees.base),
        satPerVb: feeRate(entry.fees.base, entry.weight),
        seenAt: entry.time,
        heightWhenSeen: entry.height,
        ancestors: {
          count: entry.ancestorcount,
          virtualBytes: entry.ancestorsize,
          feeSats: sats(entry.fees.ancestor),
        },
        descendants: {
          count: entry.descendantcount,
          virtualBytes: entry.descendantsize,
          feeSats: sats(entry.fees.descendant),
        },
        chunk: { feeSats: sats(chunkFee), weight: chunkWeight, satPerVb: feeRate(chunkFee, chunkWeight) },
        parents: entry.depends,
        children: entry.spentby,
        replaceable,
        replacement: replaceable
          ? replacementTerms({
              virtualBytes: entry.vsize,
              descendantFeeSats: sats(entry.fees.descendant),
              descendantCount: entry.descendantcount,
              incrementalRelayFeeBtcPerKvB: info.incrementalrelayfee ?? 0,
              // Chunk data in getmempoolentry is how the cluster mempool (31.0+) shows itself.
              clusterMempool: entry.chunkweight !== undefined,
            })
          : null,
        unbroadcast: entry.unbroadcast ?? false,
        ...(cluster
          ? {
              cluster: {
                transactions: cluster.txcount,
                weight: cluster.clusterweight,
                chunks: cluster.chunks.map((chunk) => ({
                  feeSats: sats(chunk.chunkfee),
                  weight: chunk.chunkweight,
                  satPerVb: feeRate(chunk.chunkfee, chunk.chunkweight),
                  txids: chunk.txs,
                })),
              },
            }
          : {}),
        inputs: raw.vin.length,
        outputs: raw.vout.map((output) => ({
          index: output.n,
          valueSats: sats(output.value),
          ...(output.scriptPubKey.address === undefined ? {} : { address: output.scriptPubKey.address }),
          type: output.scriptPubKey.type,
        })),
      };
    });
  }

  private async withNode<T>(nodeId: string, action: (client: BitcoinRpcClient) => Promise<T>): Promise<T> {
    const { profile } = this.options.nodes.get(nodeId);
    try {
      return await action(this.options.nodes.rpc(nodeId));
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      throw new AppFailure(describeNodeError(profile, error));
    }
  }
}
