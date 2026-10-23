import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A radio group rendered as selectable cards. Radix supplies arrow-key
// navigation and the radio semantics; the cards are only presentation.

export interface RadioCardOption<T extends string> {
  value: T;
  title: string;
  description: string;
  badge?: ReactNode;
}

export interface RadioCardsProps<T extends string> {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly RadioCardOption<T>[];
  className?: string;
}

export function RadioCards<T extends string>({ label, value, onValueChange, options, className }: RadioCardsProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        onValueChange(next as T);
      }}
      className={cn('grid gap-2', className)}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors duration-150 hover:bg-muted',
            'data-[state=checked]:border-primary data-[state=checked]:bg-primary/5',
          )}
        >
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input"
          >
            <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-medium">
              {option.title}
              {option.badge}
            </span>
            <span className="mt-0.5 block text-muted-foreground">{option.description}</span>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
