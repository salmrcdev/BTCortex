import {
  BitcoinConfig,
  containsSecretPlaceholder,
  describeChanges,
  isSecretOption,
  lookupOption,
  MANAGED_SETTINGS,
  managedSettingChanges,
  OPTION_DEFINITIONS,
  resolveEffective,
  riskyChanges,
  validateConfig,
} from '@btcortex/bitcoin-config';
import type {
  BitcoinNetwork,
  ConfigDiagnostic,
  EffectiveValue,
  OptionCategory,
  OptionDefinition,
  OptionRisk,
  SettingChange,
} from '@btcortex/bitcoin-config';

// Editing model shared by the graphical and the raw editor: both work on the
// same draft text, so switching between them never loses an edit. Validation
// runs here as the user types; the orchestrator repeats it when saving.

export const CATEGORY_ORDER: readonly OptionCategory[] = [
  'chain',
  'storage',
  'indexes',
  'performance',
  'connections',
  'privacy',
  'bandwidth',
  'relay',
  'rpc',
  'wallet',
  'zmq',
  'logging',
  'notifications',
];

export interface DraftAnalysis {
  config: BitcoinConfig;
  effective: Map<string, EffectiveValue>;
  diagnostics: ConfigDiagnostic[];
  changes: SettingChange[];
  risky: { change: SettingChange; risk: OptionRisk }[];
  errorCount: number;
}

export function analyseDraft(saved: string, draft: string, network: BitcoinNetwork, managed: boolean): DraftAnalysis {
  const before = BitcoinConfig.parse(saved);
  const config = BitcoinConfig.parse(draft);
  const diagnostics = [
    ...validateConfig(config, { network, windows: true, managed }),
    ...(managed ? managedSettingChanges(before, config, network) : []),
  ];
  const changes = describeChanges(before, config, network);
  return {
    config,
    effective: resolveEffective(config, network),
    diagnostics,
    changes,
    risky: riskyChanges(changes),
    errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
  };
}

export interface OptionState {
  definition: OptionDefinition;
  /** Effective values from the file; `undefined` when unset, so the default applies. */
  values: string[] | undefined;
  lines: number[];
  ignoredLines: number[];
  /** Set by BTCortex on the command line, which overrides the file. */
  commandLine: string | undefined;
  /** Why the option cannot be edited here, for settings BTCortex relies on. */
  locked: string | undefined;
  hidden: boolean;
  changed: boolean;
  diagnostics: ConfigDiagnostic[];
}

export function optionStates(
  analysis: DraftAnalysis,
  commandLine: readonly { key: string; value: string }[],
  managed: boolean,
): OptionState[] {
  const changed = new Set(analysis.changes.map((change) => change.key));
  return [...OPTION_DEFINITIONS.values()].map((definition) => {
    const effective = analysis.effective.get(definition.key);
    const values = effective && effective.lines.length > 0 ? effective.values : undefined;
    return {
      definition,
      values,
      lines: effective?.lines ?? [],
      ignoredLines: effective?.ignoredLines ?? [],
      commandLine: commandLine.find((option) => option.key === definition.key)?.value,
      locked: managed ? MANAGED_SETTINGS.get(definition.key) : undefined,
      hidden: isSecretOption(definition.key) && (values ?? []).some(containsSecretPlaceholder),
      changed: changed.has(definition.key),
      diagnostics: analysis.diagnostics.filter((diagnostic) => diagnostic.key === definition.key),
    };
  });
}

/** Settings in the file that are not in the catalogue; they are kept as written. */
export function unknownSettings(config: BitcoinConfig): { key: string; value: string; line: number }[] {
  const unknown: { key: string; value: string; line: number }[] = [];
  config.allLines.forEach((line, index) => {
    if (line.kind === 'setting' && !lookupOption(line.key)) {
      unknown.push({ key: line.key, value: line.value, line: index + 1 });
    }
  });
  return unknown;
}

// Changing one option is shared with the orchestrator.
export { setOption } from '@btcortex/bitcoin-config';

/** Character range of a 1-based line in the text, for selecting it in the raw editor. */
export function lineRange(text: string, line: number): { start: number; end: number } {
  let start = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', start);
    if (next === -1) return { start: text.length, end: text.length };
    start = next + 1;
  }
  const end = text.indexOf('\n', start);
  return { start, end: end === -1 ? text.length : end };
}
