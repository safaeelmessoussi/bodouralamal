import { describe, expect, it } from 'vitest';

import { fromEvent, fromSchedule } from './scheduling.js';
import SOURCE from './scheduling.ts?raw';

/**
 * المؤطِّرات showed a bare count on الجدولة, never who (Owner-reported,
 * 2026-09-15): `staffCount` was the only field the wire's `staff` array fed,
 * so a reader had to open the item just to see who was assigned. `staffNames`
 * carries the names the backend now resolves alongside the count (never
 * instead of it — `staffCount === null` still means *this kind has no
 * staffing at all*, a fact `staffNames.length === 0` alone cannot state).
 *
 * `fromEvent`'s own count was ALSO hardcoded `null` regardless of R71's real
 * staffing — a second, adjacent defect this fix corrects at the same time
 * (its own docstring names the contradiction it was silently carrying).
 */
const scheduleRow = () => ({
  id: 's1',
  title: 'حصة',
  attendance_marking: 'staff_only' as const,
  visibility: 'public',
  anchor_date: '2026-09-01',
  start_time: '09:00',
  end_time: '10:00',
  recurrence: 'weekly',
  weekdays: ['saturday'],
  effective_until: null,
  branch_name: null,
  room_name: null,
  target_name: null,
  subject_name: null,
  teaching_mode: 'entire_level',
  version: 0,
  scheduling_type_id: null,
  branch_id: 'b1',
  room_id: null,
  delivery_mode: 'in_person',
  online_media_mode: null,
  level_id: 'l1',
  target_id: 'l1',
  subject_id: 'sub1',
  academic_year_id: 'ay1',
  staff: [
    { user_id: 'u1', position: 'teacher', user_name: 'صفاء المسوسي' },
    { user_id: 'u2', position: 'assistant', user_name: 'حليمة بوزحيف' },
  ],
});

const eventRow = () => ({
  id: 'e1',
  title: 'نشاط',
  description: null,
  visibility: 'public',
  start_date: '2026-09-01',
  end_date: null,
  start_time: '09:00',
  end_time: '10:00',
  recurrence: 'none',
  recurrence_end_date: null,
  branch_ids: [],
  version: 0,
  scheduling_type_id: null,
  staff: [{ user_id: 'u1', position: 'responsible', user_name: 'صفاء المسوسي' }],
});

describe('السجل يحمل أسماء المؤطِّرات إلى جانب عددهم', () => {
  it('a class carries both the count and the real names', () => {
    const item = fromSchedule(scheduleRow() as never);
    expect(item.staffCount).toBe(2);
    expect(item.staffNames).toEqual(['صفاء المسوسي', 'حليمة بوزحيف']);
  });

  it('an activity ALSO carries its real count and names, not a hardcoded null', () => {
    const item = fromEvent(eventRow() as never);
    expect(item.staffCount).toBe(1);
    expect(item.staffNames).toEqual(['صفاء المسوسي']);
  });

  it('a null user_name is dropped, never rendered as an empty name', () => {
    const item = fromSchedule({
      ...scheduleRow(),
      staff: [{ user_id: 'u1', position: 'teacher', user_name: null }],
    } as never);
    expect(item.staffNames).toEqual([]);
  });
});

describe('an exam sitting also carries its real staff names (source-pinned — fromExam is not exported)', () => {
  const source = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('fromExam populates staffNames from row.staff\'s user_name, filtering out null/undefined', () => {
    const fromExamBody = source.slice(
      source.indexOf('function fromExam'),
      source.indexOf('function ', source.indexOf('function fromExam') + 1),
    );
    expect(fromExamBody).toContain(
      "staffNames: row.staff.map((x) => x.user_name).filter((n): n is string => n !== null && n !== undefined),",
    );
  });
});
