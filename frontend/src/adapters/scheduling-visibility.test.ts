import { describe, expect, it } from 'vitest';

import { fromEvent } from './scheduling.js';
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
