import { z } from 'zod';

// The log centre (specification section 20): log sources, structured entries
// and queries. The orchestrator redacts secrets before any entry leaves it.

export const LogSeveritySchema = z.enum(['error', 'warning', 'info', 'debug']);
export type LogSeverity = z.infer<typeof LogSeveritySchema>;

export const LOG_SEVERITIES: readonly LogSeverity[] = LogSeveritySchema.options;

/**
 * - `application`: the BTCortex orchestrator's structured log.
 * - `shell`: the BTCortex window (native shell) log.
 * - `bitcoin-core`: a node's debug.log.
 * - `bitcoin-core-console`: what bitcoind printed while starting, before its own log was open.
 * - `tor`: the notices of the tor BTCortex runs.
 * - `fulcrum`: what an Electrum server (Fulcrum) BTCortex runs for a node printed.
 */
export const LogSourceKindSchema = z.enum([
  'application',
  'shell',
  'bitcoin-core',
  'bitcoin-core-console',
  'tor',
  'fulcrum',
]);
export type LogSourceKind = z.infer<typeof LogSourceKindSchema>;

export const LogSourceSchema = z.object({
  id: z.string(),
  kind: LogSourceKindSchema,
  nodeId: z.string().optional(),
  nodeName: z.string().optional(),
  path: z.string(),
  exists: z.boolean(),
  sizeBytes: z.number().nonnegative(),
  modifiedAt: z.iso.datetime().optional(),
});
export type LogSource = z.infer<typeof LogSourceSchema>;

export const LogEntrySchema = z.object({
  /** Unique: the source and the line's byte offset in its file. */
  id: z.string(),
  sourceId: z.string(),
  time: z.iso.datetime(),
  /** The line carried no time of its own; it is placed at the previous line's time. */
  timeEstimated: z.boolean(),
  severity: LogSeveritySchema,
  /** The orchestrator component, the shell module or the Bitcoin Core log category. */
  component: z.string().optional(),
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const LogQuerySchema = z
  .object({
    sourceIds: z.array(z.string().min(1)).min(1).max(20),
    /** The least severe level to include. */
    minimumSeverity: LogSeveritySchema,
    search: z.string().max(200).optional(),
    since: z.iso.datetime().optional(),
    until: z.iso.datetime().optional(),
    limit: z.number().int().min(1).max(2000),
  })
  .strict();
export type LogQuery = z.infer<typeof LogQuerySchema>;

export const LogPageSchema = z.object({
  /** Newest first. */
  entries: z.array(LogEntrySchema),
  /** More entries matched than the limit allowed. */
  limited: z.boolean(),
  /** Only this much of the end of each file is searched. */
  windowBytes: z.number().int().positive(),
});
export type LogPage = z.infer<typeof LogPageSchema>;

export const DiagnosticBundleSchema = z.object({
  path: z.string(),
  sizeBytes: z.number().nonnegative(),
  createdAt: z.iso.datetime(),
  files: z.array(z.string()),
});
export type DiagnosticBundle = z.infer<typeof DiagnosticBundleSchema>;
