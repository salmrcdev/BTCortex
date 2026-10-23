import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { PsbtReview } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { chooseFileToSave } from '@/lib/dialogs';
import { formatBitcoin, formatSatPerVb, formatSats, truncateMiddle } from '@/lib/format';
import { QrFrames } from './qr';
import type { QrFrame } from './qr';
import { usePsbtActions, useQrEncode, useWalletActions } from './queries';

// A transaction before it is signed or sent (specification section 9: PSBT
// import and export). What it pays, to whom, what comes back as change and
// the fee are shown before anything happens; signing and broadcasting are
// separate, explicit steps, and the device shows the transaction again
// before it signs.

const PSBT_FILES = [
  { name: 'PSBT', extensions: ['psbt'] },
  { name: 'Text (base64)', extensions: ['txt'] },
];

export function PsbtReviewTable({ review }: { review: PsbtReview }) {
  const { t } = useTranslation();
  const spent = review.inputs.reduce((total, input) => total + (input.amountSats ?? 0), 0);
  return (
    <div className="space-y-3">
      <StatusIndicator
        tone={review.complete ? 'healthy' : 'attention'}
        label={review.complete ? t('hardware.psbt.complete') : t('hardware.psbt.needsSignatures')}
        className="font-medium"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('hardware.psbt.paysTo')}</TableHead>
            <TableHead className="text-right">{t('hardware.psbt.amount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {review.outputs.map((output, index) => (
            <TableRow key={`${output.address ?? 'script'}-${String(index)}`}>
              <TableCell>
                <span className="flex flex-wrap items-center gap-2">
                  {output.address ? (
                    <CopyableValue value={output.address} label={t('hardware.psbt.paysTo')} className="max-w-full" />
                  ) : (
                    <span className="text-muted-foreground">{t('hardware.psbt.script')}</span>
                  )}
                  {output.ownedByWallet && <Badge variant="neutral">{t('hardware.psbt.change')}</Badge>}
                </span>
              </TableCell>
              <TableCell className="tabular text-right">{formatBitcoin(output.amountSats)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t('hardware.psbt.inputs')}</dt>
        <dd className="tabular">
          {t('hardware.psbt.inputsValue', { count: review.inputs.length, amount: formatBitcoin(spent) })}
        </dd>
        {review.feeSats !== null && (
          <>
            <dt className="text-muted-foreground">{t('hardware.psbt.fee')}</dt>
            <dd className="tabular">
              {formatSats(review.feeSats)}
              {review.feeRateSatPerVb !== null && ` · ${formatSatPerVb(review.feeRateSatPerVb)}`}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** Saving, signing on the device and broadcasting, each as its own step. */
export function PsbtActions({
  nodeId,
  wallet,
  review,
  hex,
  onSigned,
}: {
  nodeId: string;
  /** The hardware-wallet wallet whose device can sign; without one, the PSBT can only be saved or sent. */
  wallet?: string;
  review: PsbtReview;
  hex: string | null;
  onSigned: (review: PsbtReview, hex: string | null) => void;
}) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const psbt = usePsbtActions(nodeId);
  const signer = useWalletActions(nodeId, wallet ?? '');
  const encode = useQrEncode();
  const [txid, setTxid] = useState<string>();
  const [frames, setFrames] = useState<QrFrame[]>();

  const save = async () => {
    const path = await chooseFileToSave('transaction.psbt', PSBT_FILES);
    if (path === null) return;
    psbt.writeFile.mutate(
      { path, psbt: review.psbt },
      { onSuccess: () => toast.success(t('hardware.psbt.saved')), onError },
    );
  };

  if (txid) {
    return (
      <div className="space-y-1">
        <StatusIndicator tone="healthy" label={t('hardware.psbt.broadcast')} className="font-medium" />
        <CopyableValue value={txid} label={t('hardware.psbt.txid')} className="max-w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {signer.sign.isPending && (
        <StatusIndicator tone="working" label={t('hardware.psbt.confirmOnDevice')} className="font-medium" />
      )}
      <div className="flex flex-wrap gap-2">
        {wallet !== undefined && !review.complete && (
          <ConfirmButton
            label={t('hardware.psbt.sign')}
            title={t('hardware.psbt.signTitle')}
            confirmLabel={t('hardware.psbt.signConfirm')}
            disabled={signer.sign.isPending}
            onConfirm={() => {
              signer.sign.mutate(review.psbt, {
                onSuccess: (signed) => {
                  onSigned(signed.review, signed.hex);
                  void signer.refresh();
                },
                onError,
              });
            }}
          >
            <p>{t('hardware.psbt.signBody')}</p>
          </ConfirmButton>
        )}
        <Button variant="outline" disabled={psbt.writeFile.isPending} onClick={() => void save()}>
          {t('hardware.psbt.save')}
        </Button>
        <Button
          variant="outline"
          disabled={encode.isPending}
          onClick={() => {
            if (frames) {
              setFrames(undefined);
              return;
            }
            encode.mutate(review.psbt, {
              onSuccess: ({ frames: made }) => {
                setFrames(made);
              },
              onError,
            });
          }}
        >
          {frames ? t('hardware.qr.hide') : t('hardware.qr.show')}
        </Button>
        {hex !== null && (
          <ConfirmButton
            label={t('hardware.psbt.send')}
            title={t('hardware.psbt.sendTitle')}
            confirmLabel={t('hardware.psbt.sendConfirm')}
            destructive
            disabled={psbt.broadcast.isPending}
            onConfirm={() => {
              psbt.broadcast.mutate(hex, {
                onSuccess: ({ txid: sent }) => {
                  setTxid(sent);
                  toast.success(t('hardware.psbt.broadcastToast', { txid: truncateMiddle(sent) }));
                  void signer.refresh();
                },
                onError,
              });
            }}
          >
            <p>{t('hardware.psbt.sendBody')}</p>
          </ConfirmButton>
        )}
      </div>
      {frames && (
        <div className="space-y-1">
          <p className="max-w-prose text-muted-foreground">{t('hardware.qr.showHint')}</p>
          <QrFrames frames={frames} />
        </div>
      )}
    </div>
  );
}
