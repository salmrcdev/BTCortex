import { request as httpRequest } from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as connectTls } from 'node:tls';

// A read-only client for the Esplora REST API that Blockstream's Esplora and
// mempool serve (https://github.com/Blockstream/esplora/blob/master/API.md;
// response formats checked on 2026-10-23 against blockstream.info: heights
// and hashes as plain text, 404 beyond the tip). BTCortex asks only for the
// chain tip and block hashes by height, to tell which chain an explorer
// follows and whether it keeps up; it sends no addresses or transactions.
// Onion addresses are reached through a connection the caller opens (Tor's
// SOCKS port).

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const HASH = /^[0-9a-f]{64}$/;

export type EsploraFailure = 'timeout' | 'refused' | 'unreachable' | 'tls' | 'not-found' | 'protocol';

export class EsploraError extends Error {
  constructor(
    message: string,
    readonly failure: EsploraFailure,
  ) {
    super(message);
    this.name = 'EsploraError';
  }
}

export type ExplorerKind = 'mempool' | 'esplora';

export interface EsploraClientOptions {
  /** Where the API answers, for example http://umbrel.local:3006/api. */
  apiUrl: string;
  /** Opens the connection itself, for onion addresses through Tor's SOCKS port. */
  connect?: (target: { host: string; port: number }) => Promise<Socket>;
  timeoutMs?: number;
}

function transportFailure(error: NodeJS.ErrnoException, where: string): EsploraError {
  const code = error.code ?? '';
  if (code === 'ECONNREFUSED') return new EsploraError(`Nothing answers at ${where}.`, 'refused');
  if (['ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(code)) {
    return new EsploraError(`${where} cannot be reached (${code}).`, 'unreachable');
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT')) {
    return new EsploraError(`The certificate of ${where} is not trusted (${code}).`, 'tls');
  }
  return new EsploraError(error.message || `${where} did not answer.`, 'unreachable');
}

export class EsploraClient {
  readonly base: URL;
  /** The path the API is served under, without a trailing slash. */
  private readonly prefix: string;

  constructor(private readonly options: EsploraClientOptions) {
    const base = new URL(options.apiUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
      throw new EsploraError('An explorer address starts with https:// or http://.', 'protocol');
    }
    base.search = '';
    base.hash = '';
    this.base = base;
    this.prefix = base.pathname.replace(/\/+$/, '');
  }

  /** The height of the explorer's chain tip. */
  async tipHeight(): Promise<number> {
    const text = (await this.get('/blocks/tip/height')).trim();
    const height = Number(text);
    if (!/^\d{1,9}$/.test(text) || !Number.isSafeInteger(height)) {
      throw new EsploraError(`${this.base.host} did not answer as an Esplora API would.`, 'protocol');
    }
    return height;
  }

  /** The hash of the block at a height of the explorer's chain. */
  async blockHash(height: number): Promise<string> {
    const text = (await this.get(`/block-height/${String(height)}`)).trim().toLowerCase();
    if (!HASH.test(text)) {
      throw new EsploraError(`${this.base.host} did not answer as an Esplora API would.`, 'protocol');
    }
    return text;
  }

  private get(path: string): Promise<string> {
    const secure = this.base.protocol === 'https:';
    const port = Number(this.base.port) || (secure ? 443 : 80);
    const host = this.base.hostname.replace(/^\[|\]$/g, '');
    const where = this.base.host;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const connect = this.options.connect;
    const requestOptions: RequestOptions = {
      host,
      port,
      method: 'GET',
      path: `${this.prefix}${path}`,
      timeout: timeoutMs,
      headers: { Accept: 'text/plain', Host: this.base.host },
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
            finish(new EsploraError(`${where} sent an answer larger than BTCortex accepts.`, 'protocol'));
            call.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (status >= 200 && status < 300) finish(undefined, text);
          else if (status === 404) finish(new EsploraError(`${where} has no ${path}.`, 'not-found'));
          else if (status >= 300 && status < 400) {
            finish(
              new EsploraError(
                `${where} redirects elsewhere; enter the address the explorer is reached at.`,
                'protocol',
              ),
            );
          } else finish(new EsploraError(`${where} answered HTTP ${String(status)}.`, 'protocol'));
        });
        response.on('error', (error: NodeJS.ErrnoException) => {
          finish(transportFailure(error, where));
        });
      });
      call.on('timeout', () => {
        finish(new EsploraError(`${where} did not answer within ${String(timeoutMs / 1000)} s.`, 'timeout'));
        call.destroy();
      });
      call.on('error', (error: NodeJS.ErrnoException) => {
        finish(transportFailure(error, where));
      });
      call.end();
    });
  }
}

/** Where an explorer's Esplora API may answer: mempool serves it under /api; Esplora under /api or at its root. */
export function apiCandidates(url: string, kind: ExplorerKind): string[] {
  const base = url.trim().replace(/\/+$/, '');
  if (/\/api$/i.test(base)) return [base];
  return kind === 'mempool' ? [`${base}/api`] : [`${base}/api`, base];
}

/**
 * Finds the explorer's API and reads its chain: where the API answered, the
 * tip's height and the genesis block's hash, which tells the network.
 */
export async function probeExplorer(
  url: string,
  kind: ExplorerKind,
  options: Omit<EsploraClientOptions, 'apiUrl'> = {},
): Promise<{ apiUrl: string; height: number; genesisHash: string }> {
  let last: unknown;
  for (const apiUrl of apiCandidates(url, kind)) {
    const client = new EsploraClient({ ...options, apiUrl });
    try {
      const height = await client.tipHeight();
      const genesisHash = await client.blockHash(0);
      return { apiUrl, height, genesisHash };
    } catch (error) {
      last = error;
      // Nothing listening, or a timeout, will not change at another path.
      if (error instanceof EsploraError && error.failure !== 'not-found' && error.failure !== 'protocol') throw error;
    }
  }
  throw last instanceof Error ? last : new EsploraError(`${url} did not answer as an explorer would.`, 'protocol');
}
