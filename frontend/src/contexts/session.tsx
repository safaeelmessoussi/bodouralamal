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
  approved_child_links: string[];
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

export async function refreshAccessToken(): Promise<string | null> {
  inFlightRefresh ??= (async () => {
    try {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        // TD-12: the refresh endpoint is the only cookie-authenticated route and
        // additionally requires this custom header, which a cross-site form
        // cannot set.
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { access_token: string };
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
