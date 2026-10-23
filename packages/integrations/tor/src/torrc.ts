import { join } from 'node:path';

// BTCortex's own torrc and tor command line (privacy-networking.md §2.7–2.9).
// The torrc holds only path-free options; every path travels as its own
// command-line argument, which sidesteps torrc quoting and the trailing
// backslash that would join the next line. The bundle's torrc-defaults
// belongs to Tor Browser and is never used.

export interface TorPorts {
  /** SOCKS port for Bitcoin nodes. */
  socks: number;
  /** SOCKS port for wallets and other applications, so their circuits never mix with the node's. */
  applicationSocks: number;
  control: number;
}

/**
 * The control port is not tor's usual 9051: Bitcoin Core looks for tor there
 * by default and, when it accepts incoming connections, would publish an
 * onion service through it without anyone asking. BTCortex's nodes are given
 * the port explicitly.
 */
export const DEFAULT_TOR_PORTS: TorPorts = { socks: 9050, applicationSocks: 9052, control: 9054 };

/** BTCortex's tor folder: generated configuration, tor's data directory and onion-service client keys. */
export function torLayout(home: string) {
  const data = join(home, 'data');
  return {
    torrc: join(home, 'torrc'),
    defaults: join(home, 'torrc-defaults'),
    data,
    cookie: join(data, 'control_auth_cookie'),
    onionAuth: join(home, 'onion-auth'),
  };
}

export class TorPathError extends Error {
  constructor(readonly path: string) {
    super(`tor cannot use the folder ${path} because its name contains characters outside ASCII (Tor issue 10416).`);
    this.name = 'TorPathError';
  }
}

/** tor on Windows fails to start when a path it is given contains non-ASCII characters. */
export function isTorCompatiblePath(path: string): boolean {
  return /^[\x20-\x7e]*$/.test(path);
}

export function buildTorrc(ports: TorPorts): string {
  return [
    '# Managed by BTCortex. Regenerated on every start; manual edits are overwritten.',
    '# Listeners stay on loopback. Nodes and other applications use separate SOCKS ports,',
    '# so their streams never share circuits.',
    `SocksPort 127.0.0.1:${String(ports.socks)} IsolateSOCKSAuth`,
    `SocksPort 127.0.0.1:${String(ports.applicationSocks)} IsolateSOCKSAuth`,
    `ControlPort 127.0.0.1:${String(ports.control)}`,
    'CookieAuthentication 1',
    '# Logs go to standard output, where BTCortex collects them.',
    'Log notice stdout',
    'SafeLogging 1',
    '',
  ].join('\n');
}

export const TORRC_DEFAULTS = '# Managed by BTCortex. Intentionally empty, so that no other defaults file applies.\n';

export interface TorCommandLine {
  /** The installed Expert Bundle folder, which is also the working directory. */
  bundle: string;
  /** BTCortex's tor folder (see torLayout). */
  home: string;
  /** When given, tor exits by itself once this process is gone. */
  ownerPid?: number;
  /** Start configured but without touching the network. */
  disableNetwork?: boolean;
}

export function torArguments(options: TorCommandLine): string[] {
  const layout = torLayout(options.home);
  const paths = [layout.torrc, layout.defaults, layout.data, layout.onionAuth, options.bundle];
  const unusable = paths.find((path) => !isTorCompatiblePath(path));
  if (unusable !== undefined) throw new TorPathError(unusable);
  return [
    '-f',
    layout.torrc,
    '--defaults-torrc',
    layout.defaults,
    'DataDirectory',
    layout.data,
    'CookieAuthFile',
    layout.cookie,
    'ClientOnionAuthDir',
    layout.onionAuth,
    'GeoIPFile',
    join(options.bundle, 'data', 'geoip'),
    'GeoIPv6File',
    join(options.bundle, 'data', 'geoip6'),
    ...(options.ownerPid === undefined ? [] : ['__OwningControllerProcess', String(options.ownerPid)]),
    ...(options.disableNetwork ? ['DisableNetwork', '1'] : []),
  ];
}
