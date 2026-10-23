import { z } from 'zod';

// A node's bitcoin.conf as the configuration editor sees it. Secret values are
// replaced by placeholders before the file leaves the orchestrator.

export const NodeConfigDocumentSchema = z.object({
  /** Where the file lives; `null` when the node's files are not on this computer. */
  path: z.string().nullable(),
  exists: z.boolean(),
  editable: z.boolean(),
  /** Why BTCortex will not change this file, if so. */
  readOnlyReason: z.string().optional(),
  /** The file with secret values replaced by placeholders. */
  text: z.string(),
  /** Identifies the file contents; saving requires the revision that was read. */
  revision: z.string(),
  modifiedAt: z.iso.datetime().optional(),
  /** The file changed after the running node started, so the node is not using it yet. */
  restartRequired: z.boolean(),
  /** Options BTCortex passes when it starts the node; they override the file. */
  commandLine: z.array(z.object({ key: z.string(), value: z.string() })),
});
export type NodeConfigDocument = z.infer<typeof NodeConfigDocumentSchema>;

/** Large enough for any real bitcoin.conf, small enough to refuse accidents. */
export const MAX_CONFIG_LENGTH = 256 * 1024;

export const SaveNodeConfigParamsSchema = z
  .object({
    nodeId: z.string().min(1),
    text: z.string().max(MAX_CONFIG_LENGTH),
    revision: z.string().min(1),
    /** Options whose risk the user confirmed (exposure, commands, rebuilt data). */
    acceptedRisks: z.array(z.string()).max(200),
  })
  .strict();

export const SaveNodeConfigResultSchema = z.object({
  revision: z.string(),
  restartRequired: z.boolean(),
  /** The previous file, kept next to it. */
  backup: z.string().nullable(),
  changedKeys: z.array(z.string()),
});
export type SaveNodeConfigResult = z.infer<typeof SaveNodeConfigResultSchema>;

/** The file name BTCortex gives a kept version: `bitcoin.conf.btcortex-<time>-<random>.bak`. */
export const NODE_CONFIG_VERSION_ID = /^bitcoin\.conf\.btcortex-[0-9A-Za-z-]{10,40}-[0-9a-f]{8}\.bak$/;

export const NodeConfigVersionSchema = z.object({
  id: z.string(),
  /** When BTCortex replaced this version with a newer one. */
  replacedAt: z.iso.datetime(),
  bytes: z.number().int().nonnegative(),
});
export type NodeConfigVersion = z.infer<typeof NodeConfigVersionSchema>;

export const NodeConfigHistorySchema = z.object({
  /** Kept versions, newest first; only files BTCortex has changed have any. */
  versions: z.array(NodeConfigVersionSchema),
  /** How many versions BTCortex keeps. */
  kept: z.number().int().positive(),
});
export type NodeConfigHistory = z.infer<typeof NodeConfigHistorySchema>;

export const NodeConfigChangeSchema = z.object({
  key: z.string(),
  /** Effective values now and in the version; null when unset. Secret options never carry values. */
  current: z.array(z.string()).nullable(),
  version: z.array(z.string()).nullable(),
  secret: z.boolean(),
});
export type NodeConfigChange = z.infer<typeof NodeConfigChangeSchema>;

export const NodeConfigVersionDetailSchema = z.object({
  id: z.string(),
  replacedAt: z.iso.datetime(),
  /** The version with secret values hidden. */
  text: z.string(),
  /** What restoring it would change in the file as it is now. */
  changes: z.array(NodeConfigChangeSchema),
  /** Options among those changes that need confirmation (exposure, commands, rebuilt data). */
  risky: z.array(z.string()),
});
export type NodeConfigVersionDetail = z.infer<typeof NodeConfigVersionDetailSchema>;

export const RestoreNodeConfigParamsSchema = z
  .object({
    nodeId: z.string().min(1),
    versionId: z.string().regex(NODE_CONFIG_VERSION_ID),
    /** The revision of the file as it was read; restoring refuses a file that changed since. */
    revision: z.string().min(1),
    acceptedRisks: z.array(z.string()).max(200),
  })
  .strict();
