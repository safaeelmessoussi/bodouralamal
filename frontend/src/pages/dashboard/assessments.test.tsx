import { describe, expect, it } from 'vitest';

import PAGE_SOURCE from './assessments.tsx?raw';

/**
 * «اختباراتي should show the table; if no exams, the table is empty»
 * (Owner, 2026-09-15). The page used to replace its whole `<ul>` list with a
 * bare `<EmptyState />` when `rows.length === 0`, which reads as an unbuilt
 * screen rather than a finished one with nothing in it — the exact defect
 * `DataTable` was already corrected for on every admin list (2026-08-30, see
 * its own docstring). Migrated to the shared component rather than
 * special-casing this one page a second time.
 *
 * Source-pinning: a live render needs a mocked `myAssessments` fetch behind
 * `useEffect`, while the actual regression is structural — that the page
 * hands its rows to `DataTable` (whose own test file already proves the
 * empty-row behaviour) rather than to a hand-rolled list.
 */
const source = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('اختباراتي keeps its columns when there is nothing to list', () => {
  it('no longer renders a bare <ul> list', () => {
    expect(source).not.toMatch(/<ul className="assessment-list">/);
  });

  it('renders through the shared DataTable, carrying status and error through for its own states', () => {
    expect(source).toContain('import { DataTable, type Column } from');
    expect(source).toMatch(/<DataTable<StudentAssessment>[\s\S]*?columns={columns}[\s\S]*?rows={rows}/);
    expect(source).toMatch(/status={state}[\s\S]{0,40}error={failure}/);
  });

  it('keeps the row action label distinct — فتح before a start, مراجعة إجاباتي after one', () => {
    expect(source).toContain(
      "t(row.state === 'submitted' ? 'assessments.review' : 'assessments.open')",
    );
  });
});
