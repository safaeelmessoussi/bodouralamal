import { describe, expect, it } from 'vitest';

import { t } from '../../i18n/index.js';

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
