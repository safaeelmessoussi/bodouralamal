import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { linkedChildren, type LinkedChild } from '../adapters/children.js';
import { useSession } from './session.js';
import { useActiveRole } from './active-role.js';

/**
 * Active child context (§4.3).
 *
 * Holds **only** which linked child the parent is currently acting for. The id
 * is asserted per request through `X-Active-Child-ID` and verified server-side
 * against an approved `FamilyLink`; §4.3 is explicit that client-side switching
 * is presentation and the server is the enforcement. Nothing here grants access.
 *
 * ## Why the choice survives a navigation (R62)
 *
 * It used to be React state and nothing else, on the reasoning that *"a stale
 * child in `localStorage` would silently change whose data a page requests after
 * a link is revoked."* R62 made that untenable rather than merely inconvenient:
 * choosing a child now also **switches the active role**, and switching roles
 * navigates by full page load (see `RoleSwitcher`) — so the selection was
 * destroyed by the very action that made it. The parent picked a daughter and
 * arrived at a dashboard with no child selected.
 *
 * The value therefore lives in **`sessionStorage`**, exactly as the active role
 * does and for exactly the same reason: it must outlive a navigation and must
 * not outlive the tab.
 *
 * **The staleness argument is answered, not ignored** — and by three
 * independent things rather than by storage choice:
 *
 *   1. a child whose link was revoked is absent from the next `GET /me`, and
 *      the reconciliation below drops any stored id that is not in that list;
 *   2. `localStorage` is still refused, so nothing survives the tab;
 *   3. the server re-checks the approved `FamilyLink` on **every** request and
 *      answers `404` regardless of what the client believes (§4.3).
 *
 * (1) is what makes the stored value safe: it is a *preference*, reconciled
 * against live authorization on every load, never a claim.
 */
const ACTIVE_CHILD_KEY = 'bodour.activeChild';

/** Pure form of the fail-closed child-coordinate reconciliation. */
export function resolveActiveChild(
  activeRole: string | null,
  activeChildId: string | null,
  available: readonly LinkedChild[],
): LinkedChild | null {
  if (activeRole !== 'parent') return null;
  return available.find((child) => child.id === activeChildId) ?? null;
}

export function storedActiveChildId(): string | null {
  try {
    return window.sessionStorage.getItem(ACTIVE_CHILD_KEY);
  } catch {
    return null;
  }
}

export function storeActiveChildId(id: string | null): void {
  try {
    if (id === null) window.sessionStorage.removeItem(ACTIVE_CHILD_KEY);
    else window.sessionStorage.setItem(ACTIVE_CHILD_KEY, id);
  } catch {
    // Storage disabled: the tab still works, it simply forgets on navigation.
  }
}

interface ActiveChildState {
  children: LinkedChild[];
  activeChildId: string | null;
  /** The child being acted for, or `null` — so a banner can name them (R62.10)
   *  without every caller re-deriving it from the two fields above. */
  activeChild: LinkedChild | null;
  setActiveChildId: (id: string | null) => void;
}

const ActiveChildContext = createContext<ActiveChildState | null>(null);

export function ActiveChildProvider({ children }: { children: ReactNode }): ReactNode {
  const { me } = useSession();
  const { activeRole } = useActiveRole();
  const [activeChildId, setActiveChildIdState] = useState<string | null>(() =>
    storedActiveChildId(),
  );

  const available = useMemo(() => linkedChildren(me), [me]);

  const value = useMemo<ActiveChildState>(() => {
    // A child whose link was revoked disappears from `/me` on the next load; if
    // it was the active one, fall back to none rather than keep pointing at it.
    // This is the reconciliation the doc comment above leans on — without it,
    // a stored id would be a claim rather than a preference.
    // A child coordinate is meaningful only while acting as Parent. In a
    // genuine Parent+Student account, switching to Student must resolve self;
    // a child left in sessionStorage must never leak into that request.
    const active = resolveActiveChild(activeRole, activeChildId, available);
    return {
      children: available,
      activeChildId: active?.id ?? null,
      activeChild: active,
      setActiveChildId: (id: string | null) => {
        storeActiveChildId(id);
        setActiveChildIdState(id);
      },
    };
  }, [available, activeChildId, activeRole]);

  return <ActiveChildContext.Provider value={value}>{children}</ActiveChildContext.Provider>;
}

export function useActiveChild(): ActiveChildState {
  const context = useContext(ActiveChildContext);
  if (!context) throw new Error('useActiveChild must be used inside ActiveChildProvider');
  return context;
}
