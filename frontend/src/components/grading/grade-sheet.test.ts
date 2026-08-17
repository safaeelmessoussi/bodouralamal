import { describe, expect, it } from 'vitest';

import ADMIN_PAGE from '../../pages/admin/exam-grades.tsx?raw';
import TEACHER_PAGE from '../../pages/teacher/exams.tsx?raw';
import SHEET from './grade-sheet.tsx?raw';

/** Comments are not code — the idiom the scheduling parity guard established. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **One grade sheet, two ways in (SRS Revision 70.1).**
 *
 * `/admin/exam-grades?exam=` and `/teacher/exams` must render *the same*
 * component. This project has paid for the alternative repeatedly — R69 spent a
 * whole revision removing entry points that unrelated screens had grown — and a
 * second grading implementation would diverge exactly where it matters: the
 * empty-versus-zero distinction, the /20 conversion, and BR-8's publish state.
 */
describe('both entry points render the shared sheet', () => {
  it('the admin page delegates rather than reimplementing', () => {
    expect(code(ADMIN_PAGE)).toContain('<GradeSheetView');
  });

  it('the teacher page delegates to the same component', () => {
    expect(code(TEACHER_PAGE)).toContain('<GradeSheetView');
  });

  it('neither page talks to the grade endpoints itself', () => {
    // Presence is not absence: a page could render the sheet AND keep its own
    // save path beside it, which is how two implementations start.
    for (const page of [ADMIN_PAGE, TEACHER_PAGE]) {
      expect(code(page)).not.toContain('saveGrades');
      expect(code(page)).not.toContain('publishGrades');
      expect(code(page)).not.toContain('fetchGradeSheet');
    }
  });
});

/**
 * The two rules the sheet exists to keep, asserted at the source because
 * neither is visible in a rendered snapshot.
 */
describe('the sheet keeps empty distinguishable from zero', () => {
  it('holds the mark as a string, so `` is a state `0` cannot represent', () => {
    expect(code(SHEET)).toContain('mark: string');
  });

  it('sends null — not 0 — for an unmarked student', () => {
    // BR-7 decides what becomes of an unmarked student at save time. Coercing
    // the blank field to 0 here would record a mark nobody entered and make the
    // absent-zero rule unobservable.
    expect(code(SHEET)).toContain("draft.mark.trim() === '' ? null");
  });

  /**
   * **This assertion replaced its predecessor rather than being deleted.**
   *
   * It used to read `expect(code(SHEET)).toContain('row.passed === null')` — the
   * branch that rendered an unmarked student's result as «—» instead of «راسبة».
   * The Owner removed the result column entirely (2026-08-17), so that branch is
   * gone and with it the failure mode it prevented.
   *
   * The rule underneath it is **stronger now and is asserted as such**: the sheet
   * renders no verdict about a person at all, marked or not. `row.passed` remains
   * in the contract and BR-12's override remains in the model; this screen simply
   * does not read them. The catalogue half of the same guard lives in
   * `ui/atomic-components.test.ts`.
   */
  it('renders no pass/fail verdict at all, for any row', () => {
    expect(code(SHEET)).not.toContain('row.passed');
    expect(code(SHEET)).not.toContain('admin.grades.passed');
    expect(code(SHEET)).not.toContain('admin.grades.failed');
  });

  it('still surfaces a manual override, because provenance is not a verdict', () => {
    // BR-12: a human decided this row, which a reader of the sheet needs to
    // know. That is a fact about the RECORD, not a label on the student.
    expect(code(SHEET)).toContain('manual_pass_fail_override');
    expect(code(SHEET)).toContain('admin.grades.overridden');
  });
});

describe('the scale conversion belongs to the server', () => {
  it('reads `display_scale` from the sheet rather than hardcoding /20', () => {
    // R14 fixed the association's scale at /20 and put it in `SystemSetting`;
    // a literal 20 here would be a second source of truth for it.
    expect(code(SHEET)).toContain('sheet.display_scale');
  });

  it('never computes basis points for the wire', () => {
    // R8: the round-half-up happens exactly once, at final persistence, on the
    // server. A client-side conversion would be a second rounding rule
    // deciding whether a student passed.
    expect(code(SHEET)).not.toContain('Math.round');
  });
});
