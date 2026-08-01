/**
 * The single API caller.
 *
 * Every request in the platform goes through here so the two transport rules
 * live in one place rather than at each call site:
 *
 *   - the access token travels **only** in the `Authorization` header (TD-12);
 *   - the active child travels **only** in `X-Active-Child-ID`, per request,
 *     and is verified server-side against an approved `FamilyLink` (§4.3). The
 *     client never puts a student id in a body or query string for
 *     authorization — §4.3 says the server would ignore it anyway.
 *   - the onboarding token travels **only** in `X-Onboarding-Token` (§4.1b
 *     step 4c). It is a credential, and keeping it out of the body keeps it out
 *     of anything that logs a payload — the server reads identity from its
 *     signed payload alone and rejects a body that carries `email` at all.
 */
export interface ApiOptions {
  token?: string | null;
  activeChildId?: string | null;
  /** §4.1b — the single-use registration credential, header-only. */
  onboardingToken?: string | null;
  method?: string;
  body?: unknown;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token, activeChildId, onboardingToken, method = 'GET', body } = options;

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(activeChildId ? { 'X-Active-Child-ID': activeChildId } : {}),
      ...(onboardingToken ? { 'X-Onboarding-Token': onboardingToken } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    credentials: 'same-origin',
  });

  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Carries the status so callers can branch; the TD-3.8 body is deliberately
 *  not parsed here, because only the screens that render it know which fields
 *  they need. */
export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`api error ${status}`);
    this.name = 'ApiError';
  }
}
