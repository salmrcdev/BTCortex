import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type {
  BitcoinNetworkId,
  Job,
  MethodResult,
  NodeImplementation,
  NodeStatus,
  NodeUsage,
  NodeWithStatus,
} from '@btcortex/contracts';
import { toast } from 'sonner';
import { callOrchestrator, subscribeToOrchestratorEvents } from '@/lib/orchestrator';
import { backupKeys } from '@/features/backups/queries';
import { diskUsageKeys } from '@/features/disk-usage/queries';
import { applyElectrumStatus, electrumKeys } from '@/features/electrum/queries';
import { applyLightningStatus } from '@/features/lightning/queries';
import { monitoringKeys, notifyRaisedAlerts } from '@/features/monitoring/queries';
import { profileKeys } from '@/features/profiles/queries';
import { torKeys } from '@/features/tor/queries';
import { updateKeys } from '@/features/updates/queries';

// Server state for nodes and jobs. Live updates arrive as orchestrator events
// and are written straight into the query cache, so the interface never polls
// what the orchestrator already pushes.

export const nodeKeys = {
  all: ['nodes'] as const,
  list: () => ['nodes', 'list'] as const,
  detail: (nodeId: string) => ['nodes', 'detail', nodeId] as const,
  peers: (nodeId: string) => ['nodes', 'peers', nodeId] as const,
};

export const jobKeys = {
  detail: (jobId: string) => ['jobs', jobId] as const,
};

const PEERS_REFRESH_MS = 15_000;

function applyStatus(queryClient: QueryClient, status: NodeStatus): void {
  queryClient.setQueryData<NodeWithStatus[]>(nodeKeys.list(), (current) =>
    current?.map((node) => (node.profile.id === status.nodeId ? { ...node, status } : node)),
  );
  queryClient.setQueryData<NodeWithStatus>(nodeKeys.detail(status.nodeId), (current) =>
    current ? { ...current, status } : current,
  );
}

/** Connects orchestrator events to the cache; call once at start-up. */
export function bridgeOrchestratorEvents(queryClient: QueryClient): Promise<() => void> {
  return subscribeToOrchestratorEvents((event) => {
    switch (event.type) {
      case 'node.status':
        applyStatus(queryClient, event.payload);
        return;
      case 'nodes.changed':
        void queryClient.invalidateQueries({ queryKey: nodeKeys.all });
        return;
      case 'job.updated':
        queryClient.setQueryData<Job>(jobKeys.detail(event.payload.id), event.payload);
        // A deployment's steps change as its job reports.
        if (event.payload.kind === 'profile.deploy') void queryClient.invalidateQueries({ queryKey: profileKeys.all });
        if (
          event.payload.kind.startsWith('backup.') &&
          event.payload.state !== 'queued' &&
          event.payload.state !== 'running'
        ) {
          void queryClient.invalidateQueries({ queryKey: backupKeys.all });
        }
        // A job being queued or ending decides whether BTCortex's leftovers may be removed.
        if (event.payload.state !== 'running') void queryClient.invalidateQueries({ queryKey: diskUsageKeys.all });
        if (event.payload.state === 'succeeded') {
          void queryClient.invalidateQueries({ queryKey: nodeKeys.all });
          // Installations and node set-ups change what the update centre compares.
          void queryClient.invalidateQueries({ queryKey: updateKeys.all });
          if (event.payload.kind === 'electrum.setup')
            void queryClient.invalidateQueries({ queryKey: electrumKeys.all });
        }
        return;
      case 'tor.status':
        queryClient.setQueryData(torKeys.status, event.payload);
        return;
      case 'electrum.status':
        applyElectrumStatus(queryClient, event.payload);
        return;
      case 'lightning.status':
        applyLightningStatus(queryClient, event.payload);
        return;
      case 'alerts.changed':
        void queryClient.invalidateQueries({ queryKey: monitoringKeys.all });
        for (const alert of event.payload.raised) {
          if (alert.severity === 'info') continue;
          (alert.severity === 'critical' ? toast.error : toast.warning)(alert.title, { description: alert.message });
        }
        void notifyRaisedAlerts(queryClient, event.payload.raised);
        return;
      case 'orchestrator.ready':
        // The orchestrator restarted: everything cached may be outdated.
        void queryClient.invalidateQueries();
        return;
    }
  });
}

export function useNodes() {
  return useQuery({ queryKey: nodeKeys.list(), queryFn: () => callOrchestrator('nodes.list', {}) });
}

export function useNode(nodeId: string) {
  return useQuery({ queryKey: nodeKeys.detail(nodeId), queryFn: () => callOrchestrator('nodes.get', { nodeId }) });
}

export function usePeers(nodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: nodeKeys.peers(nodeId),
    queryFn: () => callOrchestrator('nodes.peers', { nodeId }),
    enabled,
    refetchInterval: PEERS_REFRESH_MS,
  });
}

export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: jobKeys.detail(jobId ?? ''),
    queryFn: () => callOrchestrator('jobs.get', { jobId: jobId ?? '' }),
    enabled: jobId !== undefined,
  });
}

export function useSetupPlan(
  network: BitcoinNetworkId,
  usage: NodeUsage,
  enabled: boolean,
  implementation: NodeImplementation = 'bitcoin-core',
) {
  return useQuery({
    queryKey: ['setup', 'plan', network, usage, implementation] as const,
    queryFn: () =>
      callOrchestrator(
        'setup.plan',
        // Bitcoin Core is the default, so it is not named.
        { network, usage, ...(implementation === 'bitcoin-core' ? {} : { implementation }) },
        { timeoutMs: 60_000 },
      ),
    enabled,
    staleTime: 60_000,
  });
}

/** Bitcoin Core already on this computer changes outside BTCortex; look again at a calm pace. */
const DISCOVERY_REFRESH_MS = 30_000;

export function useDiscoveredNodes() {
  return useQuery({
    queryKey: [...nodeKeys.all, 'discovered'] as const,
    queryFn: () => callOrchestrator('nodes.discover', {}),
    refetchInterval: DISCOVERY_REFRESH_MS,
  });
}

export interface ConnectDiscoveredRequest {
  dataDirectory: string;
  network: BitcoinNetworkId;
  name: string;
  useConfiguredPassword: boolean;
}

export function useConnectDiscovered() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ConnectDiscoveredRequest) =>
      callOrchestrator('nodes.connectDiscovered', request, { timeoutMs: 60_000 }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodeKeys.all }),
  });
}

export interface ConnectRemoteRequest {
  name: string;
  network: BitcoinNetworkId;
  rpcEndpoint: string;
  username: string;
  password: string;
}

/** A node on another computer, reached with an RPC user name and password (kept with Windows DPAPI). */
export function useConnectRemote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, network, rpcEndpoint, username, password }: ConnectRemoteRequest) =>
      callOrchestrator(
        'nodes.connectExisting',
        { name, network, rpcEndpoint, authentication: { kind: 'password', username, password } },
        { timeoutMs: 60_000 },
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodeKeys.all }),
  });
}

type NodeAction = 'nodes.start' | 'nodes.stop' | 'nodes.restart' | 'nodes.remove';

export function useNodeAction(action: NodeAction) {
  const queryClient = useQueryClient();
  return useMutation({
    // Stopping, restarting and removing are dangerous: they are asked for only from a confirmation dialogue.
    mutationFn: (nodeId: string): Promise<MethodResult<NodeAction>> => {
      if (action === 'nodes.start') return callOrchestrator(action, { nodeId });
      // Removing a node first stops its Electrum server, which may take a while.
      if (action === 'nodes.remove') {
        return callOrchestrator(action, { nodeId, confirmed: true }, { timeoutMs: 120_000 });
      }
      return callOrchestrator(action, { nodeId, confirmed: true });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodeKeys.all }),
  });
}
