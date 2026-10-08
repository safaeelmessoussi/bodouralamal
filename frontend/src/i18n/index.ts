import { ar, type Catalog } from './ar.js';

/**
 * Translation lookup (SRS §6, §16.2). Every string resolves through a key.
 *
 * **SRS Revision 209 — the public pages read in seven languages** (the Owner,
 * 2026-10-08: الرئيسية، الجدول الزمني، المحتوى التعليمي «to english, french,
 * amazigh …, german, spanish»). Arabic is the source and the fallback: a key a
 * translation lacks reads in Arabic rather than as its key. Which language a
 * page uses is decided once, before it renders (`lib/locale.ts`) — every other
 * page of the platform stays Arabic.
 */
export const LOCALES = ['ar', 'en', 'fr', 'es', 'de', 'zgh', 'shi-Latn'] as const;
export type Locale = (typeof LOCALES)[number];

/** A translation: the Arabic catalogue's keys, flattened (`nav.home`). */
export type FlatCatalog = Readonly<Record<string, string | readonly string[]>>;

const translations: Partial<Record<Locale, FlatCatalog>> = {};
let active: Locale = 'ar';

/** The language this page renders in. */
export function activeLocale(): Locale {
  return active;
}

/** Called once before the first render (`lib/locale.ts`). */
export function applyLocale(locale: Locale, catalog: FlatCatalog | null): void {
  if (catalog) translations[locale] = catalog;
  active = catalog || locale === 'ar' ? locale : 'ar';
}

function fromArabic(path: string): unknown {
  let node: unknown = ar;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function lookup(path: string, locale: Locale): unknown {
  if (locale !== 'ar') {
    const translated = translations[locale]?.[path];
    if (translated !== undefined) return translated;
  }
  return fromArabic(path);
}

/** Dot-path getter — `t('auth.pendingTitle')`. Missing keys return the key
 *  itself, which is loud in the UI rather than silently blank. */
export function t(path: string, locale: Locale = active): string {
  const node = lookup(path, locale);
  return typeof node === 'string' ? node : path;
}

export type { Catalog };

/**
 * List lookup — month and weekday names are ordered data, not sentences, so
 * they live in the catalogue as arrays and are read through here rather than by
 * building a key per index.
 */
export function tList(path: string, locale: Locale = active): string[] {
  const node = lookup(path, locale);
  return Array.isArray(node) ? [...(node as string[])] : [];
}
