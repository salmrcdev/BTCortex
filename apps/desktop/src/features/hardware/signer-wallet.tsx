import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { PsbtReview, SignerAddressType } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBitcoin, formatDate, truncateMiddle } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useMempoolOverview } from '@/features/mempool/queries';
import { parseBitcoinAmount, parseFeeRate } from './amounts';
import { PsbtActions, PsbtReviewTable } from './psbt';
import { useSignerWallet, useWalletActions } from './queries';

// One hardware-wallet wallet on the node: what it holds, receiving with the
// address checked on the device, and sending through review, signing on the
// device and broadcasting, each as its own step.

const DEFAULT_FEE_TARGET = 6;

function Receive({ nodeId, wallet, types }: { nodeId: string; wallet: string; types: readonly SignerAddressType[] }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const actions = useWalletActions(nodeId, wallet);
  const [type, setType] = useState<SignerAddressType>(types.includes('bech32') ? 'bech32' : (types[0] ?? 'bech32'));
  const [address, setAddress] = useState<string>();
  const [checked, setChecked] = useState(false);
  const selectId = useId();
  return (
    <section className="space-y-3" aria-labelledby={`${selectId}-heading`}>
      <h3 id={`${selectId}-heading`} className="font-medium">
        {t('hardware.wallet.receiveTitle')}
      </h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={selectId}>{t('hardware.wallet.addressType')}</Label>
          <NativeSelect
            id={selectId}
            value={type}
            onChange={(event) => {
              setType(event.currentTarget.value as SignerAddressType);
            }}
          >
            {types.map((option) => (
              <option key={option} value={option}>
                {t(`hardware.addressTypes.${option}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="outline"
          disabled={actions.newAddress.isPending}
          onClick={() => {
            actions.newAddress.mutate(type, {
              onSuccess: ({ address: created }) => {
                setAddress(created);
                setChecked(false);
              },
              onError,
            });
          }}
        >
          {t('hardware.wallet.newAddress')}
        </Button>
      </div>
      {address && (
        <div className="space-y-2">
          <CopyableValue value={address} label={t('hardware.wallet.address')} className="max-w-full" />
          <p className="max-w-prose text-muted-foreground">{t('hardware.wallet.checkOnDevice')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={actions.displayAddress.isPending}
              onClick={() => {
                actions.displayAddress.mutate(address, {
                  onSuccess: () => {
                    setChecked(true);
                    toast.success(t('hardware.wallet.shownOnDevice'));
                  },
                  onError,
                });
              }}
            >
              {t('hardware.wallet.showOnDevice')}
            </Button>
            {actions.displayAddress.isPending && (
              <StatusIndicator tone="working" label={t('hardware.wallet.lookAtDevice')} />
            )}
            {checked && <StatusIndicator tone="healthy" label={t('hardware.wallet.deviceMatched')} />}
          </div>
        </div>
      )}
    </section>
  );
}

function Send({ nodeId, wallet }: { nodeId: string; wallet: string }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const actions = useWalletActions(nodeId, wallet);
  const mempool = useMempoolOverview(nodeId, true);
  const suggested = mempool.data?.estimates.find((estimate) => estimate.target === DEFAULT_FEE_TARGET)?.satPerVb;
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [feeRate, setFeeRate] = useState<string>();
  const [touched, setTouched] = useState({ address: false, amount: false, fee: false });
  const [review, setReview] = useState<PsbtReview>();
  const [hex, setHex] = useState<string | null>(null);
  const ids = { address: useId(), amount: useId(), fee: useId() };

  const feeText =
    feeRate ?? (suggested === undefined || suggested === null ? '' : String(Math.max(1, Math.ceil(suggested))));
  const amountSats = parseBitcoinAmount(amount);
  const fee = parseFeeRate(feeText);
  const errors = {
    address: address.trim().length < 14 ? t('hardware.send.addressError') : undefined,
    amount: amountSats === null ? t('hardware.send.amountError') : undefined,
    fee: fee === null ? t('hardware.send.feeError') : undefined,
  };
  const valid = errors.address === undefined && errors.amount === undefined && errors.fee === undefined;

  if (review) {
    return (
      <section className="space-y-3">
        <h3 className="font-medium">{t('hardware.send.reviewTitle')}</h3>
        <PsbtReviewTable review={review} />
        <PsbtActions
          nodeId={nodeId}
          wallet={wallet}
          review={review}
          hex={hex}
          onSigned={(signed, signedHex) => {
            setReview(signed);
            setHex(signedHex);
          }}
        />
        <Button
          variant="ghost"
          onClick={() => {
            setReview(undefined);
            setHex(null);
          }}
        >
          {t('hardware.send.startOver')}
        </Button>
      </section>
    );
  }

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched({ address: true, amount: true, fee: true });
        if (!valid || amountSats === null || fee === null) return;
        actions.createPsbt.mutate(
          { outputs: [{ address: address.trim(), amountSats }], feeRateSatPerVb: fee },
          { onSuccess: setReview, onError },
        );
      }}
    >
      <h3 className="font-medium">{t('hardware.send.title')}</h3>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1">
          <Label htmlFor={ids.address}>{t('hardware.send.address')}</Label>
          <Input
            id={ids.address}
            value={address}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            aria-invalid={touched.address && errors.address !== undefined}
            aria-describedby={`${ids.address}-error`}
            onChange={(event) => {
              setAddress(event.currentTarget.value);
            }}
            onBlur={() => {
              setTouched((previous) => ({ ...previous, address: true }));
            }}
          />
          <FieldError id={`${ids.address}-error`}>{touched.address ? errors.address : undefined}</FieldError>
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.amount}>{t('hardware.send.amount')}</Label>
          <Input
            id={ids.amount}
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.001"
            className="tabular"
            aria-invalid={touched.amount && errors.amount !== undefined}
            aria-describedby={`${ids.amount}-error`}
            onChange={(event) => {
              setAmount(event.currentTarget.value);
            }}
            onBlur={() => {
              setTouched((previous) => ({ ...previous, amount: true }));
            }}
          />
          <FieldError id={`${ids.amount}-error`}>{touched.amount ? errors.amount : undefined}</FieldError>
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.fee}>{t('hardware.send.feeRate')}</Label>
          <Input
            id={ids.fee}
            value={feeText}
            inputMode="decimal"
            autoComplete="off"
            className="tabular"
            aria-invalid={touched.fee && errors.fee !== undefined}
            aria-describedby={`${ids.fee}-hint ${ids.fee}-error`}
            onChange={(event) => {
              setFeeRate(event.currentTarget.value);
            }}
            onBlur={() => {
              setTouched((previous) => ({ ...previous, fee: true }));
            }}
          />
          <p id={`${ids.fee}-hint`} className="text-xs text-muted-foreground">
            {suggested === undefined || suggested === null
              ? t('hardware.send.feeHintNone')
              : t('hardware.send.feeHint', { blocks: DEFAULT_FEE_TARGET })}
          </p>
          <FieldError id={`${ids.fee}-error`}>{touched.fee ? errors.fee : undefined}</FieldError>
        </div>
      </div>
      <Button type="submit" disabled={actions.createPsbt.isPending}>
        {t('hardware.send.review')}
      </Button>
    </form>
  );
}

export function SignerWalletCard({ nodeId, wallet }: { nodeId: string; wallet: string }) {
  const { t } = useTranslation();
  const detail = useSignerWallet(nodeId, wallet);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hardware.wallet.title', { name: wallet })}</CardTitle>
        {detail.data?.fingerprint && (
          <span className="font-mono text-xs text-muted-foreground">{detail.data.fingerprint}</span>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {detail.isError ? (
          <ErrorPanel
            title={t('hardware.wallet.unavailable')}
            error={toOrchestratorError(detail.error)}
            onRetry={() => void detail.refetch()}
          />
        ) : !detail.data ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('hardware.wallet.balance')}</dt>
              <dd className="tabular font-medium">{formatBitcoin(detail.data.balanceSats)}</dd>
              {detail.data.pendingSats !== 0 && (
                <>
                  <dt className="text-muted-foreground">{t('hardware.wallet.pending')}</dt>
                  <dd className="tabular">{formatBitcoin(detail.data.pendingSats)}</dd>
                </>
              )}
              {detail.data.immatureSats !== 0 && (
                <>
                  <dt className="text-muted-foreground">{t('hardware.wallet.immature')}</dt>
                  <dd className="tabular">{formatBitcoin(detail.data.immatureSats)}</dd>
                </>
              )}
            </dl>
            {detail.data.pruned && (
              <p className="max-w-prose text-muted-foreground">{t('hardware.wallet.prunedNote')}</p>
            )}
            <Receive nodeId={nodeId} wallet={wallet} types={detail.data.addressTypes} />
            <Send nodeId={nodeId} wallet={wallet} />
            <section className="space-y-2">
              <h3 className="font-medium">{t('hardware.wallet.transactionsTitle')}</h3>
              {detail.data.transactions.length === 0 ? (
                <p className="text-muted-foreground">{t('hardware.wallet.noTransactions')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('hardware.wallet.date')}</TableHead>
                      <TableHead className="text-right">{t('hardware.wallet.amount')}</TableHead>
                      <TableHead className="text-right">{t('hardware.wallet.confirmations')}</TableHead>
                      <TableHead>{t('hardware.wallet.transaction')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.data.transactions.slice(0, 25).map((transaction) => (
                      <TableRow key={`${transaction.txid}-${transaction.category}-${String(transaction.amountSats)}`}>
                        <TableCell>{formatDate(transaction.time)}</TableCell>
                        <TableCell className="tabular text-right">{formatBitcoin(transaction.amountSats)}</TableCell>
                        <TableCell className="tabular text-right">{transaction.confirmations}</TableCell>
                        <TableCell>
                          <span className="font-mono text-[13px]" title={transaction.txid}>
                            {truncateMiddle(transaction.txid)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
