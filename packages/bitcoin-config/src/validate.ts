import { effectiveScalar, resolveEffective } from './effective';
import type { BitcoinNetwork } from './networks';
import { NETWORK_PARAMETERS } from './networks';
import { interpretBoolean, lookupOption } from './options';
import type { BitcoinConfig } from './parser';

// Checks a configuration the way Bitcoin Core 31.1 would treat it at start-up,
// plus BTCortex safety rules (docs/research/notes/full-nodes-core.md §5.4,
// §6.8). Errors stop the node from starting; warnings are surprising
// behaviour; information explains consequences.

export type DiagnosticSeverity = 'error' | 'warning' | 'information';

export interface ConfigDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  key?: string;
  line?: number;
}

export interface ValidationContext {
  network: BitcoinNetwork;
  /** Bitcoin Core runs on Windows here; some options behave differently. */
  windows?: boolean;
  totalMemoryBytes?: number;
  /** BTCortex supplies datadir on the command line for nodes it manages. */
  managed?: boolean;
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|\[::1\]|localhost)(:\d+)?(\/\d+)?$/i;
const MIN_PRUNE_TARGET_MIB = 550;
const MEMORY_WARNING_FRACTION = 0.75;
const MIB = 1024 * 1024;

function isEnabled(value: string | undefined): boolean {
  return value !== undefined && interpretBoolean(value);
}

export function validateConfig(config: BitcoinConfig, context: ValidationContext): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const add = (diagnostic: ConfigDiagnostic) => diagnostics.push(diagnostic);

  for (const issue of config.issues()) {
    add({ severity: 'error', code: 'parse-error', message: issue.message, line: issue.line });
  }

  config.allLines.forEach((line, index) => {
    if (line.kind !== 'setting') return;
    const lineNumber = index + 1;
    const known = lookupOption(line.key);
    if (!known) {
      add({
        severity: 'warning',
        code: 'unknown-option',
        key: line.key,
        line: lineNumber,
        message: `"${line.key}" is not a Bitcoin Core option that BTCortex knows. Bitcoin Core ignores unknown options in bitcoin.conf, so check the spelling.`,
      });
      return;
    }
    const { definition } = known;

    if (definition.commandLineOnly) {
      add({
        severity: 'error',
        code: 'command-line-only',
        key: definition.key,
        line: lineNumber,
        message: `"${definition.key}" is only valid on the command line; Bitcoin Core refuses to start with it in bitcoin.conf. Use includeconf instead.`,
      });
    }
    if (definition.removedIn) {
      add({
        severity: 'warning',
        code: 'removed-option',
        key: definition.key,
        line: lineNumber,
        message: `"${definition.key}" was removed in Bitcoin Core ${definition.removedIn} and has no effect${definition.replacement ? `; use "${definition.replacement}" instead` : ''}.`,
      });
    } else if (definition.deprecatedIn) {
      add({
        severity: 'warning',
        code: 'deprecated-option',
        key: definition.key,
        line: lineNumber,
        message: `"${definition.key}" is deprecated since Bitcoin Core ${definition.deprecatedIn}${definition.replacement ? `; prefer "${definition.replacement}"` : ''}.`,
      });
    }
    if (definition.oneShot) {
      add({
        severity: 'warning',
        code: 'one-shot-in-file',
        key: definition.key,
        line: lineNumber,
        message: `"${definition.key}" in bitcoin.conf repeats on every start. Run it once from BTCortex instead.`,
      });
    }

    if (!known.negated) {
      if (definition.type === 'boolean' && !/^-?\d+$/.test(line.value)) {
        add({
          severity: 'warning',
          code: 'boolean-format',
          key: definition.key,
          line: lineNumber,
          message: `Bitcoin Core reads "${definition.key}=${line.value}" as a number, so it means ${interpretBoolean(line.value) ? 'on' : 'off'}. Write 1 or 0.`,
        });
      }
      if (definition.type === 'integer') {
        if (!/^-?\d+$/.test(line.value)) {
          add({
            severity: 'error',
            code: 'invalid-integer',
            key: definition.key,
            line: lineNumber,
            message: `"${definition.key}" needs a whole number, not "${line.value}".`,
          });
        } else {
          const number = Number.parseInt(line.value, 10);
          if (definition.minimum !== undefined && number < definition.minimum) {
            add({
              severity: 'error',
              code: 'below-minimum',
              key: definition.key,
              line: lineNumber,
              message: `"${definition.key}" must be at least ${definition.minimum}.`,
            });
          }
          if (definition.maximum !== undefined && number > definition.maximum) {
            add({
              severity: 'error',
              code: 'above-maximum',
              key: definition.key,
              line: lineNumber,
              message: `"${definition.key}" must be at most ${definition.maximum}.`,
            });
          }
        }
      }
      if (definition.type === 'enum' && definition.values && !definition.values.includes(line.value)) {
        add({
          severity: 'error',
          code: 'invalid-choice',
          key: definition.key,
          line: lineNumber,
          message: `"${line.value}" is not a valid value for "${definition.key}". Valid values: ${definition.values.join(', ')}.`,
        });
      }
      if (definition.key === 'onlynet' && !(definition.values ?? []).includes(line.value)) {
        add({
          severity: 'error',
          code: 'invalid-network',
          key: definition.key,
          line: lineNumber,
          message:
            line.value === 'tor'
              ? 'The network name "tor" was removed in Bitcoin Core 31.0; use "onion".'
              : `"${line.value}" is not a network name. Valid names: ipv4, ipv6, onion, i2p, cjdns.`,
        });
      }
    }

    if (definition.networkOnly && line.scope === null && context.network !== 'mainnet') {
      add({
        severity: 'information',
        code: 'network-only-ignored',
        key: definition.key,
        line: lineNumber,
        message: `"${definition.key}" outside a section applies to mainnet only. For ${NETWORK_PARAMETERS[context.network].label}, put it under [${NETWORK_PARAMETERS[context.network].section}].`,
      });
    }
    if (definition.risk === 'executes-commands') {
      add({
        severity: 'warning',
        code: 'executes-commands',
        key: definition.key,
        line: lineNumber,
        message: `"${definition.key}" runs a shell command on this computer whenever the event occurs. Make sure you trust it.`,
      });
    }
    if (definition.key === 'datadir' && context.managed) {
      add({
        severity: 'warning',
        code: 'datadir-in-file',
        key: definition.key,
        line: lineNumber,
        message:
          'datadir inside bitcoin.conf redirects the node elsewhere and makes Bitcoin Core ignore that directory’s own bitcoin.conf. BTCortex passes the data directory itself.',
      });
    }
  });

  const effective = resolveEffective(config, context.network);
  const value = (key: string) => effectiveScalar(effective, key);
  const prune = value('prune');
  const pruneMiB = prune === undefined ? 0 : Number.parseInt(prune, 10);
  const pruned = Number.isFinite(pruneMiB) && pruneMiB > 0;

  if (pruned && pruneMiB > 1 && pruneMiB < MIN_PRUNE_TARGET_MIB) {
    add({
      severity: 'error',
      code: 'prune-too-small',
      key: 'prune',
      message: `A prune target must be at least ${MIN_PRUNE_TARGET_MIB} MiB (or 1 for manual pruning).`,
    });
  }
  for (const index of ['txindex', 'txospenderindex']) {
    if (pruned && isEnabled(value(index))) {
      add({
        severity: 'error',
        code: 'prune-conflict',
        key: index,
        message: `"${index}" cannot be combined with pruning; Bitcoin Core refuses to start.`,
      });
    }
  }
  if (isEnabled(value('peerblockfilters'))) {
    const filters = value('blockfilterindex');
    if (filters === undefined || filters === '0') {
      add({
        severity: 'error',
        code: 'missing-block-filters',
        key: 'peerblockfilters',
        message: 'peerblockfilters needs blockfilterindex=1; Bitcoin Core refuses to start without it.',
      });
    }
  }
  if (context.windows && isEnabled(value('daemon'))) {
    add({
      severity: 'error',
      code: 'daemon-unsupported',
      key: 'daemon',
      message:
        'daemon=1 is not supported on Windows; Bitcoin Core refuses to start. BTCortex runs the node in the background itself.',
    });
  }
  if ((effective.get('rpcwhitelist')?.values.length ?? 0) > 0 && value('rpcwhitelistdefault') !== '0') {
    add({
      severity: 'warning',
      code: 'whitelist-locks-out',
      key: 'rpcwhitelist',
      message:
        'With any rpcwhitelist entry, every other RPC user — including the cookie BTCortex uses — is denied all methods unless rpcwhitelistdefault=0.',
    });
  }
  for (const key of ['rpcbind', 'rpcallowip']) {
    const exposed = (effective.get(key)?.values ?? []).filter((entry) => !LOOPBACK.test(entry));
    if (exposed.length > 0) {
      add({
        severity: 'warning',
        code: 'rpc-exposed',
        key,
        message: `${key}=${exposed.join(', ')} lets other computers reach the RPC interface, which controls the node and its wallets. Prefer an encrypted tunnel.`,
      });
    }
  }
  if (isEnabled(value('rest'))) {
    add({
      severity: 'warning',
      code: 'rest-enabled',
      key: 'rest',
      message:
        'The REST interface needs no authentication, and web pages open in a local browser can read it. Enable it only for a program that needs it.',
    });
  }
  if (value('rpcpassword') !== undefined) {
    add({
      severity: 'information',
      code: 'plaintext-password',
      key: 'rpcpassword',
      message:
        'rpcpassword stores the password in plain text and disables the cookie. rpcauth stores only a salted hash.',
    });
  }
  if (isEnabled(value('blocksonly'))) {
    add({
      severity: 'information',
      code: 'blocksonly-wallets',
      key: 'blocksonly',
      message:
        'blocksonly stops transaction relay: fee estimation has no data and wallets connected to this node broadcast conspicuously.',
    });
  }

  const dbcache = value('dbcache');
  if (dbcache !== undefined && context.totalMemoryBytes !== undefined) {
    const cacheMiB = Number.parseInt(dbcache, 10);
    if (Number.isFinite(cacheMiB) && cacheMiB * MIB > context.totalMemoryBytes * MEMORY_WARNING_FRACTION) {
      add({
        severity: 'warning',
        code: 'dbcache-too-large',
        key: 'dbcache',
        message: `dbcache=${cacheMiB} MiB exceeds 75% of this computer's memory and may cause swapping or crashes.`,
      });
    }
  }

  return diagnostics;
}
