import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Stat tile contract (dataviz skill): label in sentence case without a colon,
// value in the UI sans at semibold with proportional figures, optional context
// line. No chart: the number is the figure.

export interface StatTileProps {
  label: string;
  value: ReactNode;
  context?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, context, className }: StatTileProps) {
  return (
    <div className={cn('rounded-lg border bg-card p-3', className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-tight">{value}</p>
      {context !== undefined && <div className="mt-1 text-xs text-muted-foreground">{context}</div>}
    </div>
  );
}
