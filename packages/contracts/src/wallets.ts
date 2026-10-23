import { z } from 'zod';
import { BitcoinNetworkSchema } from './nodes';

// Wallet applications BTCortex installs and connects to nodes.

/**
 * How Sparrow reaches the node: `node`, its Bitcoin Core RPC interface;
 * `electrum`, the Electrum server BTCortex runs next to it.
 */
export const SparrowConnectionViaSchema = z.enum(['node', 'electrum']);
export type SparrowConnectionVia = z.infer<typeof SparrowConnectionViaSchema>;

export const SparrowStatusSchema = z.object({
  /** The newest Sparrow BTCortex installed and verified, if any. */
  installed: z.object({ version: z.string(), verifiedAt: z.iso.datetime() }).nullable(),
  running: z.boolean(),
  /** Sparrow has been used on this computer before (its settings folder exists). */
  settingsFound: z.boolean(),
  /** Sparrow's configured server for the node's network, as far as BTCortex can tell. */
  connection: z.object({
    /** Sparrow uses this node the way asked about: its RPC interface, or its Electrum server. */
    usesThisNode: z.boolean(),
    /** Another server the user configured; replacing it needs explicit consent. */
    otherServer: z.object({ serverType: z.string(), server: z.string().optional() }).optional(),
    /** Networks Sparrow is set to always start on ("Restart in …"), which would make it ignore this node. */
    fixedStartupNetworks: z.array(BitcoinNetworkSchema).optional(),
  }),
  /** Why Sparrow cannot be connected to this node at all, if so. */
  unsupportedReason: z.string().optional(),
});
export type SparrowStatus = z.infer<typeof SparrowStatusSchema>;

/**
 * Which Electrum opens for a node's Electrum server:
 * - `application`: the Electrum installed on this computer with its own installer, used as it is;
 * - `verified`: the standalone Electrum BTCortex installed and verified;
 * - `install`: BTCortex installs the current release first, after checking its signatures.
 */
export const ElectrumWalletChoiceSchema = z.enum(['application', 'verified', 'install']);
export type ElectrumWalletChoice = z.infer<typeof ElectrumWalletChoiceSchema>;

export const ElectrumWalletStatusSchema = z.object({
  /** The newest Electrum BTCortex installed and verified, if any. */
  installed: z.object({ version: z.string(), verifiedAt: z.iso.datetime() }).nullable(),
  /** An Electrum installed with its own installer; BTCortex starts it but never changes it. */
  application: z.object({ version: z.string().nullable(), directory: z.string() }).nullable(),
  opens: ElectrumWalletChoiceSchema,
  /** The newest Electrum release, when it could be checked. */
  latest: z.string().nullable(),
  /** The installed application is older than the newest release, whose updates fix security issues. */
  applicationOutdated: z.boolean(),
  running: z.boolean(),
  /** The node's Electrum server as Electrum is given it, for example `127.0.0.1:50001:t`. */
  server: z.string().nullable(),
  /** Why Electrum cannot be opened for this node now, if so. */
  unavailableReason: z.string().optional(),
  /**
   * Where BTCortex's own Electrum keeps its wallets, when that copy is the one
   * that opens: a folder of its own, never another Electrum's.
   */
  ownWalletsFolder: z.string().nullable(),
  /** Another Electrum's wallets are in %APPDATA%\Electrum, which BTCortex's copy leaves alone. */
  otherElectrumWallets: z.boolean(),
});
export type ElectrumWalletStatus = z.infer<typeof ElectrumWalletStatusSchema>;
