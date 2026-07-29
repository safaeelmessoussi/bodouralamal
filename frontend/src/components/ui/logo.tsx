import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';

/**
 * The association mark. `href` makes it the standard "home" affordance in the
 * header; omitting it renders the mark alone, for pages that already are home.
 */
export function Logo({
  href,
  showText = true,
}: {
  href?: string;
  showText?: boolean;
}): ReactNode {
  const mark = (
    <>
      <img className="logo-link__mark" src="/logo.png" alt="" width={184} height={160} />
      {showText ? (
        <span className="logo-link__text">
          <span className="logo-link__name">{t('app.name')}</span>
          <span className="logo-link__sub">{t('landing.footerCity')}</span>
        </span>
      ) : null}
    </>
  );

  // The image is decorative here because the association name sits beside it as
  // real text; duplicating it in `alt` would make a screen reader say it twice.
  if (!href) return <span className="logo-link">{mark}</span>;
  return (
    <a className="logo-link" href={href}>
      <span className="visually-hidden">{t('app.logoAlt')}</span>
      {mark}
    </a>
  );
}
