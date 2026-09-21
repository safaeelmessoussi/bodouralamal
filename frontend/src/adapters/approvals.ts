import { applySort } from './reorder.js';
import type { SortState } from '../components/ui/data-table.js';
import type { FramingPreferenceView } from '../types/framing.js';
import { api } from '../lib/api.js';

/**
 * The approval queue — طلبات الانضمام (§5.6, §14.2, TD-3.2).
 *
 * Types are exactly the endpoint's contract DTO (§16.2, Revision 38), so a
 * field the API stops sending is a type error here rather than an empty cell.
 *
 * **`branch_id` filters; it does not scope** (§14.2, Revision 39). It narrows
 * what a reader chose to look at and never limits what they may see — the queue
 * stays deliberately unscoped (Revisions 25, 29) precisely so a branch Admin can
 * find an applicant whose chosen branch is **wrong**, or absent, and correct it.
 */

export type ApprovalType =
  | 'registration'
  | 'family-link'
  | 'child-application'
  /** R68 — a minor gained their own login; an administrator decides whether the
   *  parent links stand. Non-blocking: they keep working until then. */
  | 'identity-review';

/**
 * One child inside a `child-application` item (R62.1).
 *
 * **`application_id`, not a user id** — no `User` exists until the application
 * is approved, which is exactly what lets a rejected child leave no account and
 * no link behind.
 */
export interface ApprovalChild {
  application_id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  schooling_stage: string | null;
  first_name_arabic: string;
  last_name_arabic: string;
  first_name_french: string | null;
  last_name_french: string | null;
  nickname: string | null;
  sex: string | null;
  requested_category: { id: string; name: string } | null;
  requested_branch: { id: string; name: string } | null;
  data_processing_consent: boolean;
  media_release_consent: boolean;
  consent_text_version: string;
  consent_given_at: string;
}

export interface ApprovalRegistrationDetails {
  applicant: {
    first_name_arabic: string | null;
    last_name_arabic: string | null;
    first_name_french: string | null;
    last_name_french: string | null;
    nickname: string | null;
    sex: string | null;
    phone: string | null;
    email: string | null;
    data_processing_consent: {
      granted: boolean;
      text_version: string;
      given_at: string;
    } | null;
  };
}

export interface ApprovalApplicant {
  id: string;
  /** Already the name to display — the client never composes one (§20 rule 21). */
  name: string;
  role: 'applicant' | 'child' | 'parent';
}

/**
 * **One role a registration asked for, and what became of it** (SRS Revision
 * 168 §1). One form may ask for several; each is approved or declined on its
 * own, so a row's state is a LIST of these and never one word.
 */
export type RoleRequestKind = 'student' | 'guardian' | 'teaching' | 'administration';
export type RoleRequestStatus = 'pending' | 'approved' | 'declined';

export interface ApprovalRoleRequest {
  kind: RoleRequestKind;
  status: RoleRequestStatus;
  /** `student` only — «هل هذه أول مرة تسجّلين فيها؟». `null` elsewhere and on a
   *  registration from before the question existed. */
  first_time: boolean | null;
}

export interface Approval {
  id: string;
  type: ApprovalType;
  applicants: ApprovalApplicant[];
  /** An instant, correctly — a submission is a moment, not a calendar date. */
  submitted_at: string;
  /** What approving this will actually change (§14.2 "Bundle contents"). */
  bundle: { child_count: number; link_count: number };
  /**
   * §14.2 column: Branch requested (Revision 39) — **what the applicant asked
   * for**, never where they will be placed. `null` on a family-link item, which
   * carries no branch, and `null` on an account registered before R39, where it
   * means *not stated* rather than *no branch*.
   */
  branch: { id: string; name: string } | null;
  /**
   * What a self-service applicant asked to become (Revision 49) — `'teacher'`
   * or `null`.
   *
   * **A hint, never an authority.** It is what makes a staff request
   * distinguishable in this queue; the role itself is granted only by the
   * assignment the approver states below.
   */
  requested_role: string | null;
  /** R168 §1 — every role this registration asked for; `[]` on the other item
   *  types. More than one, or an `administration` request, is decided per role
   *  (`decideRoleRequest`) — the server refuses the whole-account act for it. */
  role_requests: ApprovalRoleRequest[];
  /** R169 §1 — the applicant's ACCOUNT is already active: she asked for a
   *  further role (or again for a declined one) after being admitted. There is
   *  no pending account to approve or reject, so the item is decided per role. */
  account_active: boolean;
  /** The memorisation circles a first-time مستفيدة ranked, most convenient
   *  first. **A wish, never a seat** — shown beside the placement control. */
  circle_preferences: { teaching_group_id: string; name: string; rank: number }[];
  framing: FramingPreferenceView | null;
  /**
   * The educational stage the applicant asked for (Revision 49) — what §4.1
   * step 1 preselects the first Level from.
   *
   * A **request**, never a placement: it narrows and preselects what the
   * approver is offered, and the approver may choose any Level. `null` on a
   * family-link item, on a staff request, and on any account registered before
   * this revision — where it means *not stated*.
   */
  category: { id: string; name: string } | null;
  /** R62 — present on a `child-application` item; `[]` elsewhere. Each entry is
   *  decided on its own (R62.2). */
  children: ApprovalChild[];
  registration_details: ApprovalRegistrationDetails | null;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

export interface DecisionResult {
  type: ApprovalType;
  records_updated: number;
}

export async function listApprovals(
  token: string | null,
  options: {
    page?: number;
    type?: ApprovalType;
    branchId?: string;
    /** R76 — server-side, per source; see `approvalOrder` in the service. */
    sort?: SortState | null;
    /** Exact notification target; stale/decided work returns an empty page. */
    reviewUserId?: string;
  } = {},
): Promise<Page<Approval>> {
  const params = new URLSearchParams({ page: String(options.page ?? 1), page_size: '25' });
  applySort(params, options.sort ?? null);
  if (options.type) params.set('type', options.type);
  if (options.branchId) params.set('branch_id', options.branchId);
  if (options.reviewUserId) params.set('review_user_id', options.reviewUserId);
  return api<Page<Approval>>(`/admin/approvals?${params.toString()}`, { token });
}

/**
 * Approving is **atomic across the whole bundle** (TD-4.2): parent, child and
 * link activate together or not at all. `records_updated` reports what actually
 * changed, which is why the screen can state a result rather than assume one.
 *
 * It optionally **grants a role and branch scope in that same transaction**
 * (Revision 49).
 *
 * §4.1 already makes approval *"a single administrative act that admits the
 * applicant"*, and an account that is active with no role is a person who can
 * sign in and reach nothing. Assigning here means the platform never passes
 * through that state when the approver already knows what the account is for —
 * and it leaves nothing to a second, forgettable step.
 *
 * `branch_id: null` means **all branches for that assignment** (§7 R24), never
 * *no branch*.
 */
export async function approveApproval(
  id: string,
  token: string | null,
  options: {
    reason?: string;
    assignments?: { role: string; branch_id: string | null }[];
    /**
     * §4.1 (Revision 43) — the placement, written in the same transaction.
     *
     * **Required for every person the approval admits as a student**, or the
     * server refuses with `ENROLLMENT_REQUIRED` naming who is missing: *"an
     * approved account with no enrollment is a person the platform admitted and
     * then lost."* A staff request enrols nobody.
     *
     * `level_id` is deliberately absent — the group already names its Level.
     */
    /**
     * R66.5 — each placement is a **group**, or a **Level and a branch**. The
     * union is the contract: the server refuses a request naming both, and
     * refuses half of the second shape, so a client that sent a mixture would
     * learn it failed rather than have one silently win.
     */
    enrollments?: ({ user_id: string } & PlacementBody)[];
  } = {},
): Promise<DecisionResult> {
  return api<DecisionResult>(`/admin/approvals/${id}/approve`, {
    method: 'POST',
    token,
    body: {
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.assignments && options.assignments.length > 0
        ? { assignments: options.assignments }
        : {}),
      ...(options.enrollments && options.enrollments.length > 0
        ? { enrollments: options.enrollments }
        : {}),
    },
  });
}

/** §5.6: a rejection **requires** a reason — the server refuses without one, and
 *  it is written to the audit trail (TD-8). TD-9 caps it at 500 characters. */
export async function rejectApproval(
  id: string,
  reason: string,
  token: string | null,
): Promise<DecisionResult> {
  return api<DecisionResult>(`/admin/approvals/${id}/reject`, {
    method: 'POST',
    token,
    body: { reason },
  });
}

/**
 * **One requested role, decided on its own** (R168 §1) —
 * `POST /admin/approvals/{id}/roles/{kind}/approve|decline`; `{id}` is the
 * applicant.
 *
 * What each kind needs is the server's contract, mirrored here as a union so a
 * caller cannot send a placement with a teaching request: `student` is approved
 * by PLACING her; `teaching` and `administration` by the role and scope the
 * APPROVER states (never the applicant); `guardian` by nothing at all. A decline
 * is always a reason.
 */
export type RoleDecisionBody =
  | { approve: true; kind: 'student'; enrollment: PlacementBody }
  | { approve: true; kind: 'teaching' | 'administration'; grant: { role: string; branch_id: string | null } }
  | { approve: true; kind: 'guardian' }
  | { approve: false; kind: RoleRequestKind; reason: string };

export interface RoleDecisionResult {
  status: 'approved' | 'declined';
  /** The ACCOUNT after this decision: `active` with the first approval,
   *  `rejected` only when every role was declined, otherwise still `pending`. */
  account_status: string;
}

export async function decideRoleRequest(
  userId: string,
  decision: RoleDecisionBody,
  token: string | null,
): Promise<RoleDecisionResult> {
  const body = !decision.approve
    ? { reason: decision.reason }
    : decision.kind === 'student'
      ? { enrollment: decision.enrollment }
      : decision.kind === 'guardian'
        ? {}
        : { grant: decision.grant };
  return api<RoleDecisionResult>(
    `/admin/approvals/${userId}/roles/${decision.kind}/${decision.approve ? 'approve' : 'decline'}`,
    { method: 'POST', token, body },
  );
}

/**
 * Whether this row is decided ONE ROLE AT A TIME.
 *
 * The server's rule, stated once for the screen: several requests have no single
 * «approve», and a lone `administration` request is a Super Admin's decision
 * that the whole-account act — open to every approver — may not take. An account
 * that is ALREADY active (a further role asked for later, R169 §1) has no
 * whole-account decision at all. A registration that asked for one ordinary
 * thing keeps the one decision it has always been.
 */
export function decidedPerRole(
  row: Pick<Approval, 'type' | 'role_requests'> & Partial<Pick<Approval, 'account_active'>>,
): boolean {
  return (
    row.type === 'registration' &&
    (row.account_active === true ||
      row.role_requests.length > 1 ||
      row.role_requests.some((request) => request.kind === 'administration'))
  );
}

/** TD-9's ceiling for a decision reason (§5.6). */
export const DECISION_REASON_MAX = 500;

/* ── Child applications: decided ONE CHILD AT A TIME (R62.2) ──────────────── */

/**
 * **There is no "approve this request".** R62.2 narrowed TD-4.2 from the bundle
 * to a single child: approving one application creates or links that child,
 * approves the link, grants the `parent` role if absent and audits — in one
 * transaction, **leaving every sibling untouched**. An approver may admit one
 * child and refuse another, which a bundle decision could not express.
 *
 * So a queue item of type `child-application` is decided through **this**
 * endpoint, keyed by `application_id`, never through
 * `POST /admin/approvals/{id}/approve` — whose id is a `request_id` naming no
 * `User` and no `FamilyLink`. Sending it there answered `404 NOT_FOUND` for an
 * item the queue had just rendered; the server now refuses it by name
 * (`DECIDE_PER_CHILD`) and the client no longer offers it.
 */
export interface ChildDecision {
  approve: boolean;
  /** §4.1 (R43) — required to approve a NEW child, or the server refuses with
   *  `ENROLLMENT_REQUIRED`: an admitted account with no enrolment is a person
   *  the platform admitted and then lost. */
  /** R66.5 — a group, or a Level and a branch. Never both, never half. */
  administrative_group_id?: string;
  level_id?: string;
  branch_id?: string;
  /** R62.8 — **bounded**, never free text: the reason reaches the parent, and a
   *  free-text note would eventually carry a safeguarding judgement. */
  rejection_reason?: ChildRejectionReason;
  /** Staff-only; never returned to a parent (R62.8). */
  internal_note?: string;
}

/**
 * Where a student is being placed (R66.5).
 *
 * Naming a **group** says the Level is subdivided and the student goes in this
 * subdivision — the Level and branch are read from it, and the composite FK
 * proves they agree. Naming a **Level and a branch** says the Level is not
 * subdivided, which is the case that used to leave an approver with no way to
 * admit anybody.
 */
export type PlacementBody =
  | { administrative_group_id: string }
  | { level_id: string; branch_id: string };

export type ChildRejectionReason =
  | 'duplicate_application'
  | 'insufficient_information'
  | 'not_eligible'
  | 'other';

export const CHILD_REJECTION_REASONS: ChildRejectionReason[] = [
  'duplicate_application',
  'insufficient_information',
  'not_eligible',
  'other',
];

export async function decideChildApplication(
  applicationId: string,
  decision: ChildDecision,
  token: string | null,
): Promise<{ child_user_id: string | null; parent_role_granted: boolean }> {
  return api(`/admin/child-applications/${applicationId}/decide`, {
    method: 'POST',
    token,
    body: decision,
  });
}
