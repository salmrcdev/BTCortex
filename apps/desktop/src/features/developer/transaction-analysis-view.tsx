import { useTranslation } from 'react-i18next';
import type { NodeWithStatus, TransactionDetail } from '@btcortex/contracts';
import { Note } from '@/components/feedback/note';
import { Badge } from '@/components/ui/badge';
import { formatBitcoin, formatDuration, formatNumber, formatPercent, formatTimestamp } from '@/lib/format';
import type { ScriptAnalysis, ScriptTimelock } from '@/lib/script';
import { analyseTransaction, sighashName, unusualSighash } from '@/lib/transaction-analysis';
import type { InputAnalysis, LockTimeAnalysis, SequenceAnalysis, SignatureInfo } from '@/lib/transaction-analysis';

// What a decoded transaction means, next to what the node decoded
// (specification section 14): lock time, replacement, the witness discount,
// what each input spends with its witness and script, and outputs worth a
// remark. Read-only: nothing here signs, finalises or sends.

/** Bitcoin Core 28.0 and later replace unconfirmed transactions whether or not they signal. */
const FULL_RBF_SINCE = 280_000;

export type ReplacementPolicy = 'full' | 'opt-in' | 'knots' | 'unknown';

export function replacementPolicy(node: NodeWithStatus | undefined): ReplacementPolicy {
  if (!node) return 'unknown';
  if (node.profile.implementation === 'bitcoin-knots') return 'knots';
  const version = node.status.snapshot?.network.version;
  if (version === undefined) return 'unknown';
  return version >= FULL_RBF_SINCE ? 'full' : 'opt-in';
}

function useTimelockText() {
  const { t } = useTranslation();
  return (lock: ScriptTimelock): string => {
    switch (lock.kind) {
      case 'absolute-height':
        return t('developer.analysis.afterBlock', { height: formatNumber(lock.height) });
      case 'absolute-time':
        return t('developer.analysis.afterTime', { time: formatTimestamp(new Date(lock.time * 1000)) });
      case 'relative-blocks':
        return t('developer.analysis.relativeBlocks', { count: lock.blocks });
      case 'relative-time':
        return t('developer.analysis.relativeTime', { duration: formatDuration(lock.seconds * 1000) });
    }
  };
}

function LockTime({ lock }: { lock: LockTimeAnalysis }) {
  const { t } = useTranslation();
  if (lock.kind === 'none') return <>{t('developer.analysis.lockNone')}</>;
  const text =
    lock.kind === 'height'
      ? t('developer.analysis.lockHeight', { height: formatNumber(lock.height) })
      : t('developer.analysis.lockTime', { time: formatTimestamp(new Date(lock.time * 1000)) });
  return <>{lock.enforced ? text : t('developer.analysis.lockNotEnforced', { lock: text })}</>;
}

function SequenceText({ sequence }: { sequence: SequenceAnalysis }) {
  const { t } = useTranslation();
  const timelock = useTimelockText();
  const meaning = [
    sequence.final
      ? t('developer.analysis.sequenceFinal')
      : sequence.signalsReplaceable
        ? t('developer.analysis.sequenceReplaceable')
        : t('developer.analysis.sequenceLockOnly'),
    ...(sequence.relative ? [timelock(sequence.relative)] : []),
  ].join('; ');
  return (
    <span>
      <span className="font-mono text-[12px]">{sequence.hex}</span>{' '}
      <span className="text-muted-foreground">{meaning}</span>
    </span>
  );
}

function useSignatureText() {
  const { t } = useTranslation();
  return (signature: SignatureInfo): string =>
    t('developer.analysis.signature', {
      kind: t(`developer.analysis.signatureKinds.${signature.kind}`),
      sighash: sighashName(signature.sighash),
    });
}

function ScriptFacts({ script }: { script: ScriptAnalysis & { role: 'redeem' | 'witness' | 'tapscript' } }) {
  const { t } = useTranslation();
  const timelock = useTimelockText();
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">{t(`developer.analysis.scriptRoles.${script.role}`)}</p>
      {script.multisig && (
        <p>
          {t(
            script.multisig.form === 'checksigadd'
              ? 'developer.analysis.multisigTapscript'
              : 'developer.analysis.multisig',
            { required: script.multisig.required, total: script.multisig.keys.length },
          )}
        </p>
      )}
      {script.timelocks.length > 0 && (
        <p>{t('developer.analysis.scriptLocks', { locks: script.timelocks.map(timelock).join('; ') })}</p>
      )}
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-2 font-mono text-[12px]">
        {script.asm}
      </pre>
    </div>
  );
}

function InputItem({ input, transaction }: { input: InputAnalysis; transaction: TransactionDetail }) {
  const { t } = useTranslation();
  const signatureText = useSignatureText();
  const source = transaction.inputs[input.index];
  const unusual = input.signatures.filter(unusualSighash);
  const details = input.witness.length > 0 || input.script !== null || input.taproot !== null;
  const leafVersion = input.taproot?.leafVersion ?? null;
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular text-muted-foreground">#{input.index}</span>
        <span className="font-medium">{t(`developer.analysis.spendTypes.${input.spends}`)}</span>
        {input.inferred && input.spends !== 'unknown' && (
          <Badge variant="outline">{t('developer.analysis.inferred')}</Badge>
        )}
        {source?.prevout && <span className="tabular">{formatBitcoin(source.prevout.valueSats)}</span>}
      </div>
      {source?.previous && (
        <p className="break-all font-mono text-[12px] text-muted-foreground">
          {source.previous.txid}:{source.previous.vout}
        </p>
      )}
      <p>
        <span className="text-muted-foreground">{t('developer.analysis.sequence')}: </span>
        <SequenceText sequence={input.sequence} />
      </p>
      {input.signatures.length > 0 && (
        <p>
          <span className="text-muted-foreground">{t('developer.analysis.signatures')}: </span>
          {input.signatures.map(signatureText).join(', ')}
        </p>
      )}
      {unusual.length > 0 && <Note tone="warning">{t('developer.analysis.unusualSighash')}</Note>}
      {input.taproot?.annex && <Note tone="warning">{t('developer.analysis.annex')}</Note>}
      {details && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer select-none font-medium">
            {input.script?.multisig
              ? t(
                  input.script.multisig.form === 'checksigadd'
                    ? 'developer.analysis.multisigTapscript'
                    : 'developer.analysis.multisig',
                  { required: input.script.multisig.required, total: input.script.multisig.keys.length },
                )
              : t('developer.analysis.details')}
          </summary>
          <div className="mt-3 space-y-3">
            {leafVersion !== null && (
              <p>
                {t('developer.analysis.taproot', {
                  leaf: leafVersion.toString(16),
                  depth: input.taproot?.depth ?? 0,
                })}
                <span className="block break-all font-mono text-[12px] text-muted-foreground">
                  {t('developer.analysis.internalKey', { key: input.taproot?.internalKey ?? '' })}
                </span>
              </p>
            )}
            {input.script && <ScriptFacts script={input.script} />}
            {input.witness.length > 0 && (
              <ol className="space-y-1">
                {input.witness.map((item, index) => (
                  <li
                    key={`${String(index)}-${item.hex.slice(0, 16)}`}
                    className="grid gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)]"
                  >
                    <span className="text-muted-foreground">{t(`developer.analysis.roles.${item.role}`)}</span>
                    <span className="min-w-0">
                      {item.signature && (
                        <span className="block text-muted-foreground">{sighashName(item.signature.sighash)}</span>
                      )}
                      <span className="break-all font-mono text-[12px]">
                        {item.hex === '' ? t('developer.analysis.empty') : item.hex}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

export function TransactionAnalysisView({
  transaction,
  policy,
}: {
  transaction: TransactionDetail;
  policy: ReplacementPolicy;
}) {
  const { t } = useTranslation();
  const analysis = analyseTransaction(transaction);
  const { weight } = analysis;
  const notes = analysis.outputs.filter((output) => output.dust || output.data !== null);
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('developer.analysis.lockTimeLabel')}</dt>
        <dd>
          <LockTime lock={analysis.lockTime} />
        </dd>
        <dt className="text-muted-foreground">{t('developer.analysis.replacement')}</dt>
        <dd className="space-y-1">
          <p>
            {analysis.signalsReplaceable
              ? t('developer.analysis.signals', {
                  count: analysis.replaceableInputs.length,
                  inputs: analysis.replaceableInputs.map((index) => `#${String(index)}`).join(', '),
                })
              : t('developer.analysis.noSignal')}
          </p>
          {policy !== 'unknown' && <p className="text-muted-foreground">{t(`developer.analysis.policy.${policy}`)}</p>}
        </dd>
        <dt className="text-muted-foreground">{t('developer.analysis.weight')}</dt>
        <dd className="space-y-1">
          <p>
            {t('developer.analysis.weightValue', {
              base: formatNumber(weight.baseBytes),
              witness: formatNumber(weight.witnessBytes),
              weight: formatNumber(weight.weight),
              vsize: formatNumber(weight.vsize),
            })}
          </p>
          {weight.savedVbytes > 0 && (
            <p className="text-muted-foreground">
              {t('developer.analysis.discount', {
                saved: formatNumber(weight.savedVbytes),
                share: formatPercent(weight.savedVbytes / transaction.sizeBytes),
              })}
            </p>
          )}
        </dd>
      </dl>
      <div className="space-y-1">
        <h3 className="font-medium">{t('developer.analysis.inputs', { count: analysis.inputs.length })}</h3>
        <ol className="divide-y">
          {analysis.inputs.map((input) => (
            <InputItem key={input.index} input={input} transaction={transaction} />
          ))}
        </ol>
      </div>
      {notes.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-medium">{t('developer.analysis.outputNotes')}</h3>
          <ul className="space-y-1">
            {notes.map((output) => (
              <li key={output.n}>
                <span className="tabular text-muted-foreground">#{output.n} </span>
                {output.dust
                  ? t('developer.analysis.dust', { limit: formatNumber(output.dustLimitSats ?? 0) })
                  : output.data?.text
                    ? t('developer.analysis.dataText', { text: output.data.text })
                    : t('developer.analysis.dataBytes', { count: (output.data?.hex.length ?? 0) / 2 })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
