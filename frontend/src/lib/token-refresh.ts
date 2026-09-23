/**
 * **The access token is renewed, not merely obtained** (TD-12; SRS Revision
 * 172 §5).
 *
 * The token lives one hour (`ACCESS_TTL_SECONDS`) and is held in memory. Until
 * Revision 172 the client fetched it once — at the OAuth callback, or from the
 * refresh cookie on a fresh tab — and never again: a tab open for an hour then
 * failed EVERY call with 401 until the person reloaded. The Owner met it as
 * «تعذّر حفظ التسجيل» after a 65-minute recording: the save was the tab's
 * first request past the hour, and the generic message hid the reason.
 *
 * Two renewals, both here so there is one implementation:
 *
 *  1. **Reactive** — `api()` asks for a fresh token on a 401 to a request that
 *     carried one, and retries that request once (`retryWithFreshToken`).
 *  2. **Proactive** — `SessionProvider` renews on a timer a few minutes before
 *     expiry and when a backgrounded tab becomes visible again, so an idle
 *     tab holds a valid token when the person returns to it.
 *
 * Single-flight: rotation (R101) makes concurrent refreshes a logout race, so
 * one in-flight refresh is shared and every caller awaits its result. The
 * refreshed token is announced to subscribers — the session context, which
 * holds it for every later request.
 */

/** TD-12: mirrors the server's `ACCESS_TTL_SECONDS`; the client never reads
 *  the JWT's own claims (they are the server's to interpret). */
export const ACCESS_TTL_MS = 60 * 60 * 1000;
/** How long before expiry the proactive renewal fires. */
export const RENEW_AHEAD_MS = 5 * 60 * 1000;

const ACTIVE_ROLE_KEY = 'bodour.activeRole';

export function storedActiveRole(): string | null {
  try {
    return window.sessionStorage.getItem(ACTIVE_ROLE_KEY);
  } catch {
    return null;
  }
}

export function storeActiveRole(role: string | null): void {
  try {
    if (role === null) window.sessionStorage.removeItem(ACTIVE_ROLE_KEY);
    else window.sessionStorage.setItem(ACTIVE_ROLE_KEY, role);
  } catch {
    // Storage disabled: the tab still works, it simply forgets on navigation.
  }
}

type Listener = (token: string) => void;
const listeners = new Set<Listener>();

/** Called with every token a refresh yields. Returns the unsubscribe. */
export function onAccessTokenRefreshed(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let inFlightRefresh: Promise<string | null> | null = null;
/** When the current token was obtained — what the proactive timer counts from. */
let obtainedAt = 0;

export function accessTokenObtainedAt(): number {
  return obtainedAt;
}

/** The OAuth callback and a fresh-tab bootstrap hand their token in here so
 *  the proactive timer counts from a real moment, not from zero. */
export function noteAccessTokenObtained(): void {
  obtainedAt = Date.now();
}

export async function refreshAccessToken(): Promise<string | null> {
  inFlightRefresh ??= (async () => {
    try {
      const requested = storedActiveRole();
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        // R101: refresh and logout are the only refresh-cookie consumers. Both
        // require this custom header, which a cross-site form cannot set.
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        // R60.4 — re-asserted on every refresh. Omitting it would silently widen
        // the session back to every role held, which is the one failure mode the
        // fail-safe rule exists to prevent.
        body: JSON.stringify(requested === null ? {} : { active_role: requested }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        access_token: string;
        active_role: string | null;
      };
      // **The server's answer wins.** When the requested role has been revoked it
      // falls back to another assignment and says which — storing what we asked
      // for would leave the tab claiming a role it no longer has.
      storeActiveRole(body.active_role);
      obtainedAt = Date.now();
      for (const listener of listeners) listener(body.access_token);
      return body.access_token;
    } catch {
      return null;
    } finally {
      // Released only after the awaiting callers have observed the result.
      setTimeout(() => {
        inFlightRefresh = null;
      }, 0);
    }
  })();
  return inFlightRefresh;
}

/** Test seam: forget the in-flight refresh and the subscribers. */
export function resetTokenRefreshForTests(): void {
  inFlightRefresh = null;
  listeners.clear();
  obtainedAt = 0;
}
