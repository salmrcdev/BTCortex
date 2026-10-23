import { AppFailure } from '@btcortex/contracts';
import type { AppError } from '@btcortex/contracts';
import { DownloadIntegrityError, InstallationRejectedError } from '@btcortex/installation-manager';

// Explains why an installation job stopped. Verification failures say
// explicitly that nothing was installed (specification section 30).

export function describeInstallationFailure(error: unknown, component: string): AppError {
  if (error instanceof AppFailure) return error.error;
  if (error instanceof InstallationRejectedError) {
    return {
      code: 'installation.rejected',
      message: error.message,
      component,
      dataRisk: 'none',
      likelyCause: 'The download could not be verified, so nothing was installed.',
      details: error.details,
      recoveryActions: [{ id: 'retry', label: 'Try again later' }],
    };
  }
  if (error instanceof DownloadIntegrityError) {
    return {
      code: 'installation.download-corrupted',
      message: 'The downloaded file does not match the signed checksum, so it was deleted and nothing was installed.',
      component,
      dataRisk: 'none',
      likelyCause: 'The download was corrupted or altered on the way.',
      details: { url: error.url },
      recoveryActions: [{ id: 'retry', label: 'Download again' }],
    };
  }
  return {
    code: 'installation.failed',
    message: error instanceof Error ? error.message : 'The task could not be completed.',
    component,
    dataRisk: 'none',
    likelyCause: 'A network problem or an unexpected condition interrupted the task.',
    recoveryActions: [{ id: 'retry', label: 'Start again; an interrupted download continues where it stopped' }],
  };
}
