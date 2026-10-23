import type {
  DetectionReport,
  DeviceVendor,
  ElectrumOverview,
  HardwareOverview,
  LightningConnectionWithStatus,
  NodeWithStatus,
  PaymentServerWithStatus,
  RemoteExplorerKind,
  RemoteExplorerWithStatus,
  ServiceHealth,
  ServiceState,
  TorStatus,
} from '@btcortex/contracts';
import type { ServiceAdapter } from './service-adapter';

export interface ElectrumWalletAdapterOptions {
  summary: () => Promise<{ installed: string | null; application: string | null; running: boolean }>;
}

/** The Electrum wallet: an installed copy used as it is, or BTCortex's verified standalone release, opened with the user's own server. */
export function electrumWalletAdapter(options: ElectrumWalletAdapterOptions): ServiceAdapter {
  return {
    id: 'electrum',
    // Installed through the real release files and connected to a real Fulcrum on Windows 10.
    status: 'verified-on-windows',
    level: 'connected-application',
    capabilities: ['detect', 'install', 'verify-release', 'connect', 'open', 'update', 'uninstall'],
    // Electrum needs an Electrum server; it is opened from there.
    route: '/electrum',
    async state(): Promise<ServiceState> {
      const summary = await options.summary();
      const versions = [summary.application, summary.installed].filter(
        (version): version is string => version !== null,
      );
      return {
        installed: versions.length > 0,
        versions,
        running: summary.running ? 1 : 0,
        health: versions.length === 0 ? 'unknown' : summary.running ? 'healthy' : 'inactive',
        summary:
          summary.application !== null
            ? `Electrum ${summary.application} installed on this computer${summary.running ? ', open now' : ''}.`
            : summary.installed !== null
              ? `Electrum ${summary.installed} installed by BTCortex${summary.running ? ', open now' : ''}.`
              : 'Not installed.',
      };
    },
  };
}

export interface FulcrumAdapterOptions {
  overview: () => Promise<ElectrumOverview>;
}

/** Fulcrum, BTCortex's Electrum server: installed from its signed release and run next to a node. */
export function fulcrumAdapter(options: FulcrumAdapterOptions): ServiceAdapter {
  return {
    id: 'fulcrum',
    // The real Fulcrum installed, indexing a regtest node and answering Electrum clients in the integration tests.
    status: 'integration-tested',
    level: 'fully-managed',
    capabilities: [
      'install',
      'verify-release',
      'configure',
      'connect',
      'start',
      'stop',
      'logs',
      'health',
      'update',
      'uninstall',
    ],
    route: '/electrum',
    async state(): Promise<ServiceState> {
      const overview = await options.overview();
      const servers = overview.servers.filter((server) => server.state !== 'not-set-up');
      const ready = servers.filter((server) => server.state === 'ready').length;
      const indexing = servers.filter((server) => server.state === 'indexing').length;
      const failed = servers.some((server) => server.state === 'failed');
      const health: ServiceHealth = failed
        ? 'failed'
        : indexing > 0 || servers.some((server) => server.state === 'starting')
          ? 'working'
          : ready > 0
            ? 'healthy'
            : servers.length > 0
              ? 'inactive'
              : 'unknown';
      const running = servers.filter((server) => server.pid !== null).length;
      return {
        installed: overview.installed !== null,
        versions: overview.installed ? [overview.installed.version] : [],
        running,
        health,
        summary:
          overview.installed === null
            ? 'Not set up.'
            : servers.length === 0
              ? `Fulcrum ${overview.installed.version} installed; no node has an Electrum server yet.`
              : `${plural(servers.length, 'Electrum server', 'Electrum servers')}: ${String(ready)} ready${indexing > 0 ? `, ${String(indexing)} indexing` : ''}.`,
      };
    },
  };
}

export interface LndAdapterOptions {
  connections: () => LightningConnectionWithStatus[];
}

export function lndAdapter(options: LndAdapterOptions): ServiceAdapter {
  return {
    id: 'lnd',
    // Three real LND 0.21.4 nodes on regtest in the integration tests: connected, read and backed up.
    status: 'integration-tested',
    level: 'connected-application',
    capabilities: ['detect', 'connect', 'health'],
    route: '/lightning',
    state(): Promise<ServiceState> {
      const connections = options.connections();
      const states = new Set(connections.map(({ status }) => status.state));
      const ready = connections.filter(({ status }) => status.state === 'ready').length;
      const health: ServiceHealth =
        connections.length === 0
          ? 'unknown'
          : states.has('failed') || states.has('unauthorised') || states.has('unreachable')
            ? 'attention'
            : states.has('locked')
              ? 'attention'
              : states.has('syncing') || states.has('checking')
                ? 'working'
                : 'healthy';
      return Promise.resolve({
        installed: connections.some(({ connection }) => connection.local),
        versions: [...new Set(connections.flatMap(({ status }) => (status.version === null ? [] : [status.version])))],
        running: ready,
        health,
        summary:
          connections.length === 0
            ? 'No LND node connected.'
            : `${plural(connections.length, 'LND node', 'LND nodes')} connected: ${String(ready)} ready.`,
      });
    },
  };
}

export interface BtcpayAdapterOptions {
  servers: () => PaymentServerWithStatus[];
}

/** BTCPay Server: installations elsewhere, read through the Greenfield API with a read-only key. */
export function btcpayAdapter(options: BtcpayAdapterOptions): ServiceAdapter {
  return {
    id: 'btcpay-server',
    // The Greenfield client and the service are tested against a stand-in server; no real BTCPay was available.
    status: 'unit-tested',
    level: 'connected-application',
    capabilities: ['connect', 'health'],
    route: '/payments',
    state(): Promise<ServiceState> {
      const servers = options.servers();
      const states = new Set(servers.map(({ status }) => status.state));
      const online = servers.filter(({ status }) => status.state === 'online').length;
      const health: ServiceHealth =
        servers.length === 0
          ? 'unknown'
          : states.has('unreachable') || states.has('unauthorised')
            ? 'attention'
            : states.has('synchronising') || states.has('checking')
              ? 'working'
              : 'healthy';
      return Promise.resolve({
        installed: false,
        versions: [...new Set(servers.flatMap(({ status }) => (status.version === null ? [] : [status.version])))],
        running: online,
        health,
        summary:
          servers.length === 0
            ? 'No BTCPay Server connected.'
            : `${plural(servers.length, 'BTCPay Server', 'BTCPay Servers')} connected: ${String(online)} online.`,
      });
    },
  };
}

/** mempool or Esplora explorers on other computers that BTCortex follows. */
export function remoteExplorerAdapter(
  kind: RemoteExplorerKind,
  options: { explorers: () => RemoteExplorerWithStatus[] },
): ServiceAdapter {
  const name = kind === 'mempool' ? 'mempool explorer' : 'Esplora explorer';
  return {
    id: kind,
    // The client and the service are tested against a stand-in explorer; no self-hosted one was available.
    status: 'unit-tested',
    level: 'connected-application',
    capabilities: ['connect', 'health'],
    route: '/explorer',
    state(): Promise<ServiceState> {
      const explorers = options.explorers().filter(({ explorer }) => explorer.kind === kind);
      const states = new Set(explorers.map(({ status }) => status.state));
      const online = explorers.filter(({ status }) => status.state === 'online').length;
      const health: ServiceHealth =
        explorers.length === 0
          ? 'unknown'
          : states.has('wrong-chain')
            ? 'failed'
            : states.has('unreachable')
              ? 'attention'
              : 'healthy';
      return Promise.resolve({
        installed: false,
        versions: [],
        running: online,
        health,
        summary:
          explorers.length === 0
            ? `No ${name} followed.`
            : `${plural(explorers.length, name, `${name}s`)} followed: ${String(online)} answering.`,
      });
    },
  };
}

// The integrations BTCortex has today. Bitcoin Core is managed end to end;
// Sparrow is installed from a verified release, connected to a node and
// launched; Tor is installed from a verified release and run for the nodes;
// Bitcoin Knots is installed and run only when the user chooses it, because
// its releases since 29.4.1 follow a chain Bitcoin Core rejects.

/** Health of a set of nodes: the worst one counts, so a failed node is never hidden by a healthy one. */
function nodesHealth(nodes: readonly NodeWithStatus[]): ServiceHealth {
  const states = new Set(nodes.map((node) => node.status.state));
  if (states.has('failed')) return 'failed';
  if (states.has('unreachable')) return 'attention';
  if (states.has('starting') || states.has('stopping')) return 'working';
  if (states.has('running')) return 'healthy';
  return nodes.length > 0 ? 'inactive' : 'unknown';
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export interface BitcoinCoreAdapterOptions {
  nodes: () => NodeWithStatus[];
  detect: () => Promise<DetectionReport>;
}

export function bitcoinCoreAdapter(options: BitcoinCoreAdapterOptions): ServiceAdapter {
  return {
    id: 'bitcoin-core',
    status: 'verified-on-windows',
    level: 'fully-managed',
    capabilities: ['detect', 'install', 'verify-release', 'configure', 'connect', 'start', 'stop', 'logs', 'health'],
    route: '/nodes',
    async state(): Promise<ServiceState> {
      const nodes = options.nodes().filter((node) => node.profile.implementation === 'bitcoin-core');
      const found = (await options.detect()).installations.filter((entry) => entry.product === 'Bitcoin Core');
      const running = nodes.filter((node) => node.status.state === 'running').length;
      const versions = [
        ...nodes.flatMap((node) => (node.profile.runtimeVersion ? [node.profile.runtimeVersion] : [])),
        ...found.flatMap((entry) => (entry.version ? [entry.version] : [])),
      ];
      const parts = [
        nodes.length > 0
          ? `${plural(nodes.length, 'node', 'nodes')} in BTCortex, ${String(running)} running`
          : 'No node in BTCortex yet',
        ...(found.length > 0
          ? [`${plural(found.length, 'installation', 'installations')} found on this computer`]
          : []),
      ];
      return {
        installed: nodes.length > 0 || found.length > 0,
        versions: [...new Set(versions)],
        running,
        health: nodesHealth(nodes),
        summary: `${parts.join('; ')}.`,
      };
    },
  };
}

export function bitcoinKnotsAdapter(options: BitcoinCoreAdapterOptions): ServiceAdapter {
  return {
    id: 'bitcoin-knots',
    status: 'integration-tested',
    // Set up only on request, after the user agreed that it follows another chain than Bitcoin Core.
    level: 'fully-managed',
    capabilities: ['detect', 'install', 'verify-release', 'configure', 'connect', 'start', 'stop', 'logs', 'health'],
    route: '/nodes',
    async state(): Promise<ServiceState> {
      const nodes = options.nodes().filter((node) => node.profile.implementation === 'bitcoin-knots');
      const found = (await options.detect()).installations.filter((entry) => entry.product === 'Bitcoin Knots');
      const running = nodes.filter((node) => node.status.state === 'running').length;
      const versions = [
        ...nodes.flatMap((node) => (node.profile.runtimeVersion ? [node.profile.runtimeVersion] : [])),
        ...found.flatMap((entry) => (entry.version ? [entry.version] : [])),
      ];
      const parts = [
        nodes.length > 0
          ? `${plural(nodes.length, 'node', 'nodes')} in BTCortex, ${String(running)} running`
          : 'No Knots node in BTCortex',
        ...(found.length > 0
          ? [`${plural(found.length, 'installation', 'installations')} found on this computer`]
          : []),
      ];
      return {
        installed: nodes.length > 0 || found.length > 0,
        versions: [...new Set(versions)],
        running,
        health: nodes.length > 0 ? nodesHealth(nodes) : 'unknown',
        summary: `${parts.join('; ')}.`,
      };
    },
  };
}

export interface SparrowAdapterOptions {
  summary: () => Promise<{ installed: string | null; running: boolean; settingsFound: boolean }>;
}

export function sparrowAdapter(options: SparrowAdapterOptions): ServiceAdapter {
  return {
    id: 'sparrow',
    status: 'unit-tested',
    level: 'connected-application',
    capabilities: ['install', 'verify-release', 'configure', 'connect', 'open'],
    // Sparrow is connected from a node's page.
    route: '/nodes',
    async state(): Promise<ServiceState> {
      const summary = await options.summary();
      return {
        installed: summary.installed !== null,
        versions: summary.installed === null ? [] : [summary.installed],
        running: summary.running ? 1 : 0,
        health: summary.installed === null ? 'unknown' : summary.running ? 'healthy' : 'inactive',
        summary:
          summary.installed === null
            ? summary.settingsFound
              ? 'Used on this computer before, but not installed by BTCortex.'
              : 'Not installed.'
            : `Sparrow ${summary.installed} installed by BTCortex${summary.running ? ', open now' : ''}.`,
      };
    },
  };
}

export interface TorAdapterOptions {
  status: () => Promise<TorStatus>;
}

function torHealth(status: TorStatus): ServiceHealth {
  switch (status.state) {
    case 'running':
      return status.circuitEstablished ? 'healthy' : 'attention';
    case 'starting':
    case 'stopping':
      return 'working';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'inactive';
    case 'not-installed':
      return 'unknown';
  }
}

export function torAdapter(options: TorAdapterOptions): ServiceAdapter {
  return {
    id: 'tor',
    // The real Expert Bundle installed and connected to the Tor network on Windows.
    status: 'verified-on-windows',
    level: 'fully-managed',
    capabilities: [
      'detect',
      'install',
      'verify-release',
      'configure',
      'connect',
      'start',
      'stop',
      'logs',
      'health',
      'update',
      'uninstall',
    ],
    route: '/tor',
    async state(): Promise<ServiceState> {
      const status = await options.status();
      const installed = status.installed;
      const users = status.usedBy.length > 0 ? `; used by ${plural(status.usedBy.length, 'node', 'nodes')}` : '';
      let summary = 'Not set up.';
      if (installed) {
        const name = `Tor ${installed.version}${installed.torVersion ? ` (tor ${installed.torVersion})` : ''}`;
        summary =
          status.state === 'running'
            ? `${name} connected to the Tor network${users}.`
            : status.state === 'starting'
              ? `${name} connecting to the Tor network (${String(status.bootstrap?.progress ?? 0)} %)${users}.`
              : `${name} installed, not running${users}.`;
      }
      return {
        installed: installed !== null,
        versions: installed ? [installed.version] : [],
        running: status.pid === null ? 0 : 1,
        health: torHealth(status),
        summary,
      };
    },
  };
}

export interface HardwareAdapterOptions {
  overview: () => Promise<HardwareOverview>;
}

export function hwiAdapter(options: HardwareAdapterOptions): ServiceAdapter {
  return {
    id: 'hwi',
    // Installed for real from its signed release; Bitcoin Core drives it in tests with a simulated device.
    status: 'integration-tested',
    level: 'fully-managed',
    capabilities: ['install', 'verify-release', 'detect', 'update', 'uninstall'],
    route: '/hardware',
    async state(): Promise<ServiceState> {
      const { hwi } = await options.overview();
      return {
        installed: hwi !== null,
        versions: hwi ? [hwi.version] : [],
        running: 0,
        health: hwi ? 'healthy' : 'unknown',
        summary: hwi ? `HWI ${hwi.version} installed and verified by BTCortex.` : 'Not installed.',
      };
    },
  };
}

/** A signing device reached through Bitcoin Core's external signer support and HWI. */
export function signingDeviceAdapter(
  id: string,
  vendor: DeviceVendor,
  name: string,
  options: HardwareAdapterOptions,
): ServiceAdapter {
  return {
    id,
    // The path through Bitcoin Core and HWI is tested end to end with a simulated device, not this device itself.
    status: 'integration-tested',
    level: 'connected-application',
    capabilities: ['detect', 'connect'],
    route: '/hardware',
    async state(): Promise<ServiceState> {
      const attached = (await options.overview()).devices.filter(
        (device) => device.vendor === vendor && device.confidence === 'certain',
      );
      const problems = attached.filter((device) => !device.driver.ok).length;
      return {
        installed: attached.length > 0,
        versions: [],
        running: attached.length,
        health: attached.length === 0 ? 'inactive' : problems > 0 ? 'attention' : 'healthy',
        summary:
          attached.length === 0
            ? `No ${name} connected.`
            : `${plural(attached.length, `${name} connected`, `${name} devices connected`)}${problems > 0 ? `, ${String(problems)} with a driver problem` : ''}.`,
      };
    },
  };
}

export function trezorSuiteAdapter(options: HardwareAdapterOptions): ServiceAdapter {
  return {
    id: 'trezor-suite',
    // Installed through BTCortex's verified installer on Windows and detected afterwards.
    status: 'verified-on-windows',
    level: 'external-launcher',
    capabilities: ['detect', 'install', 'verify-release', 'open'],
    route: '/hardware',
    async state(): Promise<ServiceState> {
      const { trezorSuite } = await options.overview();
      const installed = trezorSuite.installed;
      return {
        installed: installed !== null,
        versions: installed?.version ? [installed.version] : [],
        running: trezorSuite.running ? 1 : 0,
        health: installed === null ? 'unknown' : trezorSuite.running ? 'healthy' : 'inactive',
        summary:
          installed === null
            ? 'Not installed.'
            : `Trezor Suite ${installed.version ?? ''} ${installed.installedByBtcortex ? 'installed by BTCortex' : 'installed'}${trezorSuite.running ? ', open now' : ''}.`,
      };
    },
  };
}

/** A device that signs without a cable: by animated QR codes, and by PSBT files on microSD when it reads them. */
export function airGappedDeviceAdapter(id: string, name: string, readsFiles = true): ServiceAdapter {
  return {
    id,
    status: 'integration-tested',
    level: 'connected-application',
    capabilities: ['connect'],
    route: '/hardware',
    state(): Promise<ServiceState> {
      return Promise.resolve({
        installed: false,
        versions: [],
        running: 0,
        health: 'unknown',
        summary: `${name} signs PSBTs that BTCortex hands over as ${readsFiles ? 'QR codes or files' : 'QR codes'} and reads back; it never connects to this computer.`,
      });
    },
  };
}
