import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Session context (SRS TD-12, §14.4).
 *
 * The access token is held **in memory only** and sent as
 * `Authorization: Bearer` — TD-12 forbids putting it in a cookie, and keeping it
 * out of `localStorage` means a stored token cannot outlive the tab or be read
 * by injected script.
 */
export interface Me {
  id: string;
  account_status: 'pending' | 'active' | 'rejected' | 'suspended';
  roles: string[];
  /** One entry per role; `branches: null` = all branches (§4.2 Revision 24). */
  role_scopes: { role: string; branches: string[] | null }[];
  /**
   * R60 — which of `roles` this session is working as; `null` when un-narrowed.
   *
   * `roles` above stays the LIVE assignment list even while narrowed, because
   * the switcher's menu is built from it: reporting only the active role would
   * let a person narrow themselves and never widen again.
   */
  active_role: string | null;
  /**
   * R62 — the approved links, each carrying the child's name so the account
   * switcher can label an option with a person rather than an index.
   */
  approved_child_links: { id: string; display_name: string }[];
  /**
   * **R87 §M — does this person actually staff a Quran class?**
   *
   * A structural answer from the server: staffing a schedule (or one occurrence)
   * whose Subject carries R73's `tracks_quran_progress` marker. The menu shows
   * «إدخال الحفظ» on this and on nothing else — not the teacher role, not a
   * declared capability, not the Subject's name.
   */
  teaches_quran: boolean;
}

interface SessionState {
  status: 'loading' | 'anonymous' | 'authenticated';
  me: Me | null;
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
}

/** Exported so a test can render the header in a chosen session state without
 *  standing up a provider that would fetch. Application code uses
 *  `SessionProvider` / `useSession`, never this directly. */
export const SessionContext = createContext<SessionState | null>(null);

/** Single-flight refresh (TD-12): rotation makes concurrent refreshes from
 *  multiple tabs a logout race, so one in-flight refresh is shared and
 *  concurrent callers await its result. */
let inFlightRefresh: Promise<string | null> | null = null;

/**
 * The role this tab is working as (R60), kept where a full page load survives.
 *
 * The access token lives in memory and the role switch navigates, so without
 * this the narrowing would be destroyed by the navigation that caused it. It is
 * a *request*, never an authority: the server validates it against live rows and
 * answers with the role it actually granted.
 */
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

export async function refreshAccessToken(): Promise<string | null> {
  inFlightRefresh ??= (async () => {
    try {
      const requested = storedActiveRole();
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        // TD-12: the refresh endpoint is the only cookie-authenticated route and
        // additionally requires this custom header, which a cross-site form
        // cannot set.
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

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<SessionState['status']>('loading');

  // The OAuth callback delivers the token in the URL fragment, which browsers
  // never send to a server (TD-12). Read it once, then strip it from the bar so
  // it does not survive in history or get copied into a shared link.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const fromCallback = hash.get('access_token');
    if (fromCallback) {
      setAccessToken(fromCallback);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let token = accessToken;
      // No token in memory (fresh tab): try the refresh cookie before giving up.
      token ??= await refreshAccessToken();
      if (!token) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      const response = await fetch('/api/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled) return;
      if (!response.ok) {
        setStatus('anonymous');
        return;
      }
      setMe((await response.json()) as Me);
      if (token !== accessToken) setAccessToken(token);
      setStatus('authenticated');
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const value = useMemo<SessionState>(
    () => ({ status, me, accessToken, setAccessToken }),
    [status, me, accessToken],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
