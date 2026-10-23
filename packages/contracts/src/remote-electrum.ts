import { z } from 'zod';
import { BitcoinNetworkSchema } from './nodes';

// Electrum servers on other computers (specification sections 7 and 37,
// phase 5: "electrs where feasible"): electrs, Fulcrum or ElectrumX on a node
// platform or another machine, reached directly or through Tor, over TCP or
// TLS. A certificate a public authority did not issue is pinned only after
// the user accepted it. BTCortex reads such a server; it never manages it.

const Host = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9.:[\]-]+$/);
const Fingerprint = z.string().regex(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

export const RemoteElectrumEndpointSchema = z
  .object({
    host: Host,
    port: z.number().int().min(1).max(65_535),
    tls: z.boolean(),
    via: z.enum(['direct', 'tor']),
  })
  .strict();
export type RemoteElectrumEndpoint = z.infer<typeof RemoteElectrumEndpointSchema>;

export const ServerCertificateSchema = z.object({
  /** SHA-256, upper-case hex pairs separated by colons. */
  fingerprint: Fingerprint,
  subject: z.string(),
  issuer: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  /** Windows' trusted authorities vouch for it, for the name the server was reached by. */
  publiclyTrusted: z.boolean(),
});
export type ServerCertificate = z.infer<typeof ServerCertificateSchema>;

export const RemoteElectrumTestSchema = z.object({
  reachable: z.boolean(),
  /** For example "electrs/0.10.9" or "Fulcrum 2.1.4". */
  serverVersion: z.string().nullable(),
  protocolVersion: z.string().nullable(),
  genesisHash: z.string().nullable(),
  /** The network its genesis block belongs to; null when it is none BTCortex knows. */
  network: BitcoinNetworkSchema.nullable(),
  height: z.number().int().nonnegative().nullable(),
  certificate: ServerCertificateSchema.nullable(),
  error: z.string().nullable(),
});
export type RemoteElectrumTest = z.infer<typeof RemoteElectrumTestSchema>;

export const AddRemoteElectrumParamsSchema = RemoteElectrumEndpointSchema.extend({
  name: z.string().trim().min(1).max(80),
  /** The certificate the user accepted, when no public authority vouches for it. */
  certificateFingerprint: Fingerprint.nullable(),
  /** A node of BTCortex whose address lookups may use it; it must follow the same chain. */
  nodeId: z.string().min(1).nullable(),
}).strict();
export type AddRemoteElectrumParams = z.infer<typeof AddRemoteElectrumParamsSchema>;

export const RemoteElectrumServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  tls: z.boolean(),
  via: z.enum(['direct', 'tor']),
  certificateFingerprint: Fingerprint.nullable(),
  nodeId: z.string().nullable(),
  addedAt: z.string(),
});
export type RemoteElectrumServer = z.infer<typeof RemoteElectrumServerSchema>;

export const RemoteElectrumStatusSchema = z.object({
  state: z.enum(['online', 'unreachable', 'wrong-chain', 'certificate-changed', 'unknown']),
  serverVersion: z.string().nullable(),
  network: BitcoinNetworkSchema.nullable(),
  height: z.number().int().nonnegative().nullable(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
  /** Since when it has not answered, for alerts with a grace period. */
  unreachableSince: z.string().nullable(),
});
export type RemoteElectrumStatus = z.infer<typeof RemoteElectrumStatusSchema>;

export const RemoteElectrumWithStatusSchema = z.object({
  server: RemoteElectrumServerSchema,
  status: RemoteElectrumStatusSchema,
});
export type RemoteElectrumWithStatus = z.infer<typeof RemoteElectrumWithStatusSchema>;
