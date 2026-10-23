import type { DiagnosticsService } from '../diagnostics/diagnostics-service';
import type { LogService } from '../logs/log-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerLogHandlers(dispatcher: Dispatcher, logs: LogService, diagnostics: DiagnosticsService): void {
  dispatcher.register('logs.sources', () => logs.sources());
  dispatcher.register('logs.read', (query) => logs.read(query));
  dispatcher.register('diagnostics.createBundle', () => diagnostics.createBundle());
  dispatcher.register('diagnostics.revealBundle', ({ path }) => {
    diagnostics.reveal(path);
    return { opened: true };
  });
}
