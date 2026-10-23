import type { SecurityService } from '../security/security-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerSecurityHandlers(dispatcher: Dispatcher, security: SecurityService): void {
  dispatcher.register('security.overview', () => security.overview());
}
