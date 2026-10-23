import { z } from 'zod';

// Payments & merchants (specification sections 13 and 24.1, area 12):
// BTCPay Server installations BTCortex connects to through their Greenfield
// API with a read-only key — their state and synchronisation, and for each
// store its payment methods, on-chain balance and recent invoices. BTCortex
// does not install BTCPay Server (it runs on Linux, usually in Docker) and
// never creates, changes or pays anything in it.

/** The permissions BTCortex asks for; none of them can move funds or change a store. */
export const BTCPAY_READ_ONLY_PERMISSIONS = [
  'btcpay.store.canviewstoresettings',
  'btcpay.store.canviewinvoices',
  'btcpay.store.canviewwallet',
] as const;

/** BTCPay's own form for creating an API key with exactly the read-only permissions. */
export function btcpayAuthorizeUrl(baseUrl: string, applicationName = 'BTCortex'): string {
  // Plain string work: the contracts run in the window and in Node alike, without either's URL types.
  const base = baseUrl
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  const query = [
    ...BTCPAY_READ_ONLY_PERMISSIONS.map((permission) => `permissions=${encodeURIComponent(permission)}`),
    `applicationName=${encodeURIComponent(applicationName)}`,
    'strict=true',
  ].join('&');
  return `${base}/api-keys/authorize?${query}`;
}

export const PaymentServerViaSchema = z.enum(['direct', 'tor']);
export type PaymentServerVia = z.infer<typeof PaymentServerViaSchema>;

export const PaymentServerSchema = z.object({
  id: z.string(),
  kind: z.literal('btcpay'),
  name: z.string(),
  url: z.string(),
  via: PaymentServerViaSchema,
  addedAt: z.string(),
});
export type PaymentServer = z.infer<typeof PaymentServerSchema>;

export const PaymentChainStatusSchema = z.object({
  paymentMethodId: z.string(),
  chainHeight: z.number().nullable(),
  syncHeight: z.number().nullable(),
  available: z.boolean(),
});

export const PaymentServerStatusSchema = z.object({
  serverId: z.string(),
  state: z.enum(['checking', 'online', 'synchronising', 'unreachable', 'unauthorised']),
  checkedAt: z.string().nullable(),
  version: z.string().nullable(),
  onion: z.string().nullable(),
  chains: z.array(PaymentChainStatusSchema),
  error: z.string().nullable(),
  /** Since when the server has not answered, for the monitoring's grace period. */
  unreachableSince: z.string().nullable(),
});
export type PaymentServerStatus = z.infer<typeof PaymentServerStatusSchema>;

export const PaymentServerWithStatusSchema = z.object({
  server: PaymentServerSchema,
  status: PaymentServerStatusSchema,
});
export type PaymentServerWithStatus = z.infer<typeof PaymentServerWithStatusSchema>;

export const AddPaymentServerParamsSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: z.string().trim().min(1).max(500),
    apiKey: z.string().trim().min(10).max(200),
    via: PaymentServerViaSchema,
  })
  .strict();
export type AddPaymentServerParams = z.infer<typeof AddPaymentServerParamsSchema>;

export const PaymentInvoiceStatusSchema = z.enum(['New', 'Processing', 'Settled', 'Expired', 'Invalid']);
export type PaymentInvoiceStatus = z.infer<typeof PaymentInvoiceStatusSchema>;

export const PaymentInvoiceSchema = z.object({
  id: z.string(),
  status: PaymentInvoiceStatusSchema,
  additionalStatus: z.string().nullable(),
  /** Decimal strings in the invoice's currency, as BTCPay gives them. */
  amount: z.string(),
  paidAmount: z.string().nullable(),
  currency: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  orderId: z.string().nullable(),
  checkoutLink: z.string().nullable(),
});
export type PaymentInvoice = z.infer<typeof PaymentInvoiceSchema>;

export const PaymentStoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.string().nullable(),
  archived: z.boolean(),
  /** Null when the key may not read them. */
  paymentMethods: z.array(z.object({ id: z.string(), enabled: z.boolean() })).nullable(),
  /** The on-chain wallet in BTC, as decimal strings; null without the permission or an on-chain wallet. */
  balance: z.object({ total: z.string(), confirmed: z.string(), unconfirmed: z.string() }).nullable(),
  invoices: z
    .object({
      recent: z.array(PaymentInvoiceSchema),
      /** Invoices created in the last 30 days, by status. */
      counts: z.record(PaymentInvoiceStatusSchema, z.number().int().nonnegative()),
      /** Settled amounts of the last 30 days, by currency. */
      settled: z.array(z.object({ currency: z.string(), amount: z.string() })),
      /** False when the store had more invoices in 30 days than BTCortex reads. */
      complete: z.boolean(),
    })
    .nullable(),
});
export type PaymentStore = z.infer<typeof PaymentStoreSchema>;

export const PaymentDashboardSchema = z.object({
  serverId: z.string(),
  checkedAt: z.string(),
  stores: z.array(PaymentStoreSchema),
  /** What the API key lets BTCortex read. */
  permissions: z.object({ stores: z.boolean(), invoices: z.boolean(), wallet: z.boolean() }),
});
export type PaymentDashboard = z.infer<typeof PaymentDashboardSchema>;
