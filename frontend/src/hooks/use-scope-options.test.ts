import { describe, expect, it } from 'vitest';

import { scopeFieldKey } from './use-scope-options.js';
import SOURCE from './use-scope-options.ts?raw';

/**
 * **The dependency that took `/admin/schedules` down.**
 *
 * The page passed its field list as an inline array literal, so it was a new
 * reference every render. `wants` was keyed on that array, the loading effects
 * were keyed on `wants`, and those effects set state — which re-rendered, which
 * made a new array, forever. `/branches`, `/admin/levels` and
 * `/admin/academic-years` were requested continuously and then began to fail,
 * which looked like a server fault and was not: the loop tripped Nginx's per-IP
 * edge limit (TD-13), so the rate limiter was doing its job against a client
 * defect.
 *
 * **Every other caller happened to pass a module constant**, which is precisely
 * why it survived review: the convention concealed a hook that punished anyone
 * who did the obvious thing.
 *
 * So the fix is not "always pass a constant" — that is the convention that
 * already failed. It is that **identity cannot matter**, and this is where that
 * property is checked directly, rather than inferred from counting renders.
 */
describe('the field list is a dependency by content, never by identity', () => {
  it('gives two distinct arrays with the same fields the same key', () => {
    // The exact shape of the bug: two literals, equal content, different
    // references. Before the fix these were different dependencies on every
    // render; now they are one.
    expect(scopeFieldKey(['branchId', 'levelId'])).toBe(scopeFieldKey(['branchId', 'levelId']));
  });

  it('ignores the order the caller happened to write', () => {
    // The same data is requested either way, so re-ordering must not re-fetch.
    expect(scopeFieldKey(['levelId', 'branchId'])).toBe(scopeFieldKey(['branchId', 'levelId']));
  });

  it('still distinguishes genuinely different field lists', () => {
    // The guarantee has to cut both ways: a screen that starts asking for
    // Subjects must actually load them.
    expect(scopeFieldKey(['branchId'])).not.toBe(scopeFieldKey(['branchId', 'subjectId']));
    expect(scopeFieldKey([])).not.toBe(scopeFieldKey(['branchId']));
  });

  it('is stable for a module constant too — the fix regresses no caller', () => {
    const SHARED = ['branchId', 'levelId', 'subjectId'] as const;
    expect(scopeFieldKey(SHARED)).toBe(scopeFieldKey(SHARED));
    expect(scopeFieldKey(SHARED)).toBe(scopeFieldKey(['subjectId', 'branchId', 'levelId']));
  });
});

describe('the hook actually uses that key', () => {
  /**
   * The test above proves the mechanism **exists**; on its own it would still
   * pass if somebody keyed the callback back on the array. That is the gap that
   * let the original defect through — a property nobody checked was *used* —
   * so it is checked here, at the one line where identity could creep back.
   */
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('depends on the content key, not on the array reference', () => {
    expect(code).toContain('[fieldKey]');
    // `[fields]` as a dependency array is the exact regression: a new literal
    // every render, an effect that sets state, and the loop is back.
    expect(/\[\s*fields\s*\]/.test(code), 'a dependency array keys on `fields`').toBe(false);
  });

  it('never puts a raw object or array prop in a dependency array', () => {
    // `initial` is safe only because it is read once in a `useState`
    // initializer; depending on it would reintroduce the same class of bug.
    expect(/\[\s*initial\s*\]/.test(code), 'a dependency array keys on `initial`').toBe(false);
  });
});
