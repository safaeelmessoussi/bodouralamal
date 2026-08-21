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
  /**
   * R101 — mark one of the two requests that authenticates with the HttpOnly
   * refresh cookie. The raw credential remains browser-managed and invisible
   * here; this adds only the custom-header leg of the CSRF defence.
   */
  refreshCookieAuth?: boolean;
  method?: string;
  body?: unknown;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const {
    token,
    activeChildId,
    onboardingToken,
    refreshCookieAuth = false,
    method = 'GET',
    body,
  } = options;

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(activeChildId ? { 'X-Active-Child-ID': activeChildId } : {}),
      ...(onboardingToken ? { 'X-Onboarding-Token': onboardingToken } : {}),
      ...(refreshCookieAuth ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    credentials: 'same-origin',
  });

  if (!response.ok) {
    // The envelope is READ here but not interpreted (TD-3.8). Every non-2xx
    // response carries one, and a screen that cannot see `code` or `details`
    // can only say "something went wrong" — which is how a missing
    // configuration row surfaced to an operator as "try again later", with the
    // actual reason sitting unread in the body.
    //
    // Parsing is defensive: a proxy or a gateway can return a non-JSON error
    // page, and failing to parse it must not replace the real status with a
    // crash.
    let envelope: ErrorEnvelope | null = null;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body) {
        envelope = (body as { error: ErrorEnvelope }).error;
      }
    } catch {
      envelope = null;
    }
    throw new ApiError(response.status, envelope);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** The TD-3.8 envelope's payload. */
export interface ErrorEnvelope {
  code: string;
  message_key: string;
  message: string;
  details: Record<string, unknown>;
  request_id: string;
}

/**
 * Carries the status **and** the TD-3.8 envelope.
 *
 * It used to carry the status alone, on the reasoning that only the screen
 * rendering an error knows which fields it needs. That was right about *who
 * interprets* the body and wrong about *who reads* it: a screen cannot
 * interpret what it was never given, so every failure collapsed into a generic
 * message no matter how specific the server had been.
 *
 * The envelope is still not interpreted here. `code`, `details` and
 * `request_id` are handed over intact and each screen decides what to say.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ErrorEnvelope | null = null,
  ) {
    super(`api error ${status}${envelope ? ` ${envelope.code}` : ''}`);
    this.name = 'ApiError';
  }

  /** The canonical TD-3.8 code, when the response carried an envelope. */
  get code(): string | null {
    return this.envelope?.code ?? null;
  }

  /** Structured context for codes that carry it — e.g. which setting is unset. */
  get details(): Record<string, unknown> {
    return this.envelope?.details ?? {};
  }

  /** Shown discreetly beside an error so a report can be correlated to a log. */
  get requestId(): string | null {
    return this.envelope?.request_id ?? null;
  }
}
