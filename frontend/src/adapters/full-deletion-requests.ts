import { api } from '../lib/api.js';

/**
 * **Option B — the request/review control plane** (R131 §4.10a).
 *
 * **Nothing here deletes anything, and the contract says so**: every response
 * carries `executed: false`. Approving records a decision that is waiting to be
 * carried out; destructive execution is a separate step and is not implemented.
 *
 * This is **not** account closure. Closure keeps the educational archive; this
 * asks for the archive to be deleted, which may make a future attestation
 * impossible — which is why a Super Admin reviews it.
 */

export interface FullDeletionRequestResult {
  id: string;
  status: string;
  /** Always `false` today: the decision is recorded, the deletion is not done. */
  executed: boolean;
}

export async function requestFullDeletion(
  subjectId: string,
  token: string | null,
): Promise<FullDeletionRequestResult> {
  return api<FullDeletionRequestResult>('/full-deletion-requests', {
    method: 'POST',
    token,
    body: { subject_id: subjectId },
  });
}

/** One pending request, as the Super Admin's queue publishes it. */
export interface PendingFullDeletion {
  id: string;
  subject_id: string;
  subject_name: string;
  /** `self` or `guardian` — recorded at the moment of asking, because a
   *  relationship can change while a request waits. */
  basis: string;
  requested_by: string;
  created_at: string;
}

export async function listPendingFullDeletions(
  token: string | null,
): Promise<PendingFullDeletion[]> {
  const res = await api<{ data: PendingFullDeletion[] }>('/admin/full-deletion-requests', { token });
  return res.data;
}

export async function approveFullDeletion(id: string, token: string | null): Promise<void> {
  await api(`/admin/full-deletion-requests/${id}/approve`, { method: 'POST', token, body: {} });
}

export async function rejectFullDeletion(
  id: string,
  reason: string,
  token: string | null,
): Promise<void> {
  await api(`/admin/full-deletion-requests/${id}/reject`, {
    method: 'POST',
    token,
    body: { reason },
  });
}
