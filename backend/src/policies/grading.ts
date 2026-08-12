import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * **The grading scale, and the single conversion between storage and display
 * (§4.6, Revision 8, Revision 14).**
 *
 * Two rules the rest of the platform depends on and must never re-derive:
 *
 * 1. **Storage is integer basis points of the exam's total, 0–10,000.** No float
 *    column exists anywhere in scoring and none may be added (§20 rule 3). The
 *    SQL CHECK enforces the range.
 * 2. **The /20 scale is a DISPLAY concern.** Revision 14 fixed the association's
 *    scale at /20 and the pass mark at 10/20 — expressed canonically as
 *    `grading.display_scale = 20` and `grading.passing_grade_bp = 5000` — and
 *    both live in `SystemSetting` **only**, because §7 defines `Level` and
 *    `Category` as carrying no such column.
 *
 * **Rounding happens exactly once, at final persistence** (Revision 8), never
 * per intermediate step. That is why the mark → bp direction lives here and not
 * in a form: a second rounding site is a second answer.
 */

/** Revision 14's canonical values, used when no row has been configured. These
 *  are **normative defaults**, not a guess — §15.1 lists them as seed data. */
export const DEFAULT_DISPLAY_SCALE = 20;
export const DEFAULT_PASSING_GRADE_BP = 5000;

export const DISPLAY_SCALE_KEY = 'grading.display_scale';
export const PASSING_GRADE_BP_KEY = 'grading.passing_grade_bp';

export interface GradingScale {
  displayScale: number;
  passingGradeBp: number;
}

/**
 * The configured scale, falling back to Revision 14's values.
 *
 * A missing row means *nobody has overridden the association's scale*, which is
 * the ordinary state — so the default is returned rather than an error. A row
 * holding something unparseable is a different matter and is also ignored: the
 * alternative is refusing to render a grade sheet because a settings row was
 * mistyped, which turns a configuration slip into an outage.
 */
export async function readGradingScale(prisma: PrismaClient): Promise<GradingScale> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [DISPLAY_SCALE_KEY, PASSING_GRADE_BP_KEY] } },
    select: { key: true, value: true },
  });

  const read = (key: string, fallback: number): number => {
    const raw = rows.find((r) => r.key === key)?.value;
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    displayScale: read(DISPLAY_SCALE_KEY, DEFAULT_DISPLAY_SCALE),
    passingGradeBp: read(PASSING_GRADE_BP_KEY, DEFAULT_PASSING_GRADE_BP),
  };
}

/**
 * A mark on the association's scale → basis points.
 *
 * **Round half up, once** (Revision 8). `Math.round` is half-up for positive
 * numbers, which every mark is; the range is clamped rather than trusted because
 * this is the last point before a CHECK constraint would turn a client mistake
 * into a 500.
 */
export function markToBp(mark: number, displayScale: number): number {
  const bp = Math.round((mark / displayScale) * 10_000);
  return Math.min(10_000, Math.max(0, bp));
}

/** Basis points → a mark on the association's scale. Display only, never stored. */
export function bpToMark(valueBp: number, displayScale: number): number {
  return (valueBp * displayScale) / 10_000;
}

/**
 * **Pass/fail, integer-only** (§20 rule 3, Revision 14).
 *
 * The comparison is in basis points precisely so it never touches the display
 * scale: converting the threshold to /20 and comparing there would introduce a
 * float on the one path where a boundary case decides whether a student passed.
 */
export function passes(valueBp: number, passingGradeBp: number): boolean {
  return valueBp >= passingGradeBp;
}
