import { describe, expect, it } from 'vitest';

import PAGE from './enrollments.tsx?raw';
import { ar } from '../../i18n/ar.js';

/** Comments are not code — the idiom every source guard here uses. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **حفظ on تسجيل مستفيدة did nothing** (2026-08-29).
 *
 * Not a failing request — **no request at all**. The dialog derived the
 * enrolment's branch by looking the pre-chosen مستفيدة up in a directory search
 * of its own, narrowed to `beneficiaries_only`. The page builds its rows from
 * the **union** of that fact and the Student role (R79.7 exists because role
 * membership does not identify a beneficiary), so a person present on the page
 * could be absent from the dialog's list — and was: the search returned zero
 * rows. The branch came back `''`, which both disabled حفظ and made `submit`
 * return before its first statement.
 *
 * Two properties, because either alone leaves the defect reachable.
 */
describe('the enrolment dialog does not re-fetch the person it was handed', () => {
  it('takes the whole row, not an id it then has to resolve', () => {
    expect(code(PAGE)).toContain('student: StudentRow;');
    expect(code(PAGE)).toContain('branchOfStudent(student)');
  });

  it('never derives the branch from a directory SEARCH', () => {
    // The precise defect: a lookup in a list that answers a different question
    // from the one the page asked to build the row.
    expect(code(PAGE)).not.toContain("matches.find((m) => m.id === studentId)");
    expect(code(PAGE)).not.toMatch(/searchDirectory\([^)]*beneficiaries_only[^)]*\)[\s\S]{0,80}setMatches/);
  });

  it('falls back through the two things that DO answer it', () => {
    // §4.4c — a group carries its branch; R66 — a Level-only placement takes
    // hers, from her role assignment or from where she is already enrolled.
    expect(code(PAGE)).toContain('row.roles.find((r) => r.branch_id !== null)?.branch_id');
    expect(code(PAGE)).toContain('row.enrolments[0]?.branch_id');
  });
});

describe('the form never declines in silence (rule AH)', () => {
  it('says which answer is missing instead of returning', () => {
    expect(code(PAGE)).not.toContain('if (!studentId || !levelId || !derivedBranchId) return;');
    expect(code(PAGE)).toContain("setNotice(t('admin.enrollments.levelRequired'))");
    expect(code(PAGE)).toContain("setNotice(t('admin.enrollments.branchUnknown'))");
  });

  it('gates حفظ only on the answer the reader can actually give', () => {
    // A dead button is not a refusal. The branch is not her omission, so it is
    // said in words rather than enforced by a control she cannot see.
    expect(code(PAGE)).toContain('disabled={!levelId}');
  });

  it('turns the service’s own reasons into Arabic rather than «تعذّر الحفظ»', () => {
    expect(code(PAGE)).toContain("reason === 'GENDER_RESTRICTION'");
    expect(code(PAGE)).toContain("reason === 'ALREADY_ENROLLED_IN_LEVEL'");
    // An unmapped refusal still carries the server's code, so it can be quoted.
    expect(code(PAGE)).toContain("t('common.saveFailedCode').replace('{code}', error.code)");
  });

  it('and every one of those sentences resolves to Arabic', () => {
    for (const key of ['levelRequired', 'branchUnknown', 'genderRestricted', 'alreadyInGroup'] as const) {
      expect(ar.admin.enrollments[key].length).toBeGreaterThan(10);
      expect(ar.admin.enrollments[key]).not.toMatch(/[A-Z_]{6,}/);
    }
  });
});
