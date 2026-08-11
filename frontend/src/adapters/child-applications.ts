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
  token: string | null,
): Promise<ChildApplicationResult> {
  return api<ChildApplicationResult>('/child-applications', {
    method: 'POST',
    token,
    // §4.1a — a refusal cannot reach this endpoint: the server's schema types
    // the field as the literal `true`, so the form gates on it instead.
    body: { children, consent_data_processing: true },
  });
}
