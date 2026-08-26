import { ApiError } from './api.js';

/**
 * **What kind of failure this is**, in the terms a reader needs — not the terms
 * the transport uses.
 *
 * ## Why a classification and not a status code
 *
 * A screen that branches on `response.status` ends up saying *"something went
 * wrong"* for all of them, because a number is not an explanation. What a
 * person needs to know is which of a small set of situations they are in, and
 * each of those has a different next action: sign in again, ask for access, go
 * back, retry, or wait. Nine classes cover every failure this platform can
 * produce, and each one names its own action.
 *
 * ## What this deliberately does NOT do
 *
 * It does not invent a second error protocol. TD-3.8's envelope — `code`,
 * `message`, `details`, `request_id` — is the contract, and the server's own
 * `code` and `request_id` are carried through untouched. This only decides
 * *which shape of page* to show and *what to offer next*.
 *
 * **Not every API failure is a page.** An action that fails inside a dialog
 * must not replace the screen behind it, and an expected control-flow response
 * — the anonymous `/auth/refresh` 401 during startup — is not a failure at all
 * and must never be presented as one. Those are decided at the call site; this
 * module answers *what kind*, never *how loudly*.
 */
export type ErrorClass =
  /** No usable session. Signing in is the way forward. */
  | 'unauthenticated'
  /** Signed in, but this is not theirs to see. Signing in again would not help. */
  | 'forbidden'
  /** Nothing at this address, or nothing they may know exists (§20 rule 17). */
  | 'not_found'
  /** Somebody else changed it first, or the state moved. Reloading is the fix. */
  | 'conflict'
  /** Too many attempts. Waiting is the fix, and saying so stops them retrying. */
  | 'rate_limited'
  /** The item existed and no longer does, or is no longer theirs to open. */
  | 'unavailable'
  /** The request never reached a server — offline, DNS, a dropped connection. */
  | 'offline'
  /** It reached the server and the server failed. Not the reader's fault. */
  | 'server'
  /** Genuinely unrecognised. Kept separate so it can never be mistaken for one
   *  of the above and given a confidently wrong instruction. */
  | 'unknown';

/**
 * A stable, public identifier a person can quote — `BA-403`, `BA-NET`.
 *
 * **Stable is the whole point.** It is derived from the class, not from the
 * server's `code`, so it does not change when a message is reworded or an
 * endpoint starts returning a more specific reason. A reader who writes it down
 * and reports it a week later must be describing the same situation.
 *
 * It is **not** a substitute for the server's `code`, which is also shown when
 * there is one: this says *which kind of problem*, that says *which rule*.
 */
export const PUBLIC_CODE: Record<ErrorClass, string> = {
  unauthenticated: 'BA-401',
  forbidden: 'BA-403',
  not_found: 'BA-404',
  conflict: 'BA-409',
  rate_limited: 'BA-429',
  unavailable: 'BA-410',
  offline: 'BA-NET',
  server: 'BA-500',
  unknown: 'BA-000',
};

export function classifyError(error: unknown): ErrorClass {
  if (error instanceof ApiError) {
    // The envelope's `code` is consulted BEFORE the status, because the server
    // sometimes distinguishes what the status cannot: a stale or withdrawn
    // library item answers 404 by design (§20 rule 17 — "not yours" and "does
    // not exist" are indistinguishable on purpose), and the reader is better
    // served by "this is no longer available" than by "page not found".
    if (error.code === 'CONTENT_UNAVAILABLE') return 'unavailable';
    switch (error.status) {
      case 401: return 'unauthenticated';
      case 403: return 'forbidden';
      case 404: return 'not_found';
      case 409: return 'conflict';
      case 429: return 'rate_limited';
      default:
        if (error.status >= 500) return 'server';
        return 'unknown';
    }
  }
  /**
   * `fetch` rejects with a `TypeError` when the request never reached a server
   * — offline, DNS failure, a dropped connection, a blocked request. There is
   * **no `request_id` in this case and none may be invented**: nothing on the
   * server ever saw it, so a fabricated identifier would send somebody hunting
   * through logs for a request that does not exist there.
   */
  if (error instanceof TypeError) return 'offline';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'unknown';
}

/**
 * How this failure can be referred to when reporting it.
 *
 * Two genuinely different things, and **conflating them is the defect this
 * shape prevents**:
 *
 * - `server` — the backend's own `request_id`, carried through **exactly** as
 *   received so a screenshot correlates with the server log (TD-14).
 * - `local` — generated here, only when the request never reached a server.
 *   It identifies the *report*, not a server request, and the interface says so
 *   rather than presenting it as though a log entry exists for it.
 */
export interface ErrorReference {
  kind: 'server' | 'local';
  value: string;
}

export function referenceFor(error: unknown): ErrorReference {
  if (error instanceof ApiError && error.requestId) {
    return { kind: 'server', value: error.requestId };
  }
  return { kind: 'local', value: localReference() };
}

/**
 * A short, readable local reference: the date plus a few random characters.
 *
 * Deliberately unlike a `request_id` in shape, so the two cannot be mistaken
 * for one another in a support conversation. It carries no information about
 * the reader or the request — it exists to make two reports distinguishable.
 */
function localReference(): string {
  const now = new Date();
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${day}-${random}`;
}

/**
 * Whether retrying the same thing could plausibly succeed.
 *
 * Offering *retry* where it cannot is worse than offering nothing: it invites
 * somebody to press a button repeatedly against a rule that will keep refusing.
 */
export function isRetryable(kind: ErrorClass): boolean {
  return kind === 'offline' || kind === 'server' || kind === 'conflict' || kind === 'rate_limited';
}
