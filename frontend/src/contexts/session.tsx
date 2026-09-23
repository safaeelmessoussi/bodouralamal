import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ACCESS_TTL_MS,
  RENEW_AHEAD_MS,
  accessTokenObtainedAt,
  noteAccessTokenObtained,
  onAccessTokenRefreshed,
  refreshAccessToken,
} from '../lib/token-refresh.js';

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
  /** Protected singleton lifecycle status; it is not an RBAC role. */
  is_platform_owner: boolean;
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
  /**
   * **R123 — may this person record her own presence at all?**
   *
   * Structural, from the server, on the same footing as `teaches_quran`: every
   * Category she is enrolled in must permit it. **This is what hides the
   * «تسجيل حضوري» control from a teen and a child**, rather than a client
   * comparing a Category's Arabic name (§4.4b forbids that) or discovering the
   * rule by pressing a button that can only fail.
   */
  self_attendance_allowed: boolean;
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

/**
 * R172 §5 — the refresh itself, the role memory and the renewal timing live
 * in `lib/token-refresh.ts`, where `api()` can reach them without importing a
 * React context. Re-exported so the existing callers keep their import.
 */
export { refreshAccessToken, storedActiveRole, storeActiveRole } from '../lib/token-refresh.js';

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
      noteAccessTokenObtained();
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

  /**
   * **R172 §5 — the token is renewed before it dies.** A refresh from any
   * source (the timer here, a 401 retry inside `api()`, a fresh tab) lands in
   * this state, so every later request carries it. The timer fires a few
   * minutes before expiry; a tab that was hidden longer than that renews the
   * moment it is looked at again, because timers are throttled in the
   * background and a stale token is exactly what an idle tab used to hold.
   */
  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    const unsubscribe = onAccessTokenRefreshed((token) => setAccessToken(token));
    const dueIn = (): number =>
      Math.max(0, accessTokenObtainedAt() + ACCESS_TTL_MS - RENEW_AHEAD_MS - Date.now());
    let timer = window.setTimeout(function renew() {
      void refreshAccessToken().then(() => {
        timer = window.setTimeout(renew, dueIn());
      });
    }, dueIn());
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && dueIn() === 0) void refreshAccessToken();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status]);

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
