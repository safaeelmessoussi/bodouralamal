import { describe, expect, it } from 'vitest';

import PAGE_SOURCE from './scheduling.tsx?raw';
import ADAPTER_SOURCE from '../../adapters/scheduling.ts?raw';
import EXAM_SECTION_SOURCE from '../../components/scheduling/exam-section.tsx?raw';

/**
 * An already-scheduled ONLINE exam's arrangement is now editable (Owner,
 * 2026-09-15; SRS Revision 145 §1), superseding R136 clause 12. Three things
 * had to move together, and each is pinned separately because a live render
 * would need a mocked session/token to exercise any of them meaningfully:
 *
 * 1. الجدولة's row action no longer hides Edit for an online exam.
 * 2. The save adapter routes an online EDIT to `PATCH /exams/{id}/schedule`
 *    (never `PATCH /exams/{id}`, which still refuses `mode: 'online'`), and
 *    — the sharpest way this could go wrong — never builds `target`/
 *    `availability` from `examSource`'s unseeded initial state, which would
 *    silently retarget the exam to "the whole Level" on every edit save.
 * 3. `ExamSection` stops rendering the CREATE-only, `required` paper picker
 *    when editing an online exam — nothing seeds it, so it would otherwise
 *    show a required control with nothing chosen against a row that already
 *    has content.
 */
const pageSource = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const adapterSource = ADAPTER_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const examSectionSource = EXAM_SECTION_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('الجدولة offers Edit on an online exam row', () => {
  it('the row action no longer gates on examMode', () => {
    const editAction = pageSource.slice(
      pageSource.indexOf("label: t('common.edit')"),
      pageSource.indexOf("label: t('common.delete')"),
    );
    expect(editAction).not.toContain("examMode !== 'online'");
  });
});

describe('saving an edited online exam routes to the schedule-only PATCH', () => {
  it('calls updateExamSchedule, not updateExam, when editing mode online', () => {
    const examBranch = adapterSource.slice(
      adapterSource.indexOf("if (input.type === 'exam') {"),
      adapterSource.indexOf("if (input.examMode === 'online') {", adapterSource.indexOf("if (input.type === 'exam') {") + 2000),
    );
    expect(examBranch).toContain("if (input.examMode === 'online') {");
    expect(examBranch).toContain('await updateExamSchedule(');
  });

  it('never builds examTarget/examAvailability/examSourceId while editing (would silently retarget to the whole Level)', () => {
    const marker = "...(type === 'exam' && examMode === 'online' && !editing";
    expect(pageSource).toContain(marker);
  });
});

describe('ExamSection hides the CREATE-only paper picker while editing an online exam', () => {
  it('renders an edit-only hint instead of the required PaperPicker when locked', () => {
    expect(examSectionSource).toContain("mode === 'online' && locked");
    expect(examSectionSource).toContain("t('scheduling.exam.onlineEditHint')");
  });

  it('Owner-reported, 2026-09-15 — the supervisor/assistants picker is NOT hidden alongside the paper picker while editing', () => {
    // The locked+online branch renders the hint AND a StaffPicker, in that
    // order — a regression here would silently drop staff editing for an
    // online exam's arrangement, the exact gap R145 §1 left standing.
    const lockedOnlineBranch = examSectionSource.slice(
      examSectionSource.indexOf("mode === 'online' && locked"),
      examSectionSource.indexOf(": mode === 'online' ?"),
    );
    expect(lockedOnlineBranch).toContain("t('scheduling.exam.onlineEditHint')");
    expect(lockedOnlineBranch).toContain('<StaffPicker');
  });
});
