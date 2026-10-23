import { z } from 'zod';

// BTCortex's own block explorer (specification section 12): blocks,
// transactions, scripts, fees and chain statistics from the user's node, and
// address lookups only through the node's Electrum server, since Bitcoin
// Core keeps no index of addresses. Every figure says where it came from;
// nothing is fetched from external services. Amounts are in satoshis and
// fee rates in sat/vB.

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Sats = z.number().int();

/**
 * What a search found:
 * - `block`: a height or block hash; `id` is the block hash.
 * - `transaction`: a txid the node knows; `id` is the txid.
 * - `address`: a valid address for the node's network.
 * - `raw-transaction`: hex that decodes as a transaction.
 * - `script`: hex that is not a transaction but decodes as a script.
 * - `none`: nothing; `message` says why.
 */
export const ExplorerSearchResultSchema = z.object({
  kind: z.enum(['block', 'transaction', 'address', 'raw-transaction', 'script', 'none']),
  id: z.string().optional(),
  message: z.string().optional(),
});
export type ExplorerSearchResult = z.infer<typeof ExplorerSearchResultSchema>;

export const ScriptSummarySchema = z.object({
  hex: z.string(),
  asm: z.string(),
  /** Bitcoin Core's name for the script type, for example `witness_v0_keyhash`. */
  type: z.string(),
  address: z.string().optional(),
  /** The output descriptor Bitcoin Core infers, when it has one. */
  descriptor: z.string().optional(),
});
export type ScriptSummary = z.infer<typeof ScriptSummarySchema>;

export const TransactionInputSchema = z.object({
  /** Absent for the coinbase input. */
  previous: z.object({ txid: Hex64, vout: z.number().int().nonnegative() }).optional(),
  coinbase: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  scriptSig: z.object({ hex: z.string(), asm: z.string() }).optional(),
  witness: z.array(z.string()),
  /** The coin it spends, when the node can tell. */
  prevout: z
    .object({
      valueSats: Sats,
      script: ScriptSummarySchema,
      coinbase: z.boolean(),
      height: z.number().int().optional(),
    })
    .optional(),
});
export type TransactionInput = z.infer<typeof TransactionInputSchema>;

export const TransactionOutputSchema = z.object({
  n: z.number().int().nonnegative(),
  valueSats: Sats,
  script: ScriptSummarySchema,
  /** Whether the output is still unspent at the node's tip; `null` when it cannot tell (for example a pruned spender). */
  unspent: z.boolean().nullable(),
});
export type TransactionOutput = z.infer<typeof TransactionOutputSchema>;

export const TransactionDetailSchema = z.object({
  txid: Hex64,
  /** The witness transaction id. */
  wtxid: Hex64,
  version: z.number().int(),
  lockTime: z.number().int().nonnegative(),
  sizeBytes: z.number().int().positive(),
  vsize: z.number().int().positive(),
  weight: z.number().int().positive(),
  segwit: z.boolean(),
  /** An input signals BIP 125 replaceability. */
  signalsReplaceable: z.boolean(),
  status: z.discriminatedUnion('state', [
    z.object({ state: z.literal('mempool'), firstSeen: z.number().int().optional() }),
    z.object({
      state: z.literal('confirmed'),
      blockHash: Hex64,
      blockHeight: z.number().int().nonnegative(),
      blockTime: z.number().int(),
      confirmations: z.number().int().positive(),
    }),
    /** Decoded from raw hex the node has not seen. */
    z.object({ state: z.literal('not-seen') }),
  ]),
  /** Known when every input's coin is known, or from the mempool. */
  feeSats: Sats.nullable(),
  feeRate: z.number().nonnegative().nullable(),
  totalInputSats: Sats.nullable(),
  totalOutputSats: Sats,
  inputs: z.array(TransactionInputSchema),
  outputs: z.array(TransactionOutputSchema),
  /** For a transaction in the mempool: its relatives there. */
  mempool: z
    .object({
      ancestorCount: z.number().int().nonnegative(),
      descendantCount: z.number().int().nonnegative(),
      /** Unconfirmed transactions it spends from. */
      depends: z.array(Hex64),
      /** Unconfirmed transactions that spend from it. */
      spentBy: z.array(Hex64),
      ancestorFeeRate: z.number().nonnegative().nullable(),
    })
    .optional(),
  hex: z.string(),
});
export type TransactionDetail = z.infer<typeof TransactionDetailSchema>;

export const RawTransactionCheckSchema = z.object({
  transaction: TransactionDetailSchema,
  /** What the node's mempool would say to it, without broadcasting it. */
  acceptance: z.object({ allowed: z.boolean(), reason: z.string().optional() }).nullable(),
});
export type RawTransactionCheck = z.infer<typeof RawTransactionCheckSchema>;

export const BlockTransactionSummarySchema = z.object({
  txid: Hex64,
  vsize: z.number().int().positive(),
  feeSats: Sats.nullable(),
  feeRate: z.number().nonnegative().nullable(),
  outputSats: Sats,
  inputs: z.number().int().nonnegative(),
  outputs: z.number().int().nonnegative(),
  coinbase: z.boolean(),
});
export type BlockTransactionSummary = z.infer<typeof BlockTransactionSummarySchema>;

export const BlockDetailSchema = z.object({
  hash: Hex64,
  height: z.number().int().nonnegative(),
  confirmations: z.number().int(),
  time: z.number().int(),
  medianTime: z.number().int(),
  version: z.number().int(),
  versionHex: z.string(),
  merkleRoot: Hex64,
  bits: z.string(),
  nonce: z.number().int().nonnegative(),
  difficulty: z.number(),
  transactionCount: z.number().int().positive(),
  /** Known only while the node still has the block; `null` once it is pruned. */
  sizeBytes: z.number().int().nonnegative().nullable(),
  strippedSizeBytes: z.number().int().nonnegative().nullable(),
  weight: z.number().int().nonnegative().nullable(),
  previousHash: Hex64.nullable(),
  nextHash: Hex64.nullable(),
  /** Readable text in the coinbase input, such as a pool's tag. */
  coinbaseText: z.string().nullable(),
  /** `false` when the node pruned the block: only its header is known. */
  available: z.boolean(),
  stats: z
    .object({
      subsidySats: Sats,
      totalFeeSats: Sats,
      totalOutputSats: Sats,
      /** 10th, 25th, 50th, 75th and 90th percentile, weighted by size. */
      feeRatePercentiles: z.array(z.number().nonnegative()).length(5),
      averageFeeRate: z.number().nonnegative(),
      inputs: z.number().int().nonnegative(),
      outputs: z.number().int().nonnegative(),
    })
    .nullable(),
  /** One page of the block's transactions. */
  transactions: z.array(BlockTransactionSummarySchema),
  page: z.object({ index: z.number().int().nonnegative(), size: z.number().int().positive(), total: z.number().int() }),
});
export type BlockDetail = z.infer<typeof BlockDetailSchema>;

export const AddressDetailSchema = z.object({
  address: z.string(),
  script: ScriptSummarySchema,
  /** Electrum's key for the script: the reversed SHA-256 of its bytes. */
  scripthash: Hex64,
  /** Where the history comes from: the node's own Electrum server, one on another computer, or nowhere. */
  source: z.enum(['electrum-server', 'remote-electrum-server', 'unavailable']),
  /** The Electrum server on another computer that answered, which learns the address. */
  sourceName: z.string().optional(),
  /** Why there is no history, when there is none to show. */
  unavailableReason: z.string().optional(),
  balance: z.object({ confirmedSats: Sats, unconfirmedSats: Sats }).nullable(),
  history: z.array(z.object({ txid: Hex64, height: z.number().int(), feeSats: Sats.optional() })),
  unspent: z.array(
    z.object({ txid: Hex64, vout: z.number().int().nonnegative(), valueSats: Sats, height: z.number().int() }),
  ),
});
export type AddressDetail = z.infer<typeof AddressDetailSchema>;

export const ExplorerOverviewSchema = z.object({
  chain: z.string(),
  height: z.number().int().nonnegative(),
  bestBlockHash: Hex64,
  difficulty: z.number(),
  /** Hashes a second, estimated from the last 120 blocks. */
  networkHashRate: z.number().nonnegative().nullable(),
  /** Transactions in the chain, and their rate over the last month of blocks. */
  transactions: z
    .object({ count: z.number().int().nonnegative(), perSecond: z.number().nonnegative().nullable() })
    .nullable(),
  pruned: z.boolean(),
  /** The lowest block the node still holds, on a pruned node. */
  pruneHeight: z.number().int().nonnegative().nullable(),
  transactionIndex: z.boolean(),
  /** Address lookups work through the node's Electrum server. */
  addressLookups: z.boolean(),
  /** Bitcoin Core's estimates, in sat/vB; `null` while it has too little data. */
  feeEstimates: z.object({
    nextBlock: z.number().nonnegative().nullable(),
    halfHour: z.number().nonnegative().nullable(),
    hour: z.number().nonnegative().nullable(),
    day: z.number().nonnegative().nullable(),
  }),
  mempool: z.object({
    transactions: z.number().int().nonnegative(),
    vsize: z.number().int().nonnegative(),
    minimumFeeRate: z.number().nonnegative(),
  }),
  recentBlocks: z.array(
    z.object({
      hash: Hex64,
      height: z.number().int().nonnegative(),
      time: z.number().int(),
      transactionCount: z.number().int().nonnegative(),
      sizeBytes: z.number().int().nonnegative(),
      /** Median fee rate in sat/vB, when the block is available. */
      medianFeeRate: z.number().nonnegative().nullable(),
    }),
  ),
});
export type ExplorerOverview = z.infer<typeof ExplorerOverviewSchema>;
