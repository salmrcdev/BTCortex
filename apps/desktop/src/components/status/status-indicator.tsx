import { CircleCheck, CircleDashed, CircleHelp, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Status vocabulary from design-system/btcortex/MASTER.md: colour, icon and
// label always together, never colour alone.

export type StatusTone = 'healthy' | 'working' | 'attention' | 'failed' | 'inactive' | 'unknown';

const TONES: Record<StatusTone, { icon: LucideIcon; className: string; spin?: boolean }> = {
  healthy: { icon: CircleCheck, className: 'text-success' },
  working: { icon: LoaderCircle, className: 'text-info', spin: true },
  attention: { icon: TriangleAlert, className: 'text-warning' },
  failed: { icon: CircleX, className: 'text-danger' },
  inactive: { icon: CircleDashed, className: 'text-muted-foreground' },
  unknown: { icon: CircleHelp, className: 'text-muted-foreground' },
};

export interface StatusIndicatorProps {
  tone: StatusTone;
  label: string;
  className?: string;
}

export function StatusIndicator({ tone, label, className }: StatusIndicatorProps) {
  const { icon: Icon, className: toneClass, spin } = TONES[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} data-tone={tone}>
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', toneClass, spin && 'motion-safe:animate-spin')} />
      <span>{label}</span>
    </span>
  );
}
