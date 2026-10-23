import { totalmem } from 'node:os';
import { join } from 'node:path';
import { AppFailure, EVENT_NOTIFICATION_METHOD } from '@btcortex/contracts';
import type { OrchestratorEvent } from '@btcortex/contracts';
import { detectExistingInstallations } from '@btcortex/integration-bitcoin-core';
import { isElectrumRunning } from '@btcortex/integration-electrum-wallet';
import { isSparrowRunning } from '@btcortex/integration-sparrow';
import { registerAppHandlers } from './handlers/apps';
import { registerBackupHandlers } from './handlers/backups';
import { registerCatalogueHandlers } from './handlers/catalogue';
import { registerElectrumHandlers } from './handlers/electrum';
import { RemoteElectrumService } from './electrum/remote-electrum-service';
import { registerExplorerHandlers } from './handlers/explorer';
import { RemoteExplorerService } from './explorer/remote-explorer-service';
import { registerHardwareHandlers } from './handlers/hardware';
import { registerInstallationHandlers } from './handlers/installations';
import { registerLightningHandlers } from './handlers/lightning';
import { registerLogHandlers } from './handlers/logs';
import { registerMonitoringHandlers } from './handlers/monitoring';
import { registerProfileHandlers } from './handlers/profiles';
import { registerSecurityHandlers } from './handlers/security';
import { registerTopologyHandlers } from './handlers/topology';
import { registerDevToolsHandlers } from './handlers/devtools';
import { registerOnboardingHandlers } from './handlers/onboarding';
import { registerPaymentHandlers } from './handlers/payments';
import { registerRemoteHandlers } from './handlers/remote';
import { registerStorageHandlers } from './handlers/storage';
import { registerUpdateHandlers } from './handlers/updates';
import { registerNodeHandlers } from './handlers/nodes';
import { registerSetupHandlers } from './handlers/setup';
import { registerSystemHandlers } from './handlers/system';
import { registerTorHandlers } from './handlers/tor';
import { BackupService } from './backups/backup-service';
import { DiagnosticsService } from './diagnostics/diagnostics-service';
import { ElectrumService } from './electrum/electrum-service';
import { ExplorerService } from './explorer/explorer-service';
import { HardwareService } from './hardware/hardware-service';
import { InstallationService } from './installations/installation-service';
import { JobManager } from './jobs/job-manager';
import { LightningService } from './lightning/lightning-service';
import { RotatingFileSink, StderrSink, StructuredLogger } from './logging/logger';
import type { LogSink } from './logging/logger';
import { LogService, ORCHESTRATOR_LOG_FILE } from './logs/log-service';
import { ConfigWatch } from './monitoring/config-watch';
import { MonitoringService } from './monitoring/monitoring-service';
import { RecentErrorsSink } from './monitoring/recent-errors';
import { ProfileService } from './profiles/profile-service';
import { SecurityService } from './security/security-service';
import { TopologyService } from './topology/topology-service';
import { DevToolsService } from './devtools/devtools-service';
import { TransactionToolsService } from './devtools/transaction-tools';
import { TransactionTracker } from './devtools/tracker';
import { UpdateService } from './updates/update-service';
import { defaultProbes } from './onboarding/environment';
import { OnboardingService } from './onboarding/onboarding-service';
import { PaymentService } from './payments/payment-service';
import { discoverLocalNodes } from './nodes/discovery';
import { describeHardware } from './platform/hardware';
import type { PendingUpdate } from './updates/update-service';
import { ZmqWatchService } from './devtools/zmq-watch';
import { AlertStore, MetricsStore } from './monitoring/stores';
import { folderSize, measureVolume } from './platform/disks';
import { DiskUsageService } from './storage/disk-usage-service';
import { OrchestrationService } from './orchestration/orchestration-service';
import { registerServiceHandlers } from './handlers/services';
import { electrumModule, nodeModule, torModule } from './services/modules';
import { findVirtualDisks } from './storage/virtual-disks';
import { NodeConfigService } from './nodes/config-service';
import { MempoolService } from './nodes/mempool-service';
import { StorageService } from './nodes/storage-service';
import { NodeManager } from './nodes/node-manager';
import { PeerService } from './nodes/peer-service';
import { PrivacyService } from './nodes/privacy-service';
import { I2pRouterService } from './i2p/i2p-router';
import { SignerService } from './nodes/signer-service';
import { RpcConsoleService } from './nodes/rpc-console-service';
import { NodeRepository } from './nodes/repository';
import { openDatabase } from './persistence/database';
import { migrations } from './persistence/migrations';
import { SettingsStore } from './persistence/settings';
import { acquireInstanceLock } from './platform/instance-lock';
import {
  bitcoinCoreRuntimes,
  bitcoinKnotsRuntimes,
  ensureAppDirectories,
  isDevelopmentMode,
  resolveAppPaths,
} from './platform/paths';
import { trustSystemAuthorities } from './platform/certificates';
import { Dispatcher } from './rpc/dispatcher';
import { JsonRpcPeer } from './rpc/peer';
import {
  airGappedDeviceAdapter,
  bitcoinCoreAdapter,
  bitcoinKnotsAdapter,
  btcpayAdapter,
  electrumWalletAdapter,
  fulcrumAdapter,
  hwiAdapter,
  lndAdapter,
  remoteExplorerAdapter,
  signingDeviceAdapter,
  sparrowAdapter,
  torAdapter,
  trezorSuiteAdapter,
} from './services/adapters';
import { CatalogueService } from './services/catalogue-service';
import { SetupService } from './setup/setup-service';
import { ElectrumWalletService } from './apps/electrum-wallet-service';
import { SparrowService } from './apps/sparrow-service';
import { TorService } from './tor/tor-service';
import type { TorUser } from './tor/tor-service';
import { createShellCaller, SecretVault } from './vault/vault';
import { ORCHESTRATOR_VERSION } from './version';

// Entry point of the orchestrator sidecar. The native shell starts it, talks to
// it over stdin/stdout and stops it with `system.shutdown`. If the shell
// disappears, stdin closes and the orchestrator shuts itself down.

/** The shell waits five seconds; finish well before it gives up. */
const SHUTDOWN_GRACE_MS = 4_000;

function main(): void {
  const startedAt = new Date();
  const developmentMode = isDevelopmentMode();
  // Before any connection: the authorities Windows trusts count, not only Node.js's own list.
  const trustedAuthorities = trustSystemAuthorities();
  const paths = resolveAppPaths();
  ensureAppDirectories(paths);

  const recentErrors = new RecentErrorsSink();
  const sinks: LogSink[] = [
    recentErrors,
    new RotatingFileSink({
      directory: paths.logs,
      fileName: ORCHESTRATOR_LOG_FILE,
      maxFileBytes: 10 * 1024 * 1024,
      maxRotatedFiles: 5,
    }),
  ];
  if (developmentMode) sinks.push(new StderrSink());
  const logger = new StructuredLogger(sinks, developmentMode ? 'debug' : 'info');

  let lock: ReturnType<typeof acquireInstanceLock>;
  try {
    lock = acquireInstanceLock(paths.root);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'Could not acquire the instance lock', { error });
    process.stderr.write(`${error instanceof AppFailure ? JSON.stringify(error.error) : String(error)}\n`);
    logger.close();
    process.exit(2);
  }

  const database = openDatabase({ file: paths.database, migrations, logger: logger.child('persistence') });
  const dispatcher = new Dispatcher(logger.child('rpc'));
  const peer = new JsonRpcPeer({
    input: process.stdin,
    output: process.stdout,
    handler: (request) => dispatcher.dispatch(request),
    logger: logger.child('rpc'),
  });
  const publish = (event: OrchestratorEvent) => {
    peer.notify(EVENT_NOTIFICATION_METHOD, event);
  };

  const vault = new SecretVault(
    database,
    createShellCaller((method, params) => peer.request(method, params)),
  );
  const repository = new NodeRepository(database);
  const nodes = new NodeManager({
    repository,
    vault,
    runtimesDirectory: bitcoinCoreRuntimes(paths),
    knotsRuntimesDirectory: bitcoinKnotsRuntimes(paths),
    publish,
    logger: logger.child('nodes'),
    // A node that routes through Tor gets tor started first.
    beforeStart: (profile, configText): Promise<void> => privacy.prepareStart(profile, configText),
    // Wallets, then the Electrum server, then bitcoind.
    beforeStop: (profile, restart): Promise<void> => electrum.beforeNodeStop(profile, restart),
  });
  const peers = new PeerService({ nodes, logger: logger.child('peers') });
  peers.start();
  const configWatch = new ConfigWatch({
    settings: new SettingsStore(database),
    vault,
    logger: logger.child('monitoring'),
  });
  const config = new NodeConfigService({
    nodes,
    logger: logger.child('config'),
    totalMemoryBytes: totalmem(),
    afterSave: (profile) => configWatch.ownChange(profile),
  });
  const jobs = new JobManager({ database, publish, logger: logger.child('jobs') });
  const tor = new TorService({
    runtimesDirectory: join(paths.installations, 'tor'),
    home: join(paths.root, 'tor'),
    logsDirectory: paths.logs,
    downloadsDirectory: paths.downloads,
    settings: new SettingsStore(database),
    jobs,
    publish,
    logger: logger.child('tor'),
    users: async (): Promise<TorUser[]> => [...(await privacy.nodesUsingTor()), ...electrum.torUsers()],
  });
  const i2p = new I2pRouterService({ logger: logger.child('i2p') });
  const privacy: PrivacyService = new PrivacyService({ nodes, config, tor, i2p, logger: logger.child('privacy') });
  const hwiDirectory = join(paths.installations, 'hwi');
  const hardware = new HardwareService({
    hwiDirectory,
    downloadsDirectory: paths.downloads,
    suiteRecordFile: join(paths.installations, 'trezor-suite', 'verification.json'),
    jobs,
    logger: logger.child('hardware'),
  });
  const signers = new SignerService({ nodes, config, hardware, hwiDirectory, logger: logger.child('signers') });
  const fulcrumDirectory = join(paths.installations, 'fulcrum');
  const electrum: ElectrumService = new ElectrumService({
    runtimesDirectory: fulcrumDirectory,
    home: join(paths.root, 'electrum'),
    logsDirectory: paths.logs,
    downloadsDirectory: paths.downloads,
    settings: new SettingsStore(database),
    nodes,
    config,
    vault,
    jobs,
    publish,
    logger: logger.child('electrum'),
    totalMemoryBytes: totalmem(),
    tor,
  });
  const setup = new SetupService({
    paths,
    repository,
    nodes,
    jobs,
    logger: logger.child('setup'),
    setUpElectrumServer: (nodeId) => {
      electrum.setUpForNewNode(nodeId);
    },
  });
  const sparrow = new SparrowService({
    paths,
    nodes,
    jobs,
    logger: logger.child('sparrow'),
    electrumUrl: (nodeId) => electrum.connection(nodeId)?.url,
  });
  const electrumWallet = new ElectrumWalletService({
    paths,
    nodes,
    jobs,
    logger: logger.child('electrum-wallet'),
    server: (nodeId) => {
      const connection = electrum.connection(nodeId);
      return connection ? { connection, ready: electrum.status(nodeId).state === 'ready' } : undefined;
    },
  });
  const lightning = new LightningService({
    settings: new SettingsStore(database),
    vault,
    paths,
    publish,
    logger: logger.child('lightning'),
    torSocksPort: () => (tor.isRunning() ? tor.ports().applicationSocks : undefined),
  });
  const payments = new PaymentService({
    settings: new SettingsStore(database),
    vault,
    torSocksPort: () => (tor.isRunning() ? tor.ports().applicationSocks : undefined),
    logger: logger.child('payments'),
  });
  const backups = new BackupService({
    settings: new SettingsStore(database),
    vault,
    nodes,
    config,
    profiles: () => repository.list(),
    lightning: {
      list: () => lightning.list(),
      channelBackup: (connectionId) => lightning.channelBackup(connectionId),
    },
    jobs,
    paths,
    logger: logger.child('backups'),
    version: ORCHESTRATOR_VERSION,
  });
  // The update centre is built after the installations it reads; until then there is nothing pending.
  let pendingUpdates: () => Promise<PendingUpdate[]> = () => Promise.resolve([]);
  const remoteElectrum = new RemoteElectrumService({
    settings: new SettingsStore(database),
    nodes,
    socksPort: () => (tor.isRunning() ? tor.ports().applicationSocks : undefined),
    logger: logger.child('electrum-remote'),
  });
  remoteElectrum.start();
  const remoteExplorers = new RemoteExplorerService({
    settings: new SettingsStore(database),
    nodes,
    socksPort: () => (tor.isRunning() ? tor.ports().applicationSocks : undefined),
    logger: logger.child('explorers-remote'),
  });
  remoteExplorers.start();
  const monitoring = new MonitoringService({
    alerts: new AlertStore(database),
    metrics: new MetricsStore(database),
    settings: new SettingsStore(database),
    configWatch,
    recentErrors: (now) => recentErrors.summary(now),
    updates: () => pendingUpdates(),
    nodes: () => nodes.list(),
    tor: () => tor.status(),
    electrum: () => electrum.overview(),
    lightning: () => lightning.list(),
    payments: () => payments.list(),
    remoteElectrum: () => remoteElectrum.list(),
    remoteExplorers: () => remoteExplorers.list(),
    backups: () => backups.settings(),
    paths,
    publish,
    logger: logger.child('monitoring'),
  });
  const zmqWatch = new ZmqWatchService({ nodes, publish, logger: logger.child('devtools') });
  const logs = new LogService({ paths, nodes, electrumLogs: () => electrum.logSources() });
  const diagnostics = new DiagnosticsService({
    paths,
    nodes,
    jobs,
    logs,
    tor: () => tor.status(),
    version: ORCHESTRATOR_VERSION,
    logger: logger.child('diagnostics'),
  });

  let stopping = false;
  const shutdown = (reason: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('Orchestrator shutting down', { reason });
    const forceExit = setTimeout(() => {
      lock.release();
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();
    peers.stop();
    lightning.shutdown();
    payments.shutdown();
    backups.shutdown();
    monitoring.shutdown();
    zmqWatch.shutdown();
    updates.shutdown();
    // Electrum servers stop before the nodes they index.
    void electrum
      .shutdown()
      .catch((error: unknown) => {
        logger.warn('Stopping Electrum servers failed', { error });
      })
      .then(() => nodes.shutdown())
      .catch((error: unknown) => {
        logger.warn('Stopping managed nodes failed', { error });
      })
      // After the nodes: tor keeps running only for nodes that keep running.
      .then(() => tor.shutdown())
      .catch((error: unknown) => {
        logger.warn('Stopping tor failed', { error });
      })
      .finally(() => {
        try {
          peer.close();
          database.close();
        } finally {
          lock.release();
          logger.close();
          process.exit(0);
        }
      });
  };

  registerSystemHandlers(dispatcher, {
    paths,
    startedAt,
    developmentMode,
    requestShutdown: () => {
      shutdown('requested by the shell');
    },
  });
  const rpcConsole = new RpcConsoleService({ nodes, logger: logger.child('console') });
  const mempool = new MempoolService({ nodes });
  const storage = new StorageService({
    nodes,
    config,
    logger: logger.child('storage'),
    appDataDirectory: paths.root,
  });
  registerNodeHandlers(dispatcher, {
    nodes,
    config,
    peers,
    console: rpcConsole,
    mempool,
    storage,
    repository,
    vault,
    electrum,
    publish,
  });
  registerSetupHandlers(dispatcher, setup, jobs);
  registerAppHandlers(dispatcher, sparrow, electrumWallet);
  registerTorHandlers(dispatcher, tor, privacy, i2p);
  registerHardwareHandlers(dispatcher, hardware, signers);
  registerElectrumHandlers(dispatcher, electrum, remoteElectrum);
  registerLightningHandlers(dispatcher, lightning);
  registerPaymentHandlers(dispatcher, payments);
  registerRemoteHandlers(dispatcher, {
    nodes,
    lightning,
    payments,
    electrum: remoteElectrum,
    explorers: remoteExplorers,
  });
  const samples = new MetricsStore(database);
  const diskUsage = new DiskUsageService({
    paths,
    nodes: () => nodes.list(),
    electrum: () => electrum.overview(),
    backups: () => backups.settings(),
    jobs: () => jobs.list(),
    // Thirty days are beyond the minute samples, so hourly averages are read whatever the setting.
    history: (series, hours, now) => samples.history(series, hours, now, 48),
    folderSize,
    measureVolume,
    virtualDisks: () => findVirtualDisks(),
    logger: logger.child('storage'),
  });
  registerStorageHandlers(dispatcher, diskUsage);
  registerBackupHandlers(dispatcher, backups);
  registerMonitoringHandlers(dispatcher, monitoring);
  registerExplorerHandlers(
    dispatcher,
    new ExplorerService({
      remoteElectrum: (nodeId) => remoteElectrum.lookupFor(nodeId),
      nodes,
      electrum: (nodeId) => {
        const connection = electrum.connection(nodeId);
        return connection ? { connection, ready: electrum.status(nodeId).state === 'ready' } : undefined;
      },
      logger: logger.child('explorer'),
    }),
    remoteExplorers,
  );
  registerLogHandlers(dispatcher, logs, diagnostics);
  const detect = () => detectExistingInstallations();
  const devices = { overview: () => hardware.overview() };
  const coreAdapter = bitcoinCoreAdapter({ nodes: () => nodes.list(), detect });
  const knotsAdapter = bitcoinKnotsAdapter({ nodes: () => nodes.list(), detect });
  const torServiceAdapter = torAdapter({ status: () => tor.status() });
  const fulcrumServiceAdapter = fulcrumAdapter({ overview: () => electrum.overview() });
  const catalogue = new CatalogueService({
    adapters: [
      coreAdapter,
      knotsAdapter,
      sparrowAdapter({ summary: () => sparrow.summary() }),
      torServiceAdapter,
      fulcrumServiceAdapter,
      electrumWalletAdapter({ summary: () => electrumWallet.summary() }),
      lndAdapter({ connections: () => lightning.list() }),
      btcpayAdapter({ servers: () => payments.list() }),
      remoteExplorerAdapter('mempool', { explorers: () => remoteExplorers.list() }),
      remoteExplorerAdapter('esplora', { explorers: () => remoteExplorers.list() }),
      hwiAdapter(devices),
      trezorSuiteAdapter(devices),
      signingDeviceAdapter('trezor', 'trezor', 'Trezor', devices),
      signingDeviceAdapter('ledger', 'ledger', 'Ledger', devices),
      signingDeviceAdapter('bitbox02', 'bitbox', 'BitBox02', devices),
      signingDeviceAdapter('coldcard', 'coldcard', 'COLDCARD', devices),
      signingDeviceAdapter('jade', 'jade', 'Jade', devices),
      signingDeviceAdapter('keepkey', 'keepkey', 'KeepKey', devices),
      airGappedDeviceAdapter('passport', 'Passport'),
      airGappedDeviceAdapter('keystone', 'Keystone'),
      airGappedDeviceAdapter('seedsigner', 'SeedSigner', false),
      airGappedDeviceAdapter('krux', 'Krux'),
    ],
    logger: logger.child('catalogue'),
  });
  registerCatalogueHandlers(dispatcher, catalogue);
  const nodeLifecycle = {
    start: (nodeId: string) => nodes.start(nodeId),
    stop: (nodeId: string) => nodes.stop(nodeId),
    restart: (nodeId: string) => nodes.restart(nodeId),
  };
  const nodePrivacy = (nodeId: string) => privacy.overview(nodeId);
  registerServiceHandlers(
    dispatcher,
    new OrchestrationService({
      modules: [
        torModule({
          adapter: torServiceAdapter,
          status: () => tor.status(),
          lifecycle: { start: () => tor.start(), stop: () => tor.stop(), restart: () => tor.restartIfRunning() },
        }),
        nodeModule({
          adapter: coreAdapter,
          implementation: 'bitcoin-core',
          name: 'Bitcoin Core',
          nodes: () => nodes.list(),
          privacy: nodePrivacy,
          lifecycle: nodeLifecycle,
        }),
        nodeModule({
          adapter: knotsAdapter,
          implementation: 'bitcoin-knots',
          name: 'Bitcoin Knots',
          nodes: () => nodes.list(),
          privacy: nodePrivacy,
          lifecycle: nodeLifecycle,
        }),
        electrumModule({
          adapter: fulcrumServiceAdapter,
          overview: () => electrum.overview(),
          lifecycle: { start: (nodeId) => electrum.start(nodeId), stop: (nodeId) => electrum.stop(nodeId) },
        }),
      ],
      logger: logger.child('orchestration'),
    }),
  );
  const installations = new InstallationService({
    runtimesDirectory: bitcoinCoreRuntimes(paths),
    knotsDirectory: bitcoinKnotsRuntimes(paths),
    sparrowDirectory: join(paths.installations, 'sparrow'),
    torDirectory: join(paths.installations, 'tor'),
    hwiDirectory,
    hwiUsers: (version) => signers.usersOf(version),
    fulcrumDirectory,
    fulcrumUsers: (version) =>
      (electrum.runningVersions().get(version) ?? []).flatMap((nodeId) => {
        try {
          return [{ id: nodeId, name: nodes.get(nodeId).profile.name }];
        } catch {
          return [];
        }
      }),
    fulcrumUpdated: () => electrum.restartRunning(),
    electrumDirectory: join(paths.installations, 'electrum'),
    electrumRunning: isElectrumRunning,
    downloadsDirectory: paths.downloads,
    nodes,
    repository,
    jobs,
    sparrowRunning: isSparrowRunning,
    torRunningVersion: () => tor.runningVersion(),
    torUpdated: () => tor.restartIfRunning(),
    logger: logger.child('installations'),
  });
  registerInstallationHandlers(dispatcher, installations);
  const updates = new UpdateService({
    settings: new SettingsStore(database),
    installations,
    nodes: () => nodes.list(),
    tor: () => tor.status(),
    backups: () => backups.settings(),
    version: ORCHESTRATOR_VERSION,
    logger: logger.child('updates'),
  });
  pendingUpdates = () => updates.pending();
  registerUpdateHandlers(dispatcher, updates);
  const onboarding = new OnboardingService({
    settings: new SettingsStore(database),
    probes: defaultProbes({
      dataDirectory: paths.nodes,
      btcortexRoot: paths.root,
      hardware: () => describeHardware(paths.nodes),
      bitcoinCore: detect,
      connectableNodes: async () => (await discoverLocalNodes(nodes.list().map((node) => node.profile))).length,
    }),
    hasInfrastructure: () => nodes.list().length > 0 || lightning.list().length > 0,
    logger: logger.child('onboarding'),
  });
  registerOnboardingHandlers(dispatcher, onboarding);
  const profiles = new ProfileService({
    settings: new SettingsStore(database),
    jobs,
    logger: logger.child('profiles'),
    paths,
    nodes,
    setup,
    tor,
    privacy,
    electrum,
    sparrow,
    hardware,
    installedSoftware: () => installations.list(),
  });
  registerProfileHandlers(dispatcher, profiles);
  const devtools = new DevToolsService({
    nodes,
    config,
    socksPort: () => (tor.isRunning() ? tor.ports().applicationSocks : undefined),
    logger: logger.child('devtools'),
  });
  const tracker = new TransactionTracker({
    settings: new SettingsStore(database),
    nodes,
    logger: logger.child('transactions'),
  });
  tracker.start();
  registerDevToolsHandlers(
    dispatcher,
    devtools,
    zmqWatch,
    new TransactionToolsService({
      nodes,
      analysePsbt: (nodeId, psbt) => devtools.psbt(nodeId, psbt),
      tracker,
      logger: logger.child('transactions'),
    }),
  );
  registerTopologyHandlers(
    dispatcher,
    new TopologyService({
      nodes: () => nodes.list(),
      privacy: (nodeId) => privacy.overview(nodeId),
      tor: () => tor.status(),
      i2p: () => i2p.status(),
      electrum: () => electrum.overview(),
      sparrow,
      lightning: () => lightning.list(),
      version: ORCHESTRATOR_VERSION,
    }),
  );
  registerSecurityHandlers(
    dispatcher,
    new SecurityService({
      nodes: () => nodes.list(),
      config,
      tor: () => tor.status(),
      electrum: () => electrum.overview(),
      lightning: () => lightning.list(),
      installations: () => installations.list(),
      secrets: () => vault.list(),
      backups: () => backups.settings(),
      alerts: () => monitoring.alerts(false),
      paths,
      logger: logger.child('security'),
    }),
  );

  peer.onClose(() => {
    shutdown('the shell closed the channel');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    shutdown('uncaught exception');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason : String(reason) });
  });

  peer.start();
  jobs.recoverInterrupted();
  profiles.initialise();
  updates.initialise();
  nodes.initialise();
  tor.initialise();
  electrum.initialise();
  lightning.initialise();
  payments.initialise();
  backups.initialise();
  monitoring.initialise();
  // Last, so that tor and the services that follow a node are ready for it.
  void nodes.startChosenNodes();
  logger.info('Orchestrator started', {
    version: ORCHESTRATOR_VERSION,
    dataDirectory: paths.root,
    developmentMode,
    trustedAuthorities: trustedAuthorities ?? 'Node.js list only',
  });
  publish({ type: 'orchestrator.ready', at: new Date().toISOString(), payload: { version: ORCHESTRATOR_VERSION } });
}

main();
