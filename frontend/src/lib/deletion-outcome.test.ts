import { describe, expect, it } from 'vitest';

import { classifyDeletion } from './deletion-outcome.js';

/**
 * **`classifyDeletion` takes the CAUGHT ERROR, not a callback.**
 *
 * الشركاء called `classifyDeletion(() => deletePartner(id, token))`. The
 * function is not `null` and not an `ApiError`, so it fell through to `failed`
 * — and **the deletion was never performed**. No request reached nginx or the
 * API, and the reader was told it had failed. «حذف does nothing» was literally
 * true.
 *
 * TypeScript could not catch it: the parameter is `unknown`, which a function
 * satisfies. So the rule is asserted here instead — a callback must never be
 * classified as a plain failure, because that is the exact shape of the defect.
 */
describe('classifyDeletion is given an error, never an operation', () => {
  it('treats absence of an error as success', () => {
    expect(classifyDeletion(null).kind).toBe('deleted');
    expect(classifyDeletion(undefined).kind).toBe('deleted');
  });

  it('REFUSES a function, rather than quietly reporting failure', () => {
    // The misuse must be loud. Reporting `failed` for a callback is what let a
    // delete button do nothing for a whole release.
    expect(() => classifyDeletion(() => undefined)).toThrow(/callback|function/i);
  });
});
