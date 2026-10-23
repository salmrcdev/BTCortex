import { z } from 'zod';
import { BitcoinNetworkSchema } from './nodes';

// Block explorers on other computers (specification section 12; phase 5,
// "selected Bitcoin explorers"): a mempool or Esplora instance on a node
// platform or another machine, reached directly or through Tor. BTCortex
// tests one before adding it, checks every minute that it answers and follows
// the expected chain, and opens its pages for what BTCortex's own explorer
// shows. It never manages the explorer, and asks it for nothing but the chain
// tip and block hashes.

export const RemoteExplorerKindSchema = z.enum(['mempool', 'esplora']);
export type RemoteExplorerKind = z.infer<typeof RemoteExplorerKindSchema>;

const ExplorerUrl = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i, 'An explorer address starts with https:// or http://.');

export const RemoteExplorerEndpointSchema = z
  .object({
    /** The explorer's own address, as a browser opens it, for example http://umbrel.local:3006. */
    url: ExplorerUrl,
    kind: RemoteExplorerKindSchema,
    via: z.enum(['direct', 'tor']),
  })
  .strict();
export type RemoteExplorerEndpoint = z.infer<typeof RemoteExplorerEndpointSchema>;

export const RemoteExplorerTestSchema = z.object({
  reachable: z.boolean(),
  /** Where its Esplora API answered, for example http://umbrel.local:3006/api. */
  apiUrl: z.string().nullable(),
  genesisHash: z.string().nullable(),
  /** The network its genesis block belongs to; null when it is none BTCortex knows. */
  network: BitcoinNetworkSchema.nullable(),
  height: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
});
export type RemoteExplorerTest = z.infer<typeof RemoteExplorerTestSchema>;

export const AddRemoteExplorerParamsSchema = RemoteExplorerEndpointSchema.extend({
  name: z.string().trim().min(1).max(80),
  /** A node of BTCortex whose chain it must follow, and whose items it opens; null for none in particular. */
  nodeId: z.string().min(1).nullable(),
}).strict();
export type AddRemoteExplorerParams = z.infer<typeof AddRemoteExplorerParamsSchema>;

export const RemoteExplorerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  apiUrl: z.string(),
  kind: RemoteExplorerKindSchema,
  via: z.enum(['direct', 'tor']),
  /** The network it followed when it was added. */
  network: BitcoinNetworkSchema,
  nodeId: z.string().nullable(),
  addedAt: z.string(),
});
export type RemoteExplorer = z.infer<typeof RemoteExplorerSchema>;

export const RemoteExplorerStatusSchema = z.object({
  state: z.enum(['online', 'unreachable', 'wrong-chain', 'unknown']),
  network: BitcoinNetworkSchema.nullable(),
  height: z.number().int().nonnegative().nullable(),
  /** How many blocks it is behind the node it is added for, when that node answers. */
  blocksBehind: z.number().int().nullable(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
  /** Since when it has not answered, for alerts with a grace period. */
  unreachableSince: z.string().nullable(),
});
export type RemoteExplorerStatus = z.infer<typeof RemoteExplorerStatusSchema>;

export const RemoteExplorerWithStatusSchema = z.object({
  explorer: RemoteExplorerSchema,
  status: RemoteExplorerStatusSchema,
});
export type RemoteExplorerWithStatus = z.infer<typeof RemoteExplorerWithStatusSchema>;

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);

/** A page of the explorer, for something BTCortex's own explorer shows. */
export const ExplorerPageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('transaction'), txid: Hex64 }).strict(),
  z.object({ kind: z.literal('block'), hash: Hex64 }).strict(),
  z
    .object({
      kind: z.literal('address'),
      address: z
        .string()
        .min(14)
        .max(100)
        .regex(/^[A-Za-z0-9]+$/),
    })
    .strict(),
]);
export type ExplorerPage = z.infer<typeof ExplorerPageSchema>;
