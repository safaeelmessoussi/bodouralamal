import { describe, expect, it } from 'vitest';

import { PURGE_WINDOW_DAYS } from './trash.repository.js';

/**
 * BR-15's permanent-delete window (§4.10, TD-4.8).
 *
 * The window used to be hand-computed at four delete sites; it now lives here
 * once, which makes this the single place its value can be pinned. The number
 * is a business promise, not an implementation detail: the manual-restore
 * runbook assumes a deleted record is still recoverable for 90 days.
 */
describe('BR-15 — the permanent-delete window', () => {
  it('is 90 days', () => {
    expect(PURGE_WINDOW_DAYS).toBe(90);
  });
});
