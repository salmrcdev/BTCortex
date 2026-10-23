import { z } from 'zod';

// The RPC console (specification section 5.7): a catalogue of the node's
// methods with risk classes, calls, help texts and call statistics.

export const RpcRiskSchema = z.enum(['read', 'heavy', 'state', 'dangerous']);
export type RpcRiskLevel = z.infer<typeof RpcRiskSchema>;

export const RpcCatalogueEntrySchema = z.object({
  name: z.string(),
  category: z.string(),
  risk: RpcRiskSchema,
  /** Parameters or results can hold secrets; they are never logged or kept in the history. */
  secret: z.boolean(),
  /** Why BTCortex's console does not run this method at all. */
  blockedReason: z.string().optional(),
});
export type RpcCatalogueEntry = z.infer<typeof RpcCatalogueEntrySchema>;

export const RpcCallParamsSchema = z
  .object({
    nodeId: z.string().min(1),
    method: z.string().regex(/^[a-z][a-z0-9]{0,63}$/, 'An RPC method name is lower-case letters and digits.'),
    params: z.array(z.unknown()).max(64),
    /** Wallet for wallet methods (the /wallet/<name> endpoint); '' is the default wallet, whose name is empty. */
    wallet: z.string().max(200).optional(),
    /** The user confirmed a dangerous method. */
    confirmed: z.boolean(),
  })
  .strict();

export const RpcCallResultSchema = z.object({
  result: z.unknown(),
  durationMs: z.number().nonnegative(),
});
export type RpcCallResult = z.infer<typeof RpcCallResultSchema>;

export const RpcStatisticSchema = z.object({
  method: z.string(),
  calls: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  averageMs: z.number().nonnegative(),
  maxMs: z.number().nonnegative(),
});
export type RpcStatistic = z.infer<typeof RpcStatisticSchema>;
