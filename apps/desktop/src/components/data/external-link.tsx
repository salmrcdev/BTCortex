import { Copy, ExternalLink as ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { isOnionAddress, openExternal, opensInBrowser } from '@/lib/external';
import { cn } from '@/lib/utils';

type CopyReason = 'onion' | 'notHttps' | 'notOpened';

/**
 * A link to an outside website, opened in the user's browser rather than
 * inside BTCortex. An address BTCortex does not open there (an onion service,
 * or one without https such as a device on the local network) is copied
 * instead, and the user is told why and where to open it.
 */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  const opens = opensInBrowser(href);
  const copy = async (reason: CopyReason) => {
    const copied = await navigator.clipboard.writeText(href).then(
      () => true,
      () => false,
    );
    toast.info(t(`externalLink.${reason}`), {
      description: copied ? t('externalLink.copied', { address: href }) : href,
    });
  };
  return (
    <a
      href={href}
      className={cn('inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline', className)}
      onClick={(event) => {
        event.preventDefault();
        if (!opens) {
          void copy(isOnionAddress(href) ? 'onion' : 'notHttps');
          return;
        }
        void openExternal(href).catch(() => copy('notOpened'));
      }}
    >
      {children}
      {opens ? (
        <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="sr-only">{t(opens ? 'catalogue.opensInBrowser' : 'externalLink.copiesAddress')}</span>
    </a>
  );
}
