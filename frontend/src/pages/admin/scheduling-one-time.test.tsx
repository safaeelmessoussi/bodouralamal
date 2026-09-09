import { describe, expect, it } from 'vitest';

import { specOfKind } from '../../adapters/scheduling-types.js';
import { weekdaysForClass } from '../../adapters/scheduling.js';

/**
 * **R137 — «مرة واحدة» for حصة دراسية/محاضرة** (Owner decision, 2026-09-09).
 *
 * The registry (`scheduling-types.ts`) is the single source `initialRecurrenceType`
 * and `RecurrenceEditor`'s `allowOnce` both read — see `recurrence-editor.test.ts`
 * for the weekday-mapping half of this and `recurrence.test.ts` (backend) for the
 * expansion half. This file pins the one fact that lives only in the registry.
 */
describe('a class/lecture may now be scheduled once (R137)', () => {
  it('allowsOnce is true for the class structural kind', () => {
    expect(specOfKind('class').allowsOnce).toBe(true);
  });

  it('every structural kind allows once, since R137 closed the one gap', () => {
    for (const kind of ['class', 'activity', 'holiday', 'exam'] as const) {
      expect(specOfKind(kind).allowsOnce, kind).toBe(true);
    }
  });

  it('a one-time class sends no weekday — anchor_date alone names its day', () => {
    expect(weekdaysForClass('none', [], '2026-09-01')).toEqual([]);
  });
});
