import type {
  DeploymentComponent,
  DeploymentComponentInfo,
  DeploymentProfile,
  DeploymentProfileId,
} from '@btcortex/contracts';

// The deployment profiles of specification section 18, limited to what
// BTCortex can really install, configure or provide. Parts it cannot deploy
// yet are listed as such, with the reason, rather than left out silently.

const LIGHTNING_UNAVAILABLE =
  'BTCortex connects to an LND node you run, on this computer or another, but does not install or run one yet.';
const PAYMENTS_UNAVAILABLE =
  'BTCPay Server runs on Linux, usually in Docker, and BTCortex does not set up Docker or WSL2; an existing BTCPay Server can be connected on the Payments page.';

const installs = (
  component: DeploymentComponent,
  required: boolean,
  chosenByDefault = true,
): DeploymentComponentInfo => ({ component, kind: 'installs', required, chosenByDefault });
const builtIn = (component: DeploymentComponent): DeploymentComponentInfo => ({
  component,
  kind: 'built-in',
  required: true,
  chosenByDefault: true,
});
/** A reminder of something to set up afterwards, part of every profile that has it. */
const later = (component: DeploymentComponent): DeploymentComponentInfo => ({
  component,
  kind: 'later',
  required: true,
  chosenByDefault: true,
});
const unavailable = (component: DeploymentComponent, unavailableReason: string): DeploymentComponentInfo => ({
  component,
  kind: 'unavailable',
  required: false,
  chosenByDefault: false,
  unavailableReason,
});

export const PROFILES: readonly DeploymentProfile[] = [
  {
    id: 'basic-node',
    letter: 'A',
    title: 'Basic Bitcoin full node',
    summary:
      'Bitcoin Core with a configuration suited to this computer: pruned when the disk is small, no incoming connections, watched by BTCortex.',
    available: true,
    needsDockerOrWsl2: false,
    components: [
      installs('bitcoin-core', true),
      installs('tor', false, false),
      builtIn('monitoring'),
      later('backups'),
    ],
  },
  {
    id: 'private-wallet',
    letter: 'B',
    title: 'Private Bitcoin wallet infrastructure',
    summary:
      'Bitcoin Core with your own Electrum server and Sparrow connected to it, so that your wallet asks only your own node about your addresses.',
    available: true,
    needsDockerOrWsl2: false,
    components: [
      installs('bitcoin-core', true),
      installs('electrum-server', true),
      installs('sparrow', true),
      installs('hwi', false, false),
      installs('trezor-suite', false, false),
      builtIn('monitoring'),
      later('backups'),
    ],
  },
  {
    id: 'privacy-node',
    letter: 'C',
    title: 'Privacy-focused Bitcoin node',
    summary:
      'Bitcoin Core that reaches the network only through Tor, with an onion service and private broadcasting of your own transactions.',
    available: true,
    needsDockerOrWsl2: false,
    components: [installs('bitcoin-core', true), installs('tor', true), builtIn('monitoring'), later('backups')],
  },
  {
    id: 'explorer',
    letter: 'D',
    title: 'Full Bitcoin explorer',
    summary:
      'Bitcoin Core with its transaction index and an Electrum server, so that BTCortex’s explorer finds any block, transaction or address on your own node.',
    available: true,
    needsDockerOrWsl2: false,
    components: [
      installs('bitcoin-core', true),
      installs('electrum-server', true),
      builtIn('explorer'),
      builtIn('monitoring'),
      later('backups'),
    ],
  },
  {
    id: 'lightning',
    letter: 'E',
    title: 'Lightning node',
    summary: 'Bitcoin Core with a Lightning implementation beside it and a dashboard of its channels.',
    available: false,
    unavailableReason: `${LIGHTNING_UNAVAILABLE} Set up a node with profile A or B, run LND, and connect it on the Lightning page.`,
    needsDockerOrWsl2: false,
    components: [
      installs('bitcoin-core', true),
      unavailable('lightning', LIGHTNING_UNAVAILABLE),
      builtIn('monitoring'),
    ],
  },
  {
    id: 'merchant',
    letter: 'F',
    title: 'Bitcoin merchant infrastructure',
    summary: 'A Bitcoin back end with BTCPay Server, to take payments in your own shop.',
    available: false,
    unavailableReason: PAYMENTS_UNAVAILABLE,
    needsDockerOrWsl2: true,
    components: [installs('bitcoin-core', true), unavailable('payments', PAYMENTS_UNAVAILABLE)],
  },
  {
    id: 'workstation',
    letter: 'G',
    title: 'Advanced Bitcoin workstation',
    summary:
      'Bitcoin Core, an Electrum server, Sparrow, hardware-wallet tools, the explorer and the RPC console: everything to work with Bitcoin on this computer.',
    available: true,
    needsDockerOrWsl2: false,
    components: [
      installs('bitcoin-core', true),
      installs('electrum-server', true),
      installs('sparrow', false),
      installs('hwi', false),
      installs('trezor-suite', false, false),
      builtIn('explorer'),
      builtIn('rpc-console'),
      builtIn('monitoring'),
      later('backups'),
    ],
  },
  {
    id: 'maximum',
    letter: 'H',
    title: 'Maximum self-hosted Bitcoin stack',
    summary:
      'Everything BTCortex can run together: a node reached through Tor, an Electrum server, the explorer, Sparrow, hardware-wallet tools, monitoring and backups.',
    available: true,
    needsDockerOrWsl2: false,
    components: [
      installs('bitcoin-core', true),
      installs('tor', true),
      installs('electrum-server', true),
      installs('sparrow', false),
      installs('hwi', false),
      installs('trezor-suite', false, false),
      builtIn('explorer'),
      builtIn('rpc-console'),
      builtIn('monitoring'),
      later('backups'),
      unavailable('lightning', LIGHTNING_UNAVAILABLE),
      unavailable('payments', PAYMENTS_UNAVAILABLE),
    ],
  },
];

export function findProfile(id: DeploymentProfileId): DeploymentProfile {
  const profile = PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown deployment profile ${id}.`);
  return profile;
}

/** The components a deployment carries out: the required ones and the optional ones the user kept. */
export function includedComponents(
  profile: DeploymentProfile,
  chosen: readonly DeploymentComponent[],
): Set<DeploymentComponent> {
  return new Set(
    profile.components
      .filter((info) => info.kind !== 'unavailable' && (info.required || chosen.includes(info.component)))
      .map((info) => info.component),
  );
}
