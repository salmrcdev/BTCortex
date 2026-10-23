import type { BitcoinNetwork, ConfigSection } from './networks';
import { NETWORK_PARAMETERS } from './networks';
import type { OptionDefinition } from './options';
import { OPTION_DEFINITIONS } from './options';
import { BitcoinConfig } from './parser';

// Changing one option the way a careful person would by hand, shared by the
// configuration editor and the orchestrator's guided changes: the value goes
// where Bitcoin Core reads it for this network, comments and other lines stay
// as they are, and negations that would override it are removed.

/** Network sections whose settings apply to this node, in Bitcoin Core's order of precedence. */
function applicableScopes(network: BitcoinNetwork): [ConfigSection, null] {
  return [NETWORK_PARAMETERS[network].section, null];
}

/** Where a change goes: the scope its current value comes from, or the natural one for a new setting. */
function targetScope(config: BitcoinConfig, definition: OptionDefinition, network: BitcoinNetwork) {
  const [section] = applicableScopes(network);
  if (config.valuesIn(definition.key, { scope: section }).length > 0) return section;
  // Network-only options outside a section apply to mainnet only.
  if (definition.networkOnly && network !== 'mainnet') return section;
  return null;
}

/**
 * Sets an option for the node's network (or removes it, so the default
 * applies, when `values` is `undefined`). Comments and other lines stay as
 * they are; a value already in the file is changed in place.
 */
export function setOption(
  text: string,
  key: string,
  values: readonly string[] | undefined,
  network: BitcoinNetwork,
): string {
  const definition = OPTION_DEFINITIONS.get(key);
  if (!definition) return text;
  const config = BitcoinConfig.parse(text);
  const scopes = applicableScopes(network);
  // A negation (nofoo=1) would override the new value, and is meaningless once the default applies.
  for (const scope of scopes) config.unset(`no${key}`, { scope });

  if (values === undefined) {
    for (const scope of scopes) config.unset(key, { scope });
    return config.toString();
  }
  const scope = targetScope(config, definition, network);
  if (definition.type === 'list') {
    // List values from both scopes add up, so the new list must be the only one.
    for (const other of scopes) if (other !== scope) config.unset(key, { scope: other });
    config.setList(key, values, { scope });
  } else {
    config.set(key, values[0] ?? '', { scope });
  }
  return config.toString();
}
