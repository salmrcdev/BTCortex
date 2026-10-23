import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

// Where a nested page sits (specification section 24): the links above it,
// then the page itself. Only pages below a sidebar area carry a trail.

export function Breadcrumbs({ trail, current }: { trail: readonly ReactElement[]; current: string | undefined }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('app.breadcrumb')}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {trail.map((link, index) => (
          // The trail is fixed per page, so positions are stable keys.
          <Fragment key={index}>
            <li className="[&_a]:underline-offset-2 [&_a]:transition-colors [&_a]:duration-150 [&_a:hover]:text-foreground [&_a:hover]:underline">
              {link}
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
          </Fragment>
        ))}
        {current !== undefined && (
          <li aria-current="page" className="font-medium text-foreground">
            {current}
          </li>
        )}
      </ol>
    </nav>
  );
}
