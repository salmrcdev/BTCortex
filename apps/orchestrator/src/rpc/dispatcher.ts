import { AppFailure, RPC_ERROR, isMethodName, methods } from '@btcortex/contracts';
import type { MethodName, MethodResult, Methods, RequestOrigin } from '@btcortex/contracts';
import type { z } from 'zod';
import type { Logger } from '../logging/logger';
import { RpcMethodError } from './errors';

export interface IncomingRequest {
  method: string;
  params: unknown;
  origin: RequestOrigin;
}

export interface HandlerContext {
  origin: RequestOrigin;
}

export type MethodHandler<M extends MethodName> = (
  params: z.output<Methods[M]['params']>,
  context: HandlerContext,
) => Promise<MethodResult<M>> | MethodResult<M>;

type ErasedHandler = (params: unknown, context: HandlerContext) => Promise<unknown>;

/**
 * Routes requests to handlers after enforcing the contract: the method must
 * exist, the caller's origin must be allowed, and parameters must validate.
 * Results are validated too, so contract drift fails loudly instead of
 * reaching the interface as malformed data.
 */
export class Dispatcher {
  private readonly handlers = new Map<MethodName, ErasedHandler>();

  constructor(private readonly logger: Logger) {}

  register<M extends MethodName>(method: M, handler: MethodHandler<M>): void {
    if (this.handlers.has(method)) throw new Error(`A handler for ${method} is already registered.`);
    // dispatch() validates the parameters against the same schema before calling.
    this.handlers.set(method, async (parsed, context) => handler(parsed as z.output<Methods[M]['params']>, context));
  }

  async dispatch(request: IncomingRequest): Promise<unknown> {
    if (!isMethodName(request.method)) {
      throw new RpcMethodError(RPC_ERROR.methodNotFound, `Unknown method "${request.method}".`);
    }
    const definition = methods[request.method];
    if (!definition.access.includes(request.origin)) {
      this.logger.warn('Rejected a call from an origin that may not use this method', {
        method: request.method,
        origin: request.origin,
      });
      throw new RpcMethodError(RPC_ERROR.forbidden, `The method "${request.method}" is not available to this caller.`);
    }
    const handler = this.handlers.get(request.method);
    if (!handler) {
      throw new RpcMethodError(RPC_ERROR.methodNotFound, `The method "${request.method}" is not implemented yet.`);
    }

    const params = definition.params.safeParse(request.params ?? {});
    if (!params.success) {
      throw new RpcMethodError(RPC_ERROR.invalidParams, 'The request parameters are invalid.', {
        issues: params.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }

    let result: unknown;
    const started = performance.now();
    try {
      result = await handler(params.data, { origin: request.origin });
    } catch (error) {
      if (error instanceof AppFailure) throw new RpcMethodError(RPC_ERROR.applicationError, error.message, error.error);
      throw error;
    } finally {
      this.logger.debug('Handled request', {
        method: request.method,
        origin: request.origin,
        durationMs: Math.round(performance.now() - started),
      });
    }

    const checked = definition.result.safeParse(result);
    if (!checked.success) {
      this.logger.error('A handler returned a result that violates its contract', {
        method: request.method,
        issues: checked.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
      throw new RpcMethodError(RPC_ERROR.internalError, 'The orchestrator produced an invalid response.');
    }
    return checked.data;
  }
}
