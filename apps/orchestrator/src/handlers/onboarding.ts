import type { OnboardingService } from '../onboarding/onboarding-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerOnboardingHandlers(dispatcher: Dispatcher, onboarding: OnboardingService): void {
  dispatcher.register('onboarding.state', () => onboarding.state());
  dispatcher.register('onboarding.environment', ({ refresh }) => onboarding.environment(refresh === true));
  dispatcher.register('onboarding.complete', ({ mode }) => onboarding.complete(mode));
}
