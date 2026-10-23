import { Lock, Pencil, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { containsSecretPlaceholder, interpretBoolean, isSecretOption } from '@btcortex/bitcoin-config';
import type { BitcoinNetwork, OptionDefinition } from '@btcortex/bitcoin-config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { DiagnosticLine, severityRank } from './diagnostic-line';
import type { OptionState } from './config-model';

export interface OptionRowProps {
  state: OptionState;
  network: BitcoinNetwork;
  readOnly: boolean;
  onChange: (key: string, values: string[] | undefined) => void;
  onShowLine: (line: number) => void;
}

/**
 * Text kept while the user types and committed on blur or Enter. Committing on
 * every keystroke would briefly remove the setting (and its comment) whenever
 * the field is emptied on the way to a new value.
 */
function useBufferedText(external: string) {
  const [text, setText] = useState(external);
  const [source, setSource] = useState(external);
  if (external !== source) {
    // The file changed elsewhere (raw editor, discard, save): show the new value.
    setSource(external);
    setText(external);
  }
  return [text, setText] as const;
}

function unitOf(definition: OptionDefinition, t: TFunction): string | undefined {
  if (definition.type === 'feerate') return t('config.unitFeeRate');
  if (definition.type === 'amount') return t('config.unitAmount');
  return definition.unit;
}

function describeDefault(definition: OptionDefinition, t: TFunction): string | undefined {
  if (definition.defaultValue === undefined) return undefined;
  if (definition.type === 'boolean')
    return interpretBoolean(definition.defaultValue) ? t('config.on') : t('config.off');
  const unit = unitOf(definition, t);
  return unit ? `${definition.defaultValue} ${unit}` : definition.defaultValue;
}

interface ControlProps {
  id: string;
  describedBy: string;
  definition: OptionDefinition;
  values: string[] | undefined;
  invalid: boolean;
  disabled: boolean;
  commit: (values: string[] | undefined) => void;
}

function ChoiceControl({ id, describedBy, definition, values, invalid, disabled, commit }: ControlProps) {
  const { t } = useTranslation();
  const isBoolean = definition.type === 'boolean';
  const current = values?.[0];
  const selected = current === undefined ? '' : isBoolean ? (interpretBoolean(current) ? '1' : '0') : current;
  const defaultText = describeDefault(definition, t);
  const choices = isBoolean
    ? [
        { value: '1', label: t('config.on') },
        { value: '0', label: t('config.off') },
      ]
    : (definition.values ?? []).map((value) => ({ value, label: value }));
  // A value outside the known choices stays selectable, so that it is never silently changed.
  if (selected !== '' && !choices.some((choice) => choice.value === selected)) {
    choices.push({ value: selected, label: selected });
  }
  return (
    <NativeSelect
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      disabled={disabled}
      value={selected}
      className="w-56"
      onChange={(event) => {
        commit(event.target.value === '' ? undefined : [event.target.value]);
      }}
    >
      <option value="">
        {defaultText ? t('config.choiceDefaultValue', { value: defaultText }) : t('config.choiceDefault')}
      </option>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Bitcoin Core reads everything after "#" as a comment, so a value cannot contain it. */
function HashError({ id, shown }: { id: string; shown: boolean }) {
  const { t } = useTranslation();
  return shown ? (
    <p id={id} role="alert" className="text-xs text-danger">
      {t('config.hashNotAllowed')}
    </p>
  ) : null;
}

/** A hidden value can only be kept whole: the placeholder alone, or after the user name for rpcauth. */
const WHOLE_PLACEHOLDER = /^(?:[^:]*:)?\[hidden value \d+\]$/;

/** A placeholder with something typed into or around it, which the orchestrator could never put back. */
function editedPlaceholder(value: string): boolean {
  return containsSecretPlaceholder(value) && !WHOLE_PLACEHOLDER.test(value);
}

function HiddenEditedError({ id, shown }: { id: string; shown: boolean }) {
  const { t } = useTranslation();
  return shown ? (
    <p id={id} role="alert" className="text-xs text-danger">
      {t('config.hiddenEdited')}
    </p>
  ) : null;
}

function ListControl({ id, describedBy, values, invalid, disabled, commit }: ControlProps) {
  const external = (values ?? []).join('\n');
  const [text, setText] = useBufferedText(external);
  const [hashRefused, setHashRefused] = useState(false);
  const [placeholderRefused, setPlaceholderRefused] = useState(false);
  const save = () => {
    const entries = text
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    const hash = entries.some((entry) => entry.includes('#'));
    const edited = entries.some(editedPlaceholder);
    setHashRefused(hash);
    setPlaceholderRefused(edited);
    if (hash || edited) return;
    if (entries.join('\n') !== external) commit(entries.length > 0 ? entries : undefined);
  };
  const errors = [hashRefused ? `${id}-hash` : '', placeholderRefused ? `${id}-hidden` : ''].filter(Boolean);
  return (
    <div className="w-full max-w-xl space-y-1">
      <Textarea
        id={id}
        aria-describedby={[describedBy, ...errors].join(' ')}
        aria-invalid={invalid || errors.length > 0}
        disabled={disabled}
        value={text}
        rows={Math.min(8, Math.max(2, (values?.length ?? 0) + 1))}
        spellCheck={false}
        className="font-mono text-[13px]"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={save}
      />
      <HashError id={`${id}-hash`} shown={hashRefused} />
      <HiddenEditedError id={`${id}-hidden`} shown={placeholderRefused} />
    </div>
  );
}

function TextControl({ id, describedBy, definition, values, invalid, disabled, commit }: ControlProps) {
  const { t } = useTranslation();
  const external = values?.[0] ?? '';
  const secret = isSecretOption(definition.key);
  // A hidden value is never put in the field: typing would edit its placeholder instead of replacing it.
  const hidden = secret && containsSecretPlaceholder(external);
  const [text, setText] = useBufferedText(hidden ? '' : external);
  const numeric = definition.type === 'integer' || definition.type === 'feerate' || definition.type === 'amount';
  const unit = unitOf(definition, t);
  const [hashRefused, setHashRefused] = useState(false);
  const save = () => {
    const value = text.trim();
    setHashRefused(value.includes('#'));
    if (value.includes('#')) return;
    // An empty field over a hidden value keeps it; "Use default" removes it.
    if (hidden && value === '') return;
    if (value !== external) commit(value === '' ? undefined : [value]);
  };
  return (
    <div className="max-w-xl space-y-1">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          aria-describedby={hashRefused ? `${describedBy} ${id}-hash` : describedBy}
          aria-invalid={invalid || hashRefused}
          disabled={disabled}
          value={text}
          type={secret ? 'password' : 'text'}
          autoComplete={secret ? 'new-password' : 'off'}
          inputMode={definition.type === 'integer' ? 'numeric' : numeric ? 'decimal' : undefined}
          spellCheck={false}
          placeholder={hidden ? t('config.hiddenKept') : describeDefault(definition, t)}
          className={numeric ? 'w-40 tabular' : 'font-mono text-[13px]'}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
        />
        {unit && <span className="text-muted-foreground">{unit}</span>}
      </div>
      <HashError id={`${id}-hash`} shown={hashRefused} />
    </div>
  );
}

function OptionControl(props: ControlProps) {
  const { type } = props.definition;
  if (type === 'boolean' || type === 'enum') return <ChoiceControl {...props} />;
  if (type === 'list') return <ListControl {...props} />;
  return <TextControl {...props} />;
}

/** One option of the graphical editor: what it does, its value, where it comes from and what is wrong with it. */
export function OptionRow({ state, network, readOnly, onChange, onShowLine }: OptionRowProps) {
  const { t } = useTranslation();
  const id = useId();
  const { definition, values } = state;
  const defaultText = describeDefault(definition, t);
  const firstLine = state.lines[0];
  const risk = definition.risk && definition.risk !== 'normal' ? definition.risk : undefined;
  const diagnostics = [...state.diagnostics].sort((a, b) => severityRank(a) - severityRank(b));
  // The reasons a value is wrong are read out with the control, not only shown below it.
  const describedBy = `${id}-description ${id}-source${diagnostics.length > 0 ? ` ${id}-problems` : ''}`;

  return (
    <div className="space-y-2 border-b py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="font-mono text-[13px] font-medium">
          {definition.key}
        </label>
        {state.changed && (
          <Badge variant="outline">
            <Pencil aria-hidden="true" />
            {t('config.changed')}
          </Badge>
        )}
        {state.locked && (
          <Badge>
            <Lock aria-hidden="true" />
            {t('config.managed')}
          </Badge>
        )}
        {risk && (
          <Badge variant="warning">
            <ShieldAlert aria-hidden="true" />
            {t(`config.risk.${risk}`)}
          </Badge>
        )}
        {definition.removedIn ? (
          <Badge variant="warning">
            <TriangleAlert aria-hidden="true" />
            {t('config.removed', { version: definition.removedIn })}
          </Badge>
        ) : (
          definition.deprecatedIn && (
            <Badge variant="warning">
              <TriangleAlert aria-hidden="true" />
              {t('config.deprecated', { version: definition.deprecatedIn })}
            </Badge>
          )
        )}
      </div>
      <p id={`${id}-description`} className="max-w-3xl text-muted-foreground">
        {definition.description}
        {state.locked && ` ${state.locked}`}
      </p>

      <div className="flex flex-wrap items-start gap-2">
        <OptionControl
          id={id}
          describedBy={describedBy}
          definition={definition}
          values={values}
          invalid={diagnostics.some((diagnostic) => diagnostic.severity === 'error')}
          disabled={readOnly || state.locked !== undefined}
          commit={(next) => {
            onChange(definition.key, next);
          }}
        />
        {values !== undefined && !readOnly && !state.locked && (
          <Button
            variant="ghost"
            onClick={() => {
              onChange(definition.key, undefined);
              // This button disappears with the value; focus goes to the option's control, or back to the search
              // field when the whole row leaves the "in the file" view.
              requestAnimationFrame(() => {
                (document.getElementById(id) ?? document.querySelector<HTMLElement>('[data-config-focus]'))?.focus();
              });
            }}
          >
            {t('config.useDefault')}
          </Button>
        )}
      </div>

      <div id={`${id}-source`} className="space-y-1 text-xs text-muted-foreground">
        {state.hidden && <p>{t('config.hiddenValue')}</p>}
        {definition.type === 'list' && !readOnly && !state.locked && <p>{t('config.listHelp')}</p>}
        {firstLine === undefined ? (
          <p>{defaultText ? t('config.notSetWithDefault', { value: defaultText }) : t('config.notSet')}</p>
        ) : (
          <p>
            <button
              type="button"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              aria-label={t('config.showLine', { line: firstLine })}
              onClick={() => {
                onShowLine(firstLine);
              }}
            >
              {t('config.fromLine', { line: firstLine })}
            </button>
          </p>
        )}
        {state.ignoredLines.length > 0 && (
          <p>{t('config.ignoredLines', { lines: state.ignoredLines.join(', '), network: t(`networks.${network}`) })}</p>
        )}
        {state.commandLine !== undefined && (
          <p>{t('config.commandLine', { key: definition.key, value: state.commandLine })}</p>
        )}
      </div>
      {diagnostics.length > 0 && (
        <ul id={`${id}-problems`} className="space-y-1">
          {diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.code}-${String(diagnostic.line)}`}>
              <DiagnosticLine diagnostic={diagnostic} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
