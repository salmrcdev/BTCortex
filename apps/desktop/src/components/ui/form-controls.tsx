import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium', className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm placeholder:text-muted-foreground disabled:opacity-50',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}

/** A native select: keyboard and screen-reader behaviour come from the platform. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm placeholder:text-muted-foreground disabled:opacity-50',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn('mt-0.5 size-4 shrink-0 cursor-pointer accent-primary disabled:opacity-50', className)}
      {...props}
    />
  );
}

export function FieldError({ id, children }: { id: string; children: string | undefined }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs text-danger">
      {children}
    </p>
  );
}
