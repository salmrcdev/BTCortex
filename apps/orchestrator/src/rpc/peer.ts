import type { Readable, Writable } from 'node:stream';
import { JSONRPC_VERSION, RPC_ERROR, classifyMessage } from '@btcortex/contracts';
import type { RequestId, RequestOrigin, RpcErrorObject, RpcRequest } from '@btcortex/contracts';
import type { Logger } from '../logging/logger';
import type { IncomingRequest } from './dispatcher';
import { RpcMethodError, RpcRemoteError } from './errors';
import { LineDecoder } from './line-decoder';

export type RequestHandler = (request: IncomingRequest) => Promise<unknown>;

export interface JsonRpcPeerOptions {
  input: Readable;
  output: Writable;
  handler: RequestHandler;
  logger: Logger;
  /** Origin assumed when a request carries none. Defaults to the least privileged. */
  defaultOrigin?: RequestOrigin;
  defaultTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Bidirectional JSON-RPC 2.0 over newline-delimited JSON. Serves incoming
 * requests through `handler` and correlates responses to outgoing requests.
 */
export class JsonRpcPeer {
  private readonly decoder = new LineDecoder();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly closeListeners: (() => void)[] = [];
  private nextId = 1;
  private closed = false;
  private readonly defaultOrigin: RequestOrigin;
  private readonly defaultTimeoutMs: number;

  constructor(private readonly options: JsonRpcPeerOptions) {
    this.defaultOrigin = options.defaultOrigin ?? 'ui';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  start(): void {
    this.options.input.on('data', (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      for (const line of this.decoder.push(bytes, (error) => {
        this.options.logger.warn(error.message);
      }))
        this.receive(line);
    });
    this.options.input.on('end', () => {
      this.close();
    });
    this.options.input.on('error', (error) => {
      this.options.logger.error('The RPC input stream failed', { error });
      this.close();
    });
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request(method: string, params?: unknown, timeoutMs = this.defaultTimeoutMs): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new RpcRemoteError({ code: RPC_ERROR.unavailable, message: 'The RPC channel is closed.' }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new RpcRemoteError({
            code: RPC_ERROR.timeout,
            message: `No response to "${method}" within ${timeoutMs} ms.`,
          }),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(
        params === undefined
          ? { jsonrpc: JSONRPC_VERSION, id, method }
          : { jsonrpc: JSONRPC_VERSION, id, method, params },
      );
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.send(
      params === undefined ? { jsonrpc: JSONRPC_VERSION, method } : { jsonrpc: JSONRPC_VERSION, method, params },
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new RpcRemoteError({
          code: RPC_ERROR.unavailable,
          message: 'The RPC channel closed before a response arrived.',
        }),
      );
      this.pending.delete(id);
    }
    for (const listener of this.closeListeners) listener();
  }

  private receive(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.options.logger.warn('Discarded a message that is not valid JSON');
      this.send({ jsonrpc: JSONRPC_VERSION, id: null, error: { code: RPC_ERROR.parseError, message: 'Parse error.' } });
      return;
    }

    const classified = classifyMessage(value);
    switch (classified.kind) {
      case 'request':
        void this.serve(classified.message);
        return;
      case 'notification':
        this.options.logger.debug('Ignored an unexpected notification', { method: classified.message.method });
        return;
      case 'success':
        this.settle(classified.message.id, (pending) => {
          pending.resolve(classified.message.result);
        });
        return;
      case 'failure':
        if (classified.message.id === null) {
          this.options.logger.warn('The remote side reported an error without a request id', {
            error: classified.message.error,
          });
          return;
        }
        this.settle(classified.message.id, (pending) => {
          pending.reject(new RpcRemoteError(classified.message.error));
        });
        return;
      case 'invalid':
        this.options.logger.warn('Discarded an invalid JSON-RPC message', { reason: classified.reason });
        this.send({
          jsonrpc: JSONRPC_VERSION,
          id: null,
          error: { code: RPC_ERROR.invalidRequest, message: 'Invalid request.' },
        });
        return;
    }
  }

  private settle(id: RequestId, action: (pending: PendingRequest) => void): void {
    const pending = this.pending.get(id);
    if (!pending) {
      this.options.logger.warn('Received a response for an unknown or expired request', { id });
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    action(pending);
  }

  private async serve(request: RpcRequest): Promise<void> {
    try {
      const result = await this.options.handler({
        method: request.method,
        params: request.params,
        origin: request.origin ?? this.defaultOrigin,
      });
      this.send({ jsonrpc: JSONRPC_VERSION, id: request.id, result: result ?? null });
    } catch (error) {
      this.send({ jsonrpc: JSONRPC_VERSION, id: request.id, error: this.toErrorObject(request.method, error) });
    }
  }

  private toErrorObject(method: string, error: unknown): RpcErrorObject {
    if (error instanceof RpcMethodError) return error.toErrorObject();
    this.options.logger.error('A request failed with an unexpected error', { method, error });
    return {
      code: RPC_ERROR.internalError,
      message: 'An unexpected internal error occurred. Details are in the orchestrator log.',
    };
  }

  private send(message: object): void {
    if (this.closed && !('error' in message || 'result' in message)) return;
    try {
      this.options.output.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      this.options.logger.error('Failed to write to the RPC output stream', { error });
    }
  }
}
