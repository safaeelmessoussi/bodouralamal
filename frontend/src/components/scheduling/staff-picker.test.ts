import { describe, expect, it } from 'vitest';

import ACTIVITY from './class-section.tsx?raw';
// The same file holds both sections; the two names say which one each block is
// about, which the original single import made impossible to read.
import CLASS from './class-section.tsx?raw';
import EXAM from './exam-section.tsx?raw';
import PICKER from './staff-picker.tsx?raw';
import { ar } from '../../i18n/ar.js';

/** Comments are not code — the idiom the scheduling parity guard established. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **One lead and any number of assistants, written once (R71).**
 *
 * The exam section had this control longhand; R71 needed the same shape for an
 * event's responsible مؤطرة, and a second copy is how the two would diverge —
 * the exclusion of the lead from the assistant list, the disabled state, the
 * hint. It is extracted, and this guard keeps it extracted.
 */
describe('both sections use the shared staff picker', () => {
  it('the exam section delegates', () => {
    expect(code(EXAM)).toContain('<StaffPicker');
  });

  it('the activity section delegates', () => {
    expect(code(ACTIVITY)).toContain('<StaffPicker');
  });

  it('neither hand-rolls the assistants checkbox list beside it', () => {
    // Presence is not absence, the lesson the parity guard records: a section
    // could render the picker AND keep its own list, which is how two
    // implementations start.
    expect(code(EXAM)).not.toContain('field__choices');
  });
});

/**
 * The picker owns the control; each caller owns its **words**. §20 rule 22: a
 * مؤطرة who supervises an exam is not teaching it, and one responsible for a
 * celebration is doing neither.
 */
describe('the vocabulary stays each feature’s own', () => {
  it('the picker hardcodes no role noun', () => {
    for (const term of ['المشرفة', 'المسؤولة', 'المؤطِّرة', 'supervisor', 'responsible']) {
      expect(code(PICKER)).not.toContain(term);
    }
  });

  it('each section passes its own lead label', () => {
    expect(code(EXAM)).toContain("leadLabel={t('scheduling.exam.supervisor')}");
    expect(code(ACTIVITY)).toContain("leadLabel={t('admin.calendar.responsible')}");
  });
});

describe('the picker never offers a refusal', () => {
  it('excludes the lead from the assistant list', () => {
    // One person holds one position on one thing, and every server refuses the
    // pair as a duplicate — so offering somebody as both offers a refusal.
    expect(code(PICKER)).toContain('.filter((x) => x.id !== leadId)');
  });

  it('supports a read-only rendering for a caller who may not assign', () => {
    /**
     * **Restated 2026-08-20 — the rule narrowed, so the check did.**
     *
     * R71.4 kept ALL event staffing with Admins, so the whole control rendered
     * disabled for a مؤطرة. She may now set the assistants on the event she
     * answers for, and disabling the control made that grant unreachable: the
     * `＋` registered nothing and the event saved with no assistants, looking
     * exactly like a click that had not landed.
     *
     * What survives: the control can still render read-only (§14.4 — disabled
     * rather than vanishing), and **the lead is locked separately**, which is
     * the part that must not move.
     */
    expect(code(PICKER)).toContain('disabled');
    expect(code(ACTIVITY)).toContain('disabled={disabled ?? false}');
    expect(code(ACTIVITY)).toContain('leadLocked={responsibleLocked}');
  });
});

/**
 * **R90 — the planning appraisal on the shared control.**
 *
 * Written once, on the picker, so it reaches every caller that has something to
 * appraise rather than being added per section and forgotten on the next one —
 * the failure mode rule AE names: *a behaviour each caller must opt into is a
 * behaviour that will be missing somewhere.*
 */
describe('the class section hand-writes nothing (rule C)', () => {
  /**
   * **Restated 2026-08-19 — the PROPERTY changed, so the check did.**
   *
   * It asserted that the class section delegates to `StaffPicker`. R91 gave a
   * class's assignments **effective periods**, which that control cannot say:
   * a temporary replacement is Safa → 30 Nov, Amina 1–30 Nov, Safa 1 Dec → open,
   * and a single «المؤطّرة» selector has one slot for a person who needs two.
   * The class section now composes `StaffingPeriods`; the exam sitting and the
   * celebration keep `StaffPicker`, because they staff one dated thing.
   *
   * The property that survives, and is what this block was ever about, is
   * **rule C**: the section composes a shared component and writes no markup of
   * its own.
   */
  it('composes the dated staffing editor', () => {
    expect(code(CLASS)).toContain('<StaffingPeriods');
  });

  it('and the flat picker no longer serves a class', () => {
    // Presence is not absence, the lesson the parity guard records: keeping
    // both would be two ways to staff one class, and the flat one silently
    // discards every period.
    const classSection = code(CLASS).slice(0, code(CLASS).indexOf('ActivitySection'));
    expect(classSection).not.toContain('<StaffPicker');
  });

  it('keeps no checkbox list of its own beside it', () => {
    // The assistants were an expanded checkbox list — the exact markup the
    // extraction comment records as turning the form into a page of checkboxes
    // for a real roster.
    expect(code(CLASS)).not.toContain('field__choices');
    expect(code(CLASS)).not.toContain('type="checkbox"');
  });
});

describe('warnings inform; they never refuse', () => {
  it('renders every candidate — the picker filters nobody out on a warning', () => {
    // The ONLY filter in the control is the lead's exclusion from her own
    // assistant list, which exists because the server refuses that pair.
    const filters = code(PICKER).match(/\.filter\(/g) ?? [];
    expect(filters).toHaveLength(1);
    expect(code(PICKER)).toContain('.filter((x) => x.id !== leadId)');
  });

  it('disables nothing on account of a warning', () => {
    // `disabled` is the caller's authorization prop (R71.4) and nothing else
    // may drive it — a disabled option is a refusal wearing a hint.
    expect(code(PICKER)).not.toMatch(/disabled=\{[^}]*warning/);
    expect(code(PICKER)).not.toMatch(/disabled=\{[^}]*appraisal/);
    expect(code(PICKER)).not.toMatch(/disabled=\{[^}]*no_profile/);
  });

  it('the appraisal is optional, so a picker without one behaves as before', () => {
    expect(code(PICKER)).toContain('appraisal?:');
  });
});

describe('an empty profile is said once, and is not an accusation', () => {
  it('short-circuits on no_profile rather than listing three warnings', () => {
    expect(code(PICKER)).toContain('if (candidate.no_profile)');
  });

  it('every warning kind has its own catalogue key', () => {
    for (const kind of [
      'subject_not_declared',
      'category_not_declared',
      'availability_not_declared',
      'unavailable',
      'conflict',
      'availability_indeterminate',
    ]) {
      expect(code(PICKER)).toContain(kind);
    }
  });

  it('«لم تُسجَّل» and «غير متاحة» are different strings', () => {
    // *Not declared* is not *busy*. One catalogue entry serving both would be
    // the platform telling an administrator something nobody said.
    expect(ar.admin.schedules.warnNoAvailability).not.toBe(ar.admin.schedules.warnUnavailable);
    expect(ar.admin.schedules.warnNoProfile).not.toBe(ar.admin.schedules.warnUnavailable);
  });

  it('no warning string claims a refusal', () => {
    for (const key of [
      'warnSubject',
      'warnCategory',
      'warnUnavailable',
      'warnNoAvailability',
      'warnConflict',
      'warnIndeterminate',
      'warnNoProfile',
    ] as const) {
      const text = ar.admin.schedules[key];
      // Nothing here may read as a prohibition: the administration assigns whom
      // it judges right, and the copy must not suggest otherwise (R88.4).
      for (const forbidden of ['لا يمكن', 'ممنوع', 'غير مسموح', 'يُرفض']) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});

describe('assistants are appraised exactly as the lead is (R88.8)', () => {
  it('uses one Warnings component for both', () => {
    // One profile per person and no assistant variant. Two renderings would be
    // two chances for the assistant's to fall behind.
    expect(code(PICKER)).toContain('<Warnings candidate={appraisal?.[leadId]} />');
    expect(code(PICKER)).toContain('assistantIds.map(');
  });

  it('supports MORE than one assistant, which the domain permits', () => {
    // `CourseScheduleStaff` is unique on (schedule, user), not on position:
    // one lead, any number of assistants. A single-assistant control would be
    // the interface narrowing the model.
    expect(code(PICKER)).toContain('assistantIds: string[]');
    expect(code(PICKER)).toContain('onAssistants: (ids: string[]) => void');
  });
});
