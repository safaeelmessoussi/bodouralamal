import {
  setHumanityDictionary,
  type ContentDictionary,
} from '../components/history/humanity-i18n.js';
import { LOCALES, applyLocale, type FlatCatalog, type Locale } from '../i18n/index.js';
import { resolveRoute } from './route.js';

/**
 * **SRS Revision 209 — which language a page reads in.**
 *
 * Only the three public pages translate — الرئيسية، الجدول الزمني، المحتوى
 * التعليمي; every other page (sign-in, the portals, the back office) stays in
 * Arabic, whatever was chosen. A choice is kept on the device and may travel
 * in a link (`?lang=en`); Arabic is the default and the fallback. Pages load by
 * full navigation, so the language is settled once, before the first render,
 * and a change reloads the page.
 */
const STORAGE_KEY = 'bodour.locale';

/** What the language menu offers, each in its own language and script. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  ar: 'العربية',
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  zgh: 'ⵜⴰⵎⴰⵣⵉⵖⵜ',
  'shi-Latn': 'Tachelḥit',
};

/** A short mark for a narrow header (a phone), where a full name does not fit. */
export const LOCALE_SHORT: Readonly<Record<Locale, string>> = {
  ar: 'ع',
  en: 'EN',
  fr: 'FR',
  es: 'ES',
  de: 'DE',
  zgh: 'ⵜⵎⵣ',
  'shi-Latn': 'TAŠ',
};

/** The BCP 47 tag the document carries (`<html lang>`). */
export const LOCALE_TAGS: Readonly<Record<Locale, string>> = {
  ar: 'ar',
  en: 'en',
  fr: 'fr',
  es: 'es',
  de: 'de',
  zgh: 'zgh-Tfng',
  'shi-Latn': 'shi-Latn',
};

export function isLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && (LOCALES as readonly string[]).includes(value);
}

/** The pages that translate. */
export function translatesHere(pathname: string): boolean {
  const route = resolveRoute(pathname);
  return route === 'landing' || route === 'calendar' || route === 'resources';
}

/**
 * The language for this page: Arabic off the public pages; on them, the
 * link's `?lang=` first, then the device's choice, then Arabic.
 */
export function resolveLocale(pathname: string, search: string, stored: string | null): Locale {
  if (!translatesHere(pathname)) return 'ar';
  const asked = new URLSearchParams(search).get('lang');
  if (isLocale(asked)) return asked;
  if (isLocale(stored)) return stored;
  return 'ar';
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // A private window: the link's ?lang= still carries the choice.
  }
}

/** The translations, one file per language, fetched only when chosen. */
const CATALOGS = import.meta.glob<FlatCatalog>('../i18n/locales/*.json', { import: 'default' });
/** «نظرة شاملة»'s text, fetched only on the library page that shows it. */
const CONTENT = import.meta.glob<ContentDictionary>('../components/history/locales/*.json', {
  import: 'default',
});

/**
 * Settle this page's language before it renders: load the translation, set
 * `<html lang dir>`. A translation that fails to load leaves the page Arabic.
 */
export async function prepareLocale(): Promise<Locale> {
  const { pathname, search } = window.location;
  const asked = new URLSearchParams(search).get('lang');
  if (translatesHere(pathname) && isLocale(asked)) store(asked);
  const wanted = resolveLocale(pathname, search, readStored());
  let catalog: FlatCatalog | null = null;
  if (wanted !== 'ar') {
    try {
      const [ui, content] = await Promise.all([
        CATALOGS[`../i18n/locales/${wanted}.json`]?.(),
        resolveRoute(pathname) === 'resources'
          ? CONTENT[`../components/history/locales/${wanted}.json`]?.()
          : undefined,
      ]);
      catalog = ui ?? null;
      setHumanityDictionary(catalog ? (content ?? null) : null);
    } catch {
      catalog = null;
    }
  }
  applyLocale(wanted, catalog);
  const locale = catalog || wanted === 'ar' ? wanted : 'ar';
  document.documentElement.lang = LOCALE_TAGS[locale];
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  return locale;
}

/** The language menu's action: keep the choice, carry it in the address, reload. */
export function chooseLocale(locale: Locale): void {
  store(locale);
  const url = new URL(window.location.href);
  if (locale === 'ar') url.searchParams.delete('lang');
  else url.searchParams.set('lang', locale);
  window.location.assign(url.toString());
}
