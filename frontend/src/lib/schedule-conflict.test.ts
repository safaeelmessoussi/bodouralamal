import { describe, expect, it } from 'vitest';

import { describeScheduleConflict } from './schedule-conflict.js';

/** R179 §11 — the clash in words, from `details.conflicts`. */
describe('describeScheduleConflict', () => {
  it('names a room clash: the room, the day, the window and the other occurrence', () => {
    const text = describeScheduleConflict({
      conflicts: [
        { kind: 'room', date: '2026-10-08', resourceName: 'القاعة', title: 'أحكام التجويد — الحلقة 2', startTime: '09:00', endTime: '10:00' },
      ],
      total: 1,
    });
    expect(text).toBe('القاعة «القاعة» محجوزة يوم الخميس 8 أكتوبر 2026 (09:00–10:00) لـ«أحكام التجويد — الحلقة 2». اختاري توقيتاً أو قاعة أخرى.');
  });

  it('names a person clash, says the first three and counts the rest', () => {
    const one = { kind: 'teacher', date: '2026-10-08', resourceName: 'فاطمة بوخبزى', title: 'تفسير القرآن', startTime: '09:00', endTime: '10:00' };
    const text = describeScheduleConflict({ conflicts: [one, one, one, one, one], total: 12 });
    expect(text.startsWith('فاطمة بوخبزى مرتبطة بـ«تفسير القرآن» يوم الخميس 8 أكتوبر 2026 (09:00–10:00).')).toBe(true);
    expect(text).toContain('وتعارضات أخرى: 9.');
    expect(text.endsWith('اختاري توقيتاً أو قاعة أخرى.')).toBe(true);
  });

  it('falls back to the generic sentence when the server named nothing', () => {
    expect(describeScheduleConflict({ conflicts: [{ kind: 'room', date: '2026-10-08' }] })).toBe(
      'القاعة أو أحد المؤطرين مرتبط بحصة أخرى في نفس الوقت. اختر توقيتاً أو قاعة أخرى.',
    );
    expect(describeScheduleConflict(undefined)).toContain('مرتبط بحصة أخرى');
  });
});
