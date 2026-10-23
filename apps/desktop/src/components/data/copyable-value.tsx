import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const COPIED_FEEDBACK_MS = 1500;

export interface CopyableValueProps {
  value: string;
  /** Accessible name of the value, used for the copy button label. */
  label: string;
  /** Where a value too long for its room is shortened; paths keep their end, which tells them apart. */
  truncate?: 'end' | 'start';
  className?: string;
}

/** A technical value in monospace with a copy action (specification section 24.2). */
export function CopyableValue({ value, label, truncate = 'end', className }: CopyableValueProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_FEEDBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  };

  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', className)}>
      {truncate === 'start' ? (
        // Right-to-left only so that the ellipsis comes first; the value itself stays left-to-right.
        <span dir="rtl" className="truncate text-left font-mono text-[13px]" title={value}>
          <bdi dir="ltr">{value}</bdi>
        </span>
      ) : (
        <span className="truncate font-mono text-[13px]" title={value}>
          {value}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`${t('common.copy')}: ${label}`}
            onClick={() => void copy()}
          >
            {copied ? <Check aria-hidden="true" className="text-success" /> : <Copy aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? t('common.copied') : t('common.copy')}</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite">
        {copied ? t('common.copied') : ''}
      </span>
    </span>
  );
}
