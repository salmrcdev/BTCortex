import { z } from 'zod';

// Wire protocol between the native shell (Rust) and the orchestrator sidecar:
// newline-delimited JSON-RPC 2.0 over the sidecar's stdin/stdout, in both
// directions. The WebView never writes to this channel; the shell forwards its
// calls and stamps them with `origin: "ui"`, which the WebView cannot forge.

export const JSONRPC_VERSION = '2.0';

export const RequestOriginSchema = z.enum(['ui', 'shell']);
export type RequestOrigin = z.infer<typeof RequestOriginSchema>;

export const RequestIdSchema = z.union([z.string().min(1), z.number().int()]);
export type RequestId = z.infer<typeof RequestIdSchema>;

export const RpcRequestSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: RequestIdSchema,
  method: z.string().min(1),
  params: z.unknown().optional(),
  /** Present only on requests the shell sends to the orchestrator. */
  origin: RequestOriginSchema.optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcNotificationSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type RpcNotification = z.infer<typeof RpcNotificationSchema>;

export const RpcErrorObjectSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type RpcErrorObject = z.infer<typeof RpcErrorObjectSchema>;

export const RpcSuccessSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: RequestIdSchema,
  result: z.unknown(),
});
export type RpcSuccess = z.infer<typeof RpcSuccessSchema>;

export const RpcFailureSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: RequestIdSchema.nullable(),
  error: RpcErrorObjectSchema,
});
export type RpcFailure = z.infer<typeof RpcFailureSchema>;

export type RpcResponse = RpcSuccess | RpcFailure;
export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

/** Standard JSON-RPC codes plus the BTCortex application range (-32000 to -32099). */
export const RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** `error.data` carries an AppError. */
  applicationError: -32000,
  /** The caller's origin may not invoke this method. */
  forbidden: -32001,
  timeout: -32002,
  shuttingDown: -32003,
  /** The orchestrator process is not running or not reachable. */
  unavailable: -32004,
} as const;

/** Notification method the orchestrator uses for every event it publishes. */
export const EVENT_NOTIFICATION_METHOD = 'event';

export type ClassifiedMessage =
  | { kind: 'request'; message: RpcRequest }
  | { kind: 'notification'; message: RpcNotification }
  | { kind: 'success'; message: RpcSuccess }
  | { kind: 'failure'; message: RpcFailure }
  | { kind: 'invalid'; reason: string };

/** Classifies one decoded JSON value received on the channel. */
export function classifyMessage(value: unknown): ClassifiedMessage {
  if (typeof value !== 'object' || value === null) return { kind: 'invalid', reason: 'message is not an object' };
  if ('method' in value) {
    if ('id' in value) {
      const request = RpcRequestSchema.safeParse(value);
      return request.success
        ? { kind: 'request', message: request.data }
        : { kind: 'invalid', reason: 'malformed request' };
    }
    const notification = RpcNotificationSchema.safeParse(value);
    return notification.success
      ? { kind: 'notification', message: notification.data }
      : { kind: 'invalid', reason: 'malformed notification' };
  }
  if ('error' in value) {
    const failure = RpcFailureSchema.safeParse(value);
    return failure.success
      ? { kind: 'failure', message: failure.data }
      : { kind: 'invalid', reason: 'malformed error response' };
  }
  if ('result' in value) {
    const success = RpcSuccessSchema.safeParse(value);
    return success.success
      ? { kind: 'success', message: success.data }
      : { kind: 'invalid', reason: 'malformed response' };
  }
  return { kind: 'invalid', reason: 'message is neither a request, a notification nor a response' };
}
