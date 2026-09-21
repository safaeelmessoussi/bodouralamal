import { describe, expect, it } from 'vitest';

import { EMPTY_STUDENT_SECTION, EMPTY_TEACHING_SECTION } from '../../components/registration/role-sections.js';
import { ar } from '../../i18n/ar.js';
import { ApiError } from '../../lib/api.js';
import {
  buildRequest,
  explainRequestFailure,
  validateRequest,
  type RequestRoleState,
} from './request-role.js';

/**
 * SRS Revision 169 §1 — «طلب صفة إضافية». The fields and their rules are the
 * registration form's own (`role-sections.tsx`); what is pinned here is what is
 * THIS page's: which role's answers are sent, when a date of birth is asked,
 * and that a refusal is explained in her words.
 */
const base: RequestRoleState = {
  kind: '',
  student: EMPTY_STUDENT_SECTION,
  teaching: EMPTY_TEACHING_SECTION,
  needsBirthDate: false,
  birthDate: '',
  dataProcessing: false,
  circlesOffered: 0,
};
const student = { branchId: 'b-1', categoryId: 'c-1', firstTime: 'no' as const, circlePreferences: [] };

describe('what is asked of her', () => {
  it('a role must be chosen — nothing is preselected', () => {
    expect(validateRequest(base)).toEqual({ kind: ar.register.errRequired });
  });

  it('a beneficiary request needs her branch, stage, the first-time answer and her consent', () => {
    expect(Object.keys(validateRequest({ ...base, kind: 'student' })).sort()).toEqual(
      ['branch', 'category', 'dataProcessing', 'firstTime'].sort(),
    );
    expect(validateRequest({ ...base, kind: 'student', student, dataProcessing: true })).toEqual({});
  });

  it('a date of birth is asked ONLY when her record has none — completion, never correction', () => {
    const asked = { ...base, kind: 'student' as const, student, dataProcessing: true, needsBirthDate: true };
    expect(validateRequest(asked)).toHaveProperty('birthDate');
    expect(validateRequest({ ...asked, birthDate: '1991-07-09' })).toEqual({});
    expect(buildRequest({ ...asked, birthDate: '1991-07-09' }, null, 'text-1')).toMatchObject({
      birth_date: '1991-07-09',
    });
    expect(buildRequest({ ...asked, needsBirthDate: false, birthDate: '1991-07-09' }, null, 'text-1')).not.toHaveProperty(
      'birth_date',
    );
  });

  it('a teaching or administration request needs no consent and no birth date', () => {
    expect(validateRequest({ ...base, kind: 'administration' })).toEqual({});
    expect(
      validateRequest({ ...base, kind: 'teaching', teaching: { mode: 'online', allBranches: false, branchIds: [] } }),
    ).toEqual({});
  });
});

describe('what is sent is decided by the chosen role alone', () => {
  it('another section that still holds a value is never sent', () => {
    const body = buildRequest(
      { ...base, kind: 'administration', student, teaching: { mode: 'online', allBranches: false, branchIds: [] } },
      'b-9',
      'text-1',
    );
    expect(body).toEqual({ kind: 'administration', administration: { branch_id: 'b-9' } });
    // …and the applicant never names an administrative role.
    expect(JSON.stringify(body)).not.toMatch(/admin"|super_admin|"role"/);
  });

  it('a first-time beneficiary sends her circles in her order; a returning one sends none', () => {
    const first = buildRequest(
      { ...base, kind: 'student', student: { ...student, firstTime: 'yes', circlePreferences: ['g-2', 'g-1'] } },
      null,
      'text-1',
    );
    expect(first).toMatchObject({ student: { first_time: true, circle_preferences: ['g-2', 'g-1'] } });
    const returning = buildRequest({ ...base, kind: 'student', student }, null, 'text-1');
    expect(returning).toMatchObject({ student: { first_time: false } });
    expect(JSON.stringify(returning)).not.toContain('circle_preferences');
  });
});

describe('a refusal is explained in her words', () => {
  const refused = (reason: string): ApiError =>
    new ApiError(409, { code: 'STATE_CONFLICT', message: 'refused', details: { reason } } as never);

  it('names the two states that make a request pointless, and a circle that left the offer', () => {
    expect(explainRequestFailure(refused('ROLE_ALREADY_HELD'))).toBe(ar.profile.requestRole.errHeld);
    expect(explainRequestFailure(refused('ALREADY_PENDING'))).toBe(ar.profile.requestRole.errPending);
    expect(explainRequestFailure(refused('CIRCLE_NOT_OFFERED'))).toBe(ar.register.errCircleGone);
    expect(explainRequestFailure(new Error('network'))).toBe(ar.profile.requestRole.failed);
  });
});
