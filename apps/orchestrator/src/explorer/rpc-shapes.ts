import { z } from 'zod';

// The shapes of the Bitcoin Core answers the explorer reads (as observed with
// 31.1). Objects are loose: newer versions add fields, and only these are used.

export const ScriptPubKeyShape = z.looseObject({
  asm: z.string(),
  hex: z.string(),
  type: z.string(),
  address: z.string().optional(),
  desc: z.string().optional(),
});
export type ScriptPubKeyRaw = z.infer<typeof ScriptPubKeyShape>;

export const InputShape = z.looseObject({
  txid: z.string().optional(),
  vout: z.number().int().optional(),
  coinbase: z.string().optional(),
  scriptSig: z.looseObject({ asm: z.string(), hex: z.string() }).optional(),
  txinwitness: z.array(z.string()).optional(),
  sequence: z.number(),
  /** With verbosity 2 for a confirmed transaction whose block's undo data the node still has. */
  prevout: z
    .looseObject({
      generated: z.boolean(),
      height: z.number().int(),
      value: z.number(),
      scriptPubKey: ScriptPubKeyShape,
    })
    .optional(),
});
export type InputRaw = z.infer<typeof InputShape>;

export const OutputShape = z.looseObject({ value: z.number(), n: z.number().int(), scriptPubKey: ScriptPubKeyShape });

export const TransactionShape = z.looseObject({
  txid: z.string(),
  hash: z.string(),
  version: z.number().int(),
  size: z.number().int(),
  vsize: z.number().int(),
  weight: z.number().int(),
  locktime: z.number().int(),
  vin: z.array(InputShape),
  vout: z.array(OutputShape),
  hex: z.string().optional(),
  fee: z.number().optional(),
  blockhash: z.string().optional(),
  confirmations: z.number().int().optional(),
  blocktime: z.number().int().optional(),
});
export type TransactionRaw = z.infer<typeof TransactionShape>;

export const MempoolEntryShape = z.looseObject({
  vsize: z.number().int(),
  time: z.number().int(),
  ancestorcount: z.number().int(),
  ancestorsize: z.number().int(),
  descendantcount: z.number().int(),
  fees: z.looseObject({ base: z.number(), ancestor: z.number() }),
  depends: z.array(z.string()),
  spentby: z.array(z.string()),
});
export type MempoolEntryRaw = z.infer<typeof MempoolEntryShape>;

export const TxOutShape = z
  .looseObject({
    confirmations: z.number().int(),
    value: z.number(),
    scriptPubKey: ScriptPubKeyShape,
    coinbase: z.boolean(),
  })
  .nullable();

export const HeaderShape = z.looseObject({
  hash: z.string(),
  confirmations: z.number().int(),
  height: z.number().int(),
  version: z.number().int(),
  versionHex: z.string(),
  merkleroot: z.string(),
  time: z.number().int(),
  mediantime: z.number().int(),
  nonce: z.number().int(),
  bits: z.string(),
  difficulty: z.number(),
  nTx: z.number().int(),
  previousblockhash: z.string().optional(),
  nextblockhash: z.string().optional(),
});
export type HeaderRaw = z.infer<typeof HeaderShape>;

export const BlockShape = HeaderShape.extend({
  size: z.number().int(),
  strippedsize: z.number().int(),
  weight: z.number().int(),
  tx: z.array(TransactionShape),
  coinbase_tx: z.looseObject({ coinbase: z.string() }).optional(),
});
export type BlockRaw = z.infer<typeof BlockShape>;

export const BlockStatsShape = z.looseObject({
  subsidy: z.number(),
  totalfee: z.number(),
  total_out: z.number(),
  feerate_percentiles: z.array(z.number()).length(5),
  avgfeerate: z.number(),
  ins: z.number().int(),
  outs: z.number().int(),
});

export const RecentBlockStatsShape = z.looseObject({
  feerate_percentiles: z.array(z.number()).length(5),
  total_size: z.number().int(),
});

export const ValidateAddressShape = z.looseObject({
  isvalid: z.boolean(),
  address: z.string().optional(),
  scriptPubKey: z.string().optional(),
  error: z.string().optional(),
});

export const DecodedScriptShape = z.looseObject({
  asm: z.string(),
  type: z.string(),
  address: z.string().optional(),
  desc: z.string().optional(),
});

export const MempoolAcceptShape = z.array(
  z.looseObject({ allowed: z.boolean(), 'reject-reason': z.string().optional() }),
);

export const SmartFeeShape = z.looseObject({ feerate: z.number().optional() });

export const ChainTxStatsShape = z.looseObject({ txcount: z.number().int(), txrate: z.number().optional() });

export const MempoolInfoShape = z.looseObject({
  size: z.number().int(),
  bytes: z.number().int(),
  mempoolminfee: z.number(),
});
