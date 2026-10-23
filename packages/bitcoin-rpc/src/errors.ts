// Failure classes of a Bitcoin Core RPC call. They are distinct because the
// recovery differs: an unreachable node may simply be stopped, a rejected
// credential needs new credentials, a warm-up error means "wait".

/** Bitcoin Core error codes BTCortex reacts to (src/rpc/protocol.h). */
export const BITCOIN_RPC_ERROR = {
  miscError: -1,
  typeError: -3,
  walletError: -4,
  invalidAddressOrKey: -5,
  invalidParameter: -8,
  clientNotConnected: -9,
  clientInInitialDownload: -10,
  walletNotFound: -18,
  walletNotSpecified: -19,
  deserialisationError: -22,
  verifyError: -25,
  verifyRejected: -26,
  inWarmup: -28,
  methodDeprecated: -32,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

export type RpcTransportFailure = 'unreachable' | 'timeout' | 'aborted' | 'http-error' | 'invalid-response';

/** The request did not produce a JSON-RPC answer. */
export class RpcTransportError extends Error {
  constructor(
    readonly failure: RpcTransportFailure,
    message: string,
    readonly httpStatus?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RpcTransportError';
  }
}

/** HTTP 401: the node rejected the credentials (or the cookie changed). */
export class RpcAuthenticationError extends Error {
  constructor(message = 'The node rejected the RPC credentials.') {
    super(message);
    this.name = 'RpcAuthenticationError';
  }
}

/** HTTP 403: the credentials are valid but `rpcwhitelist` forbids the method. */
export class RpcForbiddenError extends Error {
  constructor(readonly method: string) {
    super(`The node does not allow these credentials to call "${method}".`);
    this.name = 'RpcForbiddenError';
  }
}

/** The node answered with a JSON-RPC error object. */
export class BitcoinRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = 'BitcoinRpcError';
  }

  /** The node is starting up ("Loading block index…"); retry later. */
  get isWarmingUp(): boolean {
    return this.code === BITCOIN_RPC_ERROR.inWarmup;
  }

  get isMethodNotFound(): boolean {
    return this.code === BITCOIN_RPC_ERROR.methodNotFound;
  }
}

export function isTransient(error: unknown): boolean {
  if (error instanceof BitcoinRpcError) return error.isWarmingUp;
  if (error instanceof RpcTransportError) return error.failure === 'unreachable' || error.failure === 'timeout';
  return false;
}
