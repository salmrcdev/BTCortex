import type { ProfileService } from '../profiles/profile-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerProfileHandlers(dispatcher: Dispatcher, profiles: ProfileService): void {
  dispatcher.register('profiles.overview', () => profiles.overview());
  dispatcher.register('profiles.plan', (choices) => profiles.plan(choices));
  dispatcher.register('profiles.deploy', ({ choices }) => profiles.deploy(choices));
}
