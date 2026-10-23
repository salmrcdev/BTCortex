import type { Dispatcher } from '../rpc/dispatcher';
import type { CatalogueService } from '../services/catalogue-service';

export function registerCatalogueHandlers(dispatcher: Dispatcher, catalogue: CatalogueService): void {
  dispatcher.register('catalogue.list', () => catalogue.list());
  dispatcher.register('catalogue.entry', ({ id }) => catalogue.entry(id));
}
