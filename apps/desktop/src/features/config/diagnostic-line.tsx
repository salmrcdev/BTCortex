import { CircleX, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigDiagnostic } from '@btcortex/bitcoin-config';
import { cn } from '@/lib/utils';

const ICONS = { error: CircleX, warning: TriangleAlert, information: Info } as const;
const TONES = { error: 'text-danger', warning: 'text-warning', information: 'text-info' } as const;

/** A configuration check, with its severity in words as well as by icon and colour. */
export function DiagnosticLine({ diagnostic, location }: { diagnostic: ConfigDiagnostic; location?: ReactNode }) {
  const { t } = useTranslation();
  const Icon = ICONS[diagnostic.severity];
  return (
    <p className="flex items-start gap-2 text-sm">
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', TONES[diagnostic.severity])} />
      <span className="min-w-0">
        <span className="font-medium">{t(`config.severity.${diagnostic.severity}`)}</span>
        {location && <> · {location}</>}: {diagnostic.message}
      </span>
    </p>
  );
}

export function severityRank(diagnostic: ConfigDiagnostic): number {
  return diagnostic.severity === 'error' ? 0 : diagnostic.severity === 'warning' ? 1 : 2;
}
