import { describe, expect, it } from 'vitest';

import RESOURCES from './resources.tsx?raw';

/**
 * **R188 §2 — the library names no Category and no Level in code.**
 *
 * It used to sort its Categories by a hard-coded progression (`المرأة /
 * اليافعات / الطفل`, R121) — a list that had once drifted from the seed and
 * matched nothing, which is the failure mode of every name kept in code. The
 * Super Admin's own order on «الفئات» and «المستويات» is now read from the
 * public calendar bootstrap (which orders both, a Level within its Category)
 * and applied to the filters and the shelves alike; a row the bootstrap does
 * not know sorts last rather than being dropped.
 */
describe('the library orders Categories and Levels by the Super Admin, never by a list in code', () => {
  it('declares no CATEGORY_ORDER and reads the bootstrap order', () => {
    expect(RESOURCES).not.toMatch(/CATEGORY_ORDER|categoryRank/);
    expect(RESOURCES).toContain('fetchCalendarBootstrap');
    expect(RESOURCES).toContain('category: new Map(bootstrap.categories.map((c, i) => [c.id, i]))');
    expect(RESOURCES).toContain('level: new Map(bootstrap.levels.map((l, i) => [l.id, i]))');
  });

  it('ranks an unknown row last rather than dropping it', () => {
    expect(RESOURCES).toContain('map.get(id) ?? Number.MAX_SAFE_INTEGER');
  });
});
