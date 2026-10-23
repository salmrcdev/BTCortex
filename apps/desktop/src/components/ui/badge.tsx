import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted text-foreground',
        outline: 'border-input text-foreground',
        success: 'border-success/40 bg-success/10 text-foreground',
        warning: 'border-warning/40 bg-warning/10 text-foreground',
        danger: 'border-danger/40 bg-danger/10 text-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
