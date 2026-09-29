import { AppError } from '../lib/errors.js';

/**
 * **The age range, stated once** (SRS Revision 180 §4; R170 §6's rule moved
 * from the Category to the Level).
 *
 * A Level may state the ages it is for — INFORMATIONAL, gating nothing (R64.7).
 * A Category states none of its own: its range is DERIVED from its Levels in
 * the Category's own order (§2.2) — the start is the first Level's start, the
 * end the last Level's end — so it can never disagree with them, and a
 * Category whose last Level states no end has none («من 18 سنة»), never an
 * invented ceiling. Read by the public overview, the back office's «الفئات»
 * and the registration forms alike.
 */
export interface AgeRange {
  minAge: number | null;
  maxAge: number | null;
}

/**
 * Levels in the Category's own order.
 *
 * The START is the first Level's start — a first Level that states no start
 * (a preparatory programme with no age, say) passes the question forward to
 * the first Level that does. The END is the LAST Level's end, strictly: a
 * last Level that states none makes the Category open-ended, which is the
 * Owner's answer for المرأة — «من 18 سنة», never a ceiling read off an
 * earlier Level.
 */
export function derivedCategoryAgeRange(levels: readonly AgeRange[]): AgeRange {
  const minAge = levels.find((level) => level.minAge !== null)?.minAge ?? null;
  const maxAge = levels.length === 0 ? null : levels[levels.length - 1]!.maxAge;
  return { minAge, maxAge };
}

/**
 * The pair is checked HERE for a create; an edit may send one end only, so it
 * is checked there against the stored other end. The database holds the same
 * rule (`level_age_range_check`) — this is what turns it into a sentence.
 */
export function assertAgeRange(minAge: number | null, maxAge: number | null): void {
  if (minAge !== null && maxAge !== null && minAge > maxAge) {
    throw new AppError('VALIDATION_FAILED', 'min_age must not exceed max_age', { reason: 'AGE_RANGE_INVERTED' });
  }
}
