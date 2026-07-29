import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { linkedChildren, type LinkedChild } from '../adapters/children.js';
import { useSession } from './session.js';

/**
 * Active child context (§4.3).
 *
 * Holds **only** which linked child the parent is currently acting for. The id
 * is asserted per request through `X-Active-Child-ID` and verified server-side
 * against an approved `FamilyLink`; §4.3 is explicit that client-side switching
 * is presentation and the server is the enforcement. Nothing here grants
 * access, and the value is never persisted — a stale child in `localStorage`
 * would silently change whose data a page requests after a link is revoked.
 */
interface ActiveChildState {
  children: LinkedChild[];
  activeChildId: string | null;
  setActiveChildId: (id: string | null) => void;
}

const ActiveChildContext = createContext<ActiveChildState | null>(null);

export function ActiveChildProvider({ children }: { children: ReactNode }): ReactNode {
  const { me } = useSession();
  const [activeChildId, setActiveChildId] = useState<string | null>(null);

  const available = useMemo(() => linkedChildren(me), [me]);

  const value = useMemo<ActiveChildState>(() => {
    // A child whose link was revoked disappears from `/me` on the next load; if
    // it was the active one, fall back to none rather than keep pointing at it.
    const stillLinked = available.some((child) => child.id === activeChildId);
    return {
      children: available,
      activeChildId: stillLinked ? activeChildId : null,
      setActiveChildId,
    };
  }, [available, activeChildId]);

  return <ActiveChildContext.Provider value={value}>{children}</ActiveChildContext.Provider>;
}

export function useActiveChild(): ActiveChildState {
  const context = useContext(ActiveChildContext);
  if (!context) throw new Error('useActiveChild must be used inside ActiveChildProvider');
  return context;
}
