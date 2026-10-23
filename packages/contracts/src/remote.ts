import { z } from 'zod';

// Remote infrastructure (specification sections 24.1, area 22, and 26): the
// services BTCortex reaches on other computers through their own interfaces —
// a Bitcoin node's RPC, LND's REST interface, BTCPay Server's Greenfield API —
// each with a connection test. BTCortex does not log in to those computers,
// so it never has operating-system access to them.

export const RemoteServiceKindSchema = z.enum(['bitcoin-node', 'lightning', 'payments', 'electrum', 'explorer']);
export type RemoteServiceKind = z.infer<typeof RemoteServiceKindSchema>;

export const RemoteTestResultSchema = z.object({
  ok: z.boolean(),
  /** Time for one round trip, in milliseconds; null when nothing answered. */
  latencyMs: z.number().nonnegative().nullable(),
  detail: z.string(),
  testedAt: z.string(),
});
export type RemoteTestResult = z.infer<typeof RemoteTestResultSchema>;
