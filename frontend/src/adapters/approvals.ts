import { api } from '../lib/api.js';

/**
 * The approval queue — طلبات الانضمام (§5.6, §14.2, TD-3.2).
 *
 * Types are exactly the endpoint's contract DTO (§16.2, Revision 38), so a
 * field the API stops sending is a type error here rather than an empty cell.
 *
 * **The queue is deliberately unscoped** (Revision 29). A self-registered
 * applicant carries no branch — registration records person fields and consents
 * only — so this queue is *the permanent path* by which a branch Admin meets
 * applicants, "by design, not a gap awaiting a fix". That is also why there is
 * no branch parameter below; see the note in `pages/admin/approvals.tsx`.
 */

export type ApprovalType = 'registration' | 'family-link';

export interface ApprovalApplicant {
  id: string;
  /** Already the name to display — the client never composes one (§20 rule 21). */
  name: string;
  role: 'applicant' | 'child' | 'parent';
}

export interface Approval {
  id: string;
  type: ApprovalType;
  applicants: ApprovalApplicant[];
  /** An instant, correctly — a submission is a moment, not a calendar date. */
  submitted_at: string;
  /** What approving this will actually change (§14.2 "Bundle contents"). */
  bundle: { child_count: number; link_count: number };
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
  options: { page?: number; type?: ApprovalType } = {},
): Promise<Page<Approval>> {
  const params = new URLSearchParams({ page: String(options.page ?? 1), page_size: '25' });
  if (options.type) params.set('type', options.type);
  return api<Page<Approval>>(`/admin/approvals?${params.toString()}`, { token });
}

/**
 * Approving is **atomic across the whole bundle** (TD-4.2): parent, child and
 * link activate together or not at all. `records_updated` reports what actually
 * changed, which is why the screen can state a result rather than assume one.
 */
export async function approveApproval(
  id: string,
  token: string | null,
  reason?: string,
): Promise<DecisionResult> {
  return api<DecisionResult>(`/admin/approvals/${id}/approve`, {
    method: 'POST',
    token,
    body: reason ? { reason } : {},
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

/** TD-9's ceiling for a decision reason (§5.6). */
export const DECISION_REASON_MAX = 500;
