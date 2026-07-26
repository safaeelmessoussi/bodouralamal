import { ar, type Catalog } from './ar.js';

/**
 * Translation lookup (SRS §6, §16.2). Arabic-only in MVP, but every string
 * already resolves through a key so the FR/EN catalogues are a content task
 * rather than a code change (§10.1).
 */
const catalogs = { ar } as const;
export type Locale = keyof typeof catalogs;

/** Dot-path getter — `t('auth.pendingTitle')`. Missing keys return the key
 *  itself, which is loud in the UI rather than silently blank. */
export function t(path: string, locale: Locale = 'ar'): string {
  const parts = path.split('.');
  let node: unknown = catalogs[locale];
  for (const part of parts) {
    if (typeof node !== 'object' || node === null || !(part in node)) return path;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : path;
}

export type { Catalog };
