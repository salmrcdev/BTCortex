import { request as httpRequest } from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import type { Duplex } from 'node:stream';
import { connect as connectTls } from 'node:tls';
import { z } from 'zod';

// A read-only client for BTCPay Server's Greenfield API v1
// (https://docs.btcpayserver.org/API/Greenfield/v1/, verified on
// 2026-10-23 against the published OpenAPI document). It sends the API key as
// `Authorization: token <key>`, validates certificates against the system's
// authorities, refuses plain HTTP except for the cases the caller allows, and
// reaches onion addresses through a connection the caller opens (Tor's SOCKS
// port). Only GET requests exist here: BTCortex watches a payment server, it
// does not run one.

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type GreenfieldErrorKind = 'auth' | 'permission' | 'not-found' | 'unavailable' | 'other';

export class GreenfieldError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: GreenfieldErrorKind,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'GreenfieldError';
  }
}

export type GreenfieldTransportFailure = 'timeout' | 'refused' | 'unreachable' | 'tls' | 'protocol';

export class GreenfieldTransportError extends Error {
  constructor(
    message: string,
    readonly failure: GreenfieldTransportFailure,
  ) {
    super(message);
    this.name = 'GreenfieldTransportError';
  }
}

export const HealthSchema = z.object({ synchronized: z.boolean() });
export type GreenfieldHealth = z.infer<typeof HealthSchema>;

export const ServerInfoSchema = z.object({
  version: z.string(),
  onion: z.string().nullable().optional(),
  supportedPaymentMethods: z.array(z.string()).default([]),
  fullySynched: z.boolean(),
  syncStatus: z
    .array(
      z.object({
        paymentMethodId: z.string().nullable().optional(),
        chainHeight: z.number().nullable().optional(),
        syncHeight: z.number().nullable().optional(),
        available: z.boolean().optional(),
      }),
    )
    .default([]),
});
export type GreenfieldServerInfo = z.infer<typeof ServerInfoSchema>;

export const StoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultCurrency: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});
export type GreenfieldStore = z.infer<typeof StoreSchema>;

export const InvoiceStatusSchema = z.enum(['New', 'Processing', 'Settled', 'Expired', 'Invalid']);
export type GreenfieldInvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  status: InvoiceStatusSchema,
  additionalStatus: z.string().nullable().optional(),
  amount: z.string(),
  paidAmount: z.string().nullable().optional(),
  currency: z.string(),
  createdTime: z.number(),
  expirationTime: z.number().nullable().optional(),
  checkoutLink: z.string().nullable().optional(),
  metadata: z.object({ orderId: z.string().nullable().optional() }).loose().nullable().optional(),
});
export type GreenfieldInvoice = z.infer<typeof InvoiceSchema>;

export const PaymentMethodSchema = z.object({ paymentMethodId: z.string(), enabled: z.boolean() });
export type GreenfieldPaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const WalletSchema = z.object({
  balance: z.string(),
  confirmedBalance: z.string(),
  unconfirmedBalance: z.string(),
});
export type GreenfieldWallet = z.infer<typeof WalletSchema>;

export interface GreenfieldClientOptions {
  /** The server's base address, for example https://pay.example.com or https://example.com/btcpay. */
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Opens the connection, for example through Tor's SOCKS port for an onion address. */
  connect?: (target: { host: string; port: number }) => Promise<Duplex>;
}

export interface InvoiceQuery {
  take?: number;
  skip?: number;
  status?: GreenfieldInvoiceStatus;
  /** Unix seconds. */
  startDate?: number;
}

function problem(status: number, text: string): GreenfieldError {
  let message = '';
  let code: string | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      // Validation errors: [{ path, message }].
      message = parsed
        .map((item: unknown) =>
          item !== null && typeof item === 'object' && 'message' in item ? String(item.message) : '',
        )
        .filter(Boolean)
        .join(' ');
    } else if (parsed !== null && typeof parsed === 'object') {
      const fields = parsed as Record<string, unknown>;
      code = typeof fields['code'] === 'string' ? fields['code'] : undefined;
      message = typeof fields['message'] === 'string' ? fields['message'] : '';
    }
  } catch {
    // Not JSON: an HTML error page from a proxy, for example.
  }
  const kind: GreenfieldErrorKind =
    status === 401
      ? 'auth'
      : status === 403
        ? 'permission'
        : status === 404
          ? 'not-found'
          : status >= 500
            ? 'unavailable'
            : 'other';
  return new GreenfieldError(message || `BTCPay Server answered with HTTP ${String(status)}.`, status, kind, code);
}

function transportFailure(error: NodeJS.ErrnoException, where: string): GreenfieldTransportError {
  const code = error.code ?? '';
  if (code === 'ECONNREFUSED') return new GreenfieldTransportError(`Nothing answers at ${where}.`, 'refused');
  if (['ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(code)) {
    return new GreenfieldTransportError(`${where} cannot be reached (${code}).`, 'unreachable');
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return new GreenfieldTransportError(`The certificate of ${where} is not trusted (${code}).`, 'tls');
  }
  return new GreenfieldTransportError(error.message || `${where} did not answer.`, 'unreachable');
}

export class GreenfieldClient {
  readonly base: URL;
  /** The path BTCPay Server is served under, without a trailing slash; empty at the root. */
  private readonly prefix: string;

  constructor(private readonly options: GreenfieldClientOptions) {
    const base = new URL(options.baseUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
      throw new Error('A BTCPay Server address starts with https:// (or http:// on a local network).');
    }
    base.search = '';
    base.hash = '';
    this.base = base;
    this.prefix = base.pathname.replace(/\/+$/, '');
  }

  health(): Promise<GreenfieldHealth> {
    return this.get('/api/v1/health', HealthSchema, false);
  }

  serverInfo(): Promise<GreenfieldServerInfo> {
    return this.get('/api/v1/server/info', ServerInfoSchema);
  }

  stores(): Promise<GreenfieldStore[]> {
    return this.get('/api/v1/stores', z.array(StoreSchema));
  }

  invoices(storeId: string, query: InvoiceQuery = {}): Promise<GreenfieldInvoice[]> {
    const search = new URLSearchParams();
    if (query.take !== undefined) search.set('take', String(query.take));
    if (query.skip !== undefined) search.set('skip', String(query.skip));
    if (query.status !== undefined) search.set('status', query.status);
    if (query.startDate !== undefined) search.set('startDate', String(query.startDate));
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return this.get(`/api/v1/stores/${encodeURIComponent(storeId)}/invoices${suffix}`, z.array(InvoiceSchema));
  }

  paymentMethods(storeId: string): Promise<GreenfieldPaymentMethod[]> {
    return this.get(`/api/v1/stores/${encodeURIComponent(storeId)}/payment-methods`, z.array(PaymentMethodSchema));
  }

  wallet(storeId: string, paymentMethodId = 'BTC-CHAIN'): Promise<GreenfieldWallet> {
    return this.get(
      `/api/v1/stores/${encodeURIComponent(storeId)}/payment-methods/${encodeURIComponent(paymentMethodId)}/wallet`,
      WalletSchema,
    );
  }

  private async get<T>(path: string, schema: z.ZodType<T>, authenticated = true): Promise<T> {
    const text = await this.send(path, authenticated);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GreenfieldTransportError(
        `${this.where()} did not answer with JSON; is it a BTCPay Server?`,
        'protocol',
      );
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new GreenfieldTransportError(
        `${this.where()} answered ${path} in a form BTCortex does not recognise.`,
        'protocol',
      );
    }
    return result.data;
  }

  private where(): string {
    return this.base.host;
  }

  private send(path: string, authenticated: boolean): Promise<string> {
    const secure = this.base.protocol === 'https:';
    const port = Number(this.base.port) || (secure ? 443 : 80);
    const host = this.base.hostname.replace(/^\[|\]$/g, '');
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const connect = this.options.connect;
    const apiKey = authenticated ? this.options.apiKey : undefined;
    const requestOptions: RequestOptions = {
      host,
      port,
      method: 'GET',
      path: `${this.prefix}${path}`,
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
        Host: this.base.host,
        ...(apiKey === undefined ? {} : { Authorization: `token ${apiKey}` }),
      },
      // Certificates name hosts; a TLS server name must not be an IP address.
      ...(secure && isIP(host) === 0 ? { servername: host } : {}),
      ...(connect
        ? {
            createConnection: (_options: unknown, created: (error: Error | null, stream: Duplex) => void) => {
              connect({ host, port }).then(
                (socket) => {
                  created(
                    null,
                    secure ? connectTls({ socket, ...(isIP(host) === 0 ? { servername: host } : {}) }) : socket,
                  );
                },
                (error: unknown) => {
                  created(error instanceof Error ? error : new Error(String(error)), undefined as unknown as Duplex);
                },
              );
              return undefined;
            },
          }
        : { agent: false }),
    };
    const request = secure ? httpsRequest : httpRequest;
    const where = this.where();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | undefined, value?: string) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value ?? '');
      };
      const call = request(requestOptions, (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            finish(new GreenfieldTransportError(`${where} sent an answer larger than BTCortex accepts.`, 'protocol'));
            call.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (status >= 200 && status < 300) finish(undefined, text);
          else if (status >= 300 && status < 400) {
            finish(
              new GreenfieldTransportError(
                `${where} redirects elsewhere; enter the address BTCPay Server is reached at.`,
                'protocol',
              ),
            );
          } else finish(problem(status, text));
        });
        response.on('error', (error) => {
          finish(transportFailure(error, where));
        });
      });
      call.on('timeout', () => {
        finish(
          new GreenfieldTransportError(`${where} did not answer within ${String(timeoutMs / 1000)} s.`, 'timeout'),
        );
        call.destroy();
      });
      call.on('error', (error: NodeJS.ErrnoException) => {
        finish(transportFailure(error, where));
      });
      call.end();
    });
  }
}
