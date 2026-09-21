import type { ReactNode } from 'react';

import type {
  Approval,
  ApprovalRoleRequest,
  RoleRequestKind,
  RoleRequestStatus,
} from '../../adapters/approvals.js';
import { t } from '../../i18n/index.js';
import { Badge, type BadgeTone } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';

/**
 * **What one registration asked for, and what became of each request** (SRS
 * Revision 168 §1).
 *
 * One form may now ask for several roles, and the Owner's rule is that the
 * administration «approves or declines each role separately». So a row's state
 * is a LIST — «مستفيدة: مقبول · هيئة التدريس: في انتظار القرار» — and the two
 * pieces here are the two places that list is read: the queue's cell, and the
 * dialog that decides it.
 *
 * **Presentation only.** This file decides nothing and calls nothing: WHAT
 * approving a role needs (a placement, a grant, nothing) is the page's, where
 * the placement and grant dialogs already live. Keeping it so is what lets the
 * page stay the one owner of «one dialog at a time».
 */

const STATUS_TONE: Record<RoleRequestStatus, BadgeTone> = {
  pending: 'warn',
  approved: 'ok',
  declined: 'neutral',
};

/** The role in the ADMINISTRATION's words — not the form's first person
 *  («أسجّل نفسي…»), which is the applicant speaking. */
export function roleKindLabel(kind: RoleRequestKind): string {
  return t(`admin.approvals.roleKind.${kind}`);
}

/**
 * The queue's «الصفة المطلوبة» cell.
 *
 * State in WORDS beside every role (the badge tints a label, never replaces
 * one): a colour alone would tell a colour-blind approver nothing about which of
 * three requests is still hers to decide.
 */
export function RoleRequestList({ requests }: { requests: ApprovalRoleRequest[] }): ReactNode {
  return (
    <ul className="approval__people" data-role-requests>
      {requests.map((request) => (
        <li
          key={request.kind}
          className="approval__person"
          data-role-request={request.kind}
          data-role-status={request.status}
        >
          <span className="approval__name">{roleKindLabel(request.kind)}</span>{' '}
          <Badge tone={STATUS_TONE[request.status]}>
            {t(`admin.approvals.roleStatus.${request.status}`)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * The memorisation circles a first-time مستفيدة ranked, most convenient first.
 *
 * **A wish, never a seat** — said on the screen, because a numbered list beside
 * a placement control otherwise reads as an instruction.
 */
export function CircleWishes({
  preferences,
}: {
  preferences: Approval['circle_preferences'];
}): ReactNode {
  if (preferences.length === 0) return null;
  const ordered = [...preferences].sort((a, b) => a.rank - b.rank);
  return (
    <div className="state" role="note" data-circle-wishes>
      <strong>{t('admin.approvals.circleWishes')}</strong>
      <ol>
        {ordered.map((preference) => (
          <li key={preference.teaching_group_id}>{preference.name}</li>
        ))}
      </ol>
      <p className="field__hint">{t('admin.approvals.circleWishesHint')}</p>
    </div>
  );
}

/**
 * The per-role review: every request, its state, and — for the ones still
 * pending that THIS approver may decide — «موافقة» and «رفض».
 *
 * **An `administration` request is shown to an Admin and not offered to her.**
 * Hiding the row would make a three-role registration look like a two-role one;
 * offering the buttons would offer a refusal. It is stated as the rule it is
 * («تبتّ فيه مديرة النظام وحدها»), which is also why an Admin who has decided
 * everything she may still sees why the item has not left her queue.
 */
export function RoleReviewDialog({
  row,
  canDecideAdministration,
  busy,
  onApprove,
  onDecline,
  onClose,
}: {
  row: Approval;
  canDecideAdministration: boolean;
  busy: boolean;
  onApprove: (kind: RoleRequestKind) => void;
  onDecline: (kind: RoleRequestKind) => void;
  onClose: () => void;
}): ReactNode {
  const names = row.applicants.map((applicant) => applicant.name).join('، ');
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin.approvals.reviewTitle').replace('{names}', names)}
    >
      <div className="form" data-role-review>
        <p>{t('admin.approvals.reviewBody')}</p>

        {row.role_requests.map((request) => {
          const hers = request.kind !== 'administration' || canDecideAdministration;
          return (
            <fieldset
              key={request.kind}
              data-role-review-item={request.kind}
              data-role-status={request.status}
            >
              <legend>
                {roleKindLabel(request.kind)}{' '}
                <Badge tone={STATUS_TONE[request.status]}>
                  {t(`admin.approvals.roleStatus.${request.status}`)}
                </Badge>
              </legend>

              {request.kind === 'student' && request.first_time !== null ? (
                <p className="field__hint">
                  {t(
                    request.first_time
                      ? 'admin.approvals.firstTimeYes'
                      : 'admin.approvals.firstTimeNo',
                  )}
                </p>
              ) : null}
              {request.kind === 'student' ? (
                <CircleWishes preferences={row.circle_preferences} />
              ) : null}
              {request.kind === 'guardian' && request.status === 'pending' ? (
                <p className="field__hint">{t('admin.approvals.reviewGuardianHint')}</p>
              ) : null}

              {request.status !== 'pending' ? null : hers ? (
                <div className="form__actions">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => onApprove(request.kind)}
                  >
                    {t('admin.approvals.approve')}
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => onDecline(request.kind)}>
                    {t('admin.approvals.reject')}
                  </Button>
                </div>
              ) : (
                <p className="field__hint" data-role-not-hers>
                  {t('admin.approvals.reviewAdministrationOnly')}
                </p>
              )}
            </fieldset>
          );
        })}

        <div className="form__actions">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
