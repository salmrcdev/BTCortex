import type { EffectiveValue } from './effective';
import { resolveEffective } from './effective';
import type { BitcoinNetwork } from './networks';
import { NETWORK_PARAMETERS } from './networks';
import type { OptionRisk } from './options';
import { interpretBoolean, lookupOption } from './options';
import type { BitcoinConfig } from './parser';
import type { ConfigDiagnostic } from './validate';

// What an edit changes for the node's network, in terms of effective values
// rather than lines, so that moving a comment or touching an ignored line is
// not reported as a change (specification section 5.6: explain changes).

export interface SettingChange {
  key: string;
  /** Effective values before and after; `undefined` when unset, so the default applies. */
  before: string[] | undefined;
  after: string[] | undefined;
}

function applied(effective: EffectiveValue | undefined): string[] | undefined {
  return effective && effective.lines.length > 0 ? effective.values : undefined;
}

function same(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function describeChanges(before: BitcoinConfig, after: BitcoinConfig, network: BitcoinNetwork): SettingChange[] {
  const old = resolveEffective(before, network);
  const next = resolveEffective(after, network);
  const keys = [...new Set([...old.keys(), ...next.keys()])].sort((a, b) => a.localeCompare(b, 'en'));
  return keys.flatMap((key) => {
    const change = { key, before: applied(old.get(key)), after: applied(next.get(key)) };
    return same(change.before, change.after) ? [] : [change];
  });
}

/**
 * Whether the change turns the option on. For switches the default counts:
 * removing `listen=0` or `natpmp=0` turns listening or port mapping back on,
 * because Bitcoin Core's default for both is on.
 */
function enables(change: SettingChange): boolean {
  const definition = lookupOption(change.key)?.definition;
  if (definition?.type === 'boolean') {
    const isOn = (values: string[] | undefined) => {
      const value = values?.[0] ?? definition.defaultValue;
      return value !== undefined && interpretBoolean(value);
    };
    return isOn(change.after) && !isOn(change.before);
  }
  return change.after !== undefined && change.after.length > 0;
}

/** Changes the user must confirm explicitly: wider exposure, commands run on events, data rebuilt. */
export function riskyChanges(changes: readonly SettingChange[]): { change: SettingChange; risk: OptionRisk }[] {
  return changes.flatMap((change) => {
    const risk = lookupOption(change.key)?.definition.risk;
    return risk && risk !== 'normal' && enables(change) ? [{ change, risk }] : [];
  });
}

// Settings BTCortex relies on for the nodes it manages. Changing them in
// bitcoin.conf would break its connection to the node or the network pinning,
// so the editor shows them read-only and saving refuses changes to them.

const NETWORK_PINNED = 'BTCortex pins the network so that this data directory can never start on another one.';
const COOKIE_ONLY =
  'A user name and password here would switch off the cookie BTCortex signs in with. Add further users with rpcauth.';

export const MANAGED_SETTINGS: ReadonlyMap<string, string> = new Map([
  ['chain', NETWORK_PINNED],
  ['testnet', NETWORK_PINNED],
  ['testnet4', NETWORK_PINNED],
  ['signet', NETWORK_PINNED],
  ['regtest', NETWORK_PINNED],
  ['rpcport', 'BTCortex connects to the node on this port.'],
  ['pid', 'BTCortex follows the node through its process identifier file.'],
  [
    'includeconf',
    'BTCortex cannot check the settings in an included file, so it keeps every setting of this node in bitcoin.conf.',
  ],
  ['rpccookiefile', 'BTCortex signs in with the cookie file at its usual place.'],
  ['rpcuser', COOKIE_ONLY],
  ['rpcpassword', COOKIE_ONLY],
  ['datadir', 'BTCortex passes the data directory when it starts the node.'],
  [
    'settings',
    'Bitcoin Core keeps settings that override this file in settings.json; BTCortex reads it at its usual place, so it stays there.',
  ],
  ['server', 'BTCortex starts the node with server=1, which overrides this file.'],
  ['printtoconsole', 'BTCortex starts the node with printtoconsole=0 and keeps the console output in a file.'],
]);

/** Hosts whose binding still lets BTCortex reach the node at 127.0.0.1. */
const LOOPBACK_BINDS = new Set(['127.0.0.1', '0.0.0.0', 'localhost']);

/**
 * With both rpcbind and rpcallowip set, Bitcoin Core listens only on the
 * rpcbind addresses (httpserver.cpp HTTPBindAddresses); BTCortex connects to
 * 127.0.0.1 on the RPC port, so one of them must still cover that.
 */
function rpcStillReachable(config: BitcoinConfig, network: BitcoinNetwork): ConfigDiagnostic[] {
  const effective = resolveEffective(config, network);
  const binds = effective.get('rpcbind')?.values ?? [];
  const allowed = effective.get('rpcallowip')?.values ?? [];
  if (binds.length === 0 || allowed.length === 0) return [];
  const port = Number.parseInt(effective.get('rpcport')?.values[0] ?? '', 10) || NETWORK_PARAMETERS[network].rpcPort;
  const reachable = binds.some((bind) => {
    const match = /^(?:\[([^\]]+)\]|([^:]+))(?::(\d+))?$/.exec(bind.trim());
    const host = (match?.[1] ?? match?.[2] ?? '').toLowerCase();
    const boundPort = match?.[3] === undefined ? port : Number(match[3]);
    return LOOPBACK_BINDS.has(host) && boundPort === port;
  });
  return reachable
    ? []
    : [
        {
          severity: 'error',
          code: 'managed-rpc-unreachable',
          key: 'rpcbind',
          message: `With rpcbind and rpcallowip both set, Bitcoin Core listens only on the rpcbind addresses, and none of them is 127.0.0.1 on port ${String(port)}, where BTCortex connects. Add rpcbind=127.0.0.1.`,
        },
      ];
}

/**
 * Bitcoin Core reads includeconf from the network section and from the global part separately
 * (common/config.cpp, add_includes), so a negation in one does not drop the other's files as it
 * would for other list options. Any include that was not there before therefore counts as a
 * change, whatever negations surround it.
 */
function addsIncludes(before: BitcoinConfig, after: BitcoinConfig, network: BitcoinNetwork): boolean {
  const section = NETWORK_PARAMETERS[network].section;
  const includes = (config: BitcoinConfig) =>
    config
      .settings()
      .filter((line) => line.key === 'includeconf' && (line.scope === null || line.scope === section))
      .map((line) => line.value);
  const existing = includes(before);
  return includes(after).some((value) => {
    const index = existing.indexOf(value);
    if (index === -1) return true;
    existing.splice(index, 1);
    return false;
  });
}

export function managedSettingChanges(
  before: BitcoinConfig,
  after: BitcoinConfig,
  network: BitcoinNetwork,
): ConfigDiagnostic[] {
  const changed = new Set(describeChanges(before, after, network).map((change) => change.key));
  if (addsIncludes(before, after, network)) changed.add('includeconf');
  return [...rpcStillReachable(after, network), ...managedLocks(changed)];
}

function managedLocks(changed: ReadonlySet<string>): ConfigDiagnostic[] {
  return [...MANAGED_SETTINGS].flatMap(([key, reason]) =>
    changed.has(key)
      ? [
          {
            severity: 'error' as const,
            code: 'managed-setting',
            key,
            message: `"${key}" is managed by BTCortex. ${reason}`,
          },
        ]
      : [],
  );
}
