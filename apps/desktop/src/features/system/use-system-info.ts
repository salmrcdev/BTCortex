import { useQuery } from '@tanstack/react-query';
import { callOrchestrator } from '@/lib/orchestrator';

/** Memory figures change continuously; refresh at a calm pace. */
const SYSTEM_INFO_REFRESH_MS = 15_000;

export function useSystemInfo() {
  return useQuery({
    queryKey: ['system', 'info'],
    queryFn: () => callOrchestrator('system.getInfo', {}),
    refetchInterval: SYSTEM_INFO_REFRESH_MS,
  });
}
