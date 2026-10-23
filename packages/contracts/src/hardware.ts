import { z } from 'zod';

// Hardware wallets (specification section 9): signing devices attached to
// this computer and their companion applications, HWI, watch-only wallets on
// the user's own node bound to a device through Bitcoin Core's external
// signer support, and PSBTs. BTCortex never asks for, reads or stores a
// recovery phrase, and never signs anything without the user's explicit
// request and the device's own confirmation.

export const DeviceVendorSchema = z.enum(['trezor', 'ledger', 'bitbox', 'coldcard', 'keepkey', 'jade']);
export type DeviceVendor = z.infer<typeof DeviceVendorSchema>;

export const AttachedDeviceSchema = z.object({
  id: z.string(),
  vendor: DeviceVendorSchema,
  /** Known from the USB identity alone; several Trezor models share one. */
  model: z.string().nullable(),
  mode: z.enum(['firmware', 'bootloader', 'legacy-hid']),
  /** `possible`: a common USB serial adapter that a Jade uses, but so do many other devices. */
  confidence: z.enum(['certain', 'possible']),
  vendorId: z.string(),
  productId: z.string(),
  windowsName: z.string().nullable(),
  driver: z.object({ ok: z.boolean(), problemCode: z.number().int().nullable() }),
});
export type AttachedDevice = z.infer<typeof AttachedDeviceSchema>;

/** A device as HWI sees it after opening it briefly. */
export const IdentifiedDeviceSchema = z.object({
  type: z.string(),
  model: z.string(),
  /** The name the user gave the device; shown, never logged. */
  label: z.string().optional(),
  /** Master key fingerprint; missing while the device is locked. */
  fingerprint: z.string().optional(),
  locked: z.boolean(),
  needsPassphrase: z.boolean(),
  error: z.string().optional(),
});
export type IdentifiedDevice = z.infer<typeof IdentifiedDeviceSchema>;

export const HardwareOverviewSchema = z.object({
  devices: z.array(AttachedDeviceSchema),
  hwi: z.object({ version: z.string(), verifiedAt: z.iso.datetime() }).nullable(),
  trezorSuite: z.object({
    installed: z
      .object({ path: z.string(), version: z.string().nullable(), installedByBtcortex: z.boolean() })
      .nullable(),
    running: z.boolean(),
    /** Suite holds a connected Trezor; other applications reach it only once Suite is closed. */
    holdsDevice: z.boolean(),
  }),
  /** The deprecated standalone Trezor Bridge, which Trezor recommends removing. */
  trezorBridge: z.object({ present: z.boolean(), running: z.boolean(), path: z.string().nullable() }),
  scannedAt: z.iso.datetime(),
});
export type HardwareOverview = z.infer<typeof HardwareOverviewSchema>;

export const SignerWalletSummarySchema = z.object({
  name: z.string(),
  /** The device the wallet belongs to, from its descriptors. */
  fingerprint: z.string().nullable(),
  balanceSats: z.number().int(),
  pendingSats: z.number().int(),
  immatureSats: z.number().int(),
});
export type SignerWalletSummary = z.infer<typeof SignerWalletSummarySchema>;

export const NodeSignerStatusSchema = z.object({
  /** BTCortex can set this node up for hardware wallets: it manages the node and can write its configuration. */
  manageable: z.boolean(),
  readOnlyReason: z.string().optional(),
  /** bitcoin.conf points Bitcoin Core at BTCortex's HWI. */
  configured: z.boolean(),
  /** The running node does not use the signer setting yet. */
  restartRequired: z.boolean(),
  running: z.boolean(),
  /** Devices Bitcoin Core finds through HWI, when the node runs with the signer set. */
  signers: z.array(z.object({ fingerprint: z.string(), name: z.string() })).nullable(),
  wallets: z.array(SignerWalletSummarySchema),
  /** Why the node's wallet functions cannot be used, for example when the node runs without wallets. */
  walletUnavailableReason: z.string().optional(),
});
export type NodeSignerStatus = z.infer<typeof NodeSignerStatusSchema>;

export const SignerAddressTypeSchema = z.enum(['bech32', 'bech32m', 'p2sh-segwit', 'legacy']);
export type SignerAddressType = z.infer<typeof SignerAddressTypeSchema>;

export const WalletTransactionSchema = z.object({
  txid: z.string(),
  /** Received (positive) or sent (negative), fees included for sends. */
  amountSats: z.number().int(),
  confirmations: z.number().int(),
  time: z.iso.datetime(),
  address: z.string().optional(),
  category: z.string(),
});
export type WalletTransaction = z.infer<typeof WalletTransactionSchema>;

export const SignerWalletDetailSchema = SignerWalletSummarySchema.extend({
  addressTypes: z.array(SignerAddressTypeSchema),
  transactions: z.array(WalletTransactionSchema),
  /** The node keeps only recent blocks, so earlier payments to this device cannot be found by rescanning. */
  pruned: z.boolean(),
});
export type SignerWalletDetail = z.infer<typeof SignerWalletDetailSchema>;

export const PsbtReviewSchema = z.object({
  psbt: z.string(),
  inputs: z.array(
    z.object({
      txid: z.string(),
      vout: z.number().int().nonnegative(),
      amountSats: z.number().int().nullable(),
      address: z.string().nullable(),
    }),
  ),
  outputs: z.array(
    z.object({
      address: z.string().nullable(),
      amountSats: z.number().int(),
      /** The output pays back to the wallet (change), when a wallet is given. */
      ownedByWallet: z.boolean(),
    }),
  ),
  feeSats: z.number().int().nullable(),
  feeRateSatPerVb: z.number().nullable(),
  estimatedVsize: z.number().int().nullable(),
  /** What the PSBT needs next: `signer`, `finalizer` or `extractor`. */
  next: z.string().nullable(),
  complete: z.boolean(),
});
export type PsbtReview = z.infer<typeof PsbtReviewSchema>;

export const PsbtOutputRequestSchema = z.object({
  address: z.string().min(14).max(120),
  amountSats: z.number().int().positive(),
});

/** One QR code: each row is a string of `1` (dark) and `0` (light) modules. */
export const QrMatrixSchema = z.object({
  size: z.number().int().positive(),
  rows: z.array(z.string()),
});
export type QrMatrix = z.infer<typeof QrMatrixSchema>;

export const QrScanProgressSchema = z.object({
  progress: z.number().min(0).max(1),
  complete: z.boolean(),
  psbt: z.string().optional(),
  error: z.string().optional(),
});
export type QrScanProgress = z.infer<typeof QrScanProgressSchema>;

export const SignedPsbtSchema = z.object({
  review: PsbtReviewSchema,
  /** The final transaction, when every input is signed. */
  hex: z.string().nullable(),
});
export type SignedPsbt = z.infer<typeof SignedPsbtSchema>;
