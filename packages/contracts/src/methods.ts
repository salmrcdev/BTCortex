import { z } from 'zod';
import {
  BackupOverviewSchema,
  BackupPassphraseSchema,
  BackupScheduleSchema,
  BackupSettingsSchema,
  BackupVerificationSchema,
  RestorePreviewSchema,
} from './backups';
import { CatalogueEntryDetailSchema, CatalogueEntrySummarySchema } from './catalogue';
import {
  AddressDetailSchema,
  BlockDetailSchema,
  ExplorerOverviewSchema,
  ExplorerSearchResultSchema,
  RawTransactionCheckSchema,
  ScriptSummarySchema,
  TransactionDetailSchema,
} from './explorer';
import {
  ElectrumOverviewSchema,
  ElectrumRemovalSchema,
  ElectrumServerStatusSchema,
  ElectrumSetupPlanSchema,
} from './electrum';
import type { RequestOrigin } from './jsonrpc';
import {
  AlertSchema,
  ConfigureMonitoringParamsSchema,
  HealthSummarySchema,
  MetricHistorySchema,
  MetricSeriesSchema,
  MonitoringExportParamsSchema,
  MonitoringExportSchema,
  MonitoringSettingsSchema,
} from './monitoring';
import { DeploymentChoicesSchema, DeploymentPlanSchema, ProfilesOverviewSchema } from './profiles';
import { SecurityOverviewSchema } from './security';
import { TopologySchema } from './topology';
import { UpdatesOverviewSchema } from './updates';
import {
  DescriptorAnalysisSchema,
  MinedBlocksSchema,
  ProbeParamsSchema,
  ProbeResultSchema,
  ProtocolFeaturesSchema,
  PsbtAnalysisSchema,
  ZmqStatusSchema,
} from './devtools';
import {
  AddLightningParamsSchema,
  ChannelBackupRecordSchema,
  LightningConnectionWithStatusSchema,
  LightningDashboardSchema,
  LightningStatusSchema,
  LocalLightningNodeSchema,
} from './lightning';
import {
  HardwareOverviewSchema,
  IdentifiedDeviceSchema,
  NodeSignerStatusSchema,
  PsbtOutputRequestSchema,
  PsbtReviewSchema,
  QrMatrixSchema,
  QrScanProgressSchema,
  SignedPsbtSchema,
  SignerAddressTypeSchema,
  SignerWalletDetailSchema,
} from './hardware';
import { DiagnosticBundleSchema, LogPageSchema, LogQuerySchema, LogSourceSchema } from './logs';
import { MempoolOverviewSchema, MempoolTransactionSchema, MetricsPointSchema } from './mempool';
import { BanTargetSchema, NetworkOverviewSchema, PeerAddressSchema, PeerEventSchema } from './peers';
import { RpcCallParamsSchema, RpcCallResultSchema, RpcCatalogueEntrySchema, RpcStatisticSchema } from './rpc-console';
import {
  NODE_CONFIG_VERSION_ID,
  NodeConfigDocumentSchema,
  NodeConfigHistorySchema,
  NodeConfigVersionDetailSchema,
  RestoreNodeConfigParamsSchema,
  SaveNodeConfigParamsSchema,
  SaveNodeConfigResultSchema,
} from './node-config';
import { EnvironmentReportSchema, OnboardingModeSchema, OnboardingStateSchema } from './onboarding';
import { AddPaymentServerParamsSchema, PaymentDashboardSchema, PaymentServerWithStatusSchema } from './payments';
import { RemoteServiceKindSchema, RemoteTestResultSchema } from './remote';
import {
  AddRemoteElectrumParamsSchema,
  RemoteElectrumEndpointSchema,
  RemoteElectrumTestSchema,
  RemoteElectrumWithStatusSchema,
} from './remote-electrum';
import {
  AddRemoteExplorerParamsSchema,
  ExplorerPageSchema,
  RemoteExplorerEndpointSchema,
  RemoteExplorerTestSchema,
  RemoteExplorerWithStatusSchema,
} from './remote-explorer';
import { CleanupKindSchema, CleanupResultSchema, DiskUsageSchema } from './disk-usage';
import {
  OrchestrationPlanSchema,
  OrchestrationRunSchema,
  OrchestrationSchema,
  OrchestrationTargetSchema,
  ServiceActionSchema,
} from './orchestration';
import {
  AddressCheckSchema,
  BroadcastParamsSchema,
  BroadcastResultSchema,
  CoinScanParamsSchema,
  CoinScanSchema,
  CombinedPsbtSchema,
  FinalisedPsbtSchema,
  OutputLookupSchema,
  ParsedPaymentUriSchema,
  PaymentUriRequestSchema,
  PaymentUriSchema,
  PsbtCombineParamsSchema,
  TrackedTransactionSchema,
} from './transaction-tools';
import {
  BitcoinNetworkSchema,
  DiscoveredNodeSchema,
  endpointParts,
  isLocalNetworkHost,
  isLoopbackHost,
  NodeImplementationSchema,
  NodeProfileSchema,
  NodeWithStatusSchema,
  PeerSummarySchema,
} from './nodes';
import {
  InstalledProductSchema,
  InstalledSoftwareSchema,
  IntegrityReportSchema,
  SoftwareUpdateSchema,
} from './installations';
import { DetectionReportSchema, JobSchema, NodeUsageSchema, SetupPlanSchema } from './setup';
import {
  ChainVerificationSchema,
  ConfigureStorageResultSchema,
  ReindexScopeSchema,
  StorageChangeSchema,
  StorageOverviewSchema,
  StoragePartIdSchema,
} from './storage';
import { SystemInfoSchema } from './system';
import {
  ConfigurePrivacyResultSchema,
  I2pRouterStatusSchema,
  NodePrivacyChangeSchema,
  NodePrivacySchema,
  TorSettingsChangeSchema,
  TorStatusSchema,
} from './tor';
import { ElectrumWalletStatusSchema, SparrowConnectionViaSchema, SparrowStatusSchema } from './wallets';

// Registry of every method the orchestrator exposes. Parameters and results are
// validated at runtime on the orchestrator side; the interface derives its
// typed client from the same definitions.

/**
 * - `read`: no side effects.
 * - `write`: changes BTCortex state or configuration.
 * - `dangerous`: may affect funds, data or privacy; the interface must obtain
 *   explicit confirmation before calling it (specification section 21.3).
 */
export type MethodRisk = 'read' | 'write' | 'dangerous';

export interface MethodDefinition<P extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  readonly params: P;
  readonly result: R;
  /** Which origins may call the method. Methods without `ui` are invisible to the WebView. */
  readonly access: readonly RequestOrigin[];
  readonly risk: MethodRisk;
  readonly description: string;
}

function defineMethod<P extends z.ZodType, R extends z.ZodType>(
  definition: MethodDefinition<P, R>,
): MethodDefinition<P, R> {
  return definition;
}

const NoParams = z.object({}).strict();
const NodeIdParams = z.object({ nodeId: z.string().min(1) }).strict();
/** For dangerous methods on a node: sent only once the user confirmed in the interface's dialogue. */
const ConfirmedNodeIdParams = z.object({ nodeId: z.string().min(1), confirmed: z.literal(true) }).strict();
const NodeNameSchema = z.string().trim().min(1).max(80);
const Done = z.object({ done: z.literal(true) });

export const methods = {
  'system.ping': defineMethod({
    params: NoParams,
    result: z.object({ pong: z.literal(true), at: z.iso.datetime() }),
    access: ['ui', 'shell'],
    risk: 'read',
    description: 'Checks that the orchestrator is responsive.',
  }),
  'system.getInfo': defineMethod({
    params: NoParams,
    result: SystemInfoSchema,
    access: ['ui', 'shell'],
    risk: 'read',
    description: 'Returns version, runtime and host information.',
  }),
  'system.shutdown': defineMethod({
    params: z.object({ reason: z.enum(['application-exit', 'restart']) }).strict(),
    result: z.object({ acknowledged: z.literal(true) }),
    access: ['shell'],
    risk: 'write',
    description:
      'Stops background work and closes the database. Managed services keep running unless their policy says otherwise.',
  }),

  'nodes.list': defineMethod({
    params: NoParams,
    result: z.array(NodeWithStatusSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Lists registered Bitcoin nodes with their latest status.',
  }),
  'nodes.get': defineMethod({
    params: NodeIdParams,
    result: NodeWithStatusSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Returns one node with its latest status.',
  }),
  'nodes.peers': defineMethod({
    params: NodeIdParams,
    result: z.array(PeerSummarySchema),
    access: ['ui'],
    risk: 'read',
    description: 'Lists the peers a node is connected to. Contains peer IP addresses.',
  }),
  'nodes.network': defineMethod({
    params: NodeIdParams,
    result: NetworkOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Which networks the node reaches, its local addresses, manually added peers and banned addresses.',
  }),
  'nodes.peers.history': defineMethod({
    params: NodeIdParams,
    result: z.array(PeerEventSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Recent peer connections and disconnections seen by BTCortex, newest first. Contains peer addresses.',
  }),
  'nodes.peers.disconnect': defineMethod({
    params: z.object({ nodeId: z.string().min(1), peerId: z.number().int().nonnegative() }).strict(),
    result: Done,
    access: ['ui'],
    risk: 'write',
    description: 'Disconnects one peer; the node finds another one by itself.',
  }),
  'nodes.peers.connect': defineMethod({
    params: z.object({ nodeId: z.string().min(1), address: PeerAddressSchema, keep: z.boolean() }).strict(),
    result: Done,
    access: ['ui'],
    risk: 'write',
    description: 'Connects to a peer once, or keeps it connected until the node restarts (addnode).',
  }),
  'nodes.peers.forget': defineMethod({
    params: z.object({ nodeId: z.string().min(1), address: PeerAddressSchema }).strict(),
    result: Done,
    access: ['ui'],
    risk: 'write',
    description: 'Removes a manually added peer from the list the node keeps connected.',
  }),
  'nodes.peers.ban': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        target: BanTargetSchema,
        durationSeconds: z
          .number()
          .int()
          .min(60)
          .max(10 * 365 * 24 * 3600),
        confirmed: z.literal(true),
      })
      .strict(),
    result: Done,
    access: ['ui'],
    risk: 'dangerous',
    description: 'Bans an address or subnet; a wide subnet can cut the node off from the network.',
  }),
  'nodes.peers.unban': defineMethod({
    params: z.object({ nodeId: z.string().min(1), target: BanTargetSchema }).strict(),
    result: Done,
    access: ['ui'],
    risk: 'write',
    description: 'Lifts the ban on an address or subnet.',
  }),
  'nodes.peers.clearBans': defineMethod({
    params: NodeIdParams,
    result: Done,
    access: ['ui'],
    risk: 'write',
    description: 'Lifts every ban.',
  }),
  'nodes.rpc.catalogue': defineMethod({
    params: NodeIdParams,
    result: z.array(RpcCatalogueEntrySchema),
    access: ['ui'],
    risk: 'read',
    description: 'Lists the RPC methods the node offers, with their risk classes.',
  }),
  'nodes.rpc.help': defineMethod({
    params: z.object({ nodeId: z.string().min(1), method: z.string().regex(/^[a-z][a-z0-9]{0,63}$/) }).strict(),
    result: z.object({ text: z.string() }),
    access: ['ui'],
    risk: 'read',
    description: 'Returns the node’s own help text for one RPC method.',
  }),
  'nodes.rpc.call': defineMethod({
    params: RpcCallParamsSchema,
    result: RpcCallResultSchema,
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Calls one RPC method from the console. Dangerous methods need confirmation; methods that would pass private keys or wallet passphrases through BTCortex are refused.',
  }),
  'nodes.rpc.statistics': defineMethod({
    params: NodeIdParams,
    result: z.array(RpcStatisticSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Counts and durations of the RPC calls BTCortex made to the node since it started.',
  }),
  'nodes.mempool': defineMethod({
    params: NodeIdParams,
    result: MempoolOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description: 'This node’s mempool: size, limits, policy, fee-rate distribution and fee estimates.',
  }),
  'nodes.mempool.transaction': defineMethod({
    params: z.object({ nodeId: z.string().min(1), txid: z.string().regex(/^[0-9a-fA-F]{64}$/) }).strict(),
    result: MempoolTransactionSchema,
    access: ['ui'],
    risk: 'read',
    description: 'One transaction in this node’s mempool, with its ancestors, descendants and cluster.',
  }),
  'nodes.metrics': defineMethod({
    params: NodeIdParams,
    result: z.array(MetricsPointSchema),
    access: ['ui'],
    risk: 'read',
    description:
      'Per-minute samples of the node’s chain height, peers and mempool since BTCortex started (at most a day).',
  }),
  'catalogue.list': defineMethod({
    params: z.object({}),
    result: z.array(CatalogueEntrySummarySchema),
    access: ['ui'],
    risk: 'read',
    description: 'Every catalogue entry with its target support level and what BTCortex can do with it today.',
  }),
  'catalogue.entry': defineMethod({
    params: z.object({ id: z.string().min(1).max(100) }),
    result: CatalogueEntryDetailSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'One catalogue entry: verified project information, compatibility, dependencies and integration state.',
  }),
  'nodes.storage': defineMethod({
    params: NodeIdParams,
    result: StorageOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Where the node keeps its data, free space and disk type, folder sizes, pruning, indexes and storage warnings.',
  }),
  'nodes.storage.configure': defineMethod({
    params: z.object({ nodeId: z.string().min(1), change: StorageChangeSchema, confirmed: z.boolean() }),
    result: ConfigureStorageResultSchema,
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Switches indexes on or off and changes pruning in bitcoin.conf of a node BTCortex manages, then restarts it. Pruning deletes block files; leaving it downloads the chain again.',
  }),
  'nodes.storage.verify': defineMethod({
    params: NodeIdParams,
    result: ChainVerificationSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Checks the most recent blocks and the chainstate with Bitcoin Core’s verifychain.',
  }),
  'nodes.storage.reindex': defineMethod({
    params: z.object({ nodeId: z.string().min(1), scope: ReindexScopeSchema, confirmed: z.literal(true) }),
    result: z.object({ restarting: z.literal(true) }),
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Restarts a node BTCortex manages with -reindex-chainstate or -reindex, which rebuild its databases and can take many hours.',
  }),
  'nodes.storage.removeIndexFiles': defineMethod({
    params: z.object({ nodeId: z.string().min(1), part: StoragePartIdSchema, confirmed: z.literal(true) }),
    result: z.object({ removedBytes: z.number().nonnegative() }),
    access: ['ui'],
    risk: 'dangerous',
    description: 'Deletes the files of an index that is switched off, on a node BTCortex manages.',
  }),
  'nodes.start': defineMethod({
    params: NodeIdParams,
    result: z.object({ accepted: z.literal(true) }),
    access: ['ui'],
    risk: 'write',
    description: 'Starts a managed node.',
  }),
  'nodes.stop': defineMethod({
    params: ConfirmedNodeIdParams,
    result: z.object({ accepted: z.literal(true) }),
    access: ['ui'],
    risk: 'dangerous',
    description: 'Shuts a node down gracefully; wallets and services using it lose their connection.',
  }),
  'nodes.restart': defineMethod({
    params: ConfirmedNodeIdParams,
    result: z.object({ accepted: z.literal(true) }),
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Shuts a managed node down gracefully and starts it again, for example to apply configuration changes.',
  }),
  'nodes.lifecycle.configure': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        keepRunningOnExit: z.boolean().optional(),
        startWithBtcortex: z.boolean().optional(),
      })
      .strict(),
    result: NodeProfileSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Chooses whether a managed node starts when BTCortex starts and keeps running after BTCortex quits.',
  }),
  'nodes.config.get': defineMethod({
    params: NodeIdParams,
    result: NodeConfigDocumentSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Reads the node’s bitcoin.conf with secret values hidden.',
  }),
  'nodes.config.save': defineMethod({
    params: SaveNodeConfigParamsSchema,
    result: SaveNodeConfigResultSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Validates and saves the bitcoin.conf of a node BTCortex manages, keeping a backup. Hidden values are kept; risky options need confirmation.',
  }),
  'nodes.config.history': defineMethod({
    params: NodeIdParams,
    result: NodeConfigHistorySchema,
    access: ['ui'],
    risk: 'read',
    description: 'Lists the earlier versions of a node’s bitcoin.conf that BTCortex kept when it saved the file.',
  }),
  'nodes.config.version': defineMethod({
    params: z.object({ nodeId: z.string().min(1), versionId: z.string().regex(NODE_CONFIG_VERSION_ID) }).strict(),
    result: NodeConfigVersionDetailSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Shows a kept version of bitcoin.conf with secrets hidden, and what restoring it would change in the current file.',
  }),
  'nodes.config.restore': defineMethod({
    params: RestoreNodeConfigParamsSchema,
    result: SaveNodeConfigResultSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Puts a kept version of bitcoin.conf back through the same checks as saving, keeping the current file as a version too.',
  }),
  'nodes.config.export': defineMethod({
    params: z.object({ nodeId: z.string().min(1), path: z.string().min(1).max(1024) }).strict(),
    result: z.object({ written: z.literal(true) }),
    access: ['ui'],
    risk: 'write',
    description:
      'Saves a copy of a node’s bitcoin.conf with every secret value hidden, to a .conf or .txt file the user chose.',
  }),
  'nodes.remove': defineMethod({
    params: ConfirmedNodeIdParams,
    result: z.object({
      removed: z.literal(true),
      dataDirectoryKept: z.string().nullable(),
      /** The index of the node's Electrum server, which is removed with the node while its index stays. */
      electrumIndexKept: z.string().nullable(),
    }),
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Removes the node from BTCortex, with its Electrum server. Blockchain, wallet and index data are never deleted.',
  }),
  'nodes.connectExisting': defineMethod({
    params: z
      .object({
        name: NodeNameSchema,
        network: BitcoinNetworkSchema,
        rpcEndpoint: z.url({ protocol: /^https?$/ }),
        authentication: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('cookie'), cookieFile: z.string().min(1) }),
          z.object({ kind: z.literal('password'), username: z.string().min(1), password: z.string().min(1) }),
        ]),
      })
      .strict()
      .superRefine((value, context) => {
        const { hostname, protocol } = endpointParts(value.rpcEndpoint);
        // A cookie file is only ever sent to a node on this computer.
        if (value.authentication.kind === 'cookie' && !isLoopbackHost(hostname)) {
          context.addIssue({
            code: 'custom',
            path: ['rpcEndpoint'],
            message: 'Cookie authentication only works with a node on this computer.',
          });
        }
        if (protocol === 'http:' && !isLocalNetworkHost(hostname)) {
          context.addIssue({
            code: 'custom',
            path: ['rpcEndpoint'],
            message: 'Outside the local network, use https so that credentials are not sent in plain text.',
          });
        }
      }),
    result: NodeProfileSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Registers an existing node after testing the connection. Passwords are stored with Windows DPAPI.',
  }),
  'nodes.discover': defineMethod({
    params: NoParams,
    result: z.array(DiscoveredNodeSchema),
    access: ['ui'],
    risk: 'read',
    description:
      'Looks for Bitcoin Core data directories on this computer and works out how to connect to each, without changing anything.',
  }),
  'nodes.connectDiscovered': defineMethod({
    params: z
      .object({
        dataDirectory: z.string().min(1),
        network: BitcoinNetworkSchema,
        name: NodeNameSchema,
        /** Consent to read the RPC password from the node's bitcoin.conf and keep a DPAPI-protected copy. */
        useConfiguredPassword: z.boolean(),
      })
      .strict(),
    result: NodeProfileSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Registers a node found by nodes.discover, using the connection details BTCortex worked out itself, after testing it.',
  }),

  'setup.plan': defineMethod({
    params: z
      .object({
        network: BitcoinNetworkSchema,
        usage: NodeUsageSchema,
        /** Bitcoin Core unless stated. */
        implementation: NodeImplementationSchema.optional(),
      })
      .strict(),
    result: SetupPlanSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Proposes a hardware-aware installation plan for a Bitcoin Core or Bitcoin Knots node without changing anything.',
  }),
  'setup.start': defineMethod({
    params: z
      .object({
        name: NodeNameSchema,
        network: BitcoinNetworkSchema,
        usage: NodeUsageSchema,
        implementation: NodeImplementationSchema.optional(),
        /** The user agreed that the node follows a chain Bitcoin Core rejects; required for such a release. */
        acceptDifferentChain: z.literal(true).optional(),
      })
      .strict(),
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description: 'Carries out an approved plan: verified download, installation, configuration and first start.',
  }),
  'bitcoinCore.detect': defineMethod({
    params: NoParams,
    result: DetectionReportSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Looks for existing Bitcoin Core data directories and installations without modifying anything.',
  }),

  'apps.sparrow.status': defineMethod({
    params: z.object({ nodeId: z.string().min(1), via: SparrowConnectionViaSchema.optional() }).strict(),
    result: SparrowStatusSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Reports whether Sparrow is installed, running and connected to the given node.',
  }),
  'apps.sparrow.connect': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        replaceExistingServer: z.boolean(),
        resetStartupNetwork: z.boolean(),
        via: SparrowConnectionViaSchema.optional(),
      })
      .strict(),
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Installs Sparrow if needed (verified), points it at the node (with cookie authentication) or at the node’s Electrum server, and opens it. A server or fixed start-up network the user chose is changed only with consent. Wallets are never touched.',
  }),
  'apps.electrum.status': defineMethod({
    params: NodeIdParams,
    result: ElectrumWalletStatusSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Which Electrum opens with the node’s Electrum server (the one installed on this computer, or BTCortex’s verified copy), whether it is current and whether it is open.',
  }),
  'apps.electrum.open': defineMethod({
    params: NodeIdParams,
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Opens Electrum with the node’s Electrum server as its only server, on the node’s network, installing Electrum first (verified) when none is on this computer. Electrum’s settings and wallets are not changed.',
  }),
  'apps.sparrow.open': defineMethod({
    params: NodeIdParams,
    result: z.object({ launched: z.literal(true) }),
    access: ['ui'],
    risk: 'read',
    description: 'Opens the installed Sparrow on the node’s network.',
  }),

  'tor.status': defineMethod({
    params: NoParams,
    result: TorStatusSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Reports the tor BTCortex runs: installation, connection to the Tor network, ports, recent notices, other software’s tor and the nodes that use it.',
  }),
  'i2p.status': defineMethod({
    params: z.object({ refresh: z.boolean().optional() }).strict(),
    result: I2pRouterStatusSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Looks for an I2P router on this computer by its SAM bridge, which nodes can use for I2P peers. BTCortex does not install or run the router.',
  }),
  'tor.install': defineMethod({
    params: NoParams,
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Installs the current Tor Expert Bundle as a background job, after checking the Tor Project’s signatures on it and on its checksums.',
  }),
  'tor.start': defineMethod({
    params: NoParams,
    result: TorStatusSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Starts BTCortex’s tor, which then connects to the Tor network.',
  }),
  'tor.stop': defineMethod({
    params: NoParams,
    result: TorStatusSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Stops BTCortex’s tor. Nodes that route through Tor lose those connections until it runs again.',
  }),
  'tor.configure': defineMethod({
    params: TorSettingsChangeSchema,
    result: TorStatusSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Changes whether tor starts with BTCortex.',
  }),
  'nodes.privacy': defineMethod({
    params: NodeIdParams,
    result: NodePrivacySchema,
    access: ['ui'],
    risk: 'read',
    description: 'How the node reaches its peers: directly or through Tor, its onion service and private broadcasting.',
  }),
  'nodes.privacy.configure': defineMethod({
    params: z
      .object({ nodeId: z.string().min(1), change: NodePrivacyChangeSchema, confirmed: z.literal(true) })
      .strict(),
    result: ConfigurePrivacyResultSchema,
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Routes a node BTCortex manages through its tor (or directly again) and sets up its onion service, then restarts it. Changes what peers and the network can learn about this computer.',
  }),

  'explorer.overview': defineMethod({
    params: NodeIdParams,
    result: ExplorerOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'The node’s chain at a glance: tip, difficulty, hash rate, transaction count, fee estimates, mempool and the latest blocks.',
  }),
  'explorer.search': defineMethod({
    params: z.object({ nodeId: z.string().min(1), query: z.string().trim().min(1).max(400_000) }).strict(),
    result: ExplorerSearchResultSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Works out what was searched for: a block height or hash, a transaction id, an address, a raw transaction or a script.',
  }),
  'explorer.block': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        id: z.string().regex(/^([0-9a-fA-F]{64}|\d{1,9})$/),
        page: z.number().int().nonnegative().max(100_000),
      })
      .strict(),
    result: BlockDetailSchema,
    access: ['ui'],
    risk: 'read',
    description: 'A block by hash or height, its statistics and one page of its transactions.',
  }),
  'explorer.transaction': defineMethod({
    params: z.object({ nodeId: z.string().min(1), txid: z.string().regex(/^[0-9a-fA-F]{64}$/) }).strict(),
    result: TransactionDetailSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'A transaction in the node’s mempool or, with the transaction index, in its chain: inputs with the coins they spend, outputs and whether they are spent, fee, and its unconfirmed relatives.',
  }),
  'explorer.decodeRaw': defineMethod({
    params: z.object({ nodeId: z.string().min(1), hex: z.string().regex(/^([0-9a-fA-F]{2}){10,200000}$/) }).strict(),
    result: RawTransactionCheckSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Decodes a raw transaction and asks the node whether its mempool would accept it, without broadcasting it.',
  }),
  'explorer.decodeScript': defineMethod({
    params: z.object({ nodeId: z.string().min(1), hex: z.string().regex(/^([0-9a-fA-F]{2}){1,10000}$/) }).strict(),
    result: ScriptSummarySchema,
    access: ['ui'],
    risk: 'read',
    description: 'Decodes a script: its opcodes, type and address.',
  }),
  'explorer.address': defineMethod({
    params: z.object({ nodeId: z.string().min(1), address: z.string().trim().min(14).max(120) }).strict(),
    result: AddressDetailSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'An address’s balance, history and unspent coins from the node’s own Electrum server; Bitcoin Core alone keeps no index of addresses.',
  }),

  'electrum.overview': defineMethod({
    params: NoParams,
    result: ElectrumOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Every node’s Electrum server: whether the node can have one, its state, indexing progress, connected wallets and how wallets connect.',
  }),
  'electrum.plan': defineMethod({
    params: z.object({ nodeId: z.string().min(1), dataDirectory: z.string().min(1).optional() }).strict(),
    result: ElectrumSetupPlanSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'What setting up an Electrum server for the node involves: where the index goes and the room it needs, the node settings BTCortex adds, whether the node restarts, and anything that prevents it.',
  }),
  'electrum.setUp': defineMethod({
    params: z
      .object({ nodeId: z.string().min(1), dataDirectory: z.string().min(1), confirmed: z.literal(true) })
      .strict(),
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Sets up an Electrum server for the node as a background job: installs Fulcrum after checking its signature, turns on the node’s transaction index and block notifications (restarting it once), then starts Fulcrum when the node is ready.',
  }),
  'explorers.remote.list': defineMethod({
    params: NoParams,
    result: z.array(RemoteExplorerWithStatusSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Block explorers (mempool, Esplora) on other computers that BTCortex follows, with where each stands.',
  }),
  'explorers.remote.test': defineMethod({
    params: RemoteExplorerEndpointSchema,
    result: RemoteExplorerTestSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Reaches a mempool or Esplora explorer directly or through Tor and reports where its API answers, its chain and its height. Nothing is stored.',
  }),
  'explorers.remote.add': defineMethod({
    params: AddRemoteExplorerParamsSchema,
    result: z.array(RemoteExplorerWithStatusSchema),
    access: ['ui'],
    risk: 'write',
    description:
      'Adds a block explorer on another computer after testing it again; one added for a node must follow the node’s chain.',
  }),
  'explorers.remote.remove': defineMethod({
    params: z.object({ id: z.string().min(1) }).strict(),
    result: z.array(RemoteExplorerWithStatusSchema),
    access: ['ui'],
    risk: 'write',
    description: 'Stops following a block explorer on another computer.',
  }),
  'explorers.remote.open': defineMethod({
    params: z.object({ id: z.string().min(1), page: ExplorerPageSchema }).strict(),
    result: z.object({ opened: z.boolean(), url: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Opens the explorer’s page for a transaction, block or address in the browser, which shows the item to the explorer; for an explorer reached through Tor the address is returned instead, for Tor Browser, because the browser would connect directly.',
  }),
  'electrum.remote.list': defineMethod({
    params: NoParams,
    result: z.array(RemoteElectrumWithStatusSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Electrum servers on other computers that BTCortex reads, with where each stands.',
  }),
  'electrum.remote.test': defineMethod({
    params: RemoteElectrumEndpointSchema,
    result: RemoteElectrumTestSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Reaches an Electrum server directly or through Tor, over TCP or TLS, and reports its software, chain, height and certificate. Nothing is stored.',
  }),
  'electrum.remote.add': defineMethod({
    params: AddRemoteElectrumParamsSchema,
    result: z.array(RemoteElectrumWithStatusSchema),
    access: ['ui'],
    risk: 'write',
    description:
      'Adds an Electrum server on another computer after testing it again: a certificate no public authority vouches for must be the one the user accepted, and a node it serves must follow the same chain.',
  }),
  'electrum.remote.remove': defineMethod({
    params: z.object({ id: z.string().min(1) }).strict(),
    result: z.array(RemoteElectrumWithStatusSchema),
    access: ['ui'],
    risk: 'write',
    description: 'Stops reading an Electrum server on another computer.',
  }),
  'electrum.start': defineMethod({
    params: NodeIdParams,
    result: ElectrumServerStatusSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Starts the node’s Electrum server, and keeps starting it whenever the node runs.',
  }),
  'electrum.stop': defineMethod({
    params: NodeIdParams,
    result: ElectrumServerStatusSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Stops the node’s Electrum server until it is started again. Wallets using it lose their connection.',
  }),
  'electrum.remoteAccess': defineMethod({
    params: z.object({ nodeId: z.string().min(1), enabled: z.boolean(), confirmed: z.literal(true) }).strict(),
    result: ElectrumServerStatusSchema,
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Publishes the node’s Electrum server as an onion service through BTCortex’s tor, so that wallets on other devices reach it over Tor, or stops publishing it. Anyone who learns the onion address can use the server.',
  }),
  'electrum.remove': defineMethod({
    params: z.object({ nodeId: z.string().min(1), deleteIndex: z.boolean(), confirmed: z.literal(true) }).strict(),
    result: ElectrumRemovalSchema,
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Removes the node’s Electrum server. Its index is deleted only when asked; rebuilding it later takes hours or days.',
  }),

  'hardware.overview': defineMethod({
    params: NoParams,
    result: HardwareOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Signing devices attached to this computer, recognised from their USB identity without opening them, and the state of HWI, Trezor Suite and the deprecated Trezor Bridge.',
  }),
  'hardware.identify': defineMethod({
    params: z.object({ network: BitcoinNetworkSchema }).strict(),
    result: z.array(IdentifiedDeviceSchema),
    access: ['ui'],
    risk: 'read',
    description:
      'Asks HWI which devices are connected, with their model and fingerprint. HWI opens each device briefly.',
  }),
  'hardware.installHwi': defineMethod({
    params: NoParams,
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description: 'Installs HWI as a background job, after checking its signed checksums.',
  }),
  'hardware.installTrezorSuite': defineMethod({
    params: NoParams,
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Installs Trezor Suite for this Windows user as a background job, after checking SatoshiLabs’ signatures on the installer.',
  }),
  'hardware.openTrezorSuite': defineMethod({
    params: NoParams,
    result: z.object({ launched: z.literal(true) }),
    access: ['ui'],
    risk: 'read',
    description: 'Opens Trezor Suite, for device set-up and firmware updates.',
  }),
  'lightning.list': defineMethod({
    params: NoParams,
    result: z.array(LightningConnectionWithStatusSchema),
    access: ['ui'],
    risk: 'read',
    description:
      'The Lightning nodes BTCortex is connected to, with what each macaroon allows and how each node is doing.',
  }),
  'lightning.detectLocal': defineMethod({
    params: NoParams,
    result: LocalLightningNodeSchema.nullable(),
    access: ['ui'],
    risk: 'read',
    description:
      'Looks for LND on this computer (%LOCALAPPDATA%\\Lnd): its network, REST address and macaroons, and whether it answers. Reads files only.',
  }),
  'lightning.add': defineMethod({
    params: AddLightningParamsSchema,
    result: LightningConnectionWithStatusSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Connects to a Lightning node after checking that it answers with the given certificate and macaroon. The macaroon is kept in the vault; one that can move funds needs explicit acceptance.',
  }),
  'lightning.remove': defineMethod({
    params: z.object({ connectionId: z.string().min(1), confirmed: z.literal(true) }).strict(),
    result: z.object({ removed: z.literal(true) }),
    access: ['ui'],
    risk: 'write',
    description:
      'Forgets a Lightning node and deletes its macaroon from the vault. The node itself and the channel backups BTCortex saved are not touched.',
  }),
  'lightning.dashboard': defineMethod({
    params: z.object({ connectionId: z.string().min(1) }).strict(),
    result: LightningDashboardSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Everything the node lets BTCortex read: identity, synchronisation, balances, channels and their liquidity, pending channels, peers, routing fees and forwards, recent invoices and payments, watchtowers, the last channel backup and warnings.',
  }),
  'lightning.refresh': defineMethod({
    params: z.object({ connectionId: z.string().min(1) }).strict(),
    result: LightningStatusSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Checks the Lightning node now instead of waiting for the next regular check.',
  }),
  'lightning.saveChannelBackup': defineMethod({
    params: z.object({ connectionId: z.string().min(1) }).strict(),
    result: ChannelBackupRecordSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Saves the node’s static channel backup into BTCortex’s backups folder. LND encrypts it with a key from the node’s seed: with that seed, it lets the channels’ funds be recovered after a loss.',
  }),

  'nodes.signers': defineMethod({
    params: NodeIdParams,
    result: NodeSignerStatusSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Whether the node can use hardware wallets through HWI, the devices it finds and its hardware-wallet wallets.',
  }),
  'nodes.signers.enable': defineMethod({
    params: z.object({ nodeId: z.string().min(1), confirmed: z.literal(true) }).strict(),
    result: z.object({ restarting: z.boolean() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Points a node BTCortex manages at its verified HWI, so that Bitcoin Core can use hardware wallets, and restarts it.',
  }),
  'nodes.signers.createWallet': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        name: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9 _-]+$/),
      })
      .strict(),
    result: z.object({ wallet: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Creates a watch-only wallet on the node for the one connected hardware wallet, from its public descriptors. No private key leaves the device.',
  }),
  'wallets.signer.detail': defineMethod({
    params: z.object({ nodeId: z.string().min(1), wallet: z.string().min(1).max(64) }).strict(),
    result: SignerWalletDetailSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Balance and recent transactions of a hardware-wallet wallet on the node.',
  }),
  'wallets.signer.newAddress': defineMethod({
    params: z
      .object({ nodeId: z.string().min(1), wallet: z.string().min(1).max(64), type: SignerAddressTypeSchema })
      .strict(),
    result: z.object({ address: z.string() }),
    access: ['ui'],
    risk: 'write',
    description: 'A new receiving address of a hardware-wallet wallet.',
  }),
  'wallets.signer.displayAddress': defineMethod({
    params: z
      .object({ nodeId: z.string().min(1), wallet: z.string().min(1).max(64), address: z.string().min(14).max(120) })
      .strict(),
    result: z.object({ shown: z.literal(true) }),
    access: ['ui'],
    risk: 'read',
    description: 'Shows an address on the hardware wallet, so the user can check it there before sharing it.',
  }),
  'wallets.psbt.create': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        wallet: z.string().min(1).max(64),
        outputs: z.array(PsbtOutputRequestSchema).min(1).max(20),
        feeRateSatPerVb: z.number().min(0.1).max(10_000),
      })
      .strict(),
    result: PsbtReviewSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Builds an unsigned transaction (PSBT) from a hardware-wallet wallet, for review before anything is signed.',
  }),
  'wallets.psbt.decode': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        psbt: z.string().min(1).max(4_000_000),
        wallet: z.string().min(1).max(64).optional(),
      })
      .strict(),
    result: PsbtReviewSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Shows what a PSBT spends and pays, as the node reads it.',
  }),
  'wallets.psbt.sign': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        wallet: z.string().min(1).max(64),
        psbt: z.string().min(1).max(4_000_000),
        confirmed: z.literal(true),
      })
      .strict(),
    result: SignedPsbtSchema,
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Sends a reviewed PSBT to the hardware wallet for signing; the device shows the transaction and asks for confirmation itself.',
  }),
  'wallets.psbt.finalize': defineMethod({
    params: z.object({ nodeId: z.string().min(1), psbt: z.string().min(1).max(4_000_000) }).strict(),
    result: z.object({ complete: z.boolean(), hex: z.string().nullable() }),
    access: ['ui'],
    risk: 'read',
    description:
      'Turns a PSBT signed elsewhere, for example on an air-gapped device, into the final transaction, when every input is signed.',
  }),
  'wallets.psbt.broadcast': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        hex: z
          .string()
          .min(20)
          .max(4_000_000)
          .regex(/^[0-9a-fA-F]+$/),
        confirmed: z.literal(true),
      })
      .strict(),
    result: z.object({ txid: z.string() }),
    access: ['ui'],
    risk: 'dangerous',
    description: 'Sends a signed transaction to the Bitcoin network through the node. It cannot be taken back.',
  }),
  'wallets.qr.encode': defineMethod({
    params: z.object({ psbt: z.string().min(1).max(4_000_000) }).strict(),
    result: z.object({ frames: z.array(QrMatrixSchema) }),
    access: ['ui'],
    risk: 'read',
    description:
      'Turns a PSBT into QR codes for a device that signs without a cable: one code, or an animated sequence of Uniform Resources (crypto-psbt).',
  }),
  'wallets.qr.decode': defineMethod({
    params: z.object({ parts: z.array(z.string().min(1).max(4000)).min(1).max(1000) }).strict(),
    result: QrScanProgressSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Puts the QR codes read so far back together into a PSBT, reporting how far it has got.',
  }),
  'wallets.psbt.readFile': defineMethod({
    params: z.object({ path: z.string().min(1).max(1024) }).strict(),
    result: z.object({ psbt: z.string() }),
    access: ['ui'],
    risk: 'read',
    description: 'Reads a PSBT from a file the user chose, for example on a microSD card from an air-gapped device.',
  }),
  'wallets.psbt.writeFile': defineMethod({
    params: z.object({ path: z.string().min(1).max(1024), psbt: z.string().min(1).max(4_000_000) }).strict(),
    result: z.object({ written: z.literal(true) }),
    access: ['ui'],
    risk: 'write',
    description: 'Saves a PSBT to a file the user chose, for example on a microSD card for an air-gapped device.',
  }),

  'logs.sources': defineMethod({
    params: NoParams,
    result: z.array(LogSourceSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Lists the log files BTCortex can show: its own, the window’s and each node’s.',
  }),
  'logs.read': defineMethod({
    params: LogQuerySchema,
    result: LogPageSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Reads recent log entries from the chosen sources, filtered and redacted, newest first.',
  }),
  'diagnostics.createBundle': defineMethod({
    params: NoParams,
    result: DiagnosticBundleSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Writes a sanitised diagnostic bundle (logs, configuration with secrets hidden, system and node state) to the BTCortex exports folder.',
  }),
  'devtools.psbt': defineMethod({
    params: z.object({ nodeId: z.string().min(1), psbt: z.string().trim().min(10).max(1_000_000) }).strict(),
    result: PsbtAnalysisSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Decodes and analyses a PSBT with the node (decodepsbt, analyzepsbt): inputs, outputs, fee, what is missing and which role comes next. Nothing is signed or sent.',
  }),
  'devtools.descriptor': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        descriptor: z.string().trim().min(4).max(10_000),
        count: z.number().int().min(1).max(100),
      })
      .strict(),
    result: DescriptorAnalysisSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Checks a public output descriptor with the node (getdescriptorinfo) and derives its first addresses. Descriptors with private keys are refused.',
  }),
  'devtools.address': defineMethod({
    params: z.object({ nodeId: z.string().min(1), address: z.string().trim().min(1).max(120) }).strict(),
    result: AddressCheckSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Checks an address with the node (validateaddress): whether it is valid on the node’s network, its type and output script, and where a bech32 address has mistakes.',
  }),
  'devtools.uri.create': defineMethod({
    params: PaymentUriRequestSchema,
    result: PaymentUriSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Makes a BIP 321 payment URI and its QR code for an address the node accepts, with an optional amount, label and message.',
  }),
  'devtools.uri.read': defineMethod({
    params: z.object({ nodeId: z.string().min(1), uri: z.string().trim().min(8).max(8000) }).strict(),
    result: ParsedPaymentUriSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Reads a bitcoin: payment URI by BIP 321 and checks its address with the node. Nothing is paid, opened or sent.',
  }),
  'devtools.psbt.combine': defineMethod({
    params: PsbtCombineParamsSchema,
    result: CombinedPsbtSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Combines PSBTs of the same transaction (combinepsbt), for example the signatures of several cosigners, and analyses the result. Nothing is signed or sent.',
  }),
  'devtools.psbt.finalise': defineMethod({
    params: z.object({ nodeId: z.string().min(1), psbt: z.string().trim().min(10).max(1_000_000) }).strict(),
    result: FinalisedPsbtSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Finalises a signed PSBT (finalizepsbt) and gives the transaction once every input is complete. Nothing is signed or sent.',
  }),
  'devtools.broadcast': defineMethod({
    params: BroadcastParamsSchema,
    result: BroadcastResultSchema,
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Sends a transaction to the network through the node (sendrawtransaction, with Bitcoin Core’s limit on absurd fees) after the user confirmed it, and follows it until it confirms.',
  }),
  'devtools.track.list': defineMethod({
    params: NoParams,
    result: z.array(TrackedTransactionSchema),
    access: ['ui'],
    risk: 'read',
    description: 'The transactions being followed until they confirm, each with where it stands.',
  }),
  'devtools.track.add': defineMethod({
    params: z.object({ nodeId: z.string().min(1), txid: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    result: z.array(TrackedTransactionSchema),
    access: ['ui'],
    risk: 'write',
    description: 'Follows a transaction until it confirms: in the mempool, then in the blocks that arrive.',
  }),
  'devtools.track.remove': defineMethod({
    params: z.object({ nodeId: z.string().min(1), txid: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    result: z.array(TrackedTransactionSchema),
    access: ['ui'],
    risk: 'write',
    description: 'Stops following a transaction.',
  }),
  'devtools.output': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        txid: z.string().regex(/^[0-9a-f]{64}$/),
        vout: z.number().int().nonnegative().max(100_000),
      })
      .strict(),
    result: OutputLookupSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Looks up one output in the node’s UTXO set (gettxout, mempool included): unspent or not, value, script and age.',
  }),
  'devtools.scan': defineMethod({
    params: CoinScanParamsSchema,
    result: CoinScanSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Finds every unspent coin of addresses or public descriptors in the node’s UTXO set (scantxoutset), with the node’s fee estimates. Descriptors with private keys are refused. On mainnet this can take minutes.',
  }),
  'devtools.scan.abort': defineMethod({
    params: z.object({ nodeId: z.string().min(1) }).strict(),
    result: z.object({ aborted: z.boolean() }),
    access: ['ui'],
    risk: 'read',
    description: 'Stops a coin scan that is still running.',
  }),
  'devtools.features': defineMethod({
    params: z.object({ nodeId: z.string().min(1) }).strict(),
    result: ProtocolFeaturesSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'The protocol features of a node, each marked as consensus, relay policy, wallet policy, experimental or implementation-specific, with its state on the node.',
  }),
  'devtools.mine': defineMethod({
    params: z
      .object({
        nodeId: z.string().min(1),
        blocks: z.number().int().min(1).max(1000),
        address: z.string().trim().min(14).max(120).optional(),
      })
      .strict(),
    result: MinedBlocksSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Generates blocks on a regtest node, to an address or to an anyone-can-spend output. Refused on every other network.',
  }),
  'devtools.probe': defineMethod({
    params: ProbeParamsSchema,
    result: ProbeResultSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Tests a service endpoint: name lookup, connection (directly or through BTCortex’s tor), TLS with full certificate checks, and the service’s own answer (HTTP, Electrum or Bitcoin RPC, without credentials).',
  }),
  'devtools.zmq.status': defineMethod({
    params: z.object({ nodeId: z.string().min(1) }).strict(),
    result: ZmqStatusSchema,
    access: ['ui'],
    risk: 'read',
    description: 'The ZMQ notifications a node publishes (getzmqnotifications) and whether BTCortex is watching them.',
  }),
  'devtools.zmq.watch': defineMethod({
    params: z.object({ nodeId: z.string().min(1), watch: z.boolean() }).strict(),
    result: ZmqStatusSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Starts or stops watching a node’s ZMQ notifications; what arrives is published as zmq.events about once a second. Watching stops by itself after 30 minutes.',
  }),
  'topology.graph': defineMethod({
    params: NoParams,
    result: TopologySchema,
    access: ['ui'],
    risk: 'read',
    description:
      'How BTCortex, wallets, Electrum servers, Lightning nodes, Bitcoin nodes, tor and the networks connect: protocols, ports, protection and whether each connection is live.',
  }),
  'updates.overview': defineMethod({
    params: z.object({ refresh: z.boolean().optional() }).strict(),
    result: UpdatesOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Every program BTCortex installs with the newest release, how serious staying is, what an update touches and its release notes, and the Bitcoin Core version of every node. With refresh, the publishers are asked again.',
  }),
  'updates.defer': defineMethod({
    params: z
      .object({
        product: InstalledProductSchema,
        version: z.string().min(1).max(40),
        /** Days to wait; null skips this version. */
        days: z.number().int().min(1).max(90).nullable(),
      })
      .strict(),
    result: UpdatesOverviewSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Puts off an update for some days, or for this version; updates that matter for security stay marked.',
  }),
  'updates.resume': defineMethod({
    params: z.object({ product: InstalledProductSchema }).strict(),
    result: UpdatesOverviewSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Shows a deferred update again.',
  }),
  'services.overview': defineMethod({
    params: NoParams,
    result: OrchestrationSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Every service BTCortex runs, with its state, what it needs and what needs it, and the integration modules they belong to.',
  }),
  'services.plan': defineMethod({
    params: z.object({ target: OrchestrationTargetSchema, action: ServiceActionSchema }).strict(),
    result: OrchestrationPlanSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'What starting, stopping or restarting a service (or all of them) would do, in order: what it needs started first, what needs it stopped first, and what else is affected.',
  }),
  'services.run': defineMethod({
    params: z
      .object({ target: OrchestrationTargetSchema, action: ServiceActionSchema, confirmed: z.literal(true) })
      .strict(),
    result: OrchestrationRunSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Carries out a plan the user confirmed, step by step in the order dependencies require.',
  }),
  'storage.overview': defineMethod({
    params: z.object({ refresh: z.boolean().optional() }).strict(),
    result: DiskUsageSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Measures every folder BTCortex manages or reads, with its owner, the volumes they are on, and how fast each node’s block files grow.',
  }),
  'storage.clean': defineMethod({
    params: z.object({ kind: CleanupKindSchema }).strict(),
    result: CleanupResultSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Removes BTCortex’s own leftovers: interrupted downloads or temporary files, only while no job could be using them.',
  }),
  'remote.test': defineMethod({
    params: z.object({ kind: RemoteServiceKindSchema, id: z.string().min(1) }).strict(),
    result: RemoteTestResultSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Tests the connection to a service on another computer with one round trip, and times it.',
  }),
  'payments.list': defineMethod({
    params: NoParams,
    result: z.array(PaymentServerWithStatusSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Lists the BTCPay Server installations BTCortex connects to, with their state.',
  }),
  'payments.add': defineMethod({
    params: AddPaymentServerParamsSchema,
    result: PaymentServerWithStatusSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Connects to a BTCPay Server through its Greenfield API, after testing the address and the read-only API key; the key is kept in the vault.',
  }),
  'payments.remove': defineMethod({
    params: z.object({ serverId: z.string().min(1) }).strict(),
    result: z.object({ removed: z.literal(true) }),
    access: ['ui'],
    risk: 'write',
    description: 'Forgets a BTCPay Server connection and its API key; nothing changes on the server.',
  }),
  'payments.dashboard': defineMethod({
    params: z.object({ serverId: z.string().min(1), refresh: z.boolean().optional() }).strict(),
    result: PaymentDashboardSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Reads the stores of a BTCPay Server: payment methods, on-chain balance and recent invoices.',
  }),
  'onboarding.state': defineMethod({
    params: NoParams,
    result: OnboardingStateSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Whether the first-run guide was finished, and whether it should open at start.',
  }),
  'onboarding.environment': defineMethod({
    params: z.object({ refresh: z.boolean().optional() }).strict(),
    result: EnvironmentReportSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Checks this computer before anything is installed: Windows, hardware, disk space, Bitcoin software already present, WSL2 and Docker, ports in use and what the network allows.',
  }),
  'onboarding.complete': defineMethod({
    params: z.object({ mode: OnboardingModeSchema.nullable() }).strict(),
    result: OnboardingStateSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Records that the first-run guide was finished or skipped.',
  }),
  'security.overview': defineMethod({
    params: NoParams,
    result: SecurityOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Security findings for every node, Tor, Electrum server, Lightning connection, installed program, the vault, backups and this computer, with what to do about each, and the controls BTCortex applies.',
  }),
  'profiles.overview': defineMethod({
    params: NoParams,
    result: ProfilesOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'The deployment profiles, what each brings and whether BTCortex can deploy it, and the latest deployments.',
  }),
  'profiles.plan': defineMethod({
    params: DeploymentChoicesSchema,
    result: DeploymentPlanSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'What deploying a profile with these choices involves on this computer: steps, downloads with their sizes, storage, memory, processors, ports, dependencies, warnings and the privacy and security implications. Changes nothing.',
  }),
  'profiles.deploy': defineMethod({
    params: z.object({ choices: DeploymentChoicesSchema, confirmed: z.literal(true) }).strict(),
    result: z.object({ jobId: z.string(), deploymentId: z.string() }),
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Carries out a reviewed profile as a background job: sets up or reuses the node, then its Electrum server, Tor routing, Sparrow and hardware-wallet tools, each verified before use. Changes what the network can learn about this computer when Tor is part of it.',
  }),
  'monitoring.health': defineMethod({
    params: NoParams,
    result: HealthSummarySchema,
    access: ['ui'],
    risk: 'read',
    description:
      'The health of nodes, Tor, Electrum servers, Lightning connections and backups in one summary, with processor, memory and disk use and the number of open alerts.',
  }),
  'monitoring.alerts': defineMethod({
    params: z.object({ includeResolved: z.boolean().optional() }).strict(),
    result: z.array(AlertSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Open alerts, newest first, and with includeResolved the alerts of the last 30 days.',
  }),
  'monitoring.acknowledge': defineMethod({
    params: z.object({ alertId: z.string().min(1) }).strict(),
    result: AlertSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Marks an alert as seen. It stays open until its cause is gone.',
  }),
  'monitoring.history': defineMethod({
    params: z
      .object({
        series: MetricSeriesSchema,
        hours: z
          .number()
          .int()
          .min(1)
          .max(24 * 365),
      })
      .strict(),
    result: MetricHistorySchema,
    access: ['ui'],
    risk: 'read',
    description:
      'The recorded history of a metric: minute samples while they are kept (two days by default), hourly averages beyond.',
  }),
  'monitoring.settings': defineMethod({
    params: NoParams,
    result: MonitoringSettingsSchema,
    access: ['ui'],
    risk: 'read',
    description: 'How long metrics are kept, the alert thresholds and which alerts become Windows notifications.',
  }),
  'monitoring.configure': defineMethod({
    params: ConfigureMonitoringParamsSchema,
    result: MonitoringSettingsSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Changes the monitoring settings. Shorter retention drops older samples at once; thresholds apply from the next check.',
  }),
  'monitoring.export': defineMethod({
    params: MonitoringExportParamsSchema,
    result: MonitoringExportSchema,
    access: ['ui'],
    risk: 'write',
    description: 'Writes the chosen metrics as CSV, or a plain-text health report, to the BTCortex exports folder.',
  }),
  'monitoring.revealExport': defineMethod({
    params: z.object({ path: z.string().min(1) }).strict(),
    result: z.object({ opened: z.literal(true) }),
    access: ['ui'],
    risk: 'read',
    description: 'Shows a monitoring export from the exports folder in File Explorer.',
  }),

  'backups.overview': defineMethod({
    params: NoParams,
    result: BackupOverviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'What BTCortex can back up on this computer, by kind (configuration, wallets, descriptors, channel backups, credentials), what it leaves out and why, the backup settings, and the backups found in the destination.',
  }),
  'backups.configure': defineMethod({
    params: z
      .object({
        destination: z.string().min(1).nullable().optional(),
        retention: z.number().int().min(1).max(100).optional(),
        schedule: BackupScheduleSchema.optional(),
        /** Kept in the DPAPI vault for encrypted scheduled backups. */
        passphrase: BackupPassphraseSchema.optional(),
        forgetPassphrase: z.literal(true).optional(),
      })
      .strict(),
    result: BackupSettingsSchema,
    access: ['ui'],
    risk: 'write',
    description:
      'Sets where backups go, how many are kept and when they run. A passphrase for encrypted scheduled backups is kept with Windows DPAPI.',
  }),
  'backups.create': defineMethod({
    params: z
      .object({ items: z.array(z.string().min(1)).min(1), passphrase: BackupPassphraseSchema.optional() })
      .strict(),
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Backs the chosen items up into the destination as a background job, then verifies the backup and applies the retention. Wallets and credentials need a passphrase, which encrypts the whole backup.',
  }),
  'backups.verify': defineMethod({
    params: z.object({ path: z.string().min(1), passphrase: z.string().min(1).optional() }).strict(),
    result: BackupVerificationSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'Checks a backup against its manifest; with the passphrase, also decrypts every file and checks its contents.',
  }),
  'backups.preview': defineMethod({
    params: z.object({ path: z.string().min(1) }).strict(),
    result: RestorePreviewSchema,
    access: ['ui'],
    risk: 'read',
    description:
      'What a backup holds and, item by item, what restoring it would do or how to use it by hand. Changes nothing.',
  }),
  'backups.restore': defineMethod({
    params: z
      .object({
        path: z.string().min(1),
        items: z.array(z.string().min(1)).min(1),
        passphrase: z.string().min(1).optional(),
        /** Settings of a restored bitcoin.conf that need confirmation and that the user has seen and confirmed. */
        acceptedSettings: z.array(z.string().min(1).max(100)).max(100).optional(),
        confirmed: z.literal(true),
      })
      .strict(),
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Restores the chosen items as a background job: a managed node’s bitcoin.conf through the configuration checks (the current file is kept as a backup; settings that need confirmation only when listed in acceptedSettings, and options that run commands never from an unencrypted backup), and wallets into a running node on this computer under a new name if the name is taken.',
  }),
  'backups.reveal': defineMethod({
    params: z.object({ path: z.string().min(1) }).strict(),
    result: z.object({ opened: z.literal(true) }),
    access: ['ui'],
    risk: 'read',
    description: 'Shows a BTCortex backup in File Explorer.',
  }),

  'diagnostics.revealBundle': defineMethod({
    params: z.object({ path: z.string().min(1) }).strict(),
    result: z.object({ opened: z.literal(true) }),
    access: ['ui'],
    risk: 'read',
    description: 'Shows a diagnostic bundle from the exports folder in File Explorer.',
  }),

  'installations.list': defineMethod({
    params: NoParams,
    result: z.array(InstalledSoftwareSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Software BTCortex installed from verified releases, with what was verified and which nodes use it.',
  }),
  'installations.checkUpdates': defineMethod({
    params: NoParams,
    result: z.array(SoftwareUpdateSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Asks the official release sources for the newest final versions of the installed software.',
  }),
  'installations.verify': defineMethod({
    params: z.object({ product: InstalledProductSchema, version: z.string().min(1).max(40) }).strict(),
    result: IntegrityReportSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Checks every installed file against the hashes recorded when the release was verified.',
  }),
  'installations.update': defineMethod({
    params: z.object({ product: InstalledProductSchema }).strict(),
    result: z.object({ jobId: z.string() }),
    access: ['ui'],
    risk: 'write',
    description:
      'Installs the newest verified release next to the current one, as a background job; nodes keep their version until switched.',
  }),
  'installations.remove': defineMethod({
    params: z
      .object({ product: InstalledProductSchema, version: z.string().min(1).max(40), confirmed: z.literal(true) })
      .strict(),
    result: z.object({ removedBytes: z.number().nonnegative() }),
    access: ['ui'],
    risk: 'dangerous',
    description: 'Deletes an installed version that no node uses and that is not running.',
  }),
  'nodes.useRuntime': defineMethod({
    params: z
      .object({ nodeId: z.string().min(1), version: z.string().min(1).max(40), confirmed: z.literal(true) })
      .strict(),
    result: z.object({ restarting: z.boolean() }),
    access: ['ui'],
    risk: 'dangerous',
    description:
      'Moves a managed node to a newer installed Bitcoin Core and restarts it; older versions may not read its data again.',
  }),
  'jobs.list': defineMethod({
    params: NoParams,
    result: z.array(JobSchema),
    access: ['ui'],
    risk: 'read',
    description: 'Lists recent background jobs.',
  }),
  'jobs.get': defineMethod({
    params: z.object({ jobId: z.string().min(1) }).strict(),
    result: JobSchema,
    access: ['ui'],
    risk: 'read',
    description: 'Returns one background job.',
  }),
} as const satisfies Record<string, MethodDefinition>;

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type MethodParams<M extends MethodName> = z.input<Methods[M]['params']>;
export type MethodResult<M extends MethodName> = z.output<Methods[M]['result']>;

export function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(methods, name);
}

// Methods the native shell serves to the orchestrator. They are never reachable
// from the WebView: the shell only accepts them on the sidecar channel.

export const shellMethods = {
  'vault.protect': defineMethod({
    params: z.object({ plaintext: z.string() }).strict(),
    result: z.object({ protected: z.base64() }),
    access: ['shell'],
    risk: 'write',
    description: 'Encrypts a secret with Windows DPAPI for the current user.',
  }),
  'vault.unprotect': defineMethod({
    params: z.object({ protected: z.base64() }).strict(),
    result: z.object({ plaintext: z.string() }),
    access: ['shell'],
    risk: 'read',
    description: 'Decrypts a secret previously protected with Windows DPAPI for the current user.',
  }),
} as const satisfies Record<string, MethodDefinition>;

export type ShellMethods = typeof shellMethods;
export type ShellMethodName = keyof ShellMethods;
export type ShellMethodParams<M extends ShellMethodName> = z.input<ShellMethods[M]['params']>;
export type ShellMethodResult<M extends ShellMethodName> = z.output<ShellMethods[M]['result']>;
