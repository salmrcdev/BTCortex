import type { OrchestrationService } from '../orchestration/orchestration-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerServiceHandlers(dispatcher: Dispatcher, orchestration: OrchestrationService): void {
  dispatcher.register('services.overview', () => orchestration.overview());
  dispatcher.register('services.plan', ({ target, action }) => orchestration.plan(target, action));
  dispatcher.register('services.run', ({ target, action }) => orchestration.run(target, action));
}
