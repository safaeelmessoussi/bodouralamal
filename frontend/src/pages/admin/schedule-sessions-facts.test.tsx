import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CourseSchedule } from '../../adapters/course-schedules.js';
import { ClassFacts } from './schedule-sessions.js';

const klass = (over: Partial<CourseSchedule> = {}): CourseSchedule =>
  ({
    id: 'c1',
    title: 'حصة — حفظ القرآن — الحلقة 2 — الخميس 09:00',
    description: null,
    visibility: 'private',
    subject_id: 's1',
    subject_name: 'حفظ القرآن',
    scheduling_type_id: null,
    target_name: null,
    branch_name: 'مقر الرباط',
    room_name: 'القاعة 3',
    teaching_mode: 'teaching_group',
    target_id: 'g1',
    dimensions: null,
    surah_names: ['طه'],
    level_names: ['المستوى 1'],
    group_names: [],
    circle_names: ['الحلقة 2'],
    level_id: 'l1',
    branch_id: 'b1',
    room_id: 'r1',
    delivery_mode: 'in_person',
    online_media_mode: null,
    start_time: '09:00:00',
    end_time: '10:30:00',
    recurrence: 'weekly',
    weekdays: ['thursday'],
    day_of_month: null,
    month_of_year: null,
    anchor_date: '2026-09-10',
    effective_until: null,
    academic_year_id: 'y1',
    staff: [{ user_id: 'u1', position: 'teacher', user_name: 'أستاذة' }],
    version: 1,
    ...over,
  }) as CourseSchedule;

describe('R277 — «حصص الجدول» shows every detail of its class', () => {
  it('names the subject, branch, room, Level, circle, Surah, day and time, staff', () => {
    const html = renderToStaticMarkup(<ClassFacts schedule={klass()} />);
    for (const text of ['حفظ القرآن', 'مقر الرباط', 'القاعة 3', 'المستوى 1', 'الحلقة 2', 'طه', 'الخميس 09:00 – 10:30', 'أستاذة']) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('المجموعة');
  });

  it('a class عن بُعد says so in place of a room', () => {
    expect(renderToStaticMarkup(<ClassFacts schedule={klass({ delivery_mode: 'online', room_name: null })} />)).toContain('عن بُعد');
  });
});
