import { describe, expect, it } from 'vitest';

import PERIODS from './staffing-periods.tsx?raw';
import FORM from '../../pages/admin/scheduling.tsx?raw';
import { ar } from '../../i18n/ar.js';

/** Comments are not code — the idiom every scheduling guard here uses. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **Staffing periods — the interface half of R91.**
 *
 * What is guarded is the handful of properties that would fail silently: a
 * blank date meaning the wrong thing, a period that never reaches the wire, a
 * refusal the administrator cannot act on, and the interface quietly capping
 * what the domain permits.
 */
describe('a blank date is OPEN-ENDED, and says so', () => {
  it('converts an empty string to null exactly once, at the wire boundary', () => {
    // A date input produces `''` and the contract wants `null`. Letting either
    // leak into the other half is how a bound silently becomes 1970.
    expect(code(FORM)).toContain("effective_from: row.effective_from === '' ? null : row.effective_from");
    expect(code(FORM)).toContain(
      "effective_until: row.effective_until === '' ? null : row.effective_until",
    );
  });

  it('explains what a blank field means, rather than leaving it blank', () => {
    expect(ar.admin.schedules.effectiveFromHint).toContain('بداية');
    expect(ar.admin.schedules.effectiveUntilHint).toContain('نهاية');
  });
});

describe('the domain permits many assistants, and the interface does not cap it', () => {
  it('holds a LIST of assignments, not a lead and a set', () => {
    expect(code(PERIODS)).toContain('value: StaffingPeriod[]');
    expect(code(PERIODS)).toContain('onChange: (next: StaffingPeriod[]) => void');
  });

  it('offers both positions on every row', () => {
    expect(code(PERIODS)).toContain("value: 'teacher'");
    expect(code(PERIODS)).toContain("value: 'assistant'");
  });

  it('defaults a new row to ASSISTANT, the position that is not capped', () => {
    // At most one main مؤطِّرة may be active on a date (R91 §6). Defaulting to
    // the capped position would make the commonest next action a refusal.
    expect(code(PERIODS)).toContain("position: 'assistant', effective_from: ''");
  });

  it('lets one person appear on more than one row', () => {
    // The resume case: Safa → 30 Nov, Amina 1–30 Nov, Safa 1 Dec → open. The
    // editor must not filter a person out because she is already listed — the
    // withdrawn `(schedule, user)` unique index is exactly what made that
    // impossible, and an interface that re-imposed it would undo R91.
    expect(code(PERIODS)).not.toContain('.filter((x) => x.id !==');
    expect(code(PERIODS)).not.toContain('alreadyChosen');
  });
});

describe('a refusal arrives in the administrator’s words', () => {
  it('maps each interval refusal to its own sentence', () => {
    expect(code(FORM)).toContain('OVERLAPPING_MAIN_TEACHER');
    expect(code(FORM)).toContain('OVERLAPPING_ASSIGNMENT');
    expect(code(FORM)).toContain('STAFF_PERIOD_OUTSIDE_SCHEDULE');
  });

  it('and every one of them resolves to Arabic', () => {
    for (const key of [
      'overlappingMain',
      'overlappingAssignment',
      'staffPeriodOutside',
    ] as const) {
      expect(ar.admin.schedules[key].length).toBeGreaterThan(10);
      expect(ar.admin.schedules[key]).not.toMatch(/[A-Z_]{6,}/);
    }
  });

  it('the hint tells her how to express a temporary replacement', () => {
    // §12 — *do not require users to understand database rows.* The three-step
    // shape is the one thing that is not obvious from four fields.
    expect(ar.admin.schedules.staffingHint).toContain('تعويض');
  });
});

describe('R90’s warnings still ride along, and still refuse nothing', () => {
  it('renders them per row', () => {
    expect(code(PERIODS)).toContain('<Warnings candidate={appraisal?.[row.user_id]} />');
  });

  it('marks the option BEFORE the choice, through the SHARED helper', () => {
    /**
     * The half that was lost and is now guarded. Moving a class from
     * `StaffPicker` to this editor dropped the option marker while the chips
     * below kept working — which is exactly what made the loss hard to see.
     * `markedLabel` is imported, never re-implemented: a second copy is how the
     * two controls would drift apart again.
     */
    expect(code(PERIODS)).toContain('markedLabel(x, appraisal)');
    expect(code(PERIODS)).toContain("from './staff-picker.js'");
    expect(code(PERIODS)).not.toContain('const WARNING_KEY');
    expect(code(PERIODS)).not.toContain('function Warnings');
  });

  it('and disables nothing on account of one', () => {
    // `disabled` is the caller's authorization prop and nothing else may drive
    // it — a disabled option is a refusal wearing a hint (rule AR).
    expect(code(PERIODS)).not.toMatch(/disabled=\{[^}]*warning/);
    expect(code(PERIODS)).not.toMatch(/disabled=\{[^}]*appraisal/);
  });
});
