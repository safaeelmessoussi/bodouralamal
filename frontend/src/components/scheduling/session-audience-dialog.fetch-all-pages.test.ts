import { describe, expect, it } from 'vitest';

import { fetchAllPages } from './session-audience-dialog.js';

/**
 * **Codex review, 2026-09-20 — الحضور's group/circle pickers must not
 * silently truncate at 100 rows.**
 *
 * `listAdministrativeGroups`/`listCircles` were each called once, discarding
 * `meta.total`, so an institute with more than 100 groups or more than 100
 * circles had entries a combined class could never select — no error, no
 * "showing 100 of 240", just a picker one row short of complete. `fetchAllPages`
 * is the fix; these are direct, behavioural tests of ITS OWN logic (never a
 * source-string pin), with a fake page source standing in for the adapter.
 */
function page<T>(data: T[], total: number): { data: T[]; meta: { page: number; page_size: number; total: number } } {
  return { data, meta: { page: 1, page_size: data.length, total } };
}

describe('fetchAllPages', () => {
  it('returns everything from a single page unchanged', async () => {
    const rows = await fetchAllPages(async () => page(['a', 'b', 'c'], 3));
    expect(rows).toEqual(['a', 'b', 'c']);
  });

  it('walks every page until it has collected `meta.total` rows', async () => {
    const calls: number[] = [];
    const rows = await fetchAllPages(async (p) => {
      calls.push(p);
      // Two full pages of 100 plus a partial third — the exact shape an
      // institute with 240 circles would produce.
      if (p === 1) return page(Array.from({ length: 100 }, (_, i) => i), 240);
      if (p === 2) return page(Array.from({ length: 100 }, (_, i) => 100 + i), 240);
      return page(Array.from({ length: 40 }, (_, i) => 200 + i), 240);
    });
    expect(calls).toEqual([1, 2, 3]);
    expect(rows).toHaveLength(240);
    expect(rows[0]).toBe(0);
    expect(rows[239]).toBe(239);
  });

  it('stops as soon as a short page confirms there is nothing more, even if `meta.total` disagrees', async () => {
    // A defensive floor against a malformed `meta.total`: a page shorter than
    // the page size is itself proof that nothing more remains, and the loop
    // must not spin past that waiting for a count that will never be reached.
    const calls: number[] = [];
    const rows = await fetchAllPages(async (p) => {
      calls.push(p);
      return { data: ['only'], meta: { page: p, page_size: 100, total: 999 } };
    });
    expect(calls).toEqual([1]);
    expect(rows).toEqual(['only']);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    await expect(
      fetchAllPages(async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
  });
});
