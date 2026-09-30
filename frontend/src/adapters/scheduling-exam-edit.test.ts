import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveSchedulingItem } from './scheduling.js';

/**
 * **R187 §1 (Owner-reported, 2026-09-30) — editing a physical exam sends no
 * `attendance_marking`.** An exam has no such column (R123 put it on a class
 * and an activity); R136 dropped it from `PATCH /exams/{id}`'s strict
 * schema, and this adapter went on sending it — so every edit of a sitting
 * from «تعديل العنصر» came back `400 unrecognized_keys`, shown as «تعذّر
 * الحفظ» (the Owner met it while clearing the supervisor). The real request
 * body is what matters here, so `fetch` is captured rather than the source
 * pinned.
 */
describe('editing a physical exam', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('PATCHes /exams/{id} without attendance_marking, and with the staff as chosen (none is allowed)', async () => {
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ data: { id: 'x', version: 2 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    await saveSchedulingItem(
      {
        type: 'exam',
        title: '',
        description: null,
        startDate: '2026-11-05',
        endDate: null,
        startTime: '10:00',
        endTime: '11:00',
        recurrence: 'once',
        weekdays: [],
        repeatUntil: null,
        attendanceMarking: 'staff_only',
        schedulingTypeId: 'type-1',
        examMode: 'physical',
        examGroupId: null,
        // The supervisor cleared: an empty staff list is a valid sitting.
        examStaff: [],
        examMaxGrade: 20,
      },
      { id: 'exam-1', version: 1 },
      'token',
    );
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/api/v1/exams/exam-1');
    expect(patch?.body).not.toHaveProperty('attendance_marking');
    expect(patch?.body).toMatchObject({ version: 1, staff: [], scheduling_type_id: 'type-1' });
    // A class edit still carries it — the column is the class's.
  });
});
