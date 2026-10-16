import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';

/**
 * **SRS Revision 224 §4 — the stored texts in the reader's language.** The
 * dictionary of one language: Arabic text → its translation (`{x}` sources
 * are patterns the client fills). Public: it holds only what the public pages
 * already show in Arabic — names and titles, never a person's name.
 */
export const TRANSLATED_LOCALES = ['en', 'fr', 'es', 'de', 'zgh', 'shi-Latn'] as const;
export type TranslatedLocale = (typeof TRANSLATED_LOCALES)[number];

export async function dictionaryFor(prisma: PrismaClient, locale: string): Promise<Record<string, string>> {
  if (!(TRANSLATED_LOCALES as readonly string[]).includes(locale)) {
    throw new AppError('VALIDATION_FAILED', 'unknown locale');
  }
  const rows = await prisma.textTranslation.findMany({ where: { locale }, select: { source: true, text: true } });
  return Object.fromEntries(rows.map((r) => [r.source, r.text]));
}
