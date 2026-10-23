import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Placeholder shown while real data loads; never a substitute for data. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
