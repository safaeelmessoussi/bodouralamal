import type { AyahInterval } from './quran-coverage.js';
import { coveragePercent, coveredAyahs } from './quran-coverage.js';

/**
 * **SRS Revision 232 — a Level may hold سورة البقرة in two parts** (the Owner,
 * 2026-10-20: «the administration can choose to teach سورة البقرة in two parts,
 * one part in the first year, and second part in the second year … that
 * happenes only for that surah as it's big»).
 *
 * Warsh numbering (R230): part 1 is the first and second hizbs, verses 1–140;
 * part 2 is the third to fifth, from «سَيَقُولُ السُّفَهَاءُ» (141) to the Surah's
 * end (285). Only Al-Baqara splits; a `level_surah.part` CHECK says the same.
 */
export type SurahPart = 1 | 2;

const PARTS: Record<number, Record<SurahPart, { from: number; to: number | null; label: string }>> = {
  2: {
    1: { from: 1, to: 140, label: 'الجزء الأول (الحزب الأول و الثاني)' },
    2: { from: 141, to: null, label: 'الجزء الثاني (الحزب الثالث و الرابع و الخامس)' },
  },
};

export function surahSplits(surahId: number): boolean {
  return PARTS[surahId] !== undefined;
}

/** The part's verses; the whole Surah when `part` is `null`. */
export function partRange(surahId: number, part: SurahPart | null, totalAyahs: number): AyahInterval {
  const spec = part === null ? undefined : PARTS[surahId]?.[part];
  if (!spec) return { start: 1, end: totalAyahs };
  return { start: spec.from, end: spec.to ?? totalAyahs };
}

/** «البقرة» — or «البقرة الجزء الثاني (الحزب الثالث و الرابع و الخامس)». */
export function syllabusName(nameArabic: string, surahId: number, part: SurahPart | null): string {
  const spec = part === null ? undefined : PARTS[surahId]?.[part];
  return spec ? `${nameArabic} ${spec.label}` : nameArabic;
}

/**
 * A Surah's memorisation read against the part a Level asks for: the merged
 * runs clipped to the part, counted, and a percentage of the part's length.
 * The whole Surah passes through unchanged.
 */
export function coverageWithin(
  merged: readonly AyahInterval[],
  range: AyahInterval,
): { merged: AyahInterval[]; mergedAyahCount: number; coveragePercent: number; totalAyahs: number } {
  const clipped = merged
    .map((run) => ({ start: Math.max(run.start, range.start), end: Math.min(run.end, range.end) }))
    .filter((run) => run.start <= run.end);
  const totalAyahs = range.end - range.start + 1;
  const mergedAyahCount = coveredAyahs(clipped);
  return { merged: clipped, mergedAyahCount, coveragePercent: coveragePercent(mergedAyahCount, totalAyahs), totalAyahs };
}
