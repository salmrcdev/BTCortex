import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScriptSummary } from '@btcortex/contracts';
import { formatBitcoin, formatNumber, formatSatPerVb, truncateMiddle } from '@/lib/format';
import { cn } from '@/lib/utils';

// Small pieces the explorer's views share: links between blocks,
// transactions and addresses (always on the same node), amounts, and
// details that open on request.

export function TransactionLink({ nodeId, txid, full = false }: { nodeId: string; txid: string; full?: boolean }) {
  return (
    <Link
      to="/explorer"
      search={{ node: nodeId, tx: txid }}
      title={txid}
      className={cn('font-mono text-[13px] underline-offset-2 hover:underline', full && 'break-all')}
    >
      {full ? txid : truncateMiddle(txid, 10, 10)}
    </Link>
  );
}

export function BlockLink({ nodeId, hash, height }: { nodeId: string; hash: string; height?: number }) {
  return (
    <Link
      to="/explorer"
      search={{ node: nodeId, block: hash }}
      title={hash}
      className="tabular underline-offset-2 hover:underline"
    >
      {height === undefined ? truncateMiddle(hash, 10, 10) : formatNumber(height)}
    </Link>
  );
}

export function AddressLink({ nodeId, address }: { nodeId: string; address: string }) {
  return (
    <Link
      to="/explorer"
      search={{ node: nodeId, address }}
      title={address}
      className="break-all font-mono text-[13px] underline-offset-2 hover:underline"
    >
      {address}
    </Link>
  );
}

export function Amount({ sats, className }: { sats: number; className?: string }) {
  return <span className={cn('tabular whitespace-nowrap', className)}>{formatBitcoin(sats)}</span>;
}

export function FeeRate({ value }: { value: number | null }) {
  return <span className="tabular whitespace-nowrap">{value === null ? '—' : formatSatPerVb(value)}</span>;
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">{children}</dl>;
}

/** A script's opcodes and hex, shown on request. */
export function ScriptDetails({ script, label }: { script: ScriptSummary; label: string }) {
  const { t } = useTranslation();
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground">{label}</summary>
      <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('explorer.scriptType')}</dt>
        <dd className="font-mono">{script.type}</dd>
        <dt className="text-muted-foreground">{t('explorer.scriptAsm')}</dt>
        <dd className="break-all font-mono">{script.asm === '' ? '—' : script.asm}</dd>
        <dt className="text-muted-foreground">{t('explorer.scriptHex')}</dt>
        <dd className="break-all font-mono">{script.hex === '' ? '—' : script.hex}</dd>
        {script.descriptor !== undefined && (
          <>
            <dt className="text-muted-foreground">{t('explorer.descriptor')}</dt>
            <dd className="break-all font-mono">{script.descriptor}</dd>
          </>
        )}
      </dl>
    </details>
  );
}
