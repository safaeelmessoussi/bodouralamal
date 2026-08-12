/**
 * **BR-13 — coverage is the union of logged intervals, and nothing else.**
 *
 * §4.5: *"coverage percentage = the mathematical union of all merged,
 * non-overlapping logged intervals per Surah. Overlapping logs must not inflate
 * progress."* The worked example the specification gives is the test this module
 * is written against:
 *
 * > `[10–20]`, `[10–30]`, `[30–123]` merge to `[10–123]` = **114 ayahs**.
 *
 * **Pure, and deliberately so.** No database, no clock, no actor — the merge is
 * the one piece of arithmetic in §4.5, and keeping it callable with plain
 * numbers is what lets the specification's own example be a unit test rather
 * than an integration fixture.
 *
 * **Ranges are CLOSED** (`[start, end]`, both inclusive), as §4.5 stores them —
 * `(2, 10, 20)` is eleven ayahs, not ten. Every off-by-one in a coverage figure
 * lives in that sentence.
 *
 * **Adjacency merges.** `[1–5]` and `[6–10]` are one run of ten, not two runs
 * with a gap: ayah 5 and ayah 6 are consecutive, so a reader who logged them
 * separately has covered `[1–10]`. The specification's own example relies on
 * this — `[10–30]` and `[30–123]` share exactly one ayah and must not produce a
 * seam.
 */

export interface AyahInterval {
  start: number;
  end: number;
}

/**
 * Merge closed intervals into the minimal set of non-overlapping, non-adjacent
 * runs, ascending.
 *
 * The input is not mutated: callers pass rows straight from the database, and a
 * sort in place would reorder somebody else's array.
 */
export function mergeIntervals(intervals: readonly AyahInterval[]): AyahInterval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: AyahInterval[] = [{ start: sorted[0]!.start, end: sorted[0]!.end }];

  for (const next of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    // `<= last.end + 1` is the adjacency rule: touching runs join. Using `<`
    // alone would leave `[1–5]` and `[6–10]` as two runs covering ten ayahs in
    // two rows, which is the same coverage reported less honestly.
    if (next.start <= last.end + 1) {
      last.end = Math.max(last.end, next.end);
    } else {
      merged.push({ start: next.start, end: next.end });
    }
  }
  return merged;
}

/** Ayahs covered by a merged set. Closed ranges, so `end - start + 1`. */
export function coveredAyahs(merged: readonly AyahInterval[]): number {
  return merged.reduce((sum, i) => sum + (i.end - i.start + 1), 0);
}

/**
 * Coverage as a percentage of the Surah's own `total_ayahs` — *"the definitive
 * denominator"* (§4.5).
 *
 * **Rounded to two decimals to match the column** (`Decimal(5,2)`), so what is
 * stored is what was computed rather than a value the database silently
 * truncates. A `total_ayahs` of zero cannot occur in the seeded table, and
 * returning 0 rather than `NaN` keeps a corrupted lookup row from propagating
 * into every dashboard that reads it.
 */
export function coveragePercent(coveredCount: number, totalAyahs: number): number {
  if (totalAyahs <= 0) return 0;
  return Math.round((coveredCount / totalAyahs) * 10_000) / 100;
}

/** The whole computation, from raw logged ranges to what the cache row stores. */
export function computeCoverage(
  intervals: readonly AyahInterval[],
  totalAyahs: number,
): { merged: AyahInterval[]; mergedAyahCount: number; coveragePercent: number } {
  const merged = mergeIntervals(intervals);
  const mergedAyahCount = coveredAyahs(merged);
  return { merged, mergedAyahCount, coveragePercent: coveragePercent(mergedAyahCount, totalAyahs) };
}
