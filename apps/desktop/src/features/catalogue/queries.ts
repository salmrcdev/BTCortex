import { useQuery } from '@tanstack/react-query';
import { callOrchestrator } from '@/lib/orchestrator';

export const catalogueKeys = {
  all: ['catalogue'] as const,
  entry: (id: string) => ['catalogue', 'entry', id] as const,
};

/** The research is static; only the live state of integrated entries changes, so a minute is plenty. */
const CATALOGUE_REFRESH_MS = 60_000;

export function useCatalogue() {
  return useQuery({
    queryKey: catalogueKeys.all,
    queryFn: () => callOrchestrator('catalogue.list', {}),
    refetchInterval: CATALOGUE_REFRESH_MS,
  });
}

export function useCatalogueEntry(id: string) {
  return useQuery({
    queryKey: catalogueKeys.entry(id),
    queryFn: () => callOrchestrator('catalogue.entry', { id }),
    refetchInterval: CATALOGUE_REFRESH_MS,
  });
}
