import { cn } from '@/lib/utils';

// Meter and progress track (dataviz skill): the fill carries severity, the
// unfilled track is a lighter step of the same hue, and the value is always
// stated in text next to it.

export type MeterTone = 'info' | 'warning' | 'danger' | 'success' | 'primary';

const FILL: Record<MeterTone, string> = {
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  success: 'bg-success',
  primary: 'bg-primary',
};

const TRACK: Record<MeterTone, string> = {
  info: 'bg-info/20',
  warning: 'bg-warning/20',
  danger: 'bg-danger/20',
  success: 'bg-success/20',
  primary: 'bg-primary/20',
};

/** Capacity severity: normal, then warning from 80 %, danger from 95 %. */
export function capacityTone(fraction: number): MeterTone {
  if (fraction >= 0.95) return 'danger';
  if (fraction >= 0.8) return 'warning';
  return 'info';
}

export interface MeterProps {
  /** 0 to 1. */
  value: number;
  label: string;
  /** Human-readable value, announced by assistive technology. */
  valueText: string;
  tone?: MeterTone;
  role?: 'meter' | 'progressbar';
  className?: string;
}

export function Meter({ value, label, valueText, tone = 'info', role = 'meter', className }: MeterProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      role={role}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 1000) / 10}
      aria-valuetext={valueText}
      className={cn('h-1.5 w-full overflow-hidden rounded-full', TRACK[tone], className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', FILL[tone])}
        style={{ width: `${(clamped * 100).toFixed(2)}%` }}
      />
    </div>
  );
}
