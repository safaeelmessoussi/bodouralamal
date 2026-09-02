import { api } from '../lib/api.js';
import type { ChildInput } from './registrations.js';

/**
 * `POST /child-applications` (R62) — an **already-signed-in** adult registers a
 * child: a parent adding another, or an adult student registering one.
 *
 * The registration flow reaches the *same* service through `POST /registrations`
 * with an onboarding token instead of a session. Two client shapes for one
 * server shape would drift, so `ChildInput` is imported rather than restated —
 * the difference between the two surfaces is who the caller is, not what a
 * child is.
 */
export interface ChildApplicationResult {
  request_id: string;
  application_ids: string[];
}

export async function submitChildApplications(
  children: ChildInput[],
  /**
   * **R119 — the id of the wording this form displayed.** The server refuses a
   * version no longer in force, so a Super Admin activating new wording while
   * the form is open cannot turn *displayed X* into *recorded Y*.
   */
  consentTextId: string,
  token: string | null,
): Promise<ChildApplicationResult> {
  return api<ChildApplicationResult>('/child-applications', {
    method: 'POST',
    token,
    // §4.1a — a refusal cannot reach this endpoint: the server's schema types
    // the field as the literal `true`, so the form gates on it instead.
    body: { children, consent_data_processing: true, consent_text_id: consentTextId },
  });
}

/**
 * `GET /child-applications/mine` (R62) — **the caller's own requests, and
 * nothing else.** The endpoint scopes to the session; there is no id to pass.
 *
 * `internal_note` is **absent from the projection server-side** (R62.8), which
 * is where that rule holds rather than where it is merely stated: a staff note
 * will eventually carry a safeguarding judgement that must not reach a parent.
 * What they are told is the **bounded** `rejection_reason`.
 */
export interface MyChildApplication {
  id: string;
  request_id: string;
  first_name_arabic: string;
  last_name_arabic: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  /** Present once the child is approved — how a parent quotes a child (R62.6). */
  reference_code: string | null;
  decided_at: string | null;
  created_at: string;
}

export async function fetchMyChildApplications(
  token: string | null,
): Promise<MyChildApplication[]> {
  const body = await api<{ data: MyChildApplication[] }>('/child-applications/mine', { token });
  return body.data;
}
