import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { AppShell } from '@/components/layout/app-shell';
import { DEVELOPER_TABS } from '@/features/developer/tabs';
import type { DeveloperTab } from '@/features/developer/tabs';
import type { ExplorerSearch } from '@/features/explorer/explorer-page';
import { isDocumentId } from '@/features/help/documents';
import type { HelpSearch } from '@/features/help/help-page';
import { LIGHTNING_TABS } from '@/features/lightning/search';
import type { LightningSearch, LightningTab } from '@/features/lightning/search';
import { validateMonitoringSearch } from '@/features/monitoring/search';
import { OverviewPage } from '@/features/overview/overview-page';

// Every page but the overview is loaded when it is first opened, so the
// window starts with what it needs for the first screen only.
const BackupsPage = lazyRouteComponent(() => import('@/features/backups/backups-page'), 'BackupsPage');
const CataloguePage = lazyRouteComponent(() => import('@/features/catalogue/catalogue-page'), 'CataloguePage');
const CatalogueEntryPage = lazyRouteComponent(() => import('@/features/catalogue/entry-page'), 'CatalogueEntryPage');
const DiskUsagePage = lazyRouteComponent(() => import('@/features/disk-usage/disk-usage-page'), 'DiskUsagePage');
const ElectrumPage = lazyRouteComponent(() => import('@/features/electrum/electrum-page'), 'ElectrumPage');
const ExplorerPage = lazyRouteComponent(() => import('@/features/explorer/explorer-page'), 'ExplorerPage');
const HardwarePage = lazyRouteComponent(() => import('@/features/hardware/hardware-page'), 'HardwarePage');
const HelpPage = lazyRouteComponent(() => import('@/features/help/help-page'), 'HelpPage');
const LightningPage = lazyRouteComponent(() => import('@/features/lightning/lightning-page'), 'LightningPage');
const LogsPage = lazyRouteComponent(() => import('@/features/logs/logs-page'), 'LogsPage');
const MonitoringPage = lazyRouteComponent(() => import('@/features/monitoring/monitoring-page'), 'MonitoringPage');
const PaymentsPage = lazyRouteComponent(() => import('@/features/payments/payments-page'), 'PaymentsPage');
const WalletsPage = lazyRouteComponent(() => import('@/features/wallets/wallets-page'), 'WalletsPage');
const RemotePage = lazyRouteComponent(() => import('@/features/remote/remote-page'), 'RemotePage');
const ProfilePage = lazyRouteComponent(() => import('@/features/profiles/profile-page'), 'ProfilePage');
const ProfilesPage = lazyRouteComponent(() => import('@/features/profiles/profiles-page'), 'ProfilesPage');
const SecurityPage = lazyRouteComponent(() => import('@/features/security/security-page'), 'SecurityPage');
const SettingsPage = lazyRouteComponent(() => import('@/features/settings/settings-page'), 'SettingsPage');
const TopologyPage = lazyRouteComponent(() => import('@/features/topology/topology-page'), 'TopologyPage');
const DeveloperPage = lazyRouteComponent(() => import('@/features/developer/developer-page'), 'DeveloperPage');
const OrchestrationPage = lazyRouteComponent(
  () => import('@/features/orchestration/orchestration-page'),
  'OrchestrationPage',
);
const NodeDetailPage = lazyRouteComponent(() => import('@/features/nodes/node-detail-page'), 'NodeDetailPage');
const NodesPage = lazyRouteComponent(() => import('@/features/nodes/nodes-page'), 'NodesPage');
const SetupPage = lazyRouteComponent(() => import('@/features/setup/setup-page'), 'SetupPage');
const SoftwarePage = lazyRouteComponent(() => import('@/features/software/software-page'), 'SoftwarePage');
const TorPage = lazyRouteComponent(() => import('@/features/tor/tor-page'), 'TorPage');
const UpdatesPage = lazyRouteComponent(() => import('@/features/updates/updates-page'), 'UpdatesPage');
const WelcomePage = lazyRouteComponent(() => import('@/features/welcome/welcome-page'), 'WelcomePage');

// Hash history: the packaged application is served from a custom protocol,
// so path-based URLs would not survive a reload.

const rootRoute = createRootRoute({ component: AppShell });

const overviewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage });
const catalogueRoute = createRoute({ getParentRoute: () => rootRoute, path: 'catalogue', component: CataloguePage });
const catalogueEntryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'catalogue/$entryId',
  component: function CatalogueEntryRouteComponent() {
    const { entryId } = catalogueEntryRoute.useParams();
    return <CatalogueEntryPage entryId={entryId} />;
  },
});
const nodesRoute = createRoute({ getParentRoute: () => rootRoute, path: 'nodes', component: NodesPage });
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: 'nodes/setup', component: SetupPage });
const nodeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'nodes/$nodeId',
  component: function NodeRouteComponent() {
    const { nodeId } = nodeRoute.useParams();
    return <NodeDetailPage nodeId={nodeId} section="overview" />;
  },
});
const nodeConfigurationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'nodes/$nodeId/configuration',
  component: function NodeConfigurationRouteComponent() {
    const { nodeId } = nodeConfigurationRoute.useParams();
    return <NodeDetailPage nodeId={nodeId} section="configuration" />;
  },
});

const nodePeersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'nodes/$nodeId/peers',
  component: function NodePeersRouteComponent() {
    const { nodeId } = nodePeersRoute.useParams();
    return <NodeDetailPage nodeId={nodeId} section="peers" />;
  },
});

const nodePrivacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'nodes/$nodeId/privacy',
  component: function NodePrivacyRouteComponent() {
    const { nodeId } = nodePrivacyRoute.useParams();
    return <NodeDetailPage nodeId={nodeId} section="privacy" />;
  },
});

const nodeMempoolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'nodes/$nodeId/mempool',
  component: function NodeMempoolRouteComponent() {
    const { nodeId } = nodeMempoolRoute.useParams();
    return <NodeDetailPage nodeId={nodeId} section="mempool" />;
  },
});

const nodeStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'nodes/$nodeId/storage',
  component: function NodeStorageRouteComponent() {
    const { nodeId } = nodeStorageRoute.useParams();
    return <NodeDetailPage nodeId={nodeId} section="storage" />;
  },
});

const nodeConsoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'nodes/$nodeId/console',
  component: function NodeConsoleRouteComponent() {
    const { nodeId } = nodeConsoleRoute.useParams();
    return <NodeDetailPage nodeId={nodeId} section="console" />;
  },
});

const softwareRoute = createRoute({ getParentRoute: () => rootRoute, path: 'software', component: SoftwarePage });
const torRoute = createRoute({ getParentRoute: () => rootRoute, path: 'tor', component: TorPage });
const hardwareRoute = createRoute({ getParentRoute: () => rootRoute, path: 'hardware', component: HardwarePage });
const backupsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'backups', component: BackupsPage });

const electrumRoute = createRoute({ getParentRoute: () => rootRoute, path: 'electrum', component: ElectrumPage });

const HEX_64 = /^[0-9a-fA-F]{64}$/;

const explorerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'explorer',
  validateSearch: (search: Record<string, unknown>): ExplorerSearch => {
    const text = (key: string) => (typeof search[key] === 'string' ? search[key] : undefined);
    const node = text('node');
    const block = text('block');
    const tx = text('tx');
    const address = text('address');
    const page = typeof search['page'] === 'number' && Number.isInteger(search['page']) ? search['page'] : undefined;
    // A lookup asked for elsewhere, such as the command palette; a height arrives as a number.
    const q = typeof search['q'] === 'number' ? String(search['q']) : text('q');
    return {
      ...(node ? { node } : {}),
      ...(q && q.length <= 4_000 ? { q } : {}),
      ...(block && (HEX_64.test(block) || /^\d{1,9}$/.test(block)) ? { block } : {}),
      ...(page !== undefined && page >= 0 ? { page } : {}),
      ...(tx && HEX_64.test(tx) ? { tx } : {}),
      ...(address && address.length <= 120 ? { address } : {}),
    };
  },
  component: function ExplorerRouteComponent() {
    const search = explorerRoute.useSearch();
    // A new lookup starts from a fresh page, with its text in the search field.
    return <ExplorerPage key={search.q ?? ''} search={search} />;
  },
});

const lightningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'lightning',
  validateSearch: (search: Record<string, unknown>): LightningSearch => {
    const connection = typeof search['connection'] === 'string' ? search['connection'] : undefined;
    const tab = (LIGHTNING_TABS as readonly unknown[]).includes(search['tab'])
      ? (search['tab'] as LightningTab)
      : undefined;
    return {
      ...(connection && connection.length <= 64 ? { connection } : {}),
      ...(tab ? { tab } : {}),
    };
  },
  component: function LightningRouteComponent() {
    return <LightningPage search={lightningRoute.useSearch()} />;
  },
});

const developerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'developer',
  validateSearch: (search: Record<string, unknown>): { tab?: DeveloperTab } => {
    const tab = DEVELOPER_TABS.find((candidate) => candidate === search['tab']);
    return tab ? { tab } : {};
  },
  component: function DeveloperRouteComponent() {
    return <DeveloperPage tab={developerRoute.useSearch().tab} />;
  },
});
const topologyRoute = createRoute({ getParentRoute: () => rootRoute, path: 'topology', component: TopologyPage });
const securityRoute = createRoute({ getParentRoute: () => rootRoute, path: 'security', component: SecurityPage });
const updatesRoute = createRoute({ getParentRoute: () => rootRoute, path: 'updates', component: UpdatesPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'settings', component: SettingsPage });
const welcomeRoute = createRoute({ getParentRoute: () => rootRoute, path: 'welcome', component: WelcomePage });
const paymentsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'payments', component: PaymentsPage });
const walletsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'wallets', component: WalletsPage });
const remoteRoute = createRoute({ getParentRoute: () => rootRoute, path: 'remote', component: RemotePage });
const servicesRoute = createRoute({ getParentRoute: () => rootRoute, path: 'services', component: OrchestrationPage });
const storageRoute = createRoute({ getParentRoute: () => rootRoute, path: 'storage', component: DiskUsagePage });
const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'help',
  validateSearch: (search: Record<string, unknown>): HelpSearch => {
    const doc = search['doc'];
    const section = typeof search['section'] === 'string' && search['section'].length <= 200 ? search['section'] : '';
    return { ...(isDocumentId(doc) ? { doc } : {}), ...(section ? { section } : {}) };
  },
  component: function HelpRouteComponent() {
    return <HelpPage search={helpRoute.useSearch()} />;
  },
});
const profilesRoute = createRoute({ getParentRoute: () => rootRoute, path: 'profiles', component: ProfilesPage });
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'profiles/$profileId',
  component: function ProfileRouteComponent() {
    const { profileId } = profileRoute.useParams();
    return <ProfilePage key={profileId} profileId={profileId} />;
  },
});

const monitoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'monitoring',
  validateSearch: validateMonitoringSearch,
  component: function MonitoringRouteComponent() {
    return <MonitoringPage search={monitoringRoute.useSearch()} />;
  },
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'logs',
  validateSearch: (search: Record<string, unknown>): { source?: string } =>
    typeof search['source'] === 'string' ? { source: search['source'] } : {},
  component: function LogsRouteComponent() {
    const { source } = logsRoute.useSearch();
    return <LogsPage initialSource={source} />;
  },
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  catalogueRoute,
  catalogueEntryRoute,
  nodesRoute,
  setupRoute,
  nodeRoute,
  nodeConfigurationRoute,
  nodePeersRoute,
  nodePrivacyRoute,
  nodeMempoolRoute,
  nodeStorageRoute,
  nodeConsoleRoute,
  softwareRoute,
  updatesRoute,
  torRoute,
  hardwareRoute,
  electrumRoute,
  explorerRoute,
  lightningRoute,
  backupsRoute,
  monitoringRoute,
  profilesRoute,
  profileRoute,
  securityRoute,
  topologyRoute,
  developerRoute,
  logsRoute,
  settingsRoute,
  welcomeRoute,
  helpRoute,
  paymentsRoute,
  walletsRoute,
  remoteRoute,
  storageRoute,
  servicesRoute,
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
