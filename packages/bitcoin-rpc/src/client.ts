import type { z } from 'zod';
import type { CredentialProvider } from './auth';
import { BitcoinRpcError, RpcAuthenticationError, RpcForbiddenError, RpcTransportError } from './errors';
import {
  BlockchainInfoSchema,
  HelpSchema,
  IndexInfoSchema,
  MempoolInfoSchema,
  NetTotalsSchema,
  NetworkInfoSchema,
  PeerInfoSchema,
  RpcInfoSchema,
  SmartFeeEstimateSchema,
  StopSchema,
  UptimeSchema,
} from './schemas';

// JSON-RPC 2.0 client for Bitcoin Core (28.0+ answers 2.0 requests strictly:
// HTTP 200 with either `result` or `error`). Older nodes answer in the legacy
// 1.1 style with HTTP 4xx/5xx and both fields; both shapes are accepted.

export interface BitcoinRpcClientOptions {
  /** For example `http://127.0.0.1:8332`. Loopback by default; remote endpoints need TLS tunnelling. */
  endpoint: string;
  credentials: CredentialProvider;
  /** Wallet endpoint (`/wallet/<name>`) for wallet RPCs. */
  wallet?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
}

export interface CallOptions<T> {
  schema?: z.ZodType<T>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Wallet endpoint for this call only, overriding the client's. */
  wallet?: string;
}

/** Options of the typed wrappers, which supply their own schema. */
export type RequestOptions = Omit<CallOptions<unknown>, 'schema'>;

export interface RpcCallStatistics {
  method: string;
  durationMs: number;
  ok: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const JSONRPC_VERSION = '2.0';

interface RawResponse {
  result?: unknown;
  error?: { code?: unknown; message?: unknown } | null;
  id?: unknown;
}

export type EstimateMode = 'unset' | 'economical' | 'conservative';

export class BitcoinRpcClient {
  private nextId = 1;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;
  private readonly listeners = new Set<(statistics: RpcCallStatistics) => void>();

  constructor(private readonly options: BitcoinRpcClientOptions) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get endpoint(): string {
    return this.options.endpoint;
  }

  /** Observes call durations, for RPC performance statistics. */
  onCall(listener: (statistics: RpcCallStatistics) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async call<T = unknown>(
    method: string,
    params: unknown[] | Record<string, unknown> = [],
    options: CallOptions<T> = {},
  ): Promise<T> {
    const started = performance.now();
    let ok = false;
    try {
      const raw = await this.send(method, params, options, true);
      const result = options.schema ? this.validate(method, options.schema, raw) : (raw as T);
      ok = true;
      return result;
    } finally {
      const statistics = { method, durationMs: performance.now() - started, ok };
      for (const listener of this.listeners) listener(statistics);
    }
  }

  private validate<T>(method: string, schema: z.ZodType<T>, raw: unknown): T {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RpcTransportError(
        'invalid-response',
        `The node's answer to "${method}" has an unexpected shape${issue ? ` (${issue.path.join('.') || 'root'}: ${issue.message})` : ''}.`,
      );
    }
    return parsed.data;
  }

  private async send(
    method: string,
    params: unknown[] | Record<string, unknown>,
    options: CallOptions<unknown>,
    retryOnAuthFailure: boolean,
  ): Promise<unknown> {
    const credentials = await this.options.credentials.get();
    const wallet = options.wallet ?? this.options.wallet;
    const url =
      wallet === undefined
        ? this.options.endpoint
        : `${this.options.endpoint.replace(/\/$/, '')}/wallet/${encodeURIComponent(wallet)}`;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const body = JSON.stringify({ jsonrpc: JSONRPC_VERSION, id: this.nextId++, method, params });

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
        },
        body,
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted)
        throw new RpcTransportError('aborted', `The "${method}" call was cancelled.`, undefined, { cause: error });
      if (timeout.aborted) {
        throw new RpcTransportError('timeout', `The node did not answer "${method}" in time.`, undefined, {
          cause: error,
        });
      }
      throw new RpcTransportError('unreachable', `The node at ${this.options.endpoint} is not reachable.`, undefined, {
        cause: error,
      });
    }

    if (response.status === 401) {
      // Cookies change on every node start: reload once before giving up.
      this.options.credentials.invalidate();
      if (retryOnAuthFailure) return this.send(method, params, options, false);
      throw new RpcAuthenticationError();
    }
    if (response.status === 403) throw new RpcForbiddenError(method);

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new RpcTransportError('invalid-response', `Reading the answer to "${method}" failed.`, response.status, {
        cause: error,
      });
    }

    let payload: RawResponse;
    try {
      payload = JSON.parse(text) as RawResponse;
    } catch {
      throw new RpcTransportError(
        response.ok ? 'invalid-response' : 'http-error',
        `The node answered "${method}" with HTTP ${response.status} and no JSON-RPC body.`,
        response.status,
      );
    }

    if (payload.error !== undefined && payload.error !== null) {
      const code = typeof payload.error.code === 'number' ? payload.error.code : -1;
      const message = typeof payload.error.message === 'string' ? payload.error.message : 'Unknown error';
      throw new BitcoinRpcError(code, message, method);
    }
    if (!response.ok) {
      throw new RpcTransportError(
        'http-error',
        `The node answered "${method}" with HTTP ${response.status}.`,
        response.status,
      );
    }
    if (!('result' in payload)) {
      throw new RpcTransportError('invalid-response', `The answer to "${method}" has no result.`, response.status);
    }
    return payload.result;
  }

  // Typed wrappers for the calls the node dashboard uses.

  getBlockchainInfo(options?: RequestOptions) {
    return this.call('getblockchaininfo', [], { ...options, schema: BlockchainInfoSchema });
  }

  getNetworkInfo(options?: RequestOptions) {
    return this.call('getnetworkinfo', [], { ...options, schema: NetworkInfoSchema });
  }

  getPeerInfo(options?: RequestOptions) {
    return this.call('getpeerinfo', [], { ...options, schema: PeerInfoSchema.array() });
  }

  getMempoolInfo(options?: RequestOptions) {
    return this.call('getmempoolinfo', [], { ...options, schema: MempoolInfoSchema });
  }

  getNetTotals(options?: RequestOptions) {
    return this.call('getnettotals', [], { ...options, schema: NetTotalsSchema });
  }

  getIndexInfo(options?: RequestOptions) {
    return this.call('getindexinfo', [], { ...options, schema: IndexInfoSchema });
  }

  getRpcInfo(options?: RequestOptions) {
    return this.call('getrpcinfo', [], { ...options, schema: RpcInfoSchema });
  }

  uptime(options?: RequestOptions) {
    return this.call('uptime', [], { ...options, schema: UptimeSchema });
  }

  estimateSmartFee(confirmationTarget: number, mode: EstimateMode = 'unset', options?: RequestOptions) {
    return this.call('estimatesmartfee', [confirmationTarget, mode], { ...options, schema: SmartFeeEstimateSchema });
  }

  help(command?: string, options?: RequestOptions) {
    return this.call('help', command === undefined ? [] : [command], { ...options, schema: HelpSchema });
  }

  /** Requests a graceful shutdown. Dangerous: callers must have explicit user confirmation. */
  stop(options?: RequestOptions) {
    return this.call('stop', [], { ...options, schema: StopSchema });
  }
}
