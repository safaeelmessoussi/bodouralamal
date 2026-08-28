import { describe, expect, it } from 'vitest';

import { isDirty } from './form-dirty.js';

/**
 * **Key order is not information about what the reader typed** (2026-08-28).
 *
 * `isDirty` compared serialised snapshots and was order-sensitive for object
 * keys, on the reasoning that both sides are built by the same literal in the
 * same file. الجدولة falsified that: its two snapshots are **separate
 * literals**, and `schedulingTypeId` was second in one and twentieth in the
 * other. Every value matched, the form was permanently dirty, and opening
 * إضافة عنصر or تعديل العنصر and closing it asked to discard nothing.
 */
describe('isDirty compares values, not key positions', () => {
  it('is clean when the same values are written in a different key order', () => {
    // The exact shape of the defect, minimised.
    expect(isDirty({ a: 1, b: 2, c: 3 }, { c: 3, a: 1, b: 2 })).toBe(false);
  });

  it('sees through nesting too', () => {
    expect(isDirty({ outer: { x: 1, y: 2 } }, { outer: { y: 2, x: 1 } })).toBe(false);
  });

  it('still reports a genuine change', () => {
    expect(isDirty({ a: 1, b: 2 }, { b: 2, a: 9 })).toBe(true);
    expect(isDirty({ a: 1 }, { a: 1, b: 2 })).toBe(true);
  });

  it('KEEPS array order significant — a reordered list is a change', () => {
    // The one thing the original comparison got right, and the narrowing must
    // not lose it: dragging a list into a new order is unsaved work.
    expect(isDirty(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isDirty({ ids: ['a', 'b'] }, { ids: ['b', 'a'] })).toBe(true);
  });
});
