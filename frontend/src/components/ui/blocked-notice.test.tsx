import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../lib/api.js';
import { BlockedNotice } from './blocked-notice.js';
import { ConfirmDialog } from './confirm-dialog.js';

/**
 * **NEW A, rendered** — what a person actually reads when a deletion is refused.
 *
 * The Owner's report was *«deleting appears to do nothing»*, so the assertions
 * are about what reaches the screen: the reason, the dependencies in the
 * association's words, the absence of «refresh» advice, a support reference,
 * and no raw envelope.
 */
const REQUEST_ID = 'e3986e8e02bb5a1b27b27d0594f784bc';
const blockedError = new ApiError(409, {
  code: 'STATE_CONFLICT',
  message_key: 'errors.state_conflict',
  message: 'تم تعديل هذا العنصر أو تغييرت حالته. يرجى تحديث الصفحة.',
  details: { blocked_by: { groups: 1, course_schedules: 1 } },
  request_id: REQUEST_ID,
});

const notice = (): string =>
  renderToStaticMarkup(<BlockedNotice error={blockedError} item="هذا المقر" />);

describe('the refusal explains itself', () => {
  it('says the branch is in use — the answer to “why did nothing happen”', () => {
    expect(notice()).toContain('لا يمكن حذف هذا المقر لأنه مستخدم حالياً.');
  });

  it('names the dependencies in the association’s words, with counts', () => {
    const html = notice();
    expect(html).toContain('مجموعات إدارية');
    expect(html).toContain('جداول حصص');
    expect(html).toContain('(1)');
  });

  it('shows no backend key', () => {
    const html = notice();
    expect(html).not.toContain('course_schedules');
    expect(html).not.toContain('groups');
    expect(html).not.toContain('blocked_by');
  });

  it('does NOT tell her to refresh — refreshing cannot resolve this', () => {
    // The defect in one assertion: the server's generic STATE_CONFLICT sentence
    // advises exactly that, and following it changes nothing.
    const html = notice();
    expect(html).not.toContain('يرجى تحديث الصفحة');
    expect(html).toContain('تحديث الصفحة لن يغيّر هذه الحالة');
  });

  it('keeps the request_id reachable for support', () => {
    expect(notice()).toContain(REQUEST_ID);
  });

  it('exposes no raw envelope', () => {
    const html = notice();
    expect(html).not.toContain('message_key');
    expect(html).not.toContain('STATE_CONFLICT');
  });
});

describe('the dialog stops asking a question it cannot answer', () => {
  const render = (blocked: boolean): string =>
    renderToStaticMarkup(
      <ConfirmDialog
        open
        title="حذف المقر"
        body="سيُحذف هذا المقر نهائياً."
        {...(blocked ? { blocked: <BlockedNotice error={blockedError} item="هذا المقر" /> } : {})}
        confirmLabel="حذف"
        danger
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

  it('ordinarily offers the destructive confirmation', () => {
    expect(render(false)).toContain('حذف');
    expect(render(false)).toContain('سيُحذف هذا المقر نهائياً.');
  });

  it('withdraws it entirely once blocked — not merely disabled', () => {
    // A greyed destructive button invites her to keep pressing the thing that
    // cannot work, which is the same failure as telling her to refresh.
    const html = render(true);
    expect(html).not.toContain('سيُحذف هذا المقر نهائياً.');
    expect(html).not.toContain('btn--danger');
    expect(html).toContain('إغلاق');
  });

  it('stays OPEN to explain, rather than closing onto a notice elsewhere', () => {
    // The dialog vanishing is what made this read as "nothing happened".
    expect(render(true)).toContain('لا يمكن حذف هذا المقر لأنه مستخدم حالياً.');
  });
});
