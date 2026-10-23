import { connect } from 'node:net';
import type { Socket } from 'node:net';

// Newline-delimited JSON-RPC over TCP, as spoken by Fulcrum's admin port and
// by every Electrum server: one JSON object per line, requests matched to
// answers by id, and server-initiated notifications (no id) for
// subscriptions. Fulcrum ends its admin answers with CRLF; both endings are
// accepted. A line longer than the limit closes the connection, so a
// misbehaving server cannot make BTCortex buffer without bound.

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_LINE_BYTES = 8 * 1024 * 1024;

export class LineRpcError extends Error {
  constructor(
    message: string,
    /** The JSON-RPC error code, when the server answered with an error. */
    readonly code?: number,
    /** `unreachable`: nothing listens; `timeout`: no answer in time; `closed`: the connection ended early. */
    readonly failure?: 'unreachable' | 'timeout' | 'closed' | 'invalid',
  ) {
    super(message);
    this.name = 'LineRpcError';
  }
}

export interface LineRpcOptions {
  port: number;
  host?: string;
  /** For connecting and for each request. */
  timeoutMs?: number;
  /**
   * A connection made by the caller instead — over TLS, or through Tor —
   * already secured and checked, used in place of a plain TCP connection.
   */
  socket?: () => Promise<Socket>;
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export type NotificationListener = (method: string, params: unknown) => void;

export class LineRpcConnection {
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<NotificationListener>();
  private closed = false;

  private constructor(
    private readonly socket: Socket,
    private readonly timeoutMs: number,
  ) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.receive(chunk);
    });
    socket.on('error', () => {
      this.close();
    });
    socket.on('close', () => {
      this.close();
    });
  }

  static open(options: LineRpcOptions): Promise<LineRpcConnection> {
    const host = options.host ?? '127.0.0.1';
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const opener = options.socket;
    if (opener) {
      return opener().then(
        (socket) => new LineRpcConnection(socket, timeoutMs),
        (error: unknown) => {
          throw error instanceof LineRpcError
            ? error
            : new LineRpcError(
                `Nothing answers on ${host}:${String(options.port)} (${error instanceof Error ? error.message : String(error)}).`,
                undefined,
                'unreachable',
              );
        },
      );
    }
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port: options.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new LineRpcError(
            `${host}:${String(options.port)} did not accept a connection in time.`,
            undefined,
            'timeout',
          ),
        );
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeAllListeners('error');
        resolve(new LineRpcConnection(socket, timeoutMs));
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(
          new LineRpcError(
            `Nothing answers on ${host}:${String(options.port)} (${error.message}).`,
            undefined,
            'unreachable',
          ),
        );
      });
    });
  }

  request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new LineRpcError('The connection is closed.', undefined, 'closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LineRpcError(`No answer to "${method}" in time.`, undefined, 'timeout'));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  onNotification(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new LineRpcError(`The connection closed before "${pending.method}" was answered.`, undefined, 'closed'),
      );
      this.pending.delete(id);
    }
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let end = this.buffer.indexOf('\n');
    while (end !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line !== '') this.handle(line);
      end = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > MAX_LINE_BYTES) this.close();
  }

  private handle(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: unknown; method?: unknown; params?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined && message.error !== null) {
        const error = message.error as { code?: unknown; message?: unknown };
        pending.reject(
          new LineRpcError(
            typeof error.message === 'string' ? error.message : `"${pending.method}" failed.`,
            typeof error.code === 'number' ? error.code : undefined,
          ),
        );
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (typeof message.method === 'string') {
      for (const listener of this.listeners) listener(message.method, message.params);
    }
  }
}

/** Opens a connection, makes one request and closes it again. */
export async function lineRpcRequest<T = unknown>(
  options: LineRpcOptions,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const connection = await LineRpcConnection.open(options);
  try {
    return await connection.request<T>(method, params);
  } finally {
    connection.close();
  }
}
