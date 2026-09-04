import { api } from '../lib/api.js';

/**
 * **A former beneficiary asks for her archived account back** (Owner decision,
 * 2026-09-04).
 *
 * The mirror of the self-managed claim, and deliberately a **separate** contract
 * rather than a mode on it: that one transitions a LIVE account to its adult,
 * this one reactivates a CLOSED one. Approving the second restores an account,
 * which is a materially different decision, and one queue meaning both would be
 * a queue where a reviewer cannot see which she is taking.
 *
 * **`reference_code` locates and never authenticates.** Possession grants
 * nothing: every unavailable archive answers the same uniform `404`, and the
 * proof of identity is the Google flow plus a Super Admin's verification.
 */

export interface AccountReturnResult {
  id: string;
  status: string;
}

export async function requestAccountReturn(
  input: {
    referenceCode: string;
    firstNameArabic: string;
    lastNameArabic: string;
    phone?: string;
  },
  onboardingToken: string,
): Promise<AccountReturnResult> {
  return api<AccountReturnResult>('/account-return-requests', {
    method: 'POST',
    onboardingToken,
    body: {
      reference_code: input.referenceCode,
      // Her CURRENT name. The erased one is not restored and is not asked for:
      // closure destroyed it, and inviting her to reconstruct it would defeat
      // the closure.
      first_name_arabic: input.firstNameArabic,
      last_name_arabic: input.lastNameArabic,
      ...(input.phone ? { phone: input.phone } : {}),
    },
  });
}

/** One pending request, as the Super Admin's review list publishes it. */
export interface PendingAccountReturn {
  id: string;
  subject_id: string;
  /**
   * What she says her name is NOW — which is what a reviewer checks against
   * whatever the association holds on paper. **The Google provider subject is
   * deliberately absent from this contract**: it is a credential coordinate, and
   * an administrator verifies a person rather than an identifier.
   */
  first_name_arabic: string;
  last_name_arabic: string;
  phone: string | null;
  created_at: string;
}

export async function listPendingAccountReturns(
  token: string | null,
): Promise<PendingAccountReturn[]> {
  const res = await api<{ data: PendingAccountReturn[] }>('/admin/account-return-requests', {
    token,
  });
  return res.data;
}

export async function approveAccountReturn(id: string, token: string | null): Promise<void> {
  await api(`/admin/account-return-requests/${id}/approve`, { method: 'POST', token, body: {} });
}

export async function rejectAccountReturn(
  id: string,
  reason: string,
  token: string | null,
): Promise<void> {
  await api(`/admin/account-return-requests/${id}/reject`, {
    method: 'POST',
    token,
    body: { reason },
  });
}
