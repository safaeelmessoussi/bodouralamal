import { describe, expect, it } from 'vitest';

import { specOfKind } from '../../adapters/scheduling-types.js';
import { weekdaysForClass } from '../../adapters/scheduling.js';
import SCHEDULING_SOURCE from './scheduling.tsx?raw';

const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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

/**
 * **R138 — the ＋ إضافة عنصر default state must never fire a failing
 * `GET /admin/teaching-candidates` request.**
 *
 * The regression: R137 made `none` the default recurrence for a new class,
 * but the appraisal request the form already sent on every keystroke never
 * gained the one thing `none` needs to mean anything — a real occurrence
 * date — so the backend refused it with `400 VALIDATION_FAILED` from the
 * moment the dialog opened. Pinned here as a source guard because the
 * property is about WHEN the request fires and what it carries, not
 * anything `renderToStaticMarkup` on this heavily-wired page could show
 * cheaply; the backend half (the schema accepting `none` and reading
 * `date`) is proven in `teaching-candidates.http.integration.test.ts`.
 */
describe('the teaching-candidates request never fires 400 in its default state (R138)', () => {
  it('the fetch is withheld while a one-time class has no occurrence date yet', () => {
    const source = code(SCHEDULING_SOURCE);
    expect(source).toContain("(recurrence.type !== 'none' || recurrence.startDate !== '')");
  });

  it('the occurrence date is sent once one-time is chosen', () => {
    const source = code(SCHEDULING_SOURCE);
    expect(source).toContain("...(recurrence.type === 'none' ? { date: recurrence.startDate } : {})");
  });
});
