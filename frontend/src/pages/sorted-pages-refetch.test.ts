import { describe, expect, it } from 'vitest';

/**
 * **A server-sorted page must REFETCH when its sort changes** (NEW C).
 *
 * §6 wired four pages to sort on the server. Three listed `sort` in the
 * `useCallback` dependency array of their loader; `approvals.tsx` did not — so
 * clicking a header updated the state, `aria-sort` announced the new direction,
 * and the request was never re-sent. **Server-side sorting fails silently in
 * exactly this way**: the control looks alive and the rows simply do not move.
 *
 * The §6 harness missed it because it clicked headers on two of the six screens.
 * A mechanical check reaches all of them, which a browser pass over one page
 * never will.
 */
const RAW = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Pages whose sort is resolved by the SERVER, so a change must re-request. */
const SERVER_SORTED = [
  '/src/pages/admin/approvals.tsx',
  '/src/pages/admin/teachers.tsx',
  '/src/pages/admin/exam-grades.tsx',
  '/src/pages/content.tsx',
];

describe('§6 — every server-sorted page re-requests when the sort changes', () => {
  for (const path of SERVER_SORTED) {
    it(`${path.split('/').pop()} lists sort in its loader dependencies`, () => {
      const source = RAW[path];
      if (source === undefined) throw new Error(`no such source file: ${path}`);
      // The loader's dependency array — the one anchored on `accessToken`.
      const deps = /\},\s*\[accessToken[^\]]*\]/.exec(source)?.[0] ?? '';
      expect(deps, `${path} loader deps: ${deps}`).toContain('sort');
    });
  }

  it('the client-sorted pages are deliberately NOT in that list', () => {
    // الجدولة merges three sources and the إدخال الحفظ roster is unpaginated:
    // both order what they already hold, so there is nothing to re-request and
    // requiring a dependency would be requiring a pointless fetch.
    expect(SERVER_SORTED).not.toContain('/src/pages/admin/scheduling.tsx');
    expect(SERVER_SORTED).not.toContain('/src/components/quran/quran-workspace.tsx');
  });
});
