import type { BitcoinNetwork, ConfigSection } from './networks';
import { NETWORK_PARAMETERS } from './networks';
import { interpretBoolean, lookupOption } from './options';
import type { BitcoinConfig, SettingLine } from './parser';

// Effective values as Bitcoin Core resolves them from bitcoin.conf for one
// network, following common::GetSetting and common::GetSettingsList
// (src/common/settings.cpp) and InterpretValue (src/common/args.cpp) step by
// step, because the locks and risk checks are only as good as this model:
// - `nofoo=1` (or `nofoo=`) is a negation; `nofoo=0` is a double negative,
//   the same as `foo=1`;
// - within one scope, everything up to the scope's last negation is dropped,
//   and a scope that ends with a negation turns the option off;
// - single-value options take the first remaining value of the first scope
//   that has one (the network section before the global scope), except the
//   chain selectors, which take the last value and are read from the global
//   scope only;
// - list options gather the remaining values of both scopes, unless the
//   network section ends negated and empty;
// - network-only options ignore the global scope on test networks, except a
//   global negation of a single-value option, which still applies.
// settings.json and command-line arguments override all of this; callers
// layer those on top when they know them.

/** Bitcoin Core reads these from the global scope only, and the last value wins. */
const CHAIN_SELECTORS = new Set(['chain', 'testnet', 'testnet4', 'signet', 'regtest']);

export interface EffectiveValue {
  key: string;
  /** Single value for scalar options; every value for list options. */
  values: string[];
  /** Line numbers (1-based) that contributed. */
  lines: number[];
  /** Assignments that exist but do not apply (shadowed, dropped or out of scope). */
  ignoredLines: number[];
  /** The option is switched off by a negation. */
  negated: boolean;
}

interface IndexedSetting {
  line: SettingLine;
  number: number;
  key: string;
  negated: boolean;
}

/** One assignment as Bitcoin Core stores it: a value, or `false` for a negation. */
interface Assignment {
  number: number;
  value: string | false;
}

/** SettingsSpan: the assignments of one scope. */
interface Span {
  /** The values after the scope's last negation. */
  after: { number: number; value: string }[];
  /** The scope's last negation, if any. */
  negation: Assignment | undefined;
  /** The scope ends with a negation. */
  lastNegated: boolean;
  /** The scope takes part at all. */
  present: boolean;
}

function indexSettings(config: BitcoinConfig): IndexedSetting[] {
  const indexed: IndexedSetting[] = [];
  config.allLines.forEach((line, index) => {
    if (line.kind !== 'setting') return;
    const known = lookupOption(line.key);
    indexed.push({
      line,
      number: index + 1,
      key: known ? known.definition.key : line.key,
      negated: known?.negated ?? false,
    });
  });
  return indexed;
}

function assignmentOf(setting: IndexedSetting): Assignment {
  if (!setting.negated) return { number: setting.number, value: setting.line.value };
  // InterpretValue: a negation with a true (or empty) value is false; "nofoo=0" is a double negative.
  return { number: setting.number, value: interpretBoolean(setting.line.value) ? false : '1' };
}

function spanOf(settings: readonly IndexedSetting[]): Span {
  const assignments = settings.map(assignmentOf);
  let last = -1;
  assignments.forEach((assignment, index) => {
    if (assignment.value === false) last = index;
  });
  const after = assignments
    .slice(last + 1)
    .flatMap((assignment) =>
      assignment.value === false ? [] : [{ number: assignment.number, value: assignment.value }],
    );
  return {
    after,
    negation: last === -1 ? undefined : assignments[last],
    lastNegated: assignments.length > 0 && assignments.at(-1)?.value === false,
    present: assignments.length > 0,
  };
}

export function resolveEffective(config: BitcoinConfig, network: BitcoinNetwork): Map<string, EffectiveValue> {
  const section: ConfigSection = NETWORK_PARAMETERS[network].section;
  const result = new Map<string, EffectiveValue>();
  const byKey = new Map<string, IndexedSetting[]>();
  for (const setting of indexSettings(config)) {
    const list = byKey.get(setting.key) ?? [];
    list.push(setting);
    byKey.set(setting.key, list);
  }

  for (const [key, settings] of byKey) {
    const definition = lookupOption(key)?.definition;
    const chainSelector = CHAIN_SELECTORS.has(key);
    const networkSpan = spanOf(chainSelector ? [] : settings.filter((setting) => setting.line.scope === section));
    const globalSpan = spanOf(settings.filter((setting) => setting.line.scope === null));
    const ignoreGlobal = definition?.networkOnly === true && network !== 'mainnet';
    const effective: EffectiveValue = { key, values: [], lines: [], ignoredLines: [], negated: false };

    if (definition?.type === 'list') {
      // GetSettingsList, for configuration-file sources.
      let done = false;
      let negatedAndEmpty = false;
      for (const [span, isGlobal] of [
        [networkSpan, false],
        [globalSpan, true],
      ] as const) {
        if (isGlobal && ignoreGlobal) continue;
        if (!done || !negatedAndEmpty) {
          effective.values.push(...span.after.map((entry) => entry.value));
          effective.lines.push(...span.after.map((entry) => entry.number));
        }
        done ||= span.negation !== undefined;
        negatedAndEmpty ||= span.lastNegated && effective.values.length === 0;
        if (span.negation && effective.values.length === 0) effective.negated = true;
      }
    } else {
      // GetSetting: the network section first, then the global scope.
      for (const [span, isGlobal] of [
        [networkSpan, false],
        [globalSpan, true],
      ] as const) {
        if (isGlobal && ignoreGlobal && !span.lastNegated) continue;
        const chosen = chainSelector ? span.after.at(-1) : span.after[0];
        if (!span.lastNegated && chosen) {
          effective.values = [chosen.value];
          effective.lines = [chosen.number];
          break;
        }
        if (span.lastNegated && span.negation) {
          effective.values = ['0'];
          effective.lines = [span.negation.number];
          effective.negated = true;
          break;
        }
      }
    }

    const used = new Set(effective.lines);
    effective.ignoredLines = settings.map((setting) => setting.number).filter((number) => !used.has(number));
    result.set(key, effective);
  }
  return result;
}

/** Convenience accessor for a scalar option. */
export function effectiveScalar(effective: Map<string, EffectiveValue>, key: string): string | undefined {
  const value = effective.get(key);
  return value && value.lines.length > 0 ? value.values[0] : undefined;
}
