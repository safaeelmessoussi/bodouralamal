import type { FramingPayload } from '../components/registration/role-sections.js';
import { api } from '../lib/api.js';
import type { RoleRequestKind, RoleRequestStatus } from './approvals.js';

/**
 * **A further role, asked for by an account that already exists** (SRS Revision
 * 169 §1) — `GET|POST /profile/role-requests`.
 *
 * Types mirror the endpoint's contract. The decline reason is deliberately
 * absent: it is operator-facing, and the server never sends it here.
 */
export type AskableRole = Exclude<RoleRequestKind, 'guardian'>;

export interface MyRoleRequests {
  requests: {
    kind: RoleRequestKind;
    status: RoleRequestStatus;
    decided_at: string | null;
    /** R170 §11 — the reason the approver chose to tell her; `null` otherwise. */
    shared_reason: string | null;
  }[];
  /** What she may ask for NOW — not held, and not already waiting. `guardian`
   *  is never here: registering a child IS that request. */
  askable: AskableRole[];
  /** What she HOLDS, from live role rows (R170 §1) — so the screen can say why
   *  nothing is askable instead of showing nothing. */
  held: RoleRequestKind[];
}

export async function fetchMyRoleRequests(token: string | null): Promise<MyRoleRequests> {
  return (await api<{ data: MyRoleRequests }>('/profile/role-requests', { token })).data;
}

export type FurtherRoleRequest =
  | {
      kind: 'student';
      student: { branch_id: string; category_id: string; first_time: boolean; circle_preferences?: string[] };
      /** Only COMPLETES a record with no date of birth (R130). */
      birth_date?: string;
      consents: { data_processing: true; consent_text_id: string };
    }
  | { kind: 'teaching'; teaching: { framing: FramingPayload } }
  | { kind: 'administration'; administration: { branch_id: string | null } };

export async function requestFurtherRole(
  body: FurtherRoleRequest,
  token: string | null,
): Promise<{ kind: AskableRole; status: 'pending'; reopened: boolean }> {
  return api('/profile/role-requests', { method: 'POST', token, body });
}
