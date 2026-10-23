import { z } from 'zod';

// Network and peer management for a node (specification section 5.8). Peer
// addresses belong to other people: they are shown, never sent anywhere, and
// no geolocation is attempted.

export const PeerNetworkSchema = z.object({
  /** ipv4, ipv6, onion, i2p or cjdns. */
  name: z.string(),
  reachable: z.boolean(),
  /** Excluded with -onlynet. */
  limited: z.boolean(),
  /** The proxy used for this network, if any (for example 127.0.0.1:9050 for Tor). */
  proxy: z.string().optional(),
});

export const AddedPeerSchema = z.object({
  address: z.string(),
  connected: z.boolean(),
});

export const BannedAddressSchema = z.object({
  /** An address or subnet, for example 203.0.113.7/32. */
  address: z.string(),
  bannedUntil: z.number().int(),
  createdAt: z.number().int(),
});

export const NetworkOverviewSchema = z.object({
  networkActive: z.boolean(),
  connectionsIn: z.number().int().nonnegative(),
  connectionsOut: z.number().int().nonnegative(),
  networks: z.array(PeerNetworkSchema),
  /** Addresses the node advertises for incoming connections; empty when it does not accept any. */
  localAddresses: z.array(z.object({ address: z.string(), port: z.number().int(), score: z.number() })),
  added: z.array(AddedPeerSchema),
  banned: z.array(BannedAddressSchema),
});
export type NetworkOverview = z.infer<typeof NetworkOverviewSchema>;

export const PeerEventSchema = z.object({
  at: z.iso.datetime(),
  kind: z.enum(['connected', 'disconnected']),
  peerId: z.number().int(),
  address: z.string(),
  network: z.string(),
  inbound: z.boolean(),
  connectionType: z.string().optional(),
  /** For disconnections: how long the connection lasted. */
  durationSeconds: z.number().int().nonnegative().optional(),
});
export type PeerEvent = z.infer<typeof PeerEventSchema>;

/** An address with an optional port, as typed by the user: IPv4, [IPv6], a host name, .onion or .i2p. */
export const PeerAddressSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(/^[a-zA-Z0-9.:[\]-]+$/, 'Use an IP address, a host name, a .onion or a .i2p address, optionally with :port.');

/** An address or subnet for a ban, for example 203.0.113.7 or 203.0.113.0/24. */
export const BanTargetSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(/^[a-zA-Z0-9.:[\]/-]+$/, 'Use an IP address or a subnet such as 203.0.113.0/24.');
