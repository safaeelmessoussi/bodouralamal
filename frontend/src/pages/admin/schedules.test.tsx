import { describe, expect, it } from 'vitest';

import { t } from '../../i18n/index.js';

import type { CourseSchedule } from '../../adapters/course-schedules.js';
import { recurrenceLabel, timeLabel } from './schedules.js';

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
  subject_id: '00000000-0000-4000-8000-000000000002',
  // R55.1 — resolved labels, so a timetable can be read without ids.
  subject_name: 'تفسير',
  target_name: 'المجموعة 1',
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
      'effective_until',
      'end_time',
      'id',
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
      'version',
      'weekdays',
    ]);
  });

  it('exposes one mode and one target, never three nullable columns (§4.4c)', () => {
    for (const column of ['level_id', 'administrative_group_id', 'teaching_group_id']) {
      expect(WIRE).not.toHaveProperty(column);
    }
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
      t('calendar.recurrence.monthly'),
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
