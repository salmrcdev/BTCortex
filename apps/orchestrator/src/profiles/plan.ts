import { CHAIN_SIZE_ESTIMATES, INDEX_SIZE_RATIOS, NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';
import type { ConfigurationRecommendation } from '@btcortex/bitcoin-config';
import type {
  DeploymentChoices,
  DeploymentComponent,
  DeploymentDownload,
  DeploymentPlan,
  DeploymentPort,
  DeploymentProfile,
  DeploymentStepPlan,
  DiskKind,
  ElectrumSetupPlan,
  HardwareSummary,
  NodeWithStatus,
} from '@btcortex/contracts';
import { fulcrumDatabaseMemory } from '@btcortex/integration-fulcrum';
import { DEFAULT_TOR_PORTS } from '@btcortex/integration-tor';
import { ADMIN_PORTS, DEFAULT_ELECTRUM_PORTS } from '../electrum/electrum-plan';
import { DEFAULT_ONION_PORTS } from '../nodes/privacy';
import type { InstallableComponent, ReleaseSize } from './releases';

// What deploying a profile means on this computer (specification section 18):
// worked out from the same recommendation the node set-up uses, the Electrum
// server's own plan for an existing node, what is installed already and the
// real sizes of the releases. Sizes of chains and indexes are estimates and
// are labelled as such. Pure, so every rule can be tested.

const GB = 1_000_000_000;
const MB = 1_000_000;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
/** BTCortex's allowance for Windows, BTCortex itself and everyday programs. */
const BASE_MEMORY_BYTES = 2 * GIB;
/** Logs, settings and the programs themselves, as the node set-up allows for them. */
const PROGRAMS_BYTES = GB;
const REGTEST_BYTES = 100 * MIB;

export type NodeTarget =
  | { kind: 'new'; name: string; dataDirectory: string; recommendation: ConfigurationRecommendation }
  | {
      kind: 'existing';
      node: NodeWithStatus;
      /** The Electrum server's own plan, when one is to be set up. */
      electrumPlan: ElectrumSetupPlan | undefined;
      electrumSetUp: boolean;
      privateBroadcastSupported: boolean;
    }
  | { kind: 'missing' };

export interface PlanInputs {
  profile: DeploymentProfile;
  choices: DeploymentChoices;
  included: ReadonlySet<DeploymentComponent>;
  hardware: HardwareSummary;
  diskKind: DiskKind;
  target: NodeTarget;
  installed: Record<InstallableComponent, boolean>;
  releases: Partial<Record<InstallableComponent, ReleaseSize>>;
}

const DOWNLOAD_NAMES: Record<InstallableComponent, { name: string; verification: string }> = {
  'bitcoin-core': {
    name: 'Bitcoin Core',
    verification: 'Signed by at least three of Bitcoin Core’s builders; checksum and Windows signature checked',
  },
  'electrum-server': {
    name: 'Fulcrum (Electrum server)',
    verification: 'Checksums signed by its developer’s key; archive checksum checked',
  },
  tor: { name: 'Tor Expert Bundle', verification: 'Signed by the Tor Project; checksum checked' },
  sparrow: { name: 'Sparrow', verification: 'Checksums signed by Sparrow’s developer; archive checksum checked' },
  hwi: { name: 'HWI', verification: 'Clear-signed checksums from its maintainers; archive checksum checked' },
  'trezor-suite': {
    name: 'Trezor Suite',
    verification: 'Signed by SatoshiLabs’ key; SatoshiLabs’ Windows signature checked',
  },
};

const TOR_MODE_WORDS = {
  'onion-peers': 'onion peers through Tor besides its usual connections',
  'all-traffic': 'every connection through Tor',
  'tor-only': 'connections through Tor only',
} as const;

const formatGb = (bytes: number) => `${Math.max(1, Math.round(bytes / GB)).toLocaleString('en-GB')} GB`;

export function buildPlan(inputs: PlanInputs): DeploymentPlan {
  const { profile, choices, included, hardware, target, installed } = inputs;
  const network = choices.network;
  const parameters = NETWORK_PARAMETERS[network];
  const has = (component: DeploymentComponent) => included.has(component);
  const tor = has('tor')
    ? (choices.tor ?? { mode: 'tor-only', onionService: true, privateBroadcast: true })
    : undefined;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const dependencies: string[] = [];
  const impact: string[] = [];
  if (!profile.available) blockers.push(profile.unavailableReason ?? 'BTCortex cannot deploy this profile yet.');

  // The node.
  let node: DeploymentPlan['node'];
  let pruned = false;
  let electrumToDo = has('electrum-server');
  if (target.kind === 'missing') {
    node = { name: 'The chosen node', existing: true, dataDirectory: null };
    blockers.push('The chosen node is no longer in BTCortex.');
  } else if (target.kind === 'existing') {
    const { profile: existing, status } = target.node;
    node = { name: existing.name, existing: true, dataDirectory: existing.dataDirectory };
    pruned = status.snapshot?.blockchain.pruned ?? false;
    if (existing.network !== network) {
      blockers.push(
        `${existing.name} runs on ${NETWORK_PARAMETERS[existing.network].label}, not on ${parameters.label}.`,
      );
    }
    if (has('tor') && existing.execution !== 'managed') {
      blockers.push(`BTCortex routes through Tor only nodes it set up; ${existing.name} was set up outside BTCortex.`);
    }
    if (tor?.privateBroadcast && !target.privateBroadcastSupported) {
      blockers.push(
        `Private broadcasting needs Bitcoin Core 31.1 or later on ${existing.name}; leave it out or update the node first.`,
      );
    }
    if (has('sparrow') && !has('electrum-server') && existing.authentication.kind !== 'cookie') {
      blockers.push(
        `Sparrow would keep ${existing.name}’s password in plain text, so BTCortex connects it only to nodes that sign in with a cookie file. Include the Electrum server instead.`,
      );
    }
    if (target.electrumSetUp) {
      electrumToDo = false;
    } else if (has('electrum-server') && target.electrumPlan) {
      blockers.push(...target.electrumPlan.blockers.map((issue) => issue.message));
      warnings.push(...target.electrumPlan.warnings.map((issue) => issue.message));
    }
  } else {
    node = { name: target.name, existing: false, dataDirectory: target.dataDirectory };
    blockers.push(...target.recommendation.blockers);
    pruned = target.recommendation.pruned;
    // A pruned node cannot have an Electrum server: the blocker says so, and pruning's consequences would only confuse.
    if (!(pruned && has('electrum-server'))) {
      (pruned ? warnings : impact).push(...target.recommendation.consequences);
    }
  }

  // Steps, in the order the deployment carries them out.
  const release = (component: InstallableComponent) => inputs.releases[component]?.version ?? null;
  const steps: DeploymentStepPlan[] = [];
  if (target.kind === 'new') {
    const version = release('bitcoin-core');
    steps.push({
      component: 'bitcoin-core',
      title: `Set up ${target.name}`,
      detail: `Bitcoin Core${version === null ? '' : ` ${version}`} for ${parameters.label}, its data in ${target.dataDirectory}${
        pruned && target.recommendation.pruneTargetMiB !== undefined
          ? `, keeping only the latest ${formatGb(target.recommendation.pruneTargetMiB * MIB)} of blocks`
          : ''
      }. It starts at once and catches up with the network.`,
      state: 'to-do',
    });
  } else {
    steps.push({
      component: 'bitcoin-core',
      title: `Use ${node.name}`,
      detail: 'The node is already in BTCortex; the deployment builds on it.',
      state: 'already-done',
    });
  }
  if (has('electrum-server')) {
    steps.push(
      electrumToDo
        ? {
            component: 'electrum-server',
            title: 'Set up the Electrum server',
            detail: `${installed['electrum-server'] ? 'Uses the Fulcrum already installed' : 'Installs Fulcrum after checking its signature'}, keeps its index next to the node’s data and starts it once the node has caught up; it then indexes every block.`,
            state: 'to-do',
          }
        : {
            component: 'electrum-server',
            title: 'Electrum server',
            detail: 'The node already has its Electrum server.',
            state: 'already-done',
          },
    );
  }
  if (tor) {
    steps.push({
      component: 'tor',
      title: 'Route the node through Tor',
      detail: `${installed.tor ? 'Starts the tor BTCortex installed' : 'Installs tor after checking its signature and starts it'}, then gives the node ${TOR_MODE_WORDS[tor.mode]}${tor.onionService ? ', an onion service' : ''}${tor.privateBroadcast ? ' and private broadcasting of its own transactions' : ''}. The node restarts once.`,
      state: 'to-do',
    });
  }
  if (has('sparrow')) {
    steps.push({
      component: 'sparrow',
      title: 'Connect Sparrow',
      detail: `${installed.sparrow ? 'Uses the Sparrow BTCortex installed' : 'Installs Sparrow after checking its signature'}, points it at ${has('electrum-server') ? 'the Electrum server' : 'the node'} and opens it. Its wallets are never touched; a server you chose yourself is kept unless you agree to replace it.`,
      state: 'to-do',
    });
  }
  if (has('hwi')) {
    steps.push(
      installed.hwi
        ? { component: 'hwi', title: 'HWI', detail: 'HWI is installed already.', state: 'already-done' }
        : {
            component: 'hwi',
            title: 'Install HWI',
            detail:
              'The hardware-wallet interface BTCortex and Bitcoin Core use to talk to Trezor, Ledger, Coldcard and other devices.',
            state: 'to-do',
          },
    );
  }
  if (has('trezor-suite')) {
    steps.push(
      installed['trezor-suite']
        ? {
            component: 'trezor-suite',
            title: 'Trezor Suite',
            detail: 'Trezor Suite is installed already.',
            state: 'already-done',
          }
        : {
            component: 'trezor-suite',
            title: 'Install Trezor Suite',
            detail: 'Trezor’s own application, installed for your Windows account. It updates itself afterwards.',
            state: 'to-do',
          },
    );
  }
  if (has('explorer')) {
    steps.push({
      component: 'explorer',
      title: 'Explorer',
      detail:
        'Part of BTCortex: blocks and transactions once the node runs, address histories once the Electrum server has indexed.',
      state: 'built-in',
    });
  }
  if (has('rpc-console')) {
    steps.push({
      component: 'rpc-console',
      title: 'RPC console',
      detail: 'Part of BTCortex: Bitcoin Core’s commands, with those that change things confirmed first.',
      state: 'built-in',
    });
  }
  if (has('monitoring')) {
    steps.push({
      component: 'monitoring',
      title: 'Monitoring',
      detail: 'Part of BTCortex: health, alerts and history for everything deployed.',
      state: 'built-in',
    });
  }
  if (has('backups')) {
    steps.push({
      component: 'backups',
      title: 'Backups',
      detail: 'Afterwards, choose a backup folder, ideally on another disk, on the Backups page.',
      state: 'later',
    });
  }

  // Downloads: only what is not installed yet.
  const downloads: DeploymentDownload[] = steps
    .filter((step) => step.state === 'to-do')
    .flatMap((step): DeploymentDownload[] => {
      const component = step.component as InstallableComponent;
      if (!(component in DOWNLOAD_NAMES) || installed[component]) return [];
      return [
        {
          component,
          ...DOWNLOAD_NAMES[component],
          version: release(component),
          bytes: inputs.releases[component]?.bytes ?? null,
        },
      ];
    });
  if (downloads.some((download) => download.version === null)) {
    warnings.push(
      'Some releases could not be checked just now, so their versions and sizes are not shown. BTCortex needs an internet connection to install them.',
    );
  }

  // Storage, as estimates once everything is synchronised and indexed.
  const sizes = CHAIN_SIZE_ESTIMATES[network];
  const storageItems: { label: string; bytes: number }[] = [];
  if (target.kind === 'new') {
    if (network === 'regtest') {
      storageItems.push({ label: 'Regtest blocks', bytes: REGTEST_BYTES });
    } else {
      const prunedBytes =
        pruned && target.recommendation.pruneTargetMiB !== undefined
          ? target.recommendation.pruneTargetMiB * MIB
          : null;
      storageItems.push({
        label: prunedBytes === null ? 'Blocks' : 'Recent blocks',
        bytes: prunedBytes ?? sizes.blocksBytes,
      });
      storageItems.push({ label: 'Chain state', bytes: sizes.chainstateBytes });
      if (has('electrum-server') && !pruned) {
        storageItems.push({
          label: 'Bitcoin Core’s transaction index',
          bytes: Math.round(sizes.blocksBytes * INDEX_SIZE_RATIOS.transactionIndex),
        });
        storageItems.push({
          label: 'Electrum server index',
          bytes: Math.round(sizes.blocksBytes * INDEX_SIZE_RATIOS.electrumIndex),
        });
      }
    }
  } else if (target.kind === 'existing' && electrumToDo && target.electrumPlan) {
    storageItems.push({ label: 'Electrum server index', bytes: target.electrumPlan.indexBytesEstimate });
    if (target.electrumPlan.transactionIndexBytesEstimate !== null) {
      storageItems.push({
        label: 'Bitcoin Core’s transaction index',
        bytes: target.electrumPlan.transactionIndexBytesEstimate,
      });
    }
  }
  if (downloads.length > 0 || target.kind === 'new') {
    storageItems.push({ label: 'Programs, settings and logs', bytes: PROGRAMS_BYTES });
  }
  const neededBytes = storageItems.reduce((sum, item) => sum + item.bytes, 0);
  if (target.kind === 'existing' && neededBytes > hardware.freeDiskBytes) {
    blockers.push(
      `About ${formatGb(neededBytes)} is needed on ${hardware.volumePath}, which has ${formatGb(hardware.freeDiskBytes)} free.`,
    );
  }
  if (inputs.diskKind === 'hdd' && (target.kind === 'new' || electrumToDo)) {
    warnings.push(
      'The data would be on a hard disk: the first synchronisation and indexing can take days or weeks there, against hours or days on an SSD.',
    );
  }

  // Memory: the caches BTCortex configures, and an allowance for everything else.
  const memoryItems: { label: string; bytes: number }[] = [];
  if (target.kind === 'new') {
    const setting = (key: string) => target.recommendation.settings.find((candidate) => candidate.key === key)?.value;
    const dbcache = Number(setting('dbcache'));
    const mempool = Number(setting('maxmempool'));
    if (Number.isFinite(dbcache))
      memoryItems.push({ label: 'Bitcoin Core’s database cache (dbcache)', bytes: dbcache * MIB });
    if (Number.isFinite(mempool))
      memoryItems.push({ label: 'Bitcoin Core’s mempool (maxmempool)', bytes: mempool * MB });
  }
  if (electrumToDo) {
    const fulcrumMiB =
      fulcrumDatabaseMemory(hardware.totalMemoryBytes) ?? Math.min(2048, (0.25 * hardware.totalMemoryBytes) / MIB);
    memoryItems.push({ label: 'Fulcrum’s database cache (db_mem)', bytes: Math.round(fulcrumMiB * MIB) });
  }
  memoryItems.push({ label: 'Windows, BTCortex and other programs (allowance)', bytes: BASE_MEMORY_BYTES });
  const recommendedBytes = memoryItems.reduce((sum, item) => sum + item.bytes, 0);
  if (recommendedBytes > hardware.totalMemoryBytes) {
    warnings.push(
      'The caches and the allowance add up to more than this computer’s memory: expect it to slow down while the node synchronises.',
    );
  }
  if (has('sparrow')) impact.push('Sparrow and Trezor Suite use memory of their own while they are open.');

  // Processors.
  const recommendedProcessors = has('electrum-server') ? 4 : 2;
  if (hardware.logicalProcessors < 2) {
    warnings.push('This computer has a single processor thread: synchronising and indexing will be slow.');
  }

  // Ports, all on this computer unless an onion service opens one to Tor.
  const ports: DeploymentPort[] = [
    {
      port: parameters.rpcPort,
      purpose: 'Bitcoin Core’s RPC interface, for BTCortex and wallets on this computer',
      reach: 'this-computer',
    },
    {
      port: parameters.p2pPort,
      purpose: 'Bitcoin’s peer-to-peer port; incoming connections stay off, the node only connects out',
      reach: 'nobody',
    },
  ];
  if (tor?.onionService) {
    ports.push({
      port: DEFAULT_ONION_PORTS[network],
      purpose: 'The node’s onion service: other nodes connect through Tor without learning this computer’s address',
      reach: 'tor',
    });
  }
  if (has('electrum-server')) {
    ports.push(
      {
        port: DEFAULT_ELECTRUM_PORTS[network],
        purpose: 'Electrum server, for wallets on this computer',
        reach: 'this-computer',
      },
      { port: ADMIN_PORTS[0], purpose: 'Fulcrum’s administration port, for BTCortex', reach: 'this-computer' },
    );
  }
  if (tor) {
    ports.push(
      { port: DEFAULT_TOR_PORTS.socks, purpose: 'tor’s SOCKS port for nodes', reach: 'this-computer' },
      {
        port: DEFAULT_TOR_PORTS.applicationSocks,
        purpose: 'tor’s SOCKS port for other programs',
        reach: 'this-computer',
      },
      { port: DEFAULT_TOR_PORTS.control, purpose: 'tor’s control port, protected by a cookie', reach: 'this-computer' },
    );
  }

  // Dependencies.
  if (has('electrum-server')) {
    dependencies.push(
      'The Electrum server needs the whole blockchain and Bitcoin Core’s transaction index; it starts indexing once the node has caught up.',
    );
  }
  if (tor) dependencies.push('The node’s Tor connections need BTCortex’s tor, which starts before the node.');
  if (has('sparrow')) {
    dependencies.push(
      has('electrum-server')
        ? 'Sparrow connects to the Electrum server and waits for it until it has indexed the chain.'
        : 'Sparrow connects to the node directly, signing in with its cookie file.',
    );
  }
  if (has('hwi'))
    dependencies.push('HWI lets BTCortex and Bitcoin Core use hardware wallets; Sparrow brings its own support.');
  if (has('trezor-suite'))
    dependencies.push('Trezor Suite holds a Trezor while it is open; close it before using the device elsewhere.');
  if (has('explorer')) dependencies.push('The explorer looks addresses up through the node’s Electrum server.');

  // Privacy.
  const privacy: string[] = [];
  if (!tor || tor.mode === 'onion-peers') {
    privacy.push(
      'Other nodes see this computer’s IP address and that it runs Bitcoin; your transactions leave from it.',
    );
  }
  if (tor) {
    privacy.push(
      tor.mode === 'tor-only'
        ? 'The node connects only through Tor: peers learn neither this computer’s address nor that it runs Bitcoin. Your internet provider sees that you use Tor.'
        : tor.mode === 'all-traffic'
          ? 'Every connection of the node goes through Tor, so peers do not learn this computer’s address; it can still reach peers that are not onion services.'
          : 'The node also reaches onion peers through Tor; its other connections still show this computer’s address.',
    );
    if (tor.onionService)
      privacy.push('Other nodes can connect to yours through its onion service without learning where it is.');
    if (tor.privateBroadcast) {
      privacy.push(
        'Your own transactions are sent through short-lived Tor connections, so peers cannot tell they started here.',
      );
    }
  }
  if (has('electrum-server')) {
    privacy.push(
      'Wallets ask your own Electrum server about their addresses instead of public servers, which would learn them.',
    );
  }
  if (has('sparrow')) privacy.push('Sparrow asks only your node or your Electrum server about your wallets.');
  if (has('explorer'))
    privacy.push('The explorer looks everything up on your node; nothing is sent to outside services.');
  if (has('trezor-suite')) {
    privacy.push(
      'Trezor Suite uses Trezor’s servers unless you point it at your Electrum server; the Electrum servers page shows how.',
    );
  }

  // Security.
  const security: string[] = ['Every program is installed only after its signatures and checksums have been verified.'];
  if (target.kind === 'new') {
    security.push(
      'The node’s RPC interface listens on this computer only, and BTCortex signs in with its cookie file: no password is stored.',
    );
  }
  if (has('electrum-server')) {
    security.push(
      'The Electrum server listens on this computer only; other devices can reach it only through Tor, if you allow it later.',
    );
  }
  if (tor) security.push('tor listens on this computer only; its control port is protected by a cookie.');
  if (tor?.onionService) {
    security.push(
      'Anyone on Tor who knows the onion address can connect to the node, which only exchanges blocks and transactions with them.',
    );
  }
  if (has('sparrow')) {
    security.push(
      'Sparrow keeps its wallets in its own folder; BTCortex changes only its server setting, and only while it is closed.',
    );
  }
  if (has('hwi') || has('trezor-suite')) {
    security.push('Keys stay on the hardware wallet: signing happens on the device, after you confirm there.');
  }
  security.push(
    'More programs mean more updates to keep up with; the Installed software page shows when they are due.',
  );

  // Resource impact.
  if (target.kind === 'new') {
    impact.unshift(
      network === 'regtest'
        ? 'Regtest downloads nothing: blocks are made on demand.'
        : `The first synchronisation downloads and verifies about ${formatGb(sizes.blocksBytes)} of blocks: hours to days of heavy processor, disk and network use, depending on the disk and the connection.`,
    );
  }
  if (electrumToDo) {
    impact.push(
      'Then Bitcoin Core builds its transaction index and Fulcrum its own: hours on an SSD, days on a hard disk.',
    );
  }
  if (tor?.mode === 'tor-only') impact.push('Synchronising through Tor only is slower than over direct connections.');
  if (network === 'mainnet') {
    impact.push(
      'Once synchronised, the node uses little processor time; it receives every new block, roughly 200 MB a day, and relays transactions.',
    );
  }

  return {
    choices,
    node,
    feasible: blockers.length === 0,
    blockers,
    warnings,
    steps,
    downloads,
    storage: {
      volume: hardware.volumePath,
      kind: inputs.diskKind,
      freeBytes: hardware.freeDiskBytes,
      totalBytes: hardware.volumeBytes,
      items: storageItems,
      neededBytes,
    },
    memory: { totalBytes: hardware.totalMemoryBytes, items: memoryItems, recommendedBytes },
    processors: { logical: hardware.logicalProcessors, recommended: recommendedProcessors },
    ports,
    dependencies,
    privacy,
    security,
    impact,
    needsDockerOrWsl2: profile.needsDockerOrWsl2,
  };
}
