import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyableValue } from '@/components/data/copyable-value';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { formatBitcoin, formatNumber } from '@/lib/format';
import { estimateSize, feeFor, INPUT_TYPES, OUTPUT_TYPES } from '@/lib/transaction-size';
import type { InputType, OutputType } from '@/lib/transaction-size';
import {
  AMOUNT_UNITS,
  convertFeeRate,
  FEE_UNITS,
  formatAmount,
  formatJson,
  hexToText,
  parseAmount,
  reverseBytes,
  textToHex,
} from './convert';
import type { AmountUnit, FeeUnit } from './convert';

// Conversions computed in the window (specification sections 14 and 15):
// amounts between bitcoin units, fee rates, a transaction's size and fee from
// its inputs and outputs, hexadecimal and JSON.

function Results({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tabular">
            <CopyableValue value={value} label={label} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function AmountCard() {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('0.001');
  const [unit, setUnit] = useState<AmountUnit>('btc');
  const parsed = parseAmount(text, unit);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('developer.convert.amount')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
          <Field id={`${id}-value`} label={t('developer.convert.value')}>
            <Input
              id={`${id}-value`}
              inputMode="decimal"
              value={text}
              aria-invalid={'error' in parsed}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </Field>
          <Field id={`${id}-unit`} label={t('developer.convert.unit')}>
            <NativeSelect
              id={`${id}-unit`}
              className="w-full"
              value={unit}
              onChange={(event) => {
                const next = AMOUNT_UNITS.find((candidate) => candidate === event.target.value);
                if (next) setUnit(next);
              }}
            >
              {AMOUNT_UNITS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {t(`developer.convert.units.${candidate}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {'error' in parsed ? (
          <p className="text-sm text-danger">{t(`developer.convert.errors.${parsed.error}`)}</p>
        ) : (
          <Results
            rows={AMOUNT_UNITS.map((candidate) => [
              t(`developer.convert.units.${candidate}`),
              formatAmount(parsed.sats, candidate),
            ])}
          />
        )}
      </CardContent>
    </Card>
  );
}

function FeeCard() {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('10');
  const [unit, setUnit] = useState<FeeUnit>('sat/vB');
  const value = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(value) && value >= 0;
  const converted = valid ? convertFeeRate(value, unit) : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('developer.convert.fee')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
          <Field id={`${id}-value`} label={t('developer.convert.value')}>
            <Input
              id={`${id}-value`}
              inputMode="decimal"
              value={text}
              aria-invalid={!valid}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </Field>
          <Field id={`${id}-unit`} label={t('developer.convert.unit')}>
            <NativeSelect
              id={`${id}-unit`}
              className="w-full"
              value={unit}
              onChange={(event) => {
                const next = FEE_UNITS.find((candidate) => candidate === event.target.value);
                if (next) setUnit(next);
              }}
            >
              {FEE_UNITS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {converted ? (
          <Results
            rows={FEE_UNITS.map((candidate) => [
              candidate,
              formatNumber(converted[candidate], { maximumFractionDigits: candidate === 'BTC/kvB' ? 8 : 3 }),
            ])}
          />
        ) : (
          <p className="text-sm text-danger">{t('developer.convert.errors.not-a-number')}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('developer.convert.feeHint')}</p>
      </CardContent>
    </Card>
  );
}

function HexCard() {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const asHex = text === '' ? '' : textToHex(text);
  const asText = hexToText(text);
  const reversed = reverseBytes(text);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('developer.convert.hex')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field id={`${id}-input`} label={t('developer.convert.hexInput')}>
          <Textarea
            id={`${id}-input`}
            rows={3}
            spellCheck={false}
            className="font-mono text-[12px]"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </Field>
        {text !== '' && (
          <dl className="space-y-2">
            <div>
              <dt className="text-muted-foreground">{t('developer.convert.textAsHex')}</dt>
              <dd className="break-all font-mono text-[12px]">{asHex}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('developer.convert.hexAsText')}</dt>
              <dd className="break-all">
                {'text' in asText ? asText.text : t(`developer.convert.errors.${asText.error}`)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('developer.convert.reversed')}</dt>
              <dd className="break-all font-mono text-[12px]">
                {'hex' in reversed ? reversed.hex : t('developer.convert.errors.not-hex')}
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function JsonCard() {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ json: string } | { error: string }>();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('developer.convert.json')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field id={`${id}-input`} label={t('developer.convert.jsonInput')}>
          <Textarea
            id={`${id}-input`}
            rows={5}
            spellCheck={false}
            className="font-mono text-[12px]"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult(undefined);
            }}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={text.trim() === ''}
            onClick={() => {
              setResult(formatJson(text, 2));
            }}
          >
            {t('developer.convert.prettify')}
          </Button>
          <Button
            variant="outline"
            disabled={text.trim() === ''}
            onClick={() => {
              setResult(formatJson(text, 0));
            }}
          >
            {t('developer.convert.minify')}
          </Button>
        </div>
        {result !== undefined &&
          ('json' in result ? (
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[12px]">
              {result.json}
            </pre>
          ) : (
            <p className="text-sm text-danger">{t('developer.convert.invalidJson', { reason: result.error })}</p>
          ))}
      </CardContent>
    </Card>
  );
}

const count = (text: string) => {
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null;
};

/** A transaction's size and fee from how many inputs and outputs of each type it has. */
function SizeCard() {
  const { t } = useTranslation();
  const id = useId();
  const [inputs, setInputs] = useState<Record<InputType, string>>({
    p2pkh: '0',
    'p2sh-p2wpkh': '0',
    p2wpkh: '1',
    p2tr: '0',
  });
  const [outputs, setOutputs] = useState<Record<OutputType, string>>({
    p2pkh: '0',
    p2sh: '0',
    p2wpkh: '2',
    p2wsh: '0',
    p2tr: '0',
  });
  const [rate, setRate] = useState('5');
  const inputCounts = Object.fromEntries(INPUT_TYPES.map((type) => [type, count(inputs[type])]));
  const outputCounts = Object.fromEntries(OUTPUT_TYPES.map((type) => [type, count(outputs[type])]));
  const feeRate = Number(rate);
  const valid =
    Object.values(inputCounts).every((value) => value !== null) &&
    Object.values(outputCounts).every((value) => value !== null) &&
    rate.trim() !== '' &&
    Number.isFinite(feeRate) &&
    feeRate >= 0;
  const size = valid ? estimateSize(inputCounts, outputCounts) : null;
  const fee = size === null ? null : feeFor(size.vsize, feeRate);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{t('developer.convert.size.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="font-medium">{t('developer.convert.size.inputs')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {INPUT_TYPES.map((type) => (
              <Field key={type} id={`${id}-in-${type}`} label={t(`developer.convert.size.inputTypes.${type}`)}>
                <Input
                  id={`${id}-in-${type}`}
                  inputMode="numeric"
                  value={inputs[type]}
                  aria-invalid={inputCounts[type] === null}
                  onChange={(event) => {
                    setInputs({ ...inputs, [type]: event.target.value });
                  }}
                />
              </Field>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="font-medium">{t('developer.convert.size.outputs')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {OUTPUT_TYPES.map((type) => (
              <Field key={type} id={`${id}-out-${type}`} label={t(`developer.convert.size.outputTypes.${type}`)}>
                <Input
                  id={`${id}-out-${type}`}
                  inputMode="numeric"
                  value={outputs[type]}
                  aria-invalid={outputCounts[type] === null}
                  onChange={(event) => {
                    setOutputs({ ...outputs, [type]: event.target.value });
                  }}
                />
              </Field>
            ))}
          </div>
        </fieldset>
        <div className="max-w-48">
          <Field id={`${id}-rate`} label={t('developer.convert.size.rate')}>
            <Input
              id={`${id}-rate`}
              inputMode="decimal"
              value={rate}
              aria-invalid={!Number.isFinite(feeRate) || feeRate < 0}
              onChange={(event) => {
                setRate(event.target.value);
              }}
            />
          </Field>
        </div>
        {size !== null && fee !== null ? (
          <Results
            rows={[
              [t('developer.convert.size.vsize'), `${formatNumber(size.vsize)} vB`],
              [t('developer.convert.size.weight'), `${formatNumber(size.weight)} WU`],
              [t('developer.convert.size.fee'), `${formatNumber(fee)} sats (${formatBitcoin(fee)})`],
            ]}
          />
        ) : (
          <p className="text-sm text-danger">{t('developer.convert.size.invalid')}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('developer.convert.size.hint')}</p>
      </CardContent>
    </Card>
  );
}

export function ConvertTab() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <AmountCard />
      <FeeCard />
      <SizeCard />
      <HexCard />
      <JsonCard />
    </div>
  );
}
