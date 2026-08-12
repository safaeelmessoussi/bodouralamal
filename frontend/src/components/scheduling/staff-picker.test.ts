import { describe, expect, it } from 'vitest';

import ACTIVITY from './class-section.tsx?raw';
import EXAM from './exam-section.tsx?raw';
import PICKER from './staff-picker.tsx?raw';

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
    // R71.4 keeps event staffing with Admins. The control renders disabled
    // rather than vanishing (§14.4), and the server refuses regardless —
    // hiding is not the enforcement mechanism.
    expect(code(PICKER)).toContain('disabled');
    expect(code(ACTIVITY)).toContain('disabled={!canAssignStaff}');
  });
});
