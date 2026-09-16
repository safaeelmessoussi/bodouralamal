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
 * empty-versus-zero distinction, the exam's own maximum, and BR-8's publish
 * state.
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
  it('holds the score as a string, so `` is a state `0` cannot represent', () => {
    // Restated for R81's vocabulary; the property is the one it always was.
    expect(code(SHEET)).toContain('score: string');
  });

  it('sends null — not 0 — for an unmarked student', () => {
    // BR-7 decides what becomes of an unmarked student at save time. Coercing
    // the blank field to 0 here would record a mark nobody entered and make the
    // absent-zero rule unobservable.
    //
    // **Owner-reported, 2026-09-16 — this logic moved into `entryPayload`**,
    // extracted so the bulk save and the per-student dialog's own save build
    // the identical wire entry rather than two implementations. The anchor
    // moves with it; the property is unchanged.
    const scoreComputation = code(SHEET).slice(
      code(SHEET).indexOf('score:', code(SHEET).indexOf('student_id: studentId,')),
      code(SHEET).indexOf('absent: draft.absent,'),
    );
    expect(scoreComputation).toContain("draft.score.trim() === ''");
    expect(scoreComputation).toContain('? null');
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

  /**
   * **Restated a second time, and in the opposite direction — deliberately.**
   *
   * It asserted that the sheet still surfaces BR-12's manual override, on the
   * reasoning that provenance is not a verdict. R81 retired the override
   * itself: with no passing threshold there is nothing to override, and the
   * columns went with the concept. So the guard now pins the *absence* of the
   * whole apparatus, which is what the Owner decided.
   *
   * Kept rather than deleted because the risk it guards is unchanged: a future
   * screen reintroducing a verdict, by any name.
   */
  it('carries no pass/fail apparatus at all — no override, no threshold', () => {
    expect(code(SHEET)).not.toContain('manual_pass_fail_override');
    expect(code(SHEET)).not.toContain('admin.grades.overridden');
    expect(code(SHEET)).not.toContain('passing');
  });
});

describe('the maximum comes from the exam, and nothing is converted', () => {
  /**
   * **Restated, not deleted.** This asserted that the sheet reads
   * `display_scale` from the server rather than hardcoding /20 — the property
   * being *the client owns no scale of its own*. R81 moved the maximum onto the
   * exam, so the same property is now that the sheet reads `max_grade` from the
   * sheet it was given. A literal 20 here would be the same defect it always
   * was.
   */
  it('reads the exam’s own maximum rather than hardcoding one', () => {
    expect(code(SHEET)).toContain('sheet.max_grade');
    expect(code(SHEET)).not.toContain('display_scale');
  });

  it('performs no arithmetic on a score at all', () => {
    // R81 removed the conversion rather than moving it: what is typed is what
    // is stored. `Math.round` or a division here would be a rounding rule the
    // client had invented, which is how a mark stops reading back as itself.
    expect(code(SHEET)).not.toContain('Math.round');
    expect(code(SHEET)).not.toContain('10_000');
  });
});

/**
 * **Owner-reported, 2026-09-15 — per-question grading, where the exam uses
 * R137's points allocation.** Source-pinned like every other rule in this
 * file (`GradeSheetView` needs a session/token context no test here mocks),
 * asserting the three properties a live render cannot easily prove: the
 * empty-vs-zero rule survives into the new path, each input is bound to its
 * OWN question's points rather than the exam's maximum, and the total column
 * becomes derived rather than typed once questions are present.
 */
describe('per-question grading keeps the same rules the whole-exam field already has', () => {
  it('never sends an empty breakdown as `[]` — nothing entered still means unmarked', () => {
    // `entered.length > 0` is the guard: a breakdown with nothing filled in
    // is `null`, matching `score: null`'s own "unmarked, not zero" meaning —
    // sending `[]` would tell the server the total is 0, which is a mark
    // nobody entered.
    expect(code(SHEET)).toContain('entered.length > 0');
  });

  it('bounds each per-question input by that question’s own points, not the exam’s maximum', () => {
    const questionInput = code(SHEET).slice(
      code(SHEET).indexOf('sheet.questions?.map((q) =>'),
      code(SHEET).indexOf('))}\n                    <td>'),
    );
    expect(questionInput).toContain('max={q.points}');
    expect(questionInput).not.toContain('max={maxGrade}');
  });

  it('the total becomes a derived, read-only sum once questions are present — never a second editable field', () => {
    expect(code(SHEET)).toContain('questionScoresTotal(draft)');
    expect(code(SHEET)).toContain('sheet.questions ? (');
  });
});

/**
 * **Owner-reported, 2026-09-16 — one row, one dialog: view her responses and
 * grade them in the same place.** Source-pinned for the identical reason
 * every other rule in this file is: `GradeSheetView` needs a session/token
 * context and a mocked `readSubmission` network call no test here provides.
 */
describe('per-row «عرض الإجابات» opens a dialog, not a redirect', () => {
  it('the per-row button is physical-exam-aware, like the exam-wide link beside it', () => {
    expect(code(SHEET)).toContain("sheet.exam.mode === 'online' ? (");
    expect(code(SHEET)).toContain('setOpenStudentId(row.student_id)');
  });

  it('fetches the SAME submission read بناء الاختبارات uses, not a second endpoint', () => {
    expect(code(SHEET)).toContain('readSubmission(examId, studentId, accessToken)');
  });

  it('the dialog’s own save sends ONE entry, built by the SAME entryPayload the bulk save uses', () => {
    expect(code(SHEET)).toContain(
      '[entryPayload(studentId, row.version, draft, sheet.questions !== undefined)]',
    );
  });

  it('reviewing without per-question grading is offered explicitly, not merely possible', () => {
    // The manual total field exists whether or not the exam uses points, and
    // its own hint states the precedence rule rather than leaving the marker
    // to infer it from `entryPayload`'s behaviour.
    expect(code(SHEET)).toContain("label={t('admin.grades.totalOverride')}");
  });

  it('the exam-wide link and the per-row dialog carry DIFFERENT labels, on purpose', () => {
    // They stopped being the same capability the moment grading moved into
    // the per-row dialog — a reader must be able to tell which is which.
    expect(code(SHEET)).toContain("t('admin.grades.openInBuilder')");
    expect(code(SHEET)).toContain("t('admin.grades.viewResponses')");
  });
});
