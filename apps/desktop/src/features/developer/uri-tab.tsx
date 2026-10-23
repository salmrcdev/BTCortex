import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AddressCheck, ParsedPaymentUri } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/form-controls';
import { QrCode } from '@/features/hardware/qr';
import { formatBitcoin } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';
import { parseAmount } from './convert';

// Payment URIs by BIP 321 (specification section 14): made for an address the
// node accepts, with a QR code, and read back with every field explained.
// Reading a URI never pays, opens its callback or sends anything.

/** The address with the characters the node found wrong marked; addresses are ASCII, so positions are characters. */
export function AddressWithErrors({ check }: { check: AddressCheck }) {
  const wrong = new Set(check.errorLocations);
  const characters = Array.from({ length: check.address.length }, (_, index) => check.address.charAt(index));
  return (
    <span className="break-all font-mono text-[12px]">
      {characters.map((character, index) =>
        wrong.has(index) ? (
          <mark key={index} className="rounded-sm bg-danger/25 text-foreground underline decoration-danger">
            {character}
          </mark>
        ) : (
          character
        ),
      )}
    </span>
  );
}

export function AddressCheckResult({ check }: { check: AddressCheck }) {
  const { t } = useTranslation();
  if (!check.valid) {
    return (
      <div className="space-y-1">
        <StatusIndicator tone="attention" label={t('developer.uri.addressRefused', { reason: check.error ?? '' })} />
        {check.errorLocations.length > 0 && (
          <p>
            {t('developer.uri.errorsAt')} <AddressWithErrors check={check} />
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <StatusIndicator
        tone="healthy"
        label={t('developer.uri.addressValid', { type: t(`developer.uri.types.${check.type ?? 'unknown'}`) })}
      />
      {check.scriptPubKey !== null && (
        <p className="text-muted-foreground">
          {t('developer.uri.script')} <span className="break-all font-mono text-[12px]">{check.scriptPubKey}</span>
        </p>
      )}
      {check.witnessVersion !== null && (
        <p className="text-muted-foreground">
          {t('developer.uri.witness', { version: check.witnessVersion })}{' '}
          <span className="break-all font-mono text-[12px]">{check.witnessProgram}</span>
        </p>
      )}
    </div>
  );
}

function MakeUri({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const parsedAmount = amount.trim() === '' ? null : parseAmount(amount, 'btc');
  const amountError = parsedAmount !== null && 'error' in parsedAmount ? parsedAmount.error : null;
  const make = useMutation({
    mutationFn: () =>
      callOrchestrator('devtools.uri.create', {
        nodeId,
        address: address.trim(),
        ...(parsedAmount !== null && 'sats' in parsedAmount && parsedAmount.sats > 0
          ? { amountSats: parsedAmount.sats }
          : {}),
        ...(label.trim() === '' ? {} : { label: label.trim() }),
        ...(message.trim() === '' ? {} : { message: message.trim() }),
      }),
  });
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('developer.uri.make')}</CardTitle>
          <CardDescription>{t('developer.uri.makeHint')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim() !== '' && amountError === null) make.mutate();
          }}
        >
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor={`${id}-address`}>{t('developer.uri.address')}</Label>
            <Input
              id={`${id}-address`}
              spellCheck={false}
              className="font-mono"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-amount`}>{t('developer.uri.amount')}</Label>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              aria-invalid={amountError !== null}
              aria-describedby={amountError === null ? undefined : `${id}-amount-error`}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
            {amountError !== null && (
              <p id={`${id}-amount-error`} className="text-xs text-danger">
                {t(`developer.convert.errors.${amountError}`)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-label`}>{t('developer.uri.label')}</Label>
            <Input
              id={`${id}-label`}
              maxLength={200}
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor={`${id}-message`}>{t('developer.uri.message')}</Label>
            <Input
              id={`${id}-message`}
              maxLength={500}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />
          </div>
          <div>
            <Button type="submit" disabled={address.trim() === '' || amountError !== null || make.isPending}>
              {t('developer.uri.makeSubmit')}
            </Button>
          </div>
        </form>
        {make.isError && <ErrorPanel title={t('developer.uri.makeFailed')} error={toOrchestratorError(make.error)} />}
        {make.data && (
          <div className="flex flex-wrap items-start gap-6">
            <QrCode frame={make.data.qr} label={t('developer.uri.qrLabel')} />
            <div className="min-w-0 flex-1 space-y-3">
              <CopyableValue value={make.data.uri} label={t('developer.uri.uri')} />
              <AddressCheckResult check={make.data.address} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ParsedUri({ value }: { value: ParsedPaymentUri }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    ...(value.amountSats === null
      ? []
      : [[t('developer.uri.amount'), formatBitcoin(value.amountSats)] as [string, string]]),
    ...(value.label === null ? [] : [[t('developer.uri.label'), value.label] as [string, string]]),
    ...(value.message === null ? [] : [[t('developer.uri.message'), value.message] as [string, string]]),
  ];
  return (
    <div className="space-y-3">
      {value.problems.length === 0 ? (
        value.addressCheck?.valid === false ? (
          <StatusIndicator tone="attention" label={t('developer.uri.badAddress')} />
        ) : (
          <StatusIndicator tone="healthy" label={t('developer.uri.valid')} />
        )
      ) : (
        <div className="space-y-1">
          <StatusIndicator tone="attention" label={t('developer.uri.invalid')} />
          <ul className="list-disc space-y-1 pl-5">
            {value.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('developer.uri.address')}</dt>
        <dd className="min-w-0 space-y-1">
          {value.address === null ? (
            <span className="text-muted-foreground">{t('developer.uri.noAddress')}</span>
          ) : (
            <>
              <span className="block break-all font-mono text-[12px]">{value.address}</span>
              {value.addressCheck && <AddressCheckResult check={value.addressCheck} />}
            </>
          )}
        </dd>
        {rows.map(([name, text]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="min-w-0 break-words">{text}</dd>
          </div>
        ))}
        {value.instructions.map((instruction, index) => (
          <div key={`${instruction.key}-${String(index)}`} className="contents">
            <dt className="text-muted-foreground">{t(`developer.uri.instructions.${instruction.kind}`)}</dt>
            <dd className="min-w-0 break-all font-mono text-[12px]">{instruction.value}</dd>
          </div>
        ))}
        {value.ignored.map((parameter, index) => (
          <div key={`${parameter.key}-${String(index)}`} className="contents">
            <dt className="text-muted-foreground">{t('developer.uri.ignored', { key: parameter.key })}</dt>
            <dd className="min-w-0 break-all">{parameter.value}</dd>
          </div>
        ))}
      </dl>
      {value.proofOfPayment && (
        <Note tone="info">
          {t(value.proofOfPayment.required ? 'developer.uri.popRequired' : 'developer.uri.pop', {
            callback: value.proofOfPayment.callback,
          })}
        </Note>
      )}
    </div>
  );
}

function ReadUri({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [uri, setUri] = useState('');
  const read = useMutation({ mutationFn: () => callOrchestrator('devtools.uri.read', { nodeId, uri: uri.trim() }) });
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('developer.uri.read')}</CardTitle>
          <CardDescription>{t('developer.uri.readHint')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (uri.trim().length >= 8) read.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`${id}-uri`}>{t('developer.uri.uri')}</Label>
            <Textarea
              id={`${id}-uri`}
              rows={3}
              spellCheck={false}
              className="font-mono text-[12px]"
              value={uri}
              onChange={(event) => {
                setUri(event.target.value);
              }}
            />
          </div>
          <Button type="submit" disabled={uri.trim().length < 8 || read.isPending}>
            {t('developer.uri.readSubmit')}
          </Button>
        </form>
        {read.isError && <ErrorPanel title={t('developer.uri.readFailed')} error={toOrchestratorError(read.error)} />}
        {read.data && <ParsedUri value={read.data} />}
      </CardContent>
    </Card>
  );
}

export function UriTab({ nodeId }: { nodeId: string }) {
  return (
    <div className="space-y-6">
      <MakeUri nodeId={nodeId} />
      <ReadUri nodeId={nodeId} />
    </div>
  );
}
