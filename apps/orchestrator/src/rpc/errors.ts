import type { RpcErrorObject } from '@btcortex/contracts';

/** An error that maps directly to a JSON-RPC error object. */
export class RpcMethodError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcMethodError';
  }

  toErrorObject(): RpcErrorObject {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

/** The remote side answered a request with a JSON-RPC error. */
export class RpcRemoteError extends Error {
  constructor(readonly rpcError: RpcErrorObject) {
    super(rpcError.message);
    this.name = 'RpcRemoteError';
  }
}
