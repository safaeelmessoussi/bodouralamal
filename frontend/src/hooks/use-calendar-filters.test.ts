import { describe, expect, it } from 'vitest';

import RAW_HOOK from './use-calendar-filters.ts?raw';
import ADMIN from '../pages/admin/scheduling.tsx?raw';
import PUBLIC_PAGE from '../pages/calendar.tsx?raw';
import PERSONAL from '../components/calendar/personal-calendar.tsx?raw';
import STUDENT from '../pages/dashboard/student.tsx?raw';
import TEACHER from '../pages/teacher/index.tsx?raw';

/** Comments cite the rules; scanning them would find the explanation. */
const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * **The calendar contract, asserted where it can be** (R84, rule AO).
 *
 * The geometry — that the filter row is on screen in both views — is measured in
 * Chrome by `verify-calendar-surfaces.mjs`, because a rendered box is the only
 * thing that can say it. What is asserted here is the structure that geometry
 * depends on, and the two role matrices the Owner set.
 */
describe('R84 — one filter state, no view-dependent controls', () => {
  it('the academic year is gone from calendar filtering entirely', () => {
    // It narrowed DEFINITIONS and meant nothing on a month of occurrences, so
    // it made one surface's two views behave differently — the exact asymmetry
    // this architecture ends. Absent from the field union and from every
    // calendar surface.
    // **Comments are not code.** The hook's own docstring says *`academicYearId`
    // is deliberately absent*, and asserting on the raw text found that sentence
    // and called it a violation — the trap `scheduling-parity` recorded.
    expect(code(RAW_HOOK)).not.toContain('academicYear');

    // **The FILTER declarations, not the whole page.** The back office also
    // hosts the create/edit form, which genuinely requires an academic year
    // (§4.4) — asserting the file never mentions one confused *a filter* with
    // *a field*, and would have forced the form to lose a required input.
    const admin = code(ADMIN);
    const filterFields = admin.slice(
      admin.indexOf('CALENDAR_FILTER_FIELDS = ['),
      admin.indexOf('] as const', admin.indexOf('CALENDAR_FILTER_FIELDS = [')),
    );
    expect(filterFields).not.toContain('academicYear');
    const listScope = admin.slice(
      admin.indexOf('LIST_SCOPE = ['),
      admin.indexOf('] as const', admin.indexOf('LIST_SCOPE = [')),
    );
    expect(listScope, 'the filter row still loads academic years').not.toContain('academicYear');
    for (const [name, source] of Object.entries({ PUBLIC_PAGE, PERSONAL })) {
      expect(code(source), `${name} still filters by academic year`).not.toContain(
        'academicYearId',
      );
    }
  });

  it('a filter never gates another filter', () => {
    // Rule F. The dependency clears a stale child; it disables nothing.
    const selectors = code(RAW_HOOK);
    expect(selectors).toContain('delete updated.levelId');
    expect(selectors).not.toContain('disabled');
  });

  it('every calendar surface reads the ONE shared hook', () => {
    for (const [name, source] of Object.entries({ ADMIN, PUBLIC_PAGE, PERSONAL })) {
      expect(code(source), `${name} does not use the shared filter state`).toContain(
        'useCalendarFilters',
      );
    }
  });
});

describe('R84 — the role matrix the Owner set', () => {
  /** The fields a surface passes, read from its own source. */
  const fieldsIn = (source: string, marker: string): string[] => {
    const at = code(source).indexOf(marker);
    const slice = code(source).slice(at, at + 400);
    return [...slice.matchAll(/'(branchId|categoryId|levelId|subjectId|groupId|circleId|type)'/g)].map(
      (m) => m[1]!,
    );
  };

  it('the beneficiary is offered Level and never Branch or Category', () => {
    const fields = fieldsIn(STUDENT, 'fields={[');
    expect(fields).toContain('levelId');
    // She may hold several enrolments, so Level is hers to narrow by.
    expect(fields).toContain('type');
    // Her calendar is already hers; either of these would imply a scope she
    // does not have (rule O).
    expect(fields).not.toContain('branchId');
    expect(fields).not.toContain('categoryId');
  });

  it('the مؤطرة is offered Branch and Category, because she works across them', () => {
    const fields = fieldsIn(TEACHER, 'fields={[');
    for (const f of ['branchId', 'categoryId', 'levelId', 'subjectId', 'groupId', 'circleId']) {
      expect(fields, `مؤطرة is missing ${f}`).toContain(f);
    }
  });

  it('the public visitor is offered Level and type, and no organisational scope', () => {
    const at = code(PUBLIC_PAGE).indexOf('PUBLIC_FILTER_FIELDS');
    const decl = code(PUBLIC_PAGE).slice(at, at + 200);
    expect(decl).toContain('levelId');
    expect(decl).toContain('type');
    expect(decl).not.toContain('branchId');
    expect(decl).not.toContain('categoryId');
  });
});

describe('R84 — month controls follow the DATA, not the surface', () => {
  it('the admin list passes no month, so the header omits title and stepping', () => {
    // `CalendarHeader` already omits both together when given no month (R82's
    // shape-follows-data rule), which is why no second flag exists.
    const admin = code(ADMIN);
    const at = admin.indexOf("view === 'list' ? (");
    const listHeader = admin.slice(at, at + 220);
    expect(listHeader).toContain('CalendarHeader');
    expect(listHeader).toContain('filters={filterRow}');
    expect(listHeader).not.toContain('month=');
  });

  it('and the same row is handed to the calendar view', () => {
    // ONE `filterRow`, rendered by both — the property that had been broken.
    expect(code(ADMIN)).toContain('filterRow={filterRow}');
    expect(code(ADMIN).match(/filters=\{filterRow\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('a personal calendar renders its filters unconditionally', () => {
    // It used to render them only when the surface had any, which made the row
    // a thing that could disappear.
    const personal = code(PERSONAL);
    expect(personal).toContain('filters={');
    expect(personal).not.toContain('fields.length > 0');
  });
});
