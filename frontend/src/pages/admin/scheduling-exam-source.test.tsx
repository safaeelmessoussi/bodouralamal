import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EXAM_SOURCE_INITIAL, ExamSection, type ExamSectionProps } from '../../components/scheduling/exam-section.js';
import { ar } from '../../i18n/ar.js';
import SCHEDULING_SOURCE from './scheduling.tsx?raw';
import EXAM_GRADES_SOURCE from './exam-grades.tsx?raw';
import BUILDER_SOURCE from './assessments.tsx?raw';
import EXAM_SECTION_SOURCE from '../../components/scheduling/exam-section.tsx?raw';
import EVENT_DIALOG_SOURCE from '../../components/calendar/event-details-dialog.tsx?raw';

/**
 * **R136, frontend-completion pass — an Owner browser walk found five real
 * defects the component-level guards elsewhere in this suite could not see**
 * (query-param prefill, cross-page navigation and a picker's authorization
 * boundary are none of them one component's problem alone). This file covers
 * exactly those, plus the render-observable half of the physical-source
 * addition `scheduling-exam.test.tsx` predates.
 */
const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('بناء الاختبارات creates content only — no target, no date', () => {
  it('the create form never mentions a target arm or asks for a date', () => {
    // The two removed fields, by their old variable names — neither survives
    // anywhere in the file, not merely in the one dialog.
    for (const gone of ['targetKind', 'targetId', "useState('')", 'needsDate', 'needsId']) {
      if (gone === "useState('')") continue; // too generic to assert against
      expect(BUILDER_SOURCE).not.toContain(gone);
    }
  });

  it('CreateDialog sends only content fields — title, description, mode, max_grade, level/subject/year', () => {
    const match = /async function submit\(\)[\s\S]*?createAssessment\(\s*\{([\s\S]*?)\},\s*token,/.exec(
      code(BUILDER_SOURCE),
    );
    expect(match, 'CreateDialog’s submit() body').not.toBeNull();
    const body = match![1]!;
    expect(body).toContain('title:');
    expect(body).toContain('mode,');
    expect(body).toContain('max_grade:');
    expect(body).toContain('level_id:');
    expect(body).not.toContain('target:');
    expect(body).not.toContain('date:');
  });
});

describe('?kind=exam&new=1 reliably selects اختبار — the defect an Owner browser walk found', () => {
  it('validates the query kind against the real registry before trusting it', () => {
    expect(code(SCHEDULING_SOURCE)).toContain(
      "kind !== null && AVAILABLE_TYPES.includes(kind as SchedulingType)",
    );
  });

  it('falls back to the ordinary default for an invalid or missing kind', () => {
    expect(code(SCHEDULING_SOURCE)).toContain(': null;');
    expect(code(SCHEDULING_SOURCE)).toContain("types[0] ?? 'class'");
  });

  it('seeds the CATALOGUE selection too, not only the internal `type` state', () => {
    /**
     * **The actual defect.** `type` was already correctly `'exam'` from
     * `initialType`; the visible picker reads `schedulingTypeId`, which
     * nothing seeded, so the browser displayed its FIRST catalogue option
     * instead — «حصة دراسية» — while the exam-specific fields underneath
     * were already showing. This effect closes that gap.
     */
    expect(code(SCHEDULING_SOURCE)).toContain(
      'if (editing || initialType === undefined || schedulingTypeId !== null) return;',
    );
    expect(code(SCHEDULING_SOURCE)).toContain(
      'const row = catalogue.find((r) => r.structural_kind === initialType);',
    );
    expect(code(SCHEDULING_SOURCE)).toContain('if (row) setSchedulingTypeId(row.id);');
  });

  it('never overwrites a later, deliberate pick — the guard is schedulingTypeId === null', () => {
    // A reader who changes her mind after the prefill fires must not be
    // silently reverted to it on the next render.
    expect(code(SCHEDULING_SOURCE)).toContain('schedulingTypeId !== null) return;');
  });

  it('`new=1` opens the create dialog itself, read once on mount — not merely the kind', () => {
    expect(code(SCHEDULING_SOURCE)).toContain(
      "new URLSearchParams(window.location.search).get('new') === '1' ? 'new' : null",
    );
  });
});

describe('source-aware scheduler prefill (?source=&mode=)', () => {
  it('reads and validates both params together before trusting either', () => {
    expect(code(SCHEDULING_SOURCE)).toContain("params.get('source')");
    expect(code(SCHEDULING_SOURCE)).toContain("params.get('mode')");
    expect(code(SCHEDULING_SOURCE)).toContain("mode === 'online' || mode === 'physical'");
  });

  it('re-fetches the source through the authorized author read — never trusts the URL alone', () => {
    expect(code(SCHEDULING_SOURCE)).toContain('void readAuthorPaper(initialExamSource.id, token)');
  });

  it('refuses a stale/wrong-mode prefill without crashing or exposing anything', () => {
    /**
     * **Fails safe, twice over.** A mode mismatch between what the URL
     * claimed and what the server actually answers is refused explicitly;
     * an inaccessible/deleted/out-of-scope id simply reaches `.catch` and
     * leaves the picker at its ordinary empty state — no thrown error
     * reaches the reader, and nothing about WHY is disclosed (§20 rule 17's
     * discipline, reused for a prefill rather than a direct request).
     */
    expect(code(SCHEDULING_SOURCE)).toContain('if (paper.mode !== initialExamSource.mode) return;');
    expect(code(SCHEDULING_SOURCE)).toMatch(/\.catch\(\(\) => \{[\s\S]{0,300}\}\);/);
  });

  it('prefills only what is legitimately derived from the source — never an occurrence fact', () => {
    const match = /void readAuthorPaper\(initialExamSource\.id, token\)[\s\S]*?\.catch/.exec(
      code(SCHEDULING_SOURCE),
    );
    expect(match, 'the prefill effect body').not.toBeNull();
    const body = match![0]!;
    expect(body).toContain('sourceId: paper.id');
    expect(body).toContain('sourceTitle: paper.title');
    expect(body).toContain('sourceLevelId: paper.level_id');
    // None of these are ever assigned from `paper` inside this effect — a
    // prefill must never invent an occurrence fact the reader has not chosen.
    for (const occurrenceField of ['startDate:', 'startTime:', 'endTime:', 'roomId:', 'branchId:']) {
      expect(body).not.toContain(`${occurrenceField} paper.`);
    }
  });

  it('runs once, on the prefill the dialog opened with — never re-fires and never re-trusts a later token', () => {
    expect(code(SCHEDULING_SOURCE)).toMatch(/\}, \[\]\);/);
  });

  it('the reuse action from بناء الاختبارات carries both params, as a pure navigation with no request', () => {
    expect(code(BUILDER_SOURCE)).toContain(
      '`/admin/schedules?kind=exam&new=1&source=${encodeURIComponent(row.id)}&mode=${row.mode}`',
    );
  });
});

/**
 * **R137 — the OTHER direction: a Session names the audience, the operator
 * still picks the paper.** التقويم's «ربط اختبار» arrives with
 * `?target_kind=session&target_id=`, the mirror image of `?source=&mode=`
 * above — that one prefills WHICH PAPER and leaves the audience to pick,
 * this one prefills WHICH AUDIENCE (one Session) and leaves the paper to
 * pick, in the same canonical scheduler, still one حفظ.
 */
describe('session-target scheduler prefill (?target_kind=session&target_id=)', () => {
  it('reads and validates both params — only the session kind is accepted here', () => {
    expect(code(SCHEDULING_SOURCE)).toContain("params.get('target_kind')");
    expect(code(SCHEDULING_SOURCE)).toContain("params.get('target_id')");
    expect(code(SCHEDULING_SOURCE)).toContain("kind === 'session' && id !== null");
  });

  it('never invents the shape for the other four target arms', () => {
    // The prefill is deliberately narrow — level/administrative_group/
    // teaching_group/student are not handled by this URL contract at all.
    const match = /const \[initialExamTarget\][\s\S]*?\}\);/.exec(code(SCHEDULING_SOURCE));
    expect(match, 'the initialExamTarget state initializer').not.toBeNull();
    expect(match![0]).not.toContain('administrative_group');
    expect(match![0]).not.toContain('teaching_group');
  });

  it('seeds examSource with targetKind session and the named id — never re-derived from a fetch here', () => {
    expect(code(SCHEDULING_SOURCE)).toContain(
      "? { ...EXAM_SOURCE_INITIAL, targetKind: 'session', targetId: initialExamTarget.id }",
    );
  });

  it('TargetPicker is what actually authorizes it — not this prefill', () => {
    // The same fail-safe clearing behaviour already proven for a stale
    // manual selection: a value the caller's own candidate list does not
    // contain is silently cleared, never trusted because a URL said so.
    expect(code(SCHEDULING_SOURCE)).not.toContain('readSession');
    expect(code(SCHEDULING_SOURCE)).not.toContain('fetchSessionDetails');
  });

  it("التقويم's own «ربط اختبار» carries the exact matching params, as a pure navigation with no request", () => {
    expect(code(EVENT_DIALOG_SOURCE)).toContain(
      '`/admin/schedules?kind=exam&new=1&target_kind=session&target_id=${encodeURIComponent(occurrence.id)}`',
    );
  });
});

describe('the authored physical-paper scheduling path (R136, completed here)', () => {
  const baseProps = {
    onMode: () => {},
    locked: false,
    hideScope: false,
    scope: {
      value: { branchId: '', levelId: '', subjectId: '', academicYearId: '', groupId: '' },
      set: () => {},
      setMany: () => {},
      options: { branchId: [], levelId: [], subjectId: [], academicYearId: [], groupId: [] },
      loading: {},
      ready: true,
      levelTeachesNothing: false,
    },
    rooms: [],
    roomId: '',
    onRoom: () => {},
    staff: [],
    supervisorId: '',
    onSupervisor: () => {},
    assistantIds: [],
    onAssistants: () => {},
    maxGrade: '20',
    onMaxGrade: () => {},
    onSourceChange: () => {},
  };

  it('physical: the paper is optional — no `required` marker, an explicit "no paper" option', () => {
    const html = renderToStaticMarkup(
      <ExamSection
        {...(baseProps as unknown as ExamSectionProps)}
        mode="physical"
        source={EXAM_SOURCE_INITIAL}
      />,
    );
    expect(html).toContain(ar.scheduling.exam.paperNoneOption);
  });

  it('physical: the paper selector is offered with `required={false}`', () => {
    const physicalPicker = /<PaperPicker\s+mode="physical"[\s\S]*?\/>/.exec(code(EXAM_SECTION_SOURCE));
    expect(physicalPicker, 'the physical PaperPicker element').not.toBeNull();
    expect(physicalPicker![0]).toContain('required={false}');
    expect(physicalPicker![0]).toContain('onClear');
  });

  it('remote: the paper selector is offered with `required`, and no `onClear` — nothing to fall back to', () => {
    const onlinePicker = /<PaperPicker\s+mode="online"[\s\S]*?\/>/.exec(code(EXAM_SECTION_SOURCE));
    expect(onlinePicker, 'the online PaperPicker element').not.toBeNull();
    expect(onlinePicker![0]).toContain('required');
    expect(onlinePicker![0]).not.toContain('onClear');
  });

  it('the picker queries the mode it was rendered for — never a mismatched delivery mode', () => {
    // One shared component, one `mode` param threaded straight into the
    // server query — never a hardcoded literal that could drift from the
    // caller's own choice.
    expect(code(EXAM_SECTION_SOURCE)).toContain('listAssessments({ mode, ');
  });

  it('choosing a physical source hides Level/Subject/Year and the maximum — they travel with the source', () => {
    const html = renderToStaticMarkup(
      <ExamSection
        {...(baseProps as unknown as ExamSectionProps)}
        mode="physical"
        source={{
          ...EXAM_SOURCE_INITIAL,
          sourceId: 'p1',
          sourceTitle: 'ورقة فيزيائية',
          sourceLevelId: 'l1',
        }}
      />,
    );
    // Checked as a field *label* (`>text<`), not a bare substring — the
    // groupId selector's own empty-state hint legitimately says «لا حلقات
    // لهذا المستوى…» even when the Level selector itself is gone.
    expect(html).not.toContain(ar.scheduling.exam.maxGrade);
    expect(html).not.toContain(`>${ar.scope.level}<`);
    expect(html).not.toContain(`>${ar.scope.subject}<`);
    expect(html).not.toContain(`>${ar.scope.academicYear}<`);
  });

  it('with no source chosen, Level/Subject/Year and the maximum still render exactly as before', () => {
    const html = renderToStaticMarkup(
      <ExamSection
        {...(baseProps as unknown as ExamSectionProps)}
        mode="physical"
        source={EXAM_SOURCE_INITIAL}
      />,
    );
    expect(html).toContain(ar.scheduling.exam.maxGrade);
    expect(html).toContain(`>${ar.scope.level}<`);
    expect(html).toContain(`>${ar.scope.subject}<`);
    expect(html).toContain(`>${ar.scope.academicYear}<`);
  });
});

describe('نقاط الامتحانات’s own schedule action', () => {
  it('links to the canonical scheduler with kind=exam&new=1, never a second creation form', () => {
    expect(EXAM_GRADES_SOURCE).toContain('/admin/schedules?kind=exam&new=1');
    expect(EXAM_GRADES_SOURCE).not.toContain('<SchedulingDialog');
  });
});

describe('no old RetargetDialog / copy-then-review path returns', () => {
  it('the retired two-act flow stays gone from both the builder and the scheduler', () => {
    for (const gone of ['RetargetDialog', "params.get('review')", 'retargetAssessment', 'publishAssessment']) {
      expect(BUILDER_SOURCE).not.toContain(gone);
      expect(SCHEDULING_SOURCE).not.toContain(gone);
    }
  });
});
