import { describe, expect, it } from 'vitest';

import PAGE from './enrollments.tsx?raw';
import AR from '../../i18n/ar.ts?raw';

/**
 * **The enrolment form names the semester** (SRS R122).
 *
 * ## What this pins, and why it is a source guard
 *
 * Before R122 an enrolment had no period, so it stayed current until somebody
 * soft-deleted it. The form is where that is now decided, and three properties
 * have to hold together:
 *
 * 1. the control **exists** and is required;
 * 2. the submit **refuses in words** rather than in silence when it is unset
 *    (rule AH — the same defect this page already had once with the branch);
 * 3. the payload actually **carries** it, because a control that renders and
 *    sends nothing is the shape `الجدول الزمني`'s filters had for months.
 *
 * Asserted against the source because all three are wiring rather than output:
 * a render test would need the admin shell, a session and four network reads to
 * say something the source says directly, and it would still not prove (3).
 */
const source = PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the placement form asks which semester', () => {
  it('renders a required period control from the server list', () => {
    expect(source).toContain('listAcademicPeriods');
    expect(source).toContain("t('admin.enrollments.periodLabel')");
  });

  it('defaults to the period running today, and does not compute that itself', () => {
    // `is_current` is the SERVER's derived answer. A page that recomputed it
    // from dates would be a second source that could disagree with the roster.
    expect(source).toContain('is_current');
    expect(source).not.toMatch(/new Date\(\)\s*[<>]=?\s*.*start_date/);
  });

  it('refuses in words when no semester is chosen', () => {
    // Rule AH. This page has already shipped a silent refusal once — the branch
    // could not be derived, حفظ was dead, and nothing said why.
    expect(source).toContain("t('admin.enrollments.periodRequired')");
  });

  it('SENDS the period — a control that renders and sends nothing is the defect', () => {
    expect(source).toContain('academic_period_id: periodId');
  });

  it('says so when no semester has been recorded yet', () => {
    // Not an empty dropdown with no explanation: the Super Admin has to record
    // the year's semesters before anybody can be enrolled.
    expect(source).toContain("t('admin.enrollments.periodNone')");
  });
});

describe('the table shows whether a placement is still running', () => {
  it('renders the period and a current/ended badge per enrolment', () => {
    expect(source).toContain("t('admin.enrollments.periodColumn')");
    expect(source).toContain('is_current_period');
  });

  it('shows a pre-R122 row honestly rather than guessing its semester', () => {
    expect(source).toContain("t('admin.enrollments.periodUnrecorded')");
  });
});

describe('the Arabic copy exists and says what the period does', () => {
  const catalogue = AR.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('names the semester and its automatic end', () => {
    expect(catalogue).toContain('الفصل الدراسي');
    // The whole point, in the hint a reader actually sees.
    expect(catalogue).toContain('وينتهي بانتهائه تلقائياً');
  });

  it('carries no engineering reference on a staff-facing screen (rule M)', () => {
    for (const key of [
      'periodLabel',
      'periodHint',
      'periodNone',
      'periodRequired',
      'periodUnrecorded',
    ]) {
      const line = catalogue.split('\n').find((l) => l.trim().startsWith(`${key}:`)) ?? '';
      expect(line).not.toMatch(/R\d{2,3}|§|academic_period|TD-/);
    }
  });
});
