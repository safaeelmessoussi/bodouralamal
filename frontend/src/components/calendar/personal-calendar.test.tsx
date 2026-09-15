import { describe, expect, it } from 'vitest';

import SOURCE from './personal-calendar.tsx?raw';

/**
 * تقويمي's filter row must offer HER own Categories/Levels/Subjects/groups/
 * circles, never the association's whole catalogue (Owner-reported,
 * 2026-09-15, screenshot evidence: the level selector listed every level in
 * every category). The bug was structural: `CalendarFilters` was fed
 * `bootstrap?.categories`/`bootstrap?.levels` — the SAME unscoped
 * `GET /calendar/bootstrap` chrome the anonymous public timetable reads —
 * while `groups`/`circles`/`subjects` were never passed at all (silently
 * empty). Source-pinning: a live render needs a mocked fetch for both the
 * bootstrap and the new options endpoint, while the regression itself is
 * which adapter result feeds which prop — exactly what a render cannot tell
 * apart without also asserting on the mock, at which point the assertion IS
 * the source check.
 */
const source = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('تقويمي reads its filter options from her own scoped vocabulary', () => {
  it('imports fetchMyCalendarOptions', () => {
    expect(source).toMatch(/import\s*{[^}]*fetchMyCalendarOptions[^}]*}\s*from\s*'\.\.\/\.\.\/adapters\/calendar\.js'/);
  });

  it('fetches it once, keyed only on the token — not on the visible month', () => {
    expect(source).toMatch(/void fetchMyCalendarOptions\(token\)[\s\S]{0,60}\.then\(setOptions\)/);
    expect(source).toMatch(/}, \[token\]\);/);
  });

  it('feeds CalendarFilters from options, not from the public bootstrap', () => {
    const filtersCall = source.slice(source.indexOf('<CalendarFilters'), source.indexOf('/>', source.indexOf('<CalendarFilters')));
    expect(filtersCall).toContain('branches={options?.branches ?? []}');
    expect(filtersCall).toContain('categories={options?.categories ?? []}');
    expect(filtersCall).toContain('levels={options?.levels ?? []}');
    expect(filtersCall).toContain('subjects={options?.subjects ?? []}');
    expect(filtersCall).toContain('groups={options?.groups ?? []}');
    expect(filtersCall).toContain('circles={options?.circles ?? []}');
    // The regression this guards: neither field may still read from the
    // unscoped public bootstrap.
    expect(filtersCall).not.toContain('bootstrap?.categories');
    expect(filtersCall).not.toContain('bootstrap?.levels');
  });
});
