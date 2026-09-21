import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { decidedPerRole, type Approval } from '../../adapters/approvals.js';
import { ar } from '../../i18n/ar.js';
import { CircleWishes, RoleRequestList, RoleReviewDialog } from './role-review.js';

/**
 * SRS Revision 168 §1 — one registration, several roles, each decided on its
 * own. What these pin is what an approver must be able to READ: every role she
 * asked for with its state in words, which of them is still this approver's to
 * decide, and that a ranked circle is a wish.
 */
const ROW: Approval = {
  id: 'u-1',
  type: 'registration',
  applicants: [{ id: 'u-1', name: 'فاطمة الزهراء', role: 'applicant' }],
  submitted_at: '2026-09-21T09:00:00.000Z',
  bundle: { child_count: 0, link_count: 0 },
  branch: { id: 'b-1', name: 'مقر تاركة' },
  requested_role: 'teacher',
  account_active: false,
  role_requests: [
    { kind: 'student', status: 'approved', first_time: true },
    { kind: 'teaching', status: 'pending', first_time: null },
    { kind: 'administration', status: 'pending', first_time: null },
  ],
  circle_preferences: [
    { teaching_group_id: 'g-2', name: 'حلقة السبت', rank: 2 },
    { teaching_group_id: 'g-1', name: 'حلقة الثلاثاء', rank: 1 },
  ],
  framing: null,
  category: { id: 'c-1', name: 'المرأة' },
  children: [],
  registration_details: null,
};

const noop = (): void => undefined;

function review(canDecideAdministration: boolean, row: Approval = ROW): string {
  return renderToStaticMarkup(
    <RoleReviewDialog
      row={row}
      canDecideAdministration={canDecideAdministration}
      busy={false}
      onApprove={noop}
      onDecline={noop}
      onClose={noop}
    />,
  );
}

/** The markup of one role's block, so an assertion is about THAT role. */
function block(html: string, kind: string): string {
  const start = html.indexOf(`data-role-review-item="${kind}"`);
  const next = html.indexOf('data-role-review-item="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe('which registrations are decided one role at a time', () => {
  it('several requests, or a place in the administration — never a lone ordinary request', () => {
    const one = (kind: 'student' | 'guardian' | 'teaching' | 'administration') => ({
      type: 'registration' as const,
      role_requests: [{ kind, status: 'pending' as const, first_time: null }],
    });
    expect(decidedPerRole(ROW)).toBe(true);
    expect(decidedPerRole(one('administration'))).toBe(true);
    expect(decidedPerRole(one('student'))).toBe(false);
    expect(decidedPerRole(one('guardian'))).toBe(false);
    expect(decidedPerRole(one('teaching'))).toBe(false);
    // R169 §1 — a lone request from an account that is ALREADY active has no
    // whole-account decision to fall back on.
    expect(decidedPerRole({ ...one('teaching'), account_active: true })).toBe(true);
    // A registration from before the requests existed, and every other item type.
    expect(decidedPerRole({ type: 'registration', role_requests: [] })).toBe(false);
    expect(decidedPerRole({ type: 'child-application', role_requests: ROW.role_requests })).toBe(false);
  });
});

describe('the queue cell', () => {
  it('names every requested role with its state in words', () => {
    const html = renderToStaticMarkup(<RoleRequestList requests={ROW.role_requests} />);
    expect(html).toContain(ar.admin.approvals.roleKind.student);
    expect(html).toContain(ar.admin.approvals.roleKind.teaching);
    expect(html).toContain(ar.admin.approvals.roleKind.administration);
    expect(html).toContain(ar.admin.approvals.roleStatus.approved);
    expect(html).toContain(ar.admin.approvals.roleStatus.pending);
    expect(html).toContain('data-role-status="approved"');
  });
});

describe('the per-role review', () => {
  it('offers a decision on each PENDING role and none on a decided one', () => {
    const html = review(true);
    expect(block(html, 'student')).not.toContain(ar.admin.approvals.approve);
    expect(block(html, 'teaching')).toContain(ar.admin.approvals.approve);
    expect(block(html, 'teaching')).toContain(ar.admin.approvals.reject);
    expect(block(html, 'administration')).toContain(ar.admin.approvals.approve);
  });

  it('shows an Admin the administration request, states whose it is, and offers her no refusal', () => {
    const html = block(review(false), 'administration');
    expect(html).toContain(ar.admin.approvals.reviewAdministrationOnly);
    expect(html).not.toContain(ar.admin.approvals.approve);
    expect(html).not.toContain(ar.admin.approvals.reject);
    // Her own decisions are untouched by it.
    expect(block(review(false), 'teaching')).toContain(ar.admin.approvals.approve);
  });

  it('says what she declared about a first registration, and that her children come separately', () => {
    expect(block(review(true), 'student')).toContain(ar.admin.approvals.firstTimeYes);
    const guardian: Approval = {
      ...ROW,
      role_requests: [
        { kind: 'guardian', status: 'pending', first_time: null },
        { kind: 'student', status: 'pending', first_time: false },
      ],
      circle_preferences: [],
    };
    const html = review(true, guardian);
    expect(block(html, 'guardian')).toContain(ar.admin.approvals.reviewGuardianHint);
    expect(block(html, 'student')).toContain(ar.admin.approvals.firstTimeNo);
    expect(html).not.toContain('data-circle-wishes');
  });
});

describe('her ranked circles', () => {
  it('are listed in HER order and called a wish, never a seat', () => {
    const html = renderToStaticMarkup(<CircleWishes preferences={ROW.circle_preferences} />);
    expect(html.indexOf('حلقة الثلاثاء')).toBeLessThan(html.indexOf('حلقة السبت'));
    expect(html).toContain(ar.admin.approvals.circleWishesHint);
  });

  it('render nothing when she ranked none', () => {
    expect(renderToStaticMarkup(<CircleWishes preferences={[]} />)).toBe('');
  });
});
