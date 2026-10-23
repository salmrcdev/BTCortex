import { z } from 'zod';

// The security centre (specification sections 21 and 24.1, area 23): what
// BTCortex can see of the security of everything it runs or connects to, each
// finding with how serious it is and what to do, and the controls BTCortex
// itself applies.

export const SecurityAreaSchema = z.enum([
  'nodes',
  'tor',
  'electrum',
  'lightning',
  'software',
  'secrets',
  'backups',
  'computer',
]);
export type SecurityArea = z.infer<typeof SecurityAreaSchema>;

/** `ok`: as it should be; `info`: worth knowing; `warning`: should be changed; `critical`: exposes funds or control. */
export const SecuritySeveritySchema = z.enum(['ok', 'info', 'warning', 'critical']);
export type SecuritySeverity = z.infer<typeof SecuritySeveritySchema>;

export const SecurityFindingSchema = z.object({
  id: z.string(),
  area: SecurityAreaSchema,
  severity: SecuritySeveritySchema,
  /** What the finding is about: a node's name, "Tor", "This computer". */
  subject: z.string(),
  title: z.string(),
  detail: z.string(),
  /** What to do about it, when something should be done. */
  action: z.string().nullable(),
  /** Where in BTCortex to do it. */
  route: z.string().nullable(),
});
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;

export const SecurityControlSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  /** `active`: in place and tested; `planned`: not in place yet. */
  state: z.enum(['active', 'planned']),
});
export type SecurityControl = z.infer<typeof SecurityControlSchema>;

export const SecurityOverviewSchema = z.object({
  checkedAt: z.string(),
  counts: z.object({
    critical: z.number().int(),
    warning: z.number().int(),
    info: z.number().int(),
    ok: z.number().int(),
  }),
  findings: z.array(SecurityFindingSchema),
  controls: z.array(SecurityControlSchema),
});
export type SecurityOverview = z.infer<typeof SecurityOverviewSchema>;
