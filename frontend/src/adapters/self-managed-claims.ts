import { api } from '../lib/api.js';

/**
 * `تحويل الحساب إلى حساب مستقل` — R132.
 *
 * **Identity is not in this payload and cannot be**, exactly as it cannot be in
 * a registration: the server takes the verified email and Google subject from
 * the signed onboarding token, and its schema does not accept them (§20 rule 9).
 * The only thing the client sends is the reference code the beneficiary already
 * holds — which grants nothing on its own (R62.5), and is why quoting it is safe.
 *
 * **This binds nothing.** It records a request that a Super Admin must approve.
 */

export interface SelfManagedClaimResult {
  id: string;
  status: string;
}

export async function requestSelfManagedClaim(
  referenceCode: string,
  onboardingToken: string,
): Promise<SelfManagedClaimResult> {
  return api<SelfManagedClaimResult>('/self-managed-claims', {
    method: 'POST',
    onboardingToken,
    body: { reference_code: referenceCode },
  });
}

/** One pending claim, as the Super Admin's review list publishes it. */
export interface PendingSelfManagedClaim {
  id: string;
  beneficiary_id: string;
  beneficiary_name: string;
  /**
   * The record's own spoken identifier. Shown because it is what the reviewer
   * matches against; **the Google provider subject is deliberately absent from
   * this contract**, because it is a credential coordinate and not UI data.
   */
  reference_code: string | null;
  /** The address that becomes her login if this is approved. */
  email: string;
  created_at: string;
}

export async function listPendingSelfManagedClaims(
  token: string | null,
): Promise<PendingSelfManagedClaim[]> {
  const res = await api<{ data: PendingSelfManagedClaim[] }>('/admin/self-managed-claims', { token });
  return res.data;
}

export async function approveSelfManagedClaim(id: string, token: string | null): Promise<void> {
  await api(`/admin/self-managed-claims/${id}/approve`, { method: 'POST', token, body: {} });
}

export async function rejectSelfManagedClaim(
  id: string,
  reason: string,
  token: string | null,
): Promise<void> {
  await api(`/admin/self-managed-claims/${id}/reject`, {
    method: 'POST',
    token,
    body: { reason },
  });
}
