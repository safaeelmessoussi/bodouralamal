import type { ReactNode } from 'react';

import { LOCALES, activeLocale, t } from '../../i18n/index.js';
import { LOCALE_NAMES, LOCALE_SHORT, LOCALE_TAGS, chooseLocale, translatesHere } from '../../lib/locale.js';
import { Menu, MenuOption } from './menu.js';

/**
 * **SRS Revision 209 — the language menu**, on the three public pages only
 * (الرئيسية، الجدول الزمني، المحتوى التعليمي): every language named in its own
 * script, the current one checked. Choosing one keeps it on the device and
 * reloads the page in it; nothing else on the platform changes language.
 */
export function LanguageMenu({
  inline = false,
  compact = false,
}: {
  inline?: boolean;
  /** A phone's header: the trigger shows a short mark (ES, ⵜⵎⵣ…); the list keeps the names. */
  compact?: boolean;
}): ReactNode {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
  if (!translatesHere(pathname)) return null;
  const current = activeLocale();
  return (
    <div className="language-menu">
      <Menu label={t('nav.language')} triggerLabel={compact ? LOCALE_SHORT[current] : LOCALE_NAMES[current]} inline={inline}>
        {(close) =>
          LOCALES.map((locale) => (
            <span key={locale} lang={LOCALE_TAGS[locale]} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
              <MenuOption
                label={LOCALE_NAMES[locale]}
                selected={locale === current}
                onSelect={() => {
                  close();
                  if (locale !== current) chooseLocale(locale);
                }}
              />
            </span>
          ))
        }
      </Menu>
    </div>
  );
}
