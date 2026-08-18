import { Prisma } from '../generated/prisma/client.js';

/**
 * **A grade is a score out of its own exam's maximum (§4.6, Revision 81).**
 *
 * That is the whole model. There is no platform-wide scale, no passing
 * threshold, and nothing derives a verdict from a mark.
 *
 * ## What this replaced, and why the replacement is simpler
 *
 * Grades were stored as **integer basis points of the exam total** (0–10,000)
 * and rendered against a global `grading.display_scale`, with
 * `grading.passing_grade_bp` deciding pass/fail. Normalising made sense while
 * every exam shared one scale and a post-MVP engine was expected to aggregate
 * across them (§10.1). Once the maximum belongs to the exam, **there is nothing
 * left to normalise against** — and the conversion stops being free:
 *
 *     max 3, score 1  →  3333 bp  →  0.9999  →  displayed 1.00
 *
 * The value read back is not the value entered. Exact decimal has no such site:
 * what was typed is what is stored and what is shown. **This is not a float** —
 * `NUMERIC(6,2)` is exact, and §20 rule 3's prohibition is on float arithmetic
 * in scoring, which this removes rather than introduces (R81 retires that rule's
 * *basis-point* clause for scores; weights for the postponed template engine are
 * untouched because they do not exist yet).
 *
 * ## Why the bound lives here and not in a CHECK
 *
 * `score <= max_grade` spans two tables, which a column CHECK cannot express.
 * So it is a service rule, applied on every write — and it is **authoritative on
 * the server**: the form refuses out-of-range values first, as a courtesy, and
 * the route refuses them regardless.
 */

/** The most a maximum or a score may be — `NUMERIC(6,2)` holds four digits. */
export const MAX_GRADE_CEILING = 9999.99;

/**
 * Two decimal places, exactly — the precision the column stores.
 *
 * A third would be silently rounded by PostgreSQL, so it is refused here
 * instead: a mark that comes back different from the one typed is the surprise
 * this model exists to remove.
 */
export function isStorablePrecision(value: Prisma.Decimal): boolean {
  return value.decimalPlaces() <= 2;
}

/** A maximum grade must be a positive number the column can hold. */
export function isValidMaxGrade(value: Prisma.Decimal): boolean {
  return (
    value.isFinite() &&
    value.greaterThan(0) &&
    value.lessThanOrEqualTo(MAX_GRADE_CEILING) &&
    isStorablePrecision(value)
  );
}

/**
 * A score is valid for an exam when it is between zero and that exam's maximum.
 *
 * **Inclusive at both ends**: full marks are a score, and zero is BR-7's absent
 * row. The comparison is `Decimal`, so a boundary case is decided exactly rather
 * than by a float that is a hair over.
 */
export function isValidScore(score: Prisma.Decimal, maxGrade: Prisma.Decimal): boolean {
  return (
    score.isFinite() &&
    score.greaterThanOrEqualTo(0) &&
    score.lessThanOrEqualTo(maxGrade) &&
    isStorablePrecision(score)
  );
}

/** The wire form: a plain number, since `Decimal` is not JSON. */
export function toNumber(value: Prisma.Decimal): number {
  return value.toNumber();
}
