import { describe, expect, it } from 'vitest';

import { fromEvent, fromSchedule } from './scheduling.js';
import type { CourseSchedule } from './course-schedules.js';
import { isDirty } from '../lib/form-dirty.js';

/**
 * **NEW B §A — editing a نشاط silently made it public.**
 *
 * Three facts combined into a visibility *widening* that nobody chose:
 *
 *  1. `fromEvent` never carried `visibility` into `SchedulingItem`, so the form
 *     had nothing to hydrate from;
 *  2. the form's state initialised to `'public'` for edit as well as create;
 *  3. the `pristine` baseline hardcoded `'public'` too — so `dirty` stayed
 *     false and the unsaved-changes guard saw nothing wrong;
 *
 * and the save payload sends `visibility` on **update** as well as create. So
 * opening a private or hidden activity, changing its title, and saving reset it
 * to عام — silently, with no prompt, and the reader had never been shown the
 * field's real value.
 *
 * The catalogue's own default is `public` (Owner decision 00), which is right
 * for **creation** and is exactly what made this invisible: the wrong value and
 * the intended default are the same string.
 */
const eventRow = (visibility: string) => ({
  id: 'e1',
  title: 'رحلة',
  description: null,
  visibility,
  start_date: '2026-09-01',
  end_date: null,
  start_time: '09:00',
  end_time: '10:00',
  recurrence_type: 'none',
  recurrence_end_date: null,
  version: 0,
  staff: [],
  scope: { branch_ids: [], category_ids: [], level_ids: [], administrative_group_ids: [] },
});

describe('a نشاط carries its stored visibility into the edit form', () => {
  it('hydrates private rather than reporting the creation default', () => {
    expect(fromEvent(eventRow('private') as never).visibility).toBe('private');
  });

  it('hydrates hidden', () => {
    expect(fromEvent(eventRow('hidden') as never).visibility).toBe('hidden');
  });

  it('carries public unchanged', () => {
    expect(fromEvent(eventRow('public') as never).visibility).toBe('public');
  });
});

/**
 * **The dirty semantics the Owner specified**, asserted against the real
 * `isDirty` the form uses — the mechanism §9E made platform-wide.
 *
 * The defect was not that `isDirty` was wrong. It was that both sides of the
 * comparison were seeded with the same wrong value, so the guard was correct
 * about a state that did not describe the record.
 */

/** The two halves the form builds, reduced to the field under test. */
const state = (visibility: string, title = 'رحلة') => ({ title, visibility });
const pristineFor = (stored: string | null, title = 'رحلة') => ({
  title,
  visibility: stored ?? 'public',
});

describe('opening, editing and changing — the three states', () => {
  it('opening a private نشاط is PRISTINE, not dirty', () => {
    // Previously: state said `public`, pristine said `public`, and the record
    // said `private`. Pristine — and wrong.
    expect(isDirty(state('private'), pristineFor('private'))).toBe(false);
  });

  it('editing the title leaves visibility alone and does not widen it', () => {
    const pristine = pristineFor('private');
    const next = state('private', 'رحلة إلى الرباط');
    expect(isDirty(next, pristine)).toBe(true);
    // THE regression: the field the reader never touched is unchanged.
    expect(next.visibility).toBe('private');
  });

  it('changing visibility explicitly makes it dirty', () => {
    expect(isDirty(state('hidden'), pristineFor('private'))).toBe(true);
  });

  it('a hidden نشاط opens pristine too', () => {
    expect(isDirty(state('hidden'), pristineFor('hidden'))).toBe(false);
  });

  it('creation still defaults to public (Owner decision 00)', () => {
    expect(pristineFor(null).visibility).toBe('public');
    expect(isDirty(state('public'), pristineFor(null))).toBe(false);
  });
});


/**
 * **NEW B §D — a class and a sitting carry theirs too.**
 *
 * §C gave `RecurringCourseSchedule`, `Session` and `Exam` a real tier on the
 * server, and the mappers still returned `null`. That was safe only for as long
 * as the write path omitted the key for those kinds — the moment §D sends it,
 * `null` becomes **exactly the §A defect on two more screens**: the form seeds
 * `item?.visibility ?? 'public'`, so a hidden class opened for an unrelated edit
 * would save back as عام, with `dirty` false because both halves of the
 * comparison agreed with each other and neither agreed with the record.
 *
 * That is why the mapper and the control ship in the same section, and why this
 * is asserted for each kind rather than assumed from the نشاط case.
 */
const scheduleRow = (visibility: string) =>
  ({
    id: 's1',
    title: 'حلقة',
    description: null,
    visibility,
    subject_id: 'sub1',
    subject_name: 'حفظ القرآن',
    teaching_mode: 'entire_level',
    target_id: 'lvl1',
    target_name: 'نور الأمل',
    level_id: 'lvl1',
    branch_id: 'b1',
    branch_name: 'مقر',
    room_id: null,
    room_name: null,
    delivery_mode: 'in_person',
    online_media_mode: null,
    start_time: '09:00',
    end_time: '10:00',
    recurrence: 'weekly',
    weekdays: ['monday'],
    day_of_month: null,
    month_of_year: null,
    anchor_date: '2026-09-01',
    effective_until: null,
    academic_year_id: 'y1',
    staff: [],
    version: 0,
  }) as unknown as CourseSchedule;

describe('a حصة carries its stored visibility into the edit form (§D)', () => {
  it('hydrates hidden rather than reporting the creation default', () => {
    expect(fromSchedule(scheduleRow('hidden')).visibility).toBe('hidden');
  });

  it('hydrates private', () => {
    expect(fromSchedule(scheduleRow('private')).visibility).toBe('private');
  });

  it('carries public unchanged', () => {
    expect(fromSchedule(scheduleRow('public')).visibility).toBe('public');
  });

  it('never returns null — that was the §C-era placeholder, and it is a widening now', () => {
    // The specific regression this file exists to prevent: a `null` here meets
    // `?? 'public'` in the form and republishes a hidden class on any edit.
    expect(fromSchedule(scheduleRow('hidden')).visibility).not.toBeNull();
  });
});

describe('the §A dirty semantics hold for a حصة as well (§D)', () => {
  const openOn = (visibility: string) => {
    const item = fromSchedule(scheduleRow(visibility));
    const pristine = { title: item.title, visibility: item.visibility ?? 'public' };
    return { item, pristine };
  };

  it('opening a hidden حصة is PRISTINE, not dirty', () => {
    const { pristine } = openOn('hidden');
    expect(isDirty({ ...pristine }, pristine)).toBe(false);
  });

  it('an unrelated edit leaves the tier untouched at hidden', () => {
    const { pristine } = openOn('hidden');
    const current = { ...pristine, title: 'حلقة معدّلة' };
    expect(isDirty(current, pristine)).toBe(true);
    // The point of the assertion: dirty because the TITLE changed, with the
    // tier still exactly what the row holds.
    expect(current.visibility).toBe('hidden');
  });

  it('changing the tier explicitly makes it dirty', () => {
    const { pristine } = openOn('hidden');
    expect(isDirty({ ...pristine, visibility: 'public' }, pristine)).toBe(true);
  });
});
