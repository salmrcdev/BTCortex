import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AddressCheck,
  DescriptorAnalysis,
  NodeWithStatus,
  PsbtAnalysis,
  RawTransactionCheck,
  ScriptSummary,
} from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/form-controls';
import { RadioCards } from '@/components/ui/radio-cards';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBitcoin, formatNumber, formatSatPerVb } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';
import { FollowButton, SendButton, TrackedTransactions } from './send';
import { JsonInspector } from './shared';
import { AddressCheckResult } from './uri-tab';
import { replacementPolicy, TransactionAnalysisView } from './transaction-analysis-view';

// Decoding with the node (specification sections 14 and 15): raw
// transactions (checked against the mempool, sent only when the user confirms
// it), scripts, PSBTs (combined and finalised by the node), output
// descriptors and addresses. Each answer comes from the node itself.

const KINDS = ['transaction', 'script', 'psbt', 'descriptor', 'address'] as const;
type Kind = (typeof KINDS)[number];

type Outcome =
  | { kind: 'transaction'; value: RawTransactionCheck }
  | { kind: 'script'; value: ScriptSummary }
  | { kind: 'psbt'; value: PsbtAnalysis; psbt: string; combined: boolean }
  | { kind: 'descriptor'; value: DescriptorAnalysis }
  | { kind: 'address'; value: AddressCheck };

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TransactionResult({ value, node }: { value: RawTransactionCheck; node: NodeWithStatus }) {
  const { t } = useTranslation();
  const { transaction, acceptance } = value;
  return (
    <div className="space-y-4">
      <Facts
        items={[
          [
            t('developer.decode.txid'),
            <CopyableValue key="txid" value={transaction.txid} label={t('developer.decode.txid')} />,
          ],
          [
            t('developer.decode.size'),
            t('developer.decode.sizeValue', {
              bytes: formatNumber(transaction.sizeBytes),
              vbytes: formatNumber(transaction.vsize),
              weight: formatNumber(transaction.weight),
            }),
          ],
          [t('developer.decode.version'), String(transaction.version)],
          [t('developer.decode.segwit'), transaction.segwit ? t('developer.yes') : t('developer.no')],
          [
            t('developer.decode.fee'),
            transaction.feeSats === null
              ? t('developer.decode.feeUnknown')
              : `${formatBitcoin(transaction.feeSats)} (${formatSatPerVb(transaction.feeRate ?? 0)})`,
          ],
        ]}
      />
      {acceptance && (
        <StatusIndicator
          tone={acceptance.allowed ? 'healthy' : 'attention'}
          label={
            acceptance.allowed
              ? t('developer.decode.accepted')
              : t('developer.decode.rejected', { reason: acceptance.reason ?? '' })
          }
        />
      )}
      <div className="flex flex-wrap gap-2">
        <SendButton node={node} check={value} />
        {transaction.status.state === 'mempool' && <FollowButton nodeId={node.profile.id} txid={transaction.txid} />}
      </div>
      <TransactionAnalysisView transaction={transaction} policy={replacementPolicy(node)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('developer.decode.output')}</TableHead>
            <TableHead>{t('developer.decode.address')}</TableHead>
            <TableHead>{t('developer.decode.type')}</TableHead>
            <TableHead className="text-right">{t('developer.decode.amount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transaction.outputs.map((output) => (
            <TableRow key={output.n}>
              <TableCell className="tabular">{output.n}</TableCell>
              <TableCell className="break-all font-mono text-[12px]">{output.script.address ?? '—'}</TableCell>
              <TableCell>{output.script.type}</TableCell>
              <TableCell className="tabular text-right">{formatBitcoin(output.valueSats)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <JsonInspector value={transaction} label={t('developer.decode.raw')} />
    </div>
  );
}

/** Finalises a signed PSBT and, once it is complete, shows the transaction ready to be checked and sent. */
function PsbtFinalise({ node, psbt }: { node: NodeWithStatus; psbt: string }) {
  const { t } = useTranslation();
  const finalise = useMutation({
    mutationFn: async () => {
      const result = await callOrchestrator('devtools.psbt.finalise', { nodeId: node.profile.id, psbt });
      const check =
        result.complete && result.hex !== null
          ? await callOrchestrator('explorer.decodeRaw', { nodeId: node.profile.id, hex: result.hex })
          : null;
      return { result, check };
    },
  });
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={finalise.isPending}
        onClick={() => {
          finalise.mutate();
        }}
      >
        {t('developer.send.finalise')}
      </Button>
      {finalise.isError && (
        <ErrorPanel title={t('developer.send.finaliseFailed')} error={toOrchestratorError(finalise.error)} />
      )}
      {finalise.data && !finalise.data.result.complete && <Note tone="info">{t('developer.send.incomplete')}</Note>}
      {finalise.data?.check && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="font-medium">{t('developer.send.complete')}</p>
          <CopyableValue value={finalise.data.result.hex ?? ''} label={t('developer.send.hexLabel')} />
          <TransactionResult value={finalise.data.check} node={node} />
        </div>
      )}
    </div>
  );
}

function PsbtResult({
  value,
  psbt,
  combined,
  node,
}: {
  value: PsbtAnalysis;
  psbt: string;
  combined: boolean;
  node: NodeWithStatus;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {combined && (
        <div className="space-y-1">
          <p className="text-muted-foreground">{t('developer.send.combined')}</p>
          <CopyableValue value={psbt} label={t('developer.send.combinedLabel')} />
        </div>
      )}
      <Facts
        items={[
          [t('developer.decode.next'), value.next ?? '—'],
          [
            t('developer.decode.fee'),
            value.feeSats === null ? t('developer.decode.feeUnknown') : formatBitcoin(value.feeSats),
          ],
          [
            t('developer.decode.estimate'),
            value.estimatedVsize === null
              ? '—'
              : t('developer.decode.estimateValue', {
                  vbytes: formatNumber(value.estimatedVsize),
                  rate: value.estimatedFeeRateSatPerVb === null ? '—' : formatSatPerVb(value.estimatedFeeRateSatPerVb),
                }),
          ],
        ]}
      />
      <PsbtFinalise node={node} psbt={psbt} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('developer.decode.input')}</TableHead>
            <TableHead className="text-right">{t('developer.decode.amount')}</TableHead>
            <TableHead>{t('developer.decode.signatures')}</TableHead>
            <TableHead>{t('developer.decode.missing')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {value.inputs.map((input) => (
            <TableRow key={input.outpoint}>
              <TableCell className="break-all font-mono text-[12px]">{input.outpoint}</TableCell>
              <TableCell className="tabular text-right">
                {input.amountSats === null ? '—' : formatBitcoin(input.amountSats)}
              </TableCell>
              <TableCell>{input.final ? t('developer.decode.final') : String(input.partialSignatures)}</TableCell>
              <TableCell>{input.missing.length === 0 ? '—' : input.missing.join(', ')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('developer.decode.address')}</TableHead>
            <TableHead className="text-right">{t('developer.decode.amount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {value.outputs.map((output, index) => (
            <TableRow key={`${String(index)}-${output.address ?? ''}`}>
              <TableCell className="break-all font-mono text-[12px]">
                {output.address ?? output.script ?? '—'}
              </TableCell>
              <TableCell className="tabular text-right">{formatBitcoin(output.amountSats)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <JsonInspector value={value.raw} label={t('developer.decode.raw')} />
    </div>
  );
}

function DescriptorResult({ value }: { value: DescriptorAnalysis }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Facts
        items={[
          [
            t('developer.decode.descriptor'),
            <CopyableValue key="d" value={value.descriptor} label={t('developer.decode.descriptor')} />,
          ],
          [
            t('developer.decode.checksum'),
            <span key="c" className="font-mono">
              {value.checksum}
            </span>,
          ],
          [t('developer.decode.ranged'), value.isRange ? t('developer.yes') : t('developer.no')],
          [t('developer.decode.solvable'), value.isSolvable ? t('developer.yes') : t('developer.no')],
        ]}
      />
      {value.addressesError !== null ? (
        <p className="text-muted-foreground">{t('developer.decode.noAddresses', { reason: value.addressesError })}</p>
      ) : (
        <ol className="space-y-1">
          {value.addresses.map((entry) => (
            <li key={entry.address} className="flex gap-3">
              <span className="w-10 shrink-0 text-right text-muted-foreground tabular">{entry.index ?? '—'}</span>
              <span className="break-all font-mono text-[12px]">{entry.address}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function DecodeTab({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const nodeId = node.profile.id;
  const formId = useId();
  const [kind, setKind] = useState<Kind>('transaction');
  const [input, setInput] = useState('');
  const [count, setCount] = useState('10');
  const decode = useMutation({
    mutationFn: async (): Promise<Outcome> => {
      const text = input.trim();
      switch (kind) {
        case 'transaction':
          return { kind, value: await callOrchestrator('explorer.decodeRaw', { nodeId, hex: text }) };
        case 'script':
          return { kind, value: await callOrchestrator('explorer.decodeScript', { nodeId, hex: text }) };
        case 'psbt': {
          // Several PSBTs of one transaction, one per line, are combined first.
          const psbts = text.split(/\s+/).filter((part) => part !== '');
          if (psbts.length > 1) {
            const combined = await callOrchestrator('devtools.psbt.combine', { nodeId, psbts: psbts.slice(0, 16) });
            return { kind, value: combined.analysis, psbt: combined.psbt, combined: true };
          }
          return {
            kind,
            value: await callOrchestrator('devtools.psbt', { nodeId, psbt: text }),
            psbt: text,
            combined: false,
          };
        }
        case 'descriptor':
          return {
            kind,
            value: await callOrchestrator('devtools.descriptor', {
              nodeId,
              descriptor: text,
              count: Math.min(100, Math.max(1, Number(count) || 1)),
            }),
          };
        case 'address':
          return { kind, value: await callOrchestrator('devtools.address', { nodeId, address: text }) };
      }
    },
  });
  return (
    <div className="space-y-4">
      <RadioCards
        label={t('developer.decode.kind')}
        value={kind}
        onValueChange={(next) => {
          setKind(next);
          decode.reset();
        }}
        className="sm:grid-cols-2 lg:grid-cols-5"
        options={KINDS.map((candidate) => ({
          value: candidate,
          title: t(`developer.decode.kinds.${candidate}`),
          description: t(`developer.decode.hints.${candidate}`),
        }))}
      />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() !== '') decode.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`${formId}-input`}>{t(`developer.decode.inputs.${kind}`)}</Label>
          <Textarea
            id={`${formId}-input`}
            rows={5}
            spellCheck={false}
            className="font-mono text-[12px]"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
          {kind === 'descriptor' && (
            <p className="text-xs text-muted-foreground">{t('developer.decode.noPrivateKeys')}</p>
          )}
        </div>
        {kind === 'descriptor' && (
          <div className="max-w-40 space-y-1">
            <Label htmlFor={`${formId}-count`}>{t('developer.decode.count')}</Label>
            <Input
              id={`${formId}-count`}
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(event) => {
                setCount(event.target.value);
              }}
            />
          </div>
        )}
        <Button type="submit" disabled={input.trim() === '' || decode.isPending}>
          {t('developer.decode.submit')}
        </Button>
      </form>
      {decode.isError && <ErrorPanel title={t('developer.decode.failed')} error={toOrchestratorError(decode.error)} />}
      {decode.data?.kind === 'transaction' && <TransactionResult value={decode.data.value} node={node} />}
      {decode.data?.kind === 'script' && (
        <div className="space-y-4">
          <Facts
            items={[
              [t('developer.decode.type'), decode.data.value.type],
              [t('developer.decode.address'), decode.data.value.address ?? '—'],
              [t('developer.decode.descriptor'), decode.data.value.descriptor ?? '—'],
            ]}
          />
          <JsonInspector value={decode.data.value} label={t('developer.decode.raw')} />
        </div>
      )}
      {decode.data?.kind === 'psbt' && (
        <PsbtResult value={decode.data.value} psbt={decode.data.psbt} combined={decode.data.combined} node={node} />
      )}
      {decode.data?.kind === 'descriptor' && <DescriptorResult value={decode.data.value} />}
      {decode.data?.kind === 'address' && <AddressCheckResult check={decode.data.value} />}
      <TrackedTransactions />
    </div>
  );
}
