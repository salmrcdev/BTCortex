import { z } from 'zod';
import { PsbtAnalysisSchema } from './devtools';
import { QrMatrixSchema } from './hardware';

// Transaction tools (specification section 14): addresses checked by the
// node, payment URIs made and read by BIP 321 (the successor of BIP 21).
// Reading a URI never pays, opens a callback or sends anything.

export const AddressTypeSchema = z.enum([
  'p2pkh',
  'p2sh',
  'p2wpkh',
  'p2wsh',
  'p2tr',
  'p2a',
  'witness-unknown',
  'unknown',
]);
export type AddressType = z.infer<typeof AddressTypeSchema>;

export const AddressCheckSchema = z.object({
  address: z.string(),
  /** Valid for the node's network; addresses of other networks are refused. */
  valid: z.boolean(),
  /** The node's reason when it refuses the address. */
  error: z.string().nullable(),
  /** Where the node found mistakes in a bech32 address, as character positions. */
  errorLocations: z.array(z.number().int().nonnegative()),
  type: AddressTypeSchema.nullable(),
  scriptPubKey: z.string().nullable(),
  witnessVersion: z.number().int().nullable(),
  witnessProgram: z.string().nullable(),
});
export type AddressCheck = z.infer<typeof AddressCheckSchema>;

export const PaymentUriRequestSchema = z
  .object({
    nodeId: z.string().min(1),
    address: z.string().trim().min(14).max(120),
    amountSats: z.number().int().positive().max(2_100_000_000_000_000).optional(),
    label: z.string().max(200).optional(),
    message: z.string().max(500).optional(),
  })
  .strict();
export type PaymentUriRequest = z.infer<typeof PaymentUriRequestSchema>;

export const PaymentUriSchema = z.object({
  uri: z.string(),
  qr: QrMatrixSchema,
  address: AddressCheckSchema,
});
export type PaymentUri = z.infer<typeof PaymentUriSchema>;

export const PaymentInstructionSchema = z.object({
  key: z.string(),
  /** lightning: BOLT 11 invoice; lno: BOLT 12 offer; pay: BIP 351; sp: silent payment (BIP 352); bc, tb, bcrt: another on-chain address. */
  kind: z.enum(['lightning', 'bolt12-offer', 'bip351', 'silent-payment', 'on-chain']),
  value: z.string(),
});
export type PaymentInstruction = z.infer<typeof PaymentInstructionSchema>;

export const ParsedPaymentUriSchema = z.object({
  /** Why the URI is invalid under BIP 321; empty when it is valid. */
  problems: z.array(z.string()),
  address: z.string().nullable(),
  addressCheck: AddressCheckSchema.nullable(),
  amountSats: z.number().int().nonnegative().nullable(),
  label: z.string().nullable(),
  message: z.string().nullable(),
  instructions: z.array(PaymentInstructionSchema),
  /** A proof-of-payment callback (pop or req-pop). BTCortex never opens one. */
  proofOfPayment: z
    .object({
      callback: z.string(),
      required: z.boolean(),
      /** False for schemes BIP 321 forbids, such as http, https, file, javascript and mailto. */
      allowedScheme: z.boolean(),
    })
    .nullable(),
  /** Parameters BTCortex does not know and that BIP 321 lets a wallet ignore. */
  ignored: z.array(z.object({ key: z.string(), value: z.string() })),
});
export type ParsedPaymentUri = z.infer<typeof ParsedPaymentUriSchema>;

// PSBTs combined and finalised, transactions sent and followed until they
// confirm. Sending always needs the user's explicit confirmation.

const Txid = z.string().regex(/^[0-9a-f]{64}$/);
const PsbtText = z.string().trim().min(10).max(1_000_000);

export const PsbtCombineParamsSchema = z
  .object({ nodeId: z.string().min(1), psbts: z.array(PsbtText).min(2).max(16) })
  .strict();

export const CombinedPsbtSchema = z.object({
  psbt: z.string(),
  analysis: PsbtAnalysisSchema,
});
export type CombinedPsbt = z.infer<typeof CombinedPsbtSchema>;

export const FinalisedPsbtSchema = z.object({
  /** Every input has its final signatures and scripts. */
  complete: z.boolean(),
  /** The PSBT with what could be finalised, while inputs are still missing something. */
  psbt: z.string().nullable(),
  /** The transaction, ready to be sent, once complete. */
  hex: z.string().nullable(),
});
export type FinalisedPsbt = z.infer<typeof FinalisedPsbtSchema>;

export const BroadcastParamsSchema = z
  .object({
    nodeId: z.string().min(1),
    hex: z.string().regex(/^([0-9a-fA-F]{2}){60,200000}$/),
    /** The user confirmed sending this transaction to the network. */
    confirmed: z.literal(true),
  })
  .strict();

export const TrackedTransactionSchema = z.object({
  nodeId: z.string(),
  txid: Txid,
  addedAt: z.string(),
  state: z.enum(['mempool', 'confirmed', 'missing', 'unknown']),
  confirmations: z.number().int().nonnegative(),
  blockHash: Txid.nullable(),
  blockHeight: z.number().int().nonnegative().nullable(),
  checkedAt: z.string().nullable(),
});
export type TrackedTransaction = z.infer<typeof TrackedTransactionSchema>;

export const BroadcastResultSchema = z.object({ txid: Txid, tracked: TrackedTransactionSchema });
export type BroadcastResult = z.infer<typeof BroadcastResultSchema>;

// Coins: one output looked up, or every coin of addresses and public
// descriptors found in the node's UTXO set (scantxoutset), with the fee rates
// the node expects, so that what each coin costs to spend can be weighed.

export const OutputLookupSchema = z.object({
  txid: Txid,
  vout: z.number().int().nonnegative(),
  /** False when the output is spent or never existed. */
  unspent: z.boolean(),
  valueSats: z.number().int().nonnegative().nullable(),
  /** 0 while the transaction that made it waits in the mempool. */
  confirmations: z.number().int().nonnegative().nullable(),
  coinbase: z.boolean().nullable(),
  script: z.object({ hex: z.string(), type: AddressTypeSchema, address: z.string().nullable() }).nullable(),
  bestBlock: z.string().nullable(),
});
export type OutputLookup = z.infer<typeof OutputLookupSchema>;

export const CoinScanParamsSchema = z
  .object({
    nodeId: z.string().min(1),
    /** Addresses or public output descriptors, one each. */
    targets: z.array(z.string().trim().min(4).max(10_000)).min(1).max(20),
  })
  .strict();

export const ScannedCoinSchema = z.object({
  txid: Txid,
  vout: z.number().int().nonnegative(),
  valueSats: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  coinbase: z.boolean(),
  descriptor: z.string(),
  script: z.string(),
  type: AddressTypeSchema,
});
export type ScannedCoin = z.infer<typeof ScannedCoinSchema>;

export const FeeRateEstimateSchema = z.object({
  /** The confirmation target in blocks. */
  blocks: z.number().int().positive(),
  satPerVb: z.number().nonnegative(),
});

export const CoinScanSchema = z.object({
  height: z.number().int().nonnegative(),
  bestBlock: z.string(),
  coins: z.array(ScannedCoinSchema),
  totalSats: z.number().int().nonnegative(),
  feeRates: z.array(FeeRateEstimateSchema),
  /** True when the fee rates are the node's own estimates rather than examples. */
  estimated: z.boolean(),
});
export type CoinScan = z.infer<typeof CoinScanSchema>;
