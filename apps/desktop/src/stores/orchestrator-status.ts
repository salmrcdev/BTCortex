import { create } from 'zustand';
import type { OrchestratorStatus } from '@btcortex/contracts';
import { fetchOrchestratorStatus, subscribeToOrchestratorStatus } from '@/lib/orchestrator';

interface OrchestratorStatusState {
  status: OrchestratorStatus;
  setStatus: (status: OrchestratorStatus) => void;
}

export const useOrchestratorStatus = create<OrchestratorStatusState>()((set) => ({
  status: { state: 'starting' },
  setStatus: (status) => {
    set({ status });
  },
}));

/** Loads the current state once and then follows the shell's status events. */
export async function connectOrchestratorStatus(): Promise<() => void> {
  const { setStatus } = useOrchestratorStatus.getState();
  const unlisten = await subscribeToOrchestratorStatus(setStatus);
  setStatus(await fetchOrchestratorStatus());
  return unlisten;
}
