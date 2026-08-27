import { describe, expect, it } from 'vitest';

/**
 * **§6's audit, as a guard: which columns are sortable, and which must not be.**
 *
 * The Owner asked for both directions — columns that look sortable and are not,
 * and columns that are sortable when their ordering means nothing. R76's test is
 * *a column is sortable when its ordering means something, not when the data
 * happens to permit one*, and that judgement is invisible to a type checker.
 *
 * Read as SOURCE deliberately. These pages have no layout engine in this test
 * environment, and the property is a declaration — `sortKey` present or absent
 * on a named column — which the text states exactly.
 */
const RAW = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Comments name the columns they explain, so only CODE is scanned — otherwise
 *  a note about a column that must NOT sort would look like one that does. */
function read(path: string): string {
  const text = RAW[path];
  if (text === undefined) throw new Error(`no such source file: ${path}`);
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `key: 'x',` … `sortKey:` within the same column literal. */
function sortableKeys(source: string): Set<string> {
  const found = new Set<string>();
  const columns = source.split(/key:\s*'/).slice(1);
  for (const chunk of columns) {
    const name = chunk.slice(0, chunk.indexOf("'"));
    // The column literal ends at the next `key: '` — already the chunk bound.
    if (/\bsortKey:/.test(chunk)) found.add(name);
  }
  return found;
}

const PAGES: { label: string; path: string; sortable: string[]; never: string[] }[] = [
  {
    label: 'المؤطِّرات',
    path: '/src/pages/admin/teachers.tsx',
    sortable: ['name'],
    // Fetched per row AFTER the page arrives, so sorting by them would order
    // the 25 rows this page holds and present it as the collection's order.
    // `branches` comes from the row itself, but a person may hold several
    // assignments, so there is no single value to order by — the server sorts
    // rows, not sets.
    never: ['branches', 'subjects', 'categories', 'availability'],
  },
  {
    label: 'طلبات الانضمام',
    path: '/src/pages/admin/approvals.tsx',
    sortable: ['applicants', 'submitted'],
    // `bundle` is a derived count of what a request contains; ordering by it
    // means nothing to an approver.
    never: ['bundle'],
  },
  {
    label: 'الجدولة',
    path: '/src/pages/admin/scheduling.tsx',
    /**
     * **RESTATED for §8 — the date/time sort moved to the column that shows the
     * date.**
     *
     * This table listed a clock window and no day at all, so it could not
     * answer *when is this*. §8 gave it a `date` column, and the composed
     * date/time `sortKey` went with it: sorting a timetable means ordering it
     * by when things happen, and the reader now sees the value she is sorting.
     * The sort is the same one; the column carrying it is the honest one.
     */
    sortable: ['type', 'title', 'date', 'branch'],
    // Derived descriptions rather than fields — and `visibility` for the reason
    // مكتبة المحتوى keeps it unsortable: an enum whose alphabetical order is
    // not its meaningful one.
    never: ['audience', 'recurrence', 'visibility', 'venue', 'staff'],
  },
  {
    label: 'مكتبة المحتوى',
    path: '/src/pages/content.tsx',
    sortable: ['title', 'branch', 'size', 'created'],
    // Enums whose alphabetical order is not their meaningful one — the
    // reasoning that kept `account_status` off المستخدمون. Both have filters.
    never: ['kind', 'visibility'],
  },
  {
    label: 'نقاط الامتحانات',
    path: '/src/pages/admin/exam-grades.tsx',
    sortable: ['title', 'date', 'level', 'subject'],
    never: ['audience'],
  },
];

describe('§6 — the sortable columns are exactly the meaningful ones', () => {
  for (const page of PAGES) {
    it(`${page.label}: sorts ${page.sortable.join(', ')} and nothing else`, () => {
      const keys = sortableKeys(read(page.path));
      for (const key of page.sortable) {
        expect(keys, `${page.label} must sort ${key}`).toContain(key);
      }
      for (const key of page.never) {
        expect(keys, `${page.label} must NOT sort ${key}`).not.toContain(key);
      }
    });
  }

  it('a column may sort by a DIFFERENT contract field, and says which', () => {
    // `created` is what the column is called; `published` is what `GET /library`
    // calls the field. The distinction is the whole point of `sortKey` — R76's
    // `sort_by` names a field in the CONTRACT, never a column or a heading.
    expect(read('/src/pages/content.tsx')).toContain("sortKey: 'published'");
  });

  it('no page sorts its action column', () => {
    for (const page of PAGES) {
      expect(sortableKeys(read(page.path))).not.toContain('actions');
    }
  });
});

/**
 * **The draft-bearing editors stay stable** — the Owner's narrow rule.
 *
 * Sorting must not reorder rows underneath somebody editing them. Both screens
 * carry a selection table AND an editor; the selection table sorts and the
 * editor does not, so the guard is that the sheet's own table declares no sort
 * handler.
 */
describe('§6 — a draft-bearing sheet is never reordered', () => {
  it('the grade sheet declares no sort, while the exam list does', () => {
    const sheet = read('/src/components/grading/grade-sheet.tsx');
    expect(sheet).not.toContain('onSort');
    expect(read('/src/pages/admin/exam-grades.tsx')).toContain('onSort');
  });

  it('إدخال الحفظ sorts the roster and not the memorisation sheet', () => {
    const workspace = read('/src/components/quran/quran-workspace.tsx');
    // Exactly one sortable table on the screen: the roster.
    expect(workspace.match(/onSort=/g)?.length ?? 0).toBe(1);
    expect(workspace).toContain('rosterSort');
  });
});
