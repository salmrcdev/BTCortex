import { z } from 'zod';

// Response schemas for the RPCs BTCortex relies on (Bitcoin Core 31.x, with the
// fields of maintained older lines optional). Objects are loose: new fields in
// newer releases pass through instead of failing validation, while the fields
// BTCortex reads are checked.

/** `warnings` is an array since 28.0 and a string with -deprecatedrpc=warnings. */
const Warnings = z
  .union([z.array(z.string()), z.string()])
  .transform((value) => (typeof value === 'string' ? (value === '' ? [] : [value]) : value));

export const BlockchainInfoSchema = z.looseObject({
  chain: z.string(),
  blocks: z.number().int().nonnegative(),
  headers: z.number().int().nonnegative(),
  bestblockhash: z.string(),
  difficulty: z.number(),
  time: z.number().int().optional(),
  mediantime: z.number().int(),
  verificationprogress: z.number(),
  initialblockdownload: z.boolean(),
  chainwork: z.string(),
  size_on_disk: z.number().nonnegative(),
  pruned: z.boolean(),
  pruneheight: z.number().int().optional(),
  automatic_pruning: z.boolean().optional(),
  prune_target_size: z.number().optional(),
  signet_challenge: z.string().optional(),
  warnings: Warnings,
});
export type BlockchainInfo = z.infer<typeof BlockchainInfoSchema>;

export const NetworkInfoSchema = z.looseObject({
  version: z.number().int(),
  subversion: z.string(),
  protocolversion: z.number().int(),
  localservices: z.string(),
  localservicesnames: z.array(z.string()).optional(),
  localrelay: z.boolean(),
  timeoffset: z.number(),
  networkactive: z.boolean(),
  connections: z.number().int().nonnegative(),
  connections_in: z.number().int().nonnegative(),
  connections_out: z.number().int().nonnegative(),
  networks: z.array(
    z.looseObject({
      name: z.string(),
      limited: z.boolean(),
      reachable: z.boolean(),
      proxy: z.string(),
      proxy_randomize_credentials: z.boolean(),
    }),
  ),
  relayfee: z.number(),
  incrementalfee: z.number(),
  localaddresses: z.array(z.looseObject({ address: z.string(), port: z.number().int(), score: z.number() })),
  warnings: Warnings,
});
export type NetworkInfo = z.infer<typeof NetworkInfoSchema>;

export const PeerInfoSchema = z.looseObject({
  id: z.number().int(),
  addr: z.string(),
  addrbind: z.string().optional(),
  addrlocal: z.string().optional(),
  network: z.string(),
  services: z.string(),
  servicesnames: z.array(z.string()).optional(),
  relaytxes: z.boolean(),
  lastsend: z.number(),
  lastrecv: z.number(),
  last_transaction: z.number().optional(),
  last_block: z.number().optional(),
  bytessent: z.number(),
  bytesrecv: z.number(),
  conntime: z.number(),
  timeoffset: z.number(),
  pingtime: z.number().optional(),
  minping: z.number().optional(),
  pingwait: z.number().optional(),
  version: z.number().int(),
  subver: z.string(),
  inbound: z.boolean(),
  synced_headers: z.number().int().optional(),
  synced_blocks: z.number().int().optional(),
  permissions: z.array(z.string()).optional(),
  minfeefilter: z.number().optional(),
  connection_type: z.string().optional(),
  transport_protocol_type: z.string().optional(),
  session_id: z.string().optional(),
  mapped_as: z.number().int().optional(),
});
export type PeerInfo = z.infer<typeof PeerInfoSchema>;

export const MempoolInfoSchema = z.looseObject({
  loaded: z.boolean(),
  size: z.number().int().nonnegative(),
  bytes: z.number().nonnegative(),
  usage: z.number().nonnegative(),
  total_fee: z.number().optional(),
  maxmempool: z.number().nonnegative(),
  mempoolminfee: z.number(),
  minrelaytxfee: z.number(),
  incrementalrelayfee: z.number().optional(),
  unbroadcastcount: z.number().int().optional(),
});
export type MempoolInfo = z.infer<typeof MempoolInfoSchema>;

export const NetTotalsSchema = z.looseObject({
  totalbytesrecv: z.number().nonnegative(),
  totalbytessent: z.number().nonnegative(),
  timemillis: z.number(),
});
export type NetTotals = z.infer<typeof NetTotalsSchema>;

export const SmartFeeEstimateSchema = z.looseObject({
  feerate: z.number().optional(),
  errors: z.array(z.string()).optional(),
  blocks: z.number().int(),
});
export type SmartFeeEstimate = z.infer<typeof SmartFeeEstimateSchema>;

export const IndexInfoSchema = z.record(
  z.string(),
  z.looseObject({ synced: z.boolean(), best_block_height: z.number().int() }),
);
export type IndexInfo = z.infer<typeof IndexInfoSchema>;

export const RpcInfoSchema = z.looseObject({
  active_commands: z.array(z.looseObject({ method: z.string(), duration: z.number() })),
  logpath: z.string(),
});
export type RpcInfo = z.infer<typeof RpcInfoSchema>;

export const UptimeSchema = z.number().int().nonnegative();
export const StopSchema = z.string();
export const HelpSchema = z.string();
