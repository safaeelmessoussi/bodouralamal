import { describe, expect, it } from 'vitest';

import PAGE_SOURCE from './assessments.tsx?raw';

/**
 * **اختباراتي/نقاطي merged into one page, one table** (Owner-reported,
 * 2026-09-16). Source-pinning throughout: a live render needs a mocked
 * `myAssessments`/`fetchMyGrades` fetch behind `useEffect`, while every
 * property here is structural — that the two sources are merged by exam id,
 * that طريقة الحضور/الحالة/the review button are gated the way the Owner asked,
 * and that the table stays sortable and reachable for a parent acting for a
 * child, none of which a render test proves more directly than the source
 * itself.
 */
const source = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('اختباراتي merges both sources by exam id', () => {
  it('fetches both /me/assessments and /students/me/grades', () => {
    expect(source).toContain('myAssessments(accessToken, childHeader)');
    expect(source).toContain('fetchMyGrades(accessToken, childHeader)');
  });

  it('merges by exam id — an id from either source produces one row', () => {
    expect(source).toMatch(
      /new Set<string>\(\[\.\.\.assessmentById\.keys\(\), \.\.\.gradeById\.keys\(\)\]\)/,
    );
  });

  it('never renders a bare <ul> — the table stays even with nothing in it', () => {
    expect(source).not.toMatch(/<ul className="assessment-list">/);
    expect(source).toMatch(/<DataTable<MergedExamRow>[\s\S]*?columns={columns}[\s\S]*?rows={sorted}/);
  });
});

describe('طريقة الحضور decides what a row offers, on every mode', () => {
  it('every row states its mode', () => {
    expect(source).toContain("t(row.mode === 'online' ? 'assessments.modeOnline' : 'assessments.modePhysical')");
  });

  it('مراجعة إجاباتي / فتح exist ONLY for a remote row', () => {
    expect(source).toMatch(
      /cell: \(row\) =>\s*row\.mode === 'online' \? \(\s*<Button variant="secondary" onClick={\(\) => setOpenId\(row\.id\)}>/,
    );
  });

  it('الحالة exists ONLY for a remote row — a physical sitting has no interaction to report', () => {
    expect(source).toMatch(/row\.mode !== 'online' \? \(\s*<span className="muted">—<\/span>/);
  });

  it('النقطة applies regardless of mode, once published', () => {
    expect(source).toContain('!row.gradePublished');
    expect(source).toContain('${row.score} / ${row.maxGrade}');
  });
});

describe('the table is sortable on every header', () => {
  it('every column carries a sortKey except the action column', () => {
    const keys = ['title', 'date', 'subject', 'mode', 'state', 'score'];
    for (const key of keys) {
      expect(source).toContain(`sortKey: '${key}'`);
    }
  });

  it('wires sort state through DataTable', () => {
    expect(source).toContain('sort={sort}');
    expect(source).toContain('onSort={setSort}');
    expect(source).toContain('sortRows(merged, sort,');
  });
});

describe('fixed alongside the merge: a parent acting for a child can open this page', () => {
  it('sends X-Active-Child-ID on both reads — myAssessments never did before', () => {
    expect(source).toContain('const childHeader = asParent ? activeChildId : null;');
  });

  it('never fetches while a parent has not chosen a child yet', () => {
    expect(source).toMatch(/if \(awaitingChild\) \{/);
  });
});
