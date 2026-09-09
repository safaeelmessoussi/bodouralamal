import { describe, expect, it } from 'vitest';

import { academicYearLabelError } from './academic-periods.js';
import { t } from '../../i18n/index.js';
import SOURCE from './academic-periods.tsx?raw';

/**
 * **A domain conflict must not be told as a concurrency accident** (2026-09-05).
 *
 * `POST /academic-periods` refuses a taken sequence with `STATE_CONFLICT` and
 * `reason: ACADEMIC_PERIOD_SEQUENCE_TAKEN`. The page matched only
 * `code === 'DUPLICATE'`, so the refusal fell through to the generic 409 arm and
 * an administrator was told *«تم تعديل هذا العنصر أو تغيّرت حالته. يرجى تحديث
 * الصفحة»* — which is untrue: nobody had touched anything, الفصل 2 simply
 * already existed. The dialog then closed and discarded what she had typed.
 *
 * The mapping is what these pin. The branch itself is asserted by
 * `academic-period.integration.test.ts`, which owns the server's side.
 */
describe('the taken-sequence refusal reads as what it is', () => {
  it('names the period number rather than describing a stale record', () => {
    const message = t('admin.academicPeriods.duplicate').replace('{sequence}', '2');

    expect(message).toContain('2');
    expect(message).toContain('مسجَّل بالفعل');
    // The sentence the generic arm used to produce, pinned out: it describes a
    // record somebody else changed, which is a different event entirely.
    expect(message).not.toContain('حدّثي الصفحة');
    expect(message).not.toBe(t('common.conflict'));
  });

  it('tells her what to do next, which the generic sentence could not', () => {
    // «refresh the page» is not an action that resolves a taken sequence.
    expect(t('admin.academicPeriods.duplicate')).toMatch(/عدّلي|اختاري/);
  });

  it('carries the placeholder the page interpolates', () => {
    // A guard against the message and the call site drifting apart: if the
    // token is renamed here and not there, the number reaches nobody.
    expect(t('admin.academicPeriods.duplicate')).toContain('{sequence}');
  });
});

/**
 * **R137 — الفصول الدراسية becomes a coherent surface for the year itself**,
 * not only its semesters. The Owner's exact complaint was that «إضافة فصل»'s
 * own year selector showed only «2026-2027» — not because it was filtered to
 * the current year (it never was, `years.map(...)` is and was unconditional,
 * see the assertion below), but because there was nowhere to create a second
 * one. This is the write path that closes the actual gap.
 */
describe('academicYearLabelError — the same YYYY-YYYY-consecutive-pair rule the server enforces', () => {
  it('accepts two consecutive years', () => {
    expect(academicYearLabelError('2026-2027')).toBeNull();
    expect(academicYearLabelError('2099-2100')).toBeNull();
  });

  it('refuses a malformed shape', () => {
    expect(academicYearLabelError('')).not.toBeNull();
    expect(academicYearLabelError('2026')).not.toBeNull();
    expect(academicYearLabelError('2026-27')).not.toBeNull();
    expect(academicYearLabelError('sept-2026')).not.toBeNull();
  });

  it('refuses a second year that is not the first plus one', () => {
    expect(academicYearLabelError('2026-2028')).not.toBeNull();
    expect(academicYearLabelError('2026-2025')).not.toBeNull();
    expect(academicYearLabelError('2026-2026')).not.toBeNull();
  });
});

describe('the semester selector was never filtered to the current year — and years now have a create action', () => {
  it('the year selector offered to «إضافة فصل» is the unconditional list, every year', () => {
    // The actual defect: not a filter to remove, but a write path to add.
    // This pins that the selector itself stayed unconditional throughout.
    expect(SOURCE).toContain('options={years.map((y) => ({ value: y.id, label: y.label }))}');
  });

  it('offers create, edit and delete for the academic year itself', () => {
    expect(SOURCE).toContain("setEditingYear('new')");
    expect(SOURCE).toContain('createAcademicYear');
    expect(SOURCE).toContain('updateAcademicYear');
    expect(SOURCE).toContain('deleteAcademicYear');
  });

  it('a blocked deletion is explained with the shared reference-data notice, not a generic sentence', () => {
    expect(SOURCE).toContain('classifyDeletion');
    expect(SOURCE).toContain('BlockedNotice');
  });

  it('a new or renamed year appears without a page reload — إضافة فصل reads the same state', () => {
    // Both dialogs' onSave calls reload the SAME `years` state (`loadYears`),
    // which the period form's own selector already reads live.
    expect(SOURCE).toContain('await loadYears();');
  });

  it('the current year gets a distinct, clear refusal — not the generic dependency notice', () => {
    // ACADEMIC_YEAR_IS_CURRENT carries no blocked_by, so classifyDeletion's
    // generic conflict sentence would otherwise tell her to refresh — which
    // does not free the flag either.
    expect(SOURCE).toContain('ACADEMIC_YEAR_IS_CURRENT');
    expect(t('admin.academicYears.isCurrentCannotDelete')).toContain('السنة الدراسية الحالية');
    expect(t('admin.academicYears.isCurrentCannotDelete')).not.toContain('حدّثي الصفحة');
  });
});
