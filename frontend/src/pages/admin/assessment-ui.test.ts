import { describe, expect, it } from 'vitest';

import builder from './assessments.tsx?raw';
import studentPage from '../dashboard/assessments.tsx?raw';
import adapter from '../../adapters/assessments.ts?raw';
import teacherPage from '../teacher/assessments.tsx?raw';
import targetPicker from '../../components/scheduling/target-picker.tsx?raw';

/**
 * **The assessment interface's rules, as opposed to its styling** (SRS §4.6,
 * R124).
 *
 * Source guards rather than renders, for the reason the sibling guards give:
 * each of these is a **decision about what is offered**, and a render test
 * proves it for one fixture while a missing branch ships for every other.
 */

describe('R124 — SAVE is not SUBMIT', () => {
  it('sends them to different routes, and only one is called from a confirmation', () => {
    // The Owner's distinction, and the whole shape of the student page: a draft
    // can be returned to, and a submission cannot be undone.
    expect(adapter).toContain("/responses");
    expect(adapter).toContain("/submit");
    expect(studentPage).toContain('assessments.submitConfirm');
    expect(studentPage).toContain('ConfirmDialog');
  });

  it('never autosaves and never autosubmits', () => {
    // A closed browser leaves a draft. An assessment that submitted itself
    // because a phone locked would be a mark nobody chose to hand in.
    expect(studentPage).not.toMatch(/setInterval|beforeunload|visibilitychange/);
  });

  it('locks every control once she has sent her answers', () => {
    expect(studentPage).toContain("paper?.submission?.state === 'submitted'");
    expect(studentPage).toContain('disabled={sent}');
  });
});

describe('R124 — a student sees her own paper and nothing else', () => {
  it('has no route that could ask for another student’s answers', () => {
    // The staff reader lives on the builder; nothing on her page addresses a
    // student id at all.
    expect(studentPage).not.toContain('readSubmission');
    expect(studentPage).not.toContain('listSubmissions');
    expect(studentPage).not.toContain('student_id');
  });

  it('tells her the grade is withheld rather than showing a draft one', () => {
    expect(studentPage).toContain('assessments.gradeWithheld');
    // The mark itself is not on this screen at any status — it reaches her
    // through the grades surface that already exists.
    expect(studentPage).not.toContain('score');
  });
});

describe('R124 — the builder offers only what the server accepts', () => {
  it('sends options and justification only on a choice question', () => {
    // The server refuses the other combinations rather than dropping them, so
    // offering them would produce a refusal the author cannot act on.
    expect(builder).toContain('...(isChoice ? { justification, options: filled } : {})');
  });

  it('reorders with up/down and adds no drag-and-drop library', () => {
    expect(builder).toContain('assessments.moveUp');
    expect(builder).toContain('assessments.moveDown');
    expect(builder).not.toMatch(/dnd|draggable|sortablejs/i);
  });

  it('stops offering edits once somebody has submitted', () => {
    // The freeze is the server's rule; the interface states it instead of
    // showing controls that answer 409.
    expect(builder).toContain("rows.some((r) => r.state !== 'in_progress')");
    expect(builder).toContain('assessments.frozen');
  });

  it('does not grade here — the sheet that already exists does', () => {
    expect(builder).toContain('assessments.grading');
    expect(builder).not.toContain('/grades');
  });

  it('refuses to open an in-progress submission, and says why', () => {
    expect(builder).toContain('assessments.inProgressNotReadable');
  });
});

describe('R124 — the whole sequence, and the occurrence’s own date', () => {
  it('sends every question id when reordering (R76)', () => {
    expect(adapter).toContain('questions/order');
    expect(builder).toContain('paper.questions.map((q) => q.id)');
  });

  it('asks for no date on a session target', () => {
    // A quick test belongs to the occurrence's day; a second date could
    // disagree with it about which students were expected.
    expect(builder).toContain("const needsDate = targetKind !== 'session';");
  });
});

describe('R124 — one builder, two frames', () => {
  it('the teaching portal renders the shared BODY inside its own chrome', () => {
    /**
     * **The defect this pins.** `/teacher/assessments` first routed straight to
     * the back-office page, which dragged `AdminLayout` — and with it the
     * administration sidebar — into the teaching portal: a مؤطِّرة saw the back
     * office's navigation and none of her own. A browser check caught it; no
     * unit test could have, because both frames render perfectly well alone.
     *
     * The property is R70.1's, applied again: one implementation, two ways in.
     */
    expect(teacherPage).toContain('AssessmentsView');
    expect(teacherPage).toContain('TeacherLayout');
    // The property is *does not IMPORT it*, not *does not mention it* — the
    // comment above the component names the defect and must stay free to.
    expect(teacherPage).not.toMatch(/import\s*\{[^}]*AdminLayout/);
    expect(teacherPage).not.toContain('<AdminLayout');
    // And the shared body itself owns no frame — it takes one.
    expect(builder).toContain('layout: PortalLayout');
    expect(builder).toContain('export function AssessmentsView');
  });
});

describe('R125 — the picker offers what the server allows, and is not the boundary', () => {
  it('asks the server for candidates instead of taking a typed UUID', () => {
    /**
     * **The defect this closes.** Four of the five targets asked the author to
     * paste a UUID, which is unusable and — worse — makes the *client* the only
     * thing standing between an author and a target she may not address. The
     * list is now the server's answer to *what may I address*, and the write
     * refuses the same thing again (rule O).
     *
     * **R136 — moved to `components/scheduling/target-picker.tsx`**, shared by
     * بناء الاختبارات (a draft's own target) and الجدولة (an occurrence's
     * target at scheduling): a `components/scheduling/` consumer importing
     * from a page would be backwards layering, so both now import the one
     * definition from there instead of `assessments.tsx` restating it.
     */
    expect(targetPicker).toContain('listAssessmentTargets');
    expect(targetPicker).toContain('function TargetPicker');
    expect(builder).toContain("TargetPicker } from '../../components/scheduling/target-picker.js'");
    // No raw id entry survives for a target.
    expect(targetPicker).not.toMatch(/label=\{t\('assessments\.targetPick'\)\}\s*\n\s*value=\{targetId\}\s*\n\s*onChange=\{setTargetId\}\s*\n\s*required\s*\n\s*error/);
  });

  it('composes the shared primitives rather than a second picker', () => {
    // `SearchInput` + `SelectField` is the pair `attendance-panel` already uses
    // to add a beneficiary. A bespoke combobox would be a second generic picker
    // for the platform to keep in step (rule C).
    expect(targetPicker).toContain('<SearchInput');
    expect(targetPicker).toContain('<SelectField');
  });

  it('scopes the LEVEL list too when the Level is itself the audience', () => {
    /**
     * **The gap this closes.** The ordinary scope selector lists every Level, so
     * a branch-scoped Admin choosing a `level` target was offered one whose
     * audience escapes her branches and refused at save — a control leading to a
     * refusal she did nothing to earn. On the other arms the Level is not the
     * audience (a group at her own branch inside a Level that spans two is
     * legitimate), so it stays the ordinary selector there.
     */
    expect(builder).toContain("targetKind === 'level' ? (");
    expect(builder).toContain('SCOPE_FIELDS_WITHOUT_LEVEL');
    expect(builder).toContain('kind="level"');
  });

  it('clears a selection the narrowed list no longer offers', () => {
    // A stale id is what reaches the server as a target the author can no longer
    // see — refused there, but only after she has been shown it as chosen.
    expect(targetPicker).toContain(
      "if (value !== '' && !rows.some((r) => r.id === value)) onChange('');",
    );
  });
});

describe('R136 — «إنشاء نسخة» stays content-only; scheduling is one navigation to الجدولة', () => {
  it('«إنشاء نسخة» calls the backend copy; «استخدام مرة أخرى» makes no request at all', () => {
    // **The R134 shape — both buttons calling the identical `copyAssessment`
    // — is retired.** الجدولة now assigns the target/date and schedules
    // atomically in one حفظ (`POST /exams/schedule`), so a REUSE no longer
    // needs its own copy first: it is a plain navigation, safely
    // server-revalidated when الجدولة reads the source fresh.
    expect(builder).toContain("t('assessments.reusePaper')");
    expect(builder).toContain("t('assessments.copyPaper')");
    expect(builder).toMatch(/const created = await copyAssessment\(row\.id, token\)/);
    // The reuse action is a redirect built from the row, never a call into
    // `copyAssessment` — the two buttons are no longer one operation.
    expect(builder).toMatch(
      /reusePaper[\s\S]{0,200}onSelect: \(row\) => \{\s*window\.location\.href = `\/admin\/schedules\?kind=exam&new=1&source=\$\{encodeURIComponent\(row\.id\)\}&mode=\$\{row\.mode\}`;/,
    );
  });

  it('retired: no RetargetDialog, no ?review=1 auto-open, no publish route', () => {
    /**
     * **R136 — the whole two-act "copy, then review target/date, then
     * publish" flow is gone.** الجدولة's one `POST /exams/schedule` assigns
     * the target/date and schedules atomically; there is no intermediate
     * "retargeted draft" state left for a dialog to manage, and no separate
     * publish call for a confirmation to trigger.
     */
    expect(builder).not.toContain('function RetargetDialog');
    expect(builder).not.toContain("params.get('review')");
    expect(builder).not.toContain('setRetargeting');
    expect(builder).not.toContain('publishAssessment');
    expect(builder).not.toContain('retargetAssessment');
    expect(adapter).not.toContain('publishAssessment');
    expect(adapter).not.toContain('retargetAssessment');
    expect(adapter).not.toContain('/assessments/${examId}/publish');
    // `/assessments/targets` (the target PICKER's own route) survives —
    // only the retired per-paper `/assessments/{id}/target` write is gone.
    expect(adapter).not.toContain('/assessments/${examId}/target');
  });

  it('the header action navigates to الجدولة with the source and mode, never calls publish', () => {
    expect(builder).toContain("t('assessments.scheduleAction')");
    expect(builder).toMatch(
      /\/admin\/schedules\?kind=exam&new=1&source=\$\{encodeURIComponent\(examId\)\}&mode=\$\{paper\.mode\}/,
    );
  });

  it('shows lineage only when it exists, never a zero/empty badge', () => {
    expect(builder).toContain('paper.source_exam_id ?');
    expect(builder).toContain('paper.reused_count ?');
  });
});

describe('R136 — بناء الاختبارات authors content for either delivery mode', () => {
  it('lets the author choose mode on create, and sends it', () => {
    expect(builder).toContain("useState<'physical' | 'online'>('online')");
    expect(builder).toMatch(/createAssessment\(\s*\{\s*title: title\.trim\(\),\s*description: description\.trim\(\) \|\| null,\s*mode,/);
  });

  it('the library shows a مسودة badge — every row IS one, by construction (R136)', () => {
    expect(builder).toContain("<Badge tone=\"neutral\">{t('assessments.statusDraft')}</Badge>");
  });

  it('no status filter dropdown remains — the server accepts none', () => {
    // The column header (`assessments.filterStatus`, "الحالة") stays — every
    // row's status is now trivially `draft`, so it is worth showing, just no
    // longer worth filtering on. The FILTER control is what is retired.
    expect(builder).not.toContain('stateFilter');
    expect(builder).not.toContain('assessments.statusPublished');
    expect(builder).not.toContain('assessments.statusClosed');
    expect(adapter).not.toMatch(/interface AssessmentListFilters \{\s*status/);
  });
});
