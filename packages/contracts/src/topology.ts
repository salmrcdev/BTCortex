import { z } from 'zod';
import { ServiceHealthSchema } from './catalogue';

// The network topology (specification sections 10.2 and 24.1, area 16): the
// real relationships between BTCortex, the programs and services it runs or
// connects to, and the networks they reach, with protocols, ports, how each
// connection is protected and whether it is live.

export const TopologyElementKindSchema = z.enum([
  'btcortex',
  'wallet',
  'electrum-server',
  'lightning-node',
  'bitcoin-node',
  'tor',
  'i2p-router',
  'bitcoin-network',
  'tor-network',
  'i2p-network',
  'lightning-network',
]);
export type TopologyElementKind = z.infer<typeof TopologyElementKindSchema>;

export const TopologyElementSchema = z.object({
  id: z.string(),
  kind: TopologyElementKindSchema,
  label: z.string(),
  /** Version, network, state: what the element is now. */
  detail: z.string(),
  health: ServiceHealthSchema,
  route: z.string().nullable(),
  /** Its column, left to right: 0 programs, 1 services, 2 nodes, 3 privacy, 4 networks. */
  layer: z.number().int().min(0).max(4),
});
export type TopologyElement = z.infer<typeof TopologyElementSchema>;

/** `loopback`: this computer only; `tor`: through Tor; `i2p`: through I2P; `tls`: encrypted; `clear`: unencrypted over a network; `unknown`: not known to BTCortex. */
export const TopologyProtectionSchema = z.enum(['loopback', 'tor', 'i2p', 'tls', 'clear', 'unknown']);
export type TopologyProtection = z.infer<typeof TopologyProtectionSchema>;

export const TopologyLinkSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  protocol: z.string(),
  port: z.number().int().nullable(),
  protection: TopologyProtectionSchema,
  /** Both ends run and the connection is in use. */
  active: z.boolean(),
  detail: z.string(),
});
export type TopologyLink = z.infer<typeof TopologyLinkSchema>;

export const TopologySchema = z.object({
  checkedAt: z.string(),
  elements: z.array(TopologyElementSchema),
  links: z.array(TopologyLinkSchema),
});
export type Topology = z.infer<typeof TopologySchema>;
