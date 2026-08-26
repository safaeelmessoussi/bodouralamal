import { describe, expect, it } from 'vitest';

import type { Exam } from '../../adapters/exams.js';
import type { Occurrence } from '../../adapters/calendar.js';
import { OCCURRENCE_KIND_BADGE, OCCURRENCE_KIND_LABEL } from '../../adapters/calendar.js';
import { AVAILABLE_TYPES, specOfKind } from '../../adapters/scheduling-types.js';
import { examStaffOf } from '../../components/scheduling/exam-section.js';
import { t } from '../../i18n/index.js';

/**
 * Physical exams in the unified scheduling module (§4.6, Revision 58).
 *
 * The client half of the contract guard, on the same reasoning as
 * `scheduling-contract.test.tsx`: `api<T>()` is an unchecked cast, so `WIRE`
 * below is written with the key set `exam.http.integration.test.ts` pins on the
 * server and typed as `Exam` — **renaming a field in the adapter breaks this
 * typecheck**, which is the check the cast cannot perform.
 *
 * Beyond the contract, this pins the three claims R58 makes about the interface
 * and nothing else can observe: an exam is a registry entry rather than a
 * branch, `null` means *the whole Level*, and the colour is the same token on
 * every surface.
 */
const WIRE: Exam = {
  id: '00000000-0000-4000-8000-0000000000e1',
  mode: 'physical',
  title: 'امتحان الفصل الأول',
  // R81 — the exam's own maximum; there is no platform scale to inherit one.
  max_grade: 20,
  description: 'تفتح القاعة قبل ربع ساعة',
  // R109 (§D) — every kind carries a tier; the fixture states one rather
  // than letting the mapper fall back to a default.
  visibility: 'private',
  date: '2026-09-14',
  start_time: '09:00',
  end_time: '11:00',
  level_id: '00000000-0000-4000-8000-0000000000e2',
  level_name: 'المستوى 1',
  subject_id: '00000000-0000-4000-8000-0000000000e3',
  subject_name: 'تفسير',
  academic_year_id: '00000000-0000-4000-8000-0000000000e4',
  branch_id: '00000000-0000-4000-8000-0000000000e5',
  branch_name: 'مقر أمرشيش',
  room_id: '00000000-0000-4000-8000-0000000000e6',
  room_name: 'قاعة 1',
  administrative_group_id: null,
  administrative_group_name: null,
  staff: [{ user_id: '00000000-0000-4000-8000-0000000000e7', position: 'supervisor' }],
  version: 0,
};

describe('the adapter type matches the wire contract', () => {
  it('carries exactly the keys the server test pins', () => {
    expect(Object.keys(WIRE).sort()).toEqual([
      'academic_year_id',
      'administrative_group_id',
      'administrative_group_name',
      'branch_id',
      'branch_name',
      'date',
      'description',
      'end_time',
      'id',
      'level_id',
      'level_name',
      // R81 — mirrors the server test's exact key set, which is the point of
      // this assertion: the two contracts are asserted against each other.
      'max_grade',
      'mode',
      'room_id',
      'room_name',
      'staff',
      'start_time',
      'subject_id',
      'subject_name',
      'title',
      'version',
      // R109 (§D) — the sitting's own tier, superseding §4.6's "no tier of its
      // own". Pinned so it cannot join the contract by accident.
      'visibility',
    ]);
  });

  it('has no online field, deliberately', () => {
    // A field with nothing behind it is a promise the platform has not made.
    // When the mode arrives it needs a link, an audience, an open/close window
    // and submission rules — a shape nobody has decided.
    for (const column of ['exam_url', 'opens_at', 'closes_at', 'access_policy', 'questions']) {
      expect(WIRE).not.toHaveProperty(column);
    }
  });
});

describe('R56 promised a third arm, not a second scheduling experience', () => {
  it('offers the exam from the registry, so no picker can fall behind it', () => {
    // The list filter and the type picker both read this. A hand-written list
    // is exactly the copy that silently omits a new kind.
    expect(AVAILABLE_TYPES).toContain('exam');
  });

  it('declares what an exam IS rather than letting the form infer it', () => {
    const spec = specOfKind('exam');
    // One dated sitting: `once` is the only honest pattern, and offering
    // *weekly* would describe something the model cannot represent.
    expect(spec.allowsOnce).toBe(true);
    // A sitting nobody can attend is not a sitting — no all-day exam exists.
    expect(spec.hasAllDay).toBe(false);
    // It produces no Sessions, so R50's occurrence scopes have nothing to act on.
    expect(spec.hasOccurrences).toBe(false);
  });
});

describe('the exam colour is one token, used on every surface', () => {
  it('gives the calendar chip and the list badge the same modifier', () => {
    // The chip is `event-chip--exam`; the badge is `badge--exam`. They read the
    // same `--color-exam` token, which is what stops the list and the grid from
    // disagreeing about what an exam looks like.
    expect(OCCURRENCE_KIND_BADGE.exam).toBe('exam');
    // A class and an activity keep their own hues, so three kinds are three
    // colours rather than two plus a special case.
    expect(OCCURRENCE_KIND_BADGE.session).toBe('class');
    expect(OCCURRENCE_KIND_BADGE.event).toBe('activity');
  });

  it('names the kind in Arabic, so colour is never the only signal', () => {
    // §14.4 and plain accessibility: a reader who cannot separate violet from
    // green still reads "امتحان".
    expect(t(OCCURRENCE_KIND_LABEL.exam)).toBe('امتحان');
    expect(t(OCCURRENCE_KIND_LABEL.exam)).not.toContain('calendar.');
  });

  it('accepts an exam occurrence from the calendar contract', () => {
    // Typed as `Occurrence`: the server sends `kind: 'exam'`, and a client type
    // that still knew only two kinds would fail here rather than in a browser.
    const occurrence: Pick<Occurrence, 'kind' | 'recurrence'> = {
      kind: 'exam',
      // Not a rule that repeats — `null`, never `'none'`.
      recurrence: null,
    };
    expect(OCCURRENCE_KIND_BADGE[occurrence.kind]).toBe('exam');
  });
});

describe('exam staff are supervisors, not instructors', () => {
  it('puts exactly one supervisor first, with any number of assistants', () => {
    expect(examStaffOf('s1', ['a1', 'a2'])).toEqual([
      { user_id: 's1', position: 'supervisor' },
      { user_id: 'a1', position: 'assistant' },
      { user_id: 'a2', position: 'assistant' },
    ]);
  });

  it('omits the supervisor rather than sending an empty id', () => {
    // The form refuses to save without one; if it ever did, an empty string
    // would be a foreign key the server cannot resolve, which reads as a bug
    // in the exam rather than in the form.
    expect(examStaffOf('', ['a1'])).toEqual([{ user_id: 'a1', position: 'assistant' }]);
  });
});
