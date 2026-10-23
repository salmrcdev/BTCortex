import { z } from 'zod';
import { InstalledProductSchema } from './installations';
import { BitcoinNetworkSchema, NodeImplementationSchema } from './nodes';

// The update centre (specification sections 23 and 24.1, area 20): every
// program BTCortex installs with the release it could move to, how serious
// staying is, what an update affects and how to read its release notes; the
// Bitcoin Core version of every node with what moving it changes for good;
// and BTCortex itself. Updates can be deferred; security-relevant ones stay
// marked as such.

export const UpdateSecuritySchema = z.object({
  severity: z.enum(['critical', 'warning']),
  reason: z.string(),
});
export type UpdateSecurity = z.infer<typeof UpdateSecuritySchema>;

export const ComponentUpdateSchema = z.object({
  product: InstalledProductSchema,
  name: z.string(),
  /** Versions BTCortex installed, newest first. */
  installed: z.array(z.string()),
  /** The newest final release upstream, as last checked; null when unknown. */
  latest: z.string().nullable(),
  state: z.enum(['current', 'available', 'unknown', 'not-installed']),
  security: UpdateSecuritySchema.nullable(),
  releaseNotes: z.string().nullable(),
  /** What an update touches: restarts, programs to close, nodes to move. */
  impact: z.array(z.string()),
  /** Put off by the user: until a date, or for this version altogether (until null). */
  deferred: z.object({ version: z.string(), until: z.string().nullable() }).nullable(),
  error: z.string().nullable(),
  /** Why the newest release is not offered, for example an Electrum newer than BTCortex's servers support. */
  held: z.string().nullable(),
});
export type ComponentUpdate = z.infer<typeof ComponentUpdateSchema>;

export const NodeVersionSchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  network: BitcoinNetworkSchema,
  /** Bitcoin Core or Bitcoin Knots, whose versions the node moves between. */
  implementation: NodeImplementationSchema,
  managed: z.boolean(),
  /** The version the node runs or will run; null when not known. */
  version: z.string().nullable(),
  /** The newest version of the node's own software (Bitcoin Core or Bitcoin Knots) BTCortex installed, when newer than the node's. */
  newer: z.string().nullable(),
  security: UpdateSecuritySchema.nullable(),
  /** What moving to `newer` changes for good. */
  notes: z.array(z.string()),
});
export type NodeVersion = z.infer<typeof NodeVersionSchema>;

export const UpdatesOverviewSchema = z.object({
  checkedAt: z.string().nullable(),
  btcortex: z.object({ version: z.string(), detail: z.string() }),
  components: z.array(ComponentUpdateSchema),
  nodes: z.array(NodeVersionSchema),
  /** The last successful backup, so that one can be made before a node moves to a new major version. */
  lastBackupAt: z.string().nullable(),
});
export type UpdatesOverview = z.infer<typeof UpdatesOverviewSchema>;
