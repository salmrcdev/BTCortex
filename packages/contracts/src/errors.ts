import { z } from 'zod';

// Every error that reaches the interface explains what happened, which
// component was affected, whether user data is at risk, the likely cause, safe
// diagnostic details and the available recovery actions (specification
// section 30). Diagnostic details must already be redacted: no passwords, RPC
// cookies, macaroons, tokens, keys or recovery phrases.

export const DataRiskSchema = z.enum(['none', 'possible', 'likely', 'unknown']);
export type DataRisk = z.infer<typeof DataRiskSchema>;

export const RecoveryActionSchema = z.object({
  /** Stable identifier the interface can map to a handler, for example `retry` or `open-settings`. */
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

export const AppErrorSchema = z.object({
  /** Stable machine-readable code, for example `bitcoin-core.rpc-unauthorised`. */
  code: z.string().min(1),
  /** What happened, in plain British English. */
  message: z.string().min(1),
  /** The affected component, for example `Bitcoin Core (Main node)`. */
  component: z.string().min(1),
  dataRisk: DataRiskSchema,
  likelyCause: z.string().optional(),
  /** Redacted technical details that are safe to show and export. */
  details: z.record(z.string(), z.unknown()).optional(),
  recoveryActions: z.array(RecoveryActionSchema),
});
export type AppError = z.infer<typeof AppErrorSchema>;

/** Error raised inside the orchestrator and serialised across the boundary unchanged. */
export class AppFailure extends Error {
  readonly error: AppError;

  constructor(error: AppError, options?: { cause?: unknown }) {
    super(error.message, options);
    this.name = 'AppFailure';
    this.error = error;
  }
}

export function isAppError(value: unknown): value is AppError {
  return AppErrorSchema.safeParse(value).success;
}
