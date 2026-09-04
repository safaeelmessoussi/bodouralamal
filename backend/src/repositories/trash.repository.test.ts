import { describe, expect, it } from "vitest";

import { TRASH_WINDOW_DAYS } from "./trash.repository.js";

/**
 * BR-15's permanent-delete window (§4.10, TD-4.8).
 *
 * The window used to be hand-computed at four delete sites; it now lives here
 * once, which makes this the single place its value can be pinned. The number
 * is a business promise, not an implementation detail: the manual-restore
 * runbook assumes a deleted record is still recoverable for seven days.
 */
describe("BR-15 — the permanent-delete window", () => {
  it("is seven days, for every entity alike", () => {
    // Revision 133 collapsed ninety-for-records and three-for-accounts into one
    // number. A test that merely read the constant back would pass whatever it
    // said; this pins the POLICY, so moving it needs a decision.
    expect(TRASH_WINDOW_DAYS).toBe(7);
  });
});
