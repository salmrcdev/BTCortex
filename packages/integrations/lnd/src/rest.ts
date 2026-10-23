import { X509Certificate } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:https';
import type { RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { checkServerIdentity as checkHostName, connect as connectTls } from 'node:tls';
import type { PeerCertificate } from 'node:tls';

// LND's REST interface (docs/research/notes/lightning.md, section 2.3): JSON
// over HTTPS, authenticated by a macaroon in the Grpc-Metadata-macaroon
// header. LND serves a self-signed certificate, so BTCortex accepts exactly
// the certificate it was given, by its SHA-256 fingerprint, whatever name the
// node is reached by: an onion or LAN address works, a different certificate
// never does. A certificate authority given instead (a node behind a proxy) is
// trusted for the certificates it issued, with the usual name check. Without
// a certificate, the system's authorities and name checks apply.

const DEFAULT_PORT = 8080;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Generous for listings of thousands of channels, payments or forwards. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface LndRestEndpoint {
  host: string;
  port: number;
}

/** `host:port`, `[::1]:8080` or `https://host:port/`; the port defaults to LND's 8080. */
export function parseRestAddress(address: string): LndRestEndpoint {
  const trimmed = address.trim();
  if (/^http:\/\//i.test(trimmed)) throw new Error('LND serves its REST interface over HTTPS only.');
  const bare = trimmed.replace(/^https:\/\//i, '').replace(/\/+$/, '');
  const match = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(bare) ?? /^([a-z0-9.-]+)(?::(\d+))?$/i.exec(bare);
  const host = match?.[1];
  const port = match?.[2] === undefined ? DEFAULT_PORT : Number(match[2]);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`"${address}" is not a REST address such as 127.0.0.1:8080.`);
  }
  return { host, port };
}

export function formatRestAddress(endpoint: LndRestEndpoint): string {
  return isIP(endpoint.host) === 6
    ? `[${endpoint.host}]:${String(endpoint.port)}`
    : `${endpoint.host}:${String(endpoint.port)}`;
}

/** The SHA-256 fingerprint of a PEM certificate, as upper-case hex pairs separated by colons. */
export function certificateFingerprint(pem: string): string {
  try {
    return new X509Certificate(pem).fingerprint256.toUpperCase();
  } catch (error) {
    throw new Error('This is not a TLS certificate (LND keeps its own in tls.cert).', { cause: error });
  }
}

/** When a PEM certificate expires, as an ISO 8601 timestamp; null when it cannot be read. */
export function certificateExpiry(pem: string): string | null {
  try {
    return new X509Certificate(pem).validToDate.toISOString();
  } catch {
    return null;
  }
}

export type LndTransportFailure = 'unreachable' | 'timeout' | 'certificate' | 'protocol';

/** LND could not be reached, or did not answer as LND does. */
export class LndTransportError extends Error {
  constructor(
    message: string,
    readonly failure: LndTransportFailure,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LndTransportError';
  }
}

export type LndErrorKind = 'auth' | 'permission' | 'locked' | 'not-found' | 'unavailable' | 'other';

/** LND answered with an error. */
export class LndRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: LndErrorKind,
    readonly grpcCode?: number,
  ) {
    super(message);
    this.name = 'LndRestError';
  }
}

/** grpc-gateway's error body: `{"code": 2, "message": "...", "details": []}`. */
export function toRestError(status: number, body: unknown): LndRestError {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const message = typeof fields['message'] === 'string' ? fields['message'] : `LND answered HTTP ${String(status)}.`;
  const code = typeof fields['code'] === 'number' ? fields['code'] : undefined;
  const lower = message.toLowerCase();
  let kind: LndErrorKind = 'other';
  if (lower.includes('permission denied')) kind = 'permission';
  else if (
    lower.includes('verification failed') ||
    lower.includes('cannot get macaroon') ||
    lower.includes('expected 1 macaroon') ||
    lower.includes('invalid macaroon') ||
    lower.includes('cannot determine data format of binary-encoded macaroon') ||
    code === 16
  ) {
    kind = 'auth';
  } else if (lower.includes('wallet locked') || lower.includes('not yet ready') || lower.includes('waiting to start')) {
    kind = 'locked';
  } else if (status === 404 || code === 5) kind = 'not-found';
  else if (status === 503 || code === 14) kind = 'unavailable';
  return new LndRestError(message, status, kind, code);
}

export interface LndRestClientOptions {
  endpoint: LndRestEndpoint;
  /** LND's tls.cert, or a certificate authority, as PEM. Without it, the system's authorities are used. */
  tlsCertificate?: string;
  /** The macaroon, hex-encoded. Only /v1/state answers without one. */
  macaroon?: string;
  timeoutMs?: number;
  /** Opens the connection, for example through Tor's SOCKS port for an onion address. */
  connect?: (endpoint: LndRestEndpoint) => Promise<Duplex>;
}

type Method = 'GET' | 'POST' | 'DELETE';
type Query = Record<string, string | number | boolean | undefined>;

export class LndRestClient {
  readonly endpoint: LndRestEndpoint;
  private readonly pinned: string | undefined;

  constructor(private readonly options: LndRestClientOptions) {
    this.endpoint = options.endpoint;
    this.pinned = options.tlsCertificate === undefined ? undefined : certificateFingerprint(options.tlsCertificate);
  }

  get(path: string, query?: Query): Promise<unknown> {
    return this.send('GET', withQuery(path, query));
  }

  post(path: string, body: unknown = {}): Promise<unknown> {
    return this.send('POST', path, body);
  }

  delete(path: string, query?: Query): Promise<unknown> {
    return this.send('DELETE', withQuery(path, query));
  }

  /**
   * A streaming call (newline-delimited JSON, each line `{"result": …}` or
   * `{"error": …}`): resolves with the first result `done` accepts.
   */
  stream(path: string, body: unknown, done: (result: unknown) => boolean): Promise<unknown> {
    return this.send('POST', path, body, done);
  }

  private send(method: Method, path: string, body?: unknown, done?: (result: unknown) => boolean): Promise<unknown> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const tls = this.tlsOptions();
    const connect = this.options.connect;
    const requestOptions: RequestOptions = {
      host: this.endpoint.host,
      port: this.endpoint.port,
      method,
      path,
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
        ...(this.options.macaroon === undefined ? {} : { 'Grpc-Metadata-macaroon': this.options.macaroon }),
        ...(payload === undefined
          ? {}
          : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) }),
      },
      ...tls,
      ...(connect
        ? {
            createConnection: (_options: unknown, created: (error: Error | null, stream: Duplex) => void) => {
              connect(this.endpoint).then(
                (socket) => {
                  created(null, connectTls({ socket, ...tls }));
                },
                (error: unknown) => {
                  created(error instanceof Error ? error : new Error(String(error)), undefined as unknown as Duplex);
                },
              );
              return undefined;
            },
          }
        : // A fresh connection per call; with an agent, Node would ignore createConnection.
          { agent: false }),
    };
    const where = formatRestAddress(this.endpoint);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | undefined, value?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };
      const call = request(requestOptions, (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        let pending = '';
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            finish(new LndTransportError(`LND at ${where} sent an answer larger than BTCortex accepts.`, 'protocol'));
            call.destroy();
            return;
          }
          if (!done || status !== 200) {
            chunks.push(chunk);
            return;
          }
          pending += chunk.toString('utf8');
          let newline = pending.indexOf('\n');
          while (newline >= 0) {
            const line = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            newline = pending.indexOf('\n');
            if (line === '') continue;
            let message: { result?: unknown; error?: unknown };
            try {
              message = JSON.parse(line) as { result?: unknown; error?: unknown };
            } catch {
              finish(new LndTransportError(`LND at ${where} streamed something other than JSON.`, 'protocol'));
              call.destroy();
              return;
            }
            if (message.error !== undefined) {
              finish(toRestError(status, message.error));
              call.destroy();
              return;
            }
            if (done(message.result)) {
              finish(undefined, message.result);
              call.destroy();
              return;
            }
          }
        });
        response.on('end', () => {
          if (done && status === 200) {
            finish(new LndTransportError(`LND at ${where} ended the stream before the call was complete.`, 'protocol'));
            return;
          }
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = {};
          if (text.trim() !== '') {
            try {
              parsed = JSON.parse(text);
            } catch {
              finish(
                new LndTransportError(
                  `LND at ${where} answered HTTP ${String(status)} with something other than JSON; is this LND's REST port?`,
                  'protocol',
                ),
              );
              return;
            }
          }
          if (status >= 200 && status < 300) finish(undefined, parsed);
          else finish(toRestError(status, parsed));
        });
        response.on('error', (error) => {
          finish(
            new LndTransportError(`The answer from LND at ${where} was cut off.`, 'unreachable', { cause: error }),
          );
        });
      });
      call.on('timeout', () => {
        finish(
          new LndTransportError(`LND at ${where} did not answer within ${String(timeoutMs / 1000)} s.`, 'timeout'),
        );
        call.destroy();
      });
      call.on('error', (error: NodeJS.ErrnoException) => {
        finish(describeConnectionError(error, where));
      });
      if (payload !== undefined) call.write(payload);
      call.end();
    });
  }

  private tlsOptions() {
    const certificate = this.options.tlsCertificate;
    const pinned = this.pinned;
    const servername = isIP(this.endpoint.host) === 0 ? this.endpoint.host : undefined;
    if (certificate === undefined || pinned === undefined) {
      return { rejectUnauthorized: true, ...(servername === undefined ? {} : { servername }) };
    }
    return {
      rejectUnauthorized: true,
      ca: certificate,
      ...(servername === undefined ? {} : { servername }),
      checkServerIdentity: (hostname: string, presented: PeerCertificate): Error | undefined =>
        // The very certificate BTCortex was given, whatever name the node is reached by…
        presented.fingerprint256.toUpperCase() === pinned
          ? undefined
          : // …or one the given authority issued, for the name it was issued to.
            checkHostName(hostname, presented),
    };
  }
}

function withQuery(path: string, query: Query | undefined): string {
  if (!query) return path;
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value !== undefined) parameters.set(name, String(value));
  const text = parameters.toString();
  return text === '' ? path : `${path}?${text}`;
}

const CERTIFICATE_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
]);

function describeConnectionError(error: NodeJS.ErrnoException, where: string): LndTransportError {
  const code = error.code ?? '';
  if (CERTIFICATE_ERRORS.has(code) || /certificate/i.test(error.message)) {
    return new LndTransportError(
      `LND at ${where} presented a different TLS certificate from the one BTCortex was given (${code || error.message}).`,
      'certificate',
      { cause: error },
    );
  }
  if (code === 'EPROTO' || code === 'ERR_SSL_WRONG_VERSION_NUMBER' || /wrong version number/i.test(error.message)) {
    return new LndTransportError(`${where} does not speak HTTPS; is this LND's REST port?`, 'protocol', {
      cause: error,
    });
  }
  return new LndTransportError(`LND could not be reached at ${where} (${code || error.message}).`, 'unreachable', {
    cause: error,
  });
}
