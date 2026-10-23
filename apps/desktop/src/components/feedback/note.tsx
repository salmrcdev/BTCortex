import { Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/** A short explanation next to what it is about: information, or something to watch out for. */
export function Note({ tone, children }: { tone: 'info' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <p className="flex max-w-prose items-start gap-2">
      <Icon
        aria-hidden="true"
        className={tone === 'info' ? 'mt-0.5 size-4 shrink-0 text-info' : 'mt-0.5 size-4 shrink-0 text-warning'}
      />
      <span>{children}</span>
    </p>
  );
}
