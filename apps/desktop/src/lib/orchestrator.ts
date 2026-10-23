import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import {
  AppErrorSchema,
  ORCHESTRATOR_EVENT_CHANNEL,
  ORCHESTRATOR_STATUS_CHANNEL,
  OrchestratorEventSchema,
  OrchestratorStatusSchema,
  RPC_ERROR,
  RpcErrorObjectSchema,
  methods,
} from '@btcortex/contracts';
import type {
  AppError,
  MethodName,
  MethodParams,
  MethodResult,
  OrchestratorEvent,
  OrchestratorStatus,
} from '@btcortex/contracts';

// The only way the interface talks to the rest of BTCortex. Every response is
// validated against the shared contract before it reaches a component.

export class OrchestratorError extends Error {
  readonly code: number;
  /** Structured explanation for application-level failures (specification section 30). */
  readonly appError: AppError | undefined;

  constructor(code: number, message: string, appError?: AppError) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    this.appError = appError;
  }
}

export function isDesktopRuntime(): boolean {
  return isTauri();
}

function unavailableOutsideDesktop(): OrchestratorError {
  return new OrchestratorError(
    RPC_ERROR.unavailable,
    'BTCortex is running outside its desktop application, so it cannot reach its orchestrator.',
  );
}

export function toOrchestratorError(error: unknown): OrchestratorError {
  if (error instanceof OrchestratorError) return error;
  const rpc = RpcErrorObjectSchema.safeParse(error);
  if (rpc.success) {
    const appError = AppErrorSchema.safeParse(rpc.data.data);
    return new OrchestratorError(rpc.data.code, rpc.data.message, appError.success ? appError.data : undefined);
  }
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'An unknown error occurred.';
  return new OrchestratorError(RPC_ERROR.internalError, message);
}

export interface CallOptions {
  /** Upper bound for this call; the shell caps it at five minutes. */
  timeoutMs?: number;
}

export async function callOrchestrator<M extends MethodName>(
  method: M,
  params: MethodParams<M>,
  options: CallOptions = {},
): Promise<MethodResult<M>> {
  if (!isTauri()) throw unavailableOutsideDesktop();
  const definition = methods[method];
  if (!(definition.access as readonly string[]).includes('ui')) {
    throw new OrchestratorError(RPC_ERROR.forbidden, `The method "${method}" is not available to the interface.`);
  }
  let raw: unknown;
  try {
    raw = await invoke('orchestrator_call', { method, params, timeoutMs: options.timeoutMs });
  } catch (error) {
    throw toOrchestratorError(error);
  }
  const parsed = definition.result.safeParse(raw);
  if (!parsed.success) {
    throw new OrchestratorError(
      RPC_ERROR.internalError,
      `The orchestrator returned data that does not match the "${method}" contract.`,
    );
  }
  return parsed.data as MethodResult<M>;
}

export async function fetchOrchestratorStatus(): Promise<OrchestratorStatus> {
  if (!isTauri()) return { state: 'failed', detail: unavailableOutsideDesktop().message };
  return OrchestratorStatusSchema.parse(await invoke('orchestrator_status'));
}

export async function subscribeToOrchestratorStatus(
  handler: (status: OrchestratorStatus) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen(ORCHESTRATOR_STATUS_CHANNEL, (event) => {
    const status = OrchestratorStatusSchema.safeParse(event.payload);
    if (status.success) handler(status.data);
  });
}

export async function subscribeToOrchestratorEvents(handler: (event: OrchestratorEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen(ORCHESTRATOR_EVENT_CHANNEL, (event) => {
    const parsed = OrchestratorEventSchema.safeParse(event.payload);
    if (parsed.success) handler(parsed.data);
  });
}
