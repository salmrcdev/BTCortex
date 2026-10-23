import { z } from 'zod';

// Software BTCortex installed itself from verified releases (specification
// section 17.3 and the catalogue's update, repair and removal operations).
// Every entry carries what was verified when it was installed.

export const InstalledProductSchema = z.enum([
  'bitcoin-core',
  'bitcoin-knots',
  'sparrow',
  'tor',
  'hwi',
  'fulcrum',
  'electrum',
]);
export type InstalledProduct = z.infer<typeof InstalledProductSchema>;

export const InstalledSoftwareSchema = z.object({
  product: InstalledProductSchema,
  version: z.string(),
  directory: z.string(),
  bytes: z.number().nonnegative(),
  verifiedAt: z.iso.datetime(),
  /** Trusted signatures on the release's checksums, and how many were required. */
  signatures: z.object({ valid: z.number().int().nonnegative(), required: z.number().int().nonnegative() }),
  /** `verified`: every executable carries the expected publisher's Windows signature; `recorded`: checked, not required. */
  codeSigning: z.enum(['verified', 'recorded', 'none']),
  /** File hashes were recorded at installation, so the files can be checked again. */
  integrityRecorded: z.boolean(),
  /** Nodes that run this version. */
  usedBy: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Sparrow is open, or this tor runs, so its files are in use. */
  running: z.boolean(),
});
export type InstalledSoftware = z.infer<typeof InstalledSoftwareSchema>;

export const SoftwareUpdateSchema = z.object({
  product: InstalledProductSchema,
  /** The newest version BTCortex has installed, if any. */
  installed: z.string().nullable(),
  /** The newest final release upstream; `null` when it could not be checked. */
  latest: z.string().nullable(),
  updateAvailable: z.boolean(),
  checkedAt: z.iso.datetime(),
  /** Why the check failed, for example no internet connection. */
  error: z.string().optional(),
  /** Why the newest release is not offered, for example an Electrum newer than BTCortex's servers support. */
  held: z.string().optional(),
});
export type SoftwareUpdate = z.infer<typeof SoftwareUpdateSchema>;

export const IntegrityReportSchema = z.object({
  product: InstalledProductSchema,
  version: z.string(),
  recorded: z.boolean(),
  checked: z.number().int().nonnegative(),
  missing: z.array(z.string()),
  changed: z.array(z.string()),
});
export type IntegrityReport = z.infer<typeof IntegrityReportSchema>;
