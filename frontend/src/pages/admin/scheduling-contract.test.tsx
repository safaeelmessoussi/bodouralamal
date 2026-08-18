import { describe, expect, it } from 'vitest';

import { t } from '../../i18n/index.js';

import type { CourseSchedule } from '../../adapters/course-schedules.js';
import { fromSchedule } from '../../adapters/scheduling.js';
import { recurrenceLabel, timeLabel } from '../../components/scheduling/labels.js';

/**
 * `/admin/schedules` — the client half of the contract guard.
 *
 * `api<T>()` is an **unchecked cast**: the generic asserts a shape and nothing
 * verifies it at runtime, so an adapter that names a field the API never sends
 * compiles perfectly and fails only in a browser. That is exactly how the Hijri
 * screen went blank, and the guard is the same on both sides:
 *
 * 1. **Server** — `course-schedule.http.integration.test.ts` pins the EXACT key
 *    set of a schedule row.
 * 2. **Client — here.** `WIRE` is written with that key set and typed as
 *    `CourseSchedule`, so **renaming a field in the adapter breaks this
 *    typecheck**, which is the check the cast cannot perform.
 */
const WIRE: CourseSchedule = {
  id: '00000000-0000-4000-8000-000000000001',
  // R57 — the class's own name, distinct from the Subject that identifies it.
  title: 'حلقة تحفيظ المتقدمين',
  description: null,
  subject_id: '00000000-0000-4000-8000-000000000002',
  // R55.1 — resolved labels, so a timetable can be read without ids.
  subject_name: 'تفسير',
  target_name: 'المجموعة 1',
  // Which Level the class is for, resolved server-side. For a Group-taught
  // class the row's own column is NULL, so this is the ONLY way a client learns
  // it — and the edit form could not seed its Level selector without it.
  level_id: '00000000-0000-4000-8000-000000000009',
  branch_name: 'مقر أمرشيش',
  room_name: null,
  teaching_mode: 'administrative_group',
  target_id: '00000000-0000-4000-8000-000000000003',
  branch_id: '00000000-0000-4000-8000-000000000004',
  room_id: null,
  start_time: '15:00',
  end_time: '16:30',
  recurrence: 'weekly',
  weekdays: ['tuesday'],
  day_of_month: null,
  month_of_year: null,
  anchor_date: null,
  effective_until: null,
  academic_year_id: '00000000-0000-4000-8000-000000000005',
  staff: [{ user_id: '00000000-0000-4000-8000-000000000006', position: 'teacher' }],
  version: 0,
};

describe('the adapter type matches the wire contract', () => {
  it('carries exactly the keys the server test pins', () => {
    expect(Object.keys(WIRE).sort()).toEqual([
      'academic_year_id',
      'anchor_date',
      'branch_id',
      'branch_name',
      'day_of_month',
      'description',
      'effective_until',
      'end_time',
      'id',
      // Which Level the class is for, resolved server-side (§2.2). Mirrors the
      // server key set exactly, which is what this test exists to keep true.
      'level_id',
      'month_of_year',
      'recurrence',
      'room_id',
      'room_name',
      'staff',
      'start_time',
      'subject_id',
      'subject_name',
      'target_id',
      'target_name',
      'teaching_mode',
      'title',
      'version',
      'weekdays',
    ]);
  });

  it('exposes one mode and one target, never three nullable columns (§4.4c)', () => {
    // **Restated, not relaxed** — the same restatement the server guard took.
    // The property is *no raw TARGET column is exposed*: either group column
    // would be a rival answer to *who is this for*, and a response carrying one
    // beside `target_id` would have no correct reading.
    for (const column of ['administrative_group_id', 'teaching_group_id']) {
      expect(WIRE).not.toHaveProperty(column);
    }
    // `level_id` is a RESOLVED field answering *which Level*, not a target. It
    // cannot contradict `target_id`: in `entire_level` the two agree by
    // definition, and in the other modes the target is not a Level at all.
    expect(WIRE.level_id).not.toBe(WIRE.target_id);
    expect(WIRE.teaching_mode).toBe('administrative_group');
  });
});

describe('TD-11: the time cell renders the wall clock verbatim', () => {
  it('does not reinterpret the value through a Date', () => {
    // The tempting "improvement" is to parse and reformat these. A class starts
    // at 15:00 at its branch; parsing turns that into a reader's local time and
    // silently moves the class.
    expect(timeLabel(WIRE)).toBe('15:00 – 16:30');
    expect(timeLabel(WIRE)).not.toContain('T');
    expect(timeLabel(WIRE)).not.toContain('Z');
  });

  // A timezone-shifting variant was written and REMOVED: mutating `TZ` after the
  // process has started does not change `Date`'s behaviour, so it passed
  // whatever the implementation did. A test that passes for the wrong reason is
  // worse than no test — the assertions above guard the same property honestly,
  // because `timeLabel` is pure string concatenation and 'T'/'Z' would appear
  // the moment anyone parsed the value.
});

describe('the recurrence cell', () => {
  it('lists the weekdays IN ARABIC, never the wire enum', () => {
    // The column rendered `weekdays.join()` straight from the contract, so an
    // Arabic-only interface (§6) showed `tuesday`. The enum is the contract's
    // vocabulary and is never what a reader sees.
    expect(recurrenceLabel(WIRE)).toBe(t('scheduling.weekday.tuesday'));
    expect(recurrenceLabel(WIRE)).not.toContain('tuesday');
  });

  it('translates the rule name when there are no weekdays', () => {
    // `recurrence: 'none'` with no weekdays is a real state — a one-off
    // occurrence — and an empty cell would read as missing data.
    expect(recurrenceLabel({ ...WIRE, weekdays: [], recurrence: 'monthly' })).toBe(
      // R56 — one recurrence vocabulary. The label resolves through the same
      // pattern catalog the editor's own control uses, so a table and a form
      // cannot disagree about what a rule is called.
      t('scheduling.pattern.monthly'),
    );
  });

  it('uses the SAME day names the recurrence editor checkboxes use', () => {
    // One catalog for one concept: the table and the form must not disagree
    // about what Tuesday is called.
    for (const day of ['monday', 'tuesday', 'saturday']) {
      expect(recurrenceLabel({ ...WIRE, weekdays: [day] })).toBe(t(`scheduling.weekday.${day}`));
    }
  });
});

/**
 * **The edit form's seed, which had no test and two defects** (2026-08-18).
 *
 * Reported as: open a class, change only «نهاية التكرار», press «حفظ» — and get
 * *«اختاري الحلقة المعنية»* beside a الحلقة selector reading *«لا حلقات لهذا
 * المستوى في هذا الفرع»*. Both symptoms came from the item the form seeds from,
 * so that is where the guard belongs.
 */
describe('a class row carries what an edit form must seed from', () => {
  const item = fromSchedule(WIRE);

  it('carries the row\u2019s OWN teaching mode, never a default', () => {
    // It was hard-coded to `administrative_group` for every class. The mode
    // select is disabled while editing, so an `entire_level` class opened on a
    // mode it does not have, with no way to correct it — and `teaching_mode` is
    // SENT on save, so an unrelated edit would have rewritten its audience.
    expect(item.ids.teachingMode).toBe('administrative_group');
  });

  it('carries the Level even though the class is taught to a GROUP', () => {
    // The row's own `level_id` is NULL in this mode (§4.4c allows one target),
    // so this can only be the server's resolved answer. Without it the form
    // seeded no Level, the Group list — narrowed by Level AND Branch together —
    // came back empty, and the seeded Group was dropped as invalid.
    expect(item.ids.levelId).toBe(WIRE.level_id);
    expect(item.ids.levelId).not.toBeNull();
  });

  it('reads the target as a GROUP, because that is what the mode names', () => {
    expect(item.ids.groupId).toBe(WIRE.target_id);
    // And the Level is not the target: reading one from the other is the guess
    // §4.4c warns about, and it is why these are two fields.
    expect(item.ids.levelId).not.toBe(item.ids.groupId);
  });

  it('reads an entire-level class the other way round', () => {
    const entireLevel = fromSchedule({
      ...WIRE,
      teaching_mode: 'entire_level',
      target_id: WIRE.level_id!,
    });
    expect(entireLevel.ids.teachingMode).toBe('entire_level');
    expect(entireLevel.ids.levelId).toBe(WIRE.level_id);
    // No group is chosen, and inventing one from `target_id` would name a Level
    // as a Group — which is exactly how the audience got rewritten.
    expect(entireLevel.ids.groupId).toBeNull();
  });
});
