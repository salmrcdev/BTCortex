import { z } from 'zod';

// Backups (specification section 22): what can be backed up, kept apart by
// kind so that nobody mistakes a configuration backup for a way to recover
// funds; manual and scheduled backups into a folder of the user's choice,
// encrypted with a passphrase whenever they hold keys or credentials;
// verification; retention; and a preview before anything is restored.

/**
 * - `configuration`: settings that make things work again (bitcoin.conf, BTCortex's settings and node profiles).
 * - `wallet`: a Bitcoin Core wallet file, which holds private keys unless the wallet is watch-only.
 * - `descriptors`: a wallet's public descriptors, which let a wallet be watched again but cannot spend.
 * - `channel`: an LND static channel backup, which recovers channel funds together with the node's seed.
 * - `credentials`: passwords, macaroons and onion-service keys BTCortex keeps, which cannot be recreated.
 */
export const BackupKindSchema = z.enum(['configuration', 'wallet', 'descriptors', 'channel', 'credentials']);
export type BackupKind = z.infer<typeof BackupKindSchema>;

export const BackupItemSchema = z.object({
  id: z.string(),
  kind: BackupKindSchema,
  title: z.string(),
  /** What it belongs to, for example a node's name. */
  component: z.string(),
  description: z.string(),
  /** Holds private keys or credentials: it goes only into encrypted backups. */
  secret: z.boolean(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
});
export type BackupItem = z.infer<typeof BackupItemSchema>;

/** Data BTCortex deliberately leaves out, with the reason. */
export const NotBackedUpSchema = z.object({
  kind: z.enum(['blockchain', 'index', 'seed', 'electrum-wallets']),
  title: z.string(),
  description: z.string(),
});
export type NotBackedUp = z.infer<typeof NotBackedUpSchema>;

export const BackupScheduleSchema = z.object({
  /** 0 switches scheduled backups off. */
  everyHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30),
  /** Scheduled backups are encrypted with a stored passphrase and then include keys and credentials. */
  encrypted: z.boolean(),
});
export type BackupSchedule = z.infer<typeof BackupScheduleSchema>;

export const BackupRunSchema = z.object({
  at: z.string(),
  trigger: z.enum(['manual', 'scheduled']),
  outcome: z.enum(['succeeded', 'failed']),
  path: z.string().optional(),
  message: z.string().optional(),
  /** Items that were selected but could not be backed up, and why. */
  skipped: z.array(z.object({ id: z.string(), title: z.string(), reason: z.string() })),
});
export type BackupRun = z.infer<typeof BackupRunSchema>;

export const BackupSettingsSchema = z.object({
  destination: z.string().nullable(),
  /** Backups kept in the destination; older BTCortex backups there are deleted after a successful one. */
  retention: z.number().int().min(1).max(100),
  schedule: BackupScheduleSchema,
  /** Whether a passphrase for scheduled backups is kept (in the DPAPI vault). */
  passphraseStored: z.boolean(),
  lastRun: BackupRunSchema.nullable(),
});
export type BackupSettings = z.infer<typeof BackupSettingsSchema>;

export const BackupSummarySchema = z.object({
  path: z.string(),
  createdAt: z.string(),
  appVersion: z.string(),
  encrypted: z.boolean(),
  trigger: z.enum(['manual', 'scheduled']),
  bytes: z.number().int(),
  items: z.array(
    z.object({
      id: z.string(),
      kind: BackupKindSchema,
      title: z.string(),
      component: z.string(),
      files: z.number().int(),
    }),
  ),
});
export type BackupSummary = z.infer<typeof BackupSummarySchema>;

export const BackupVerificationSchema = z.object({
  ok: z.boolean(),
  checkedFiles: z.number().int(),
  /** Whether the contents were decrypted and checked too, not only the stored bytes. */
  decrypted: z.boolean(),
  problems: z.array(z.string()),
});
export type BackupVerification = z.infer<typeof BackupVerificationSchema>;

/**
 * - `restore`: BTCortex can put it back (a managed node's bitcoin.conf, a wallet into a running node on this computer).
 * - `manual`: it is in the backup, and the explanation says how to use it.
 */
export const RestoreActionSchema = z.enum(['restore', 'manual']);

export const RestorePreviewSchema = z.object({
  backup: BackupSummarySchema,
  items: z.array(
    z.object({
      id: z.string(),
      kind: BackupKindSchema,
      title: z.string(),
      component: z.string(),
      action: RestoreActionSchema,
      /** What restoring does, or how to use the item by hand. */
      explanation: z.string(),
      /** Why BTCortex cannot restore it now, when it would otherwise. */
      blockedReason: z.string().optional(),
    }),
  ),
});
export type RestorePreview = z.infer<typeof RestorePreviewSchema>;

export const RestoreOutcomeSchema = z.object({
  at: z.string(),
  backupPath: z.string(),
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      outcome: z.enum(['restored', 'failed']),
      message: z.string(),
      /** Settings of a bitcoin.conf the user must see and confirm before it can be restored. */
      settingsToConfirm: z.array(z.string()).optional(),
    }),
  ),
});
export type RestoreOutcome = z.infer<typeof RestoreOutcomeSchema>;

export const BackupOverviewSchema = z.object({
  items: z.array(BackupItemSchema),
  notBackedUp: z.array(NotBackedUpSchema),
  settings: BackupSettingsSchema,
  /** BTCortex backups found in the destination, newest first. */
  backups: z.array(BackupSummarySchema),
  /** The destination is on the same disk as BTCortex's data, which a disk failure would take with it. */
  sameDiskAsData: z.boolean(),
  lastRestore: RestoreOutcomeSchema.nullable(),
});
export type BackupOverview = z.infer<typeof BackupOverviewSchema>;

/** At least 12 characters: the passphrase is all that protects keys in a backup that leaves this computer. */
export const BackupPassphraseSchema = z.string().min(12).max(1024);
