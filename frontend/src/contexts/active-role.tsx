import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { ROLE_HOMES } from '../lib/role-home.js';
import { useSession } from './session.js';

/**
 * Active role context (§2.1: *"a single person may hold multiple roles
 * concurrently … switching context via an account switcher in the header"*).
 *
 * ## What was broken
 *
 * `RoleSwitcher` held its selection in **local component state** and did nothing
 * with it. Picking a role re-labelled the button and changed nothing else: the
 * page stayed put, and every screen went on reading `me.roles` — the full set —
 * so a Super Admin who selected *مؤطِّرة* still saw the Super Admin back office.
 * The control was documented as *"presentation only"*, and it was not even that.
 *
 * ## What an active role IS, and what it is not
 *
 * It is a **context**, exactly like the active child (§4.3): it selects which of
 * the person's roles the interface is currently being used *as*, and therefore
 * which portal, navigation and home page they get.
 *
 * It is **not** a permission. §4.2 is explicit that *"scope resolves per role,
 * never as a flat union across roles"*, and the server enforces TD-2 from the
 * JWT on every request. Selecting *مؤطِّرة* does not remove the Super Admin's
 * authority server-side, and nothing here could make it do so — which is the
 * point: **the client cannot grant itself anything, and it cannot revoke
 * anything either.** Narrowing server authority to the active role would be a
 * new normative concept and needs its own SRS revision.
 *
 * ## R60 — the server is now the authority
 *
 * This began as a client-only context, and it is now a *reflection* of a real
 * authorization state. `me.active_role` is what the token actually carries, so
 * the interface can no longer disagree with what the server will accept: if the
 * requested role was revoked, refresh fell back to another and said so, and this
 * shows that one.
 *
 * `sessionStorage` still holds the **request** — what this tab asks for on its
 * next refresh — which is a different thing from what it was granted.
 *
 * ## Why this one persists when the active child does not
 *
 * `ActiveChildProvider` deliberately keeps nothing: a stale child in storage
 * would silently change *whose data* a page requests after a link is revoked.
 * A role is different in both respects — it selects a portal rather than a
 * person, and **switching navigates**, which in this application is a full page
 * load (`main.tsx` switches on `window.location.pathname`). Without persistence
 * the selection would be discarded by the very navigation it causes.
 *
 * `sessionStorage`, not `localStorage`: the choice belongs to this browsing
 * session, as the switch itself does. And it is **validated against `me.roles`
 * on every read**, so a role that has since been revoked is discarded rather
 * than honoured — the same freshness property the active child gets for free by
 * not persisting at all.
 */
const STORAGE_KEY = 'bodour.activeRole';

interface ActiveRoleState {
  /**
   * **Every role the account holds**, in §14.1's precedence order.
   *
   * For the switcher's menu and nothing else. R60.9 keeps `/me` reporting the
   * full list precisely so a person can switch back; using it to decide what the
   * interface *shows* is the bug this context exists to prevent.
   */
  roles: string[];
  /** `null` only when the account holds no role at all (§14.4's no-role landing). */
  activeRole: string | null;
  /**
   * **The active role as a one-element array** — what every presentation
   * decision reads.
   *
   * The helpers that decide navigation and homes (`visibleModules`,
   * `roleHomePath`, `canAccess`) all take a role *list*, because they predate
   * R60 and were written against `me.roles`. Handing them `[activeRole]` makes
   * them correct with no change to their signatures or their logic — and, more
   * to the point, gives every caller **one obvious thing to read** instead of a
   * choice between two lists where only one is right.
   *
   * That choice is what produced both reported defects: `لوحة التحكم` sent a
   * Super Admin working as مؤطِّرة to `/admin`, and the back-office sidebar
   * listed Super Admin modules to someone acting as Admin. Neither was a routing
   * bug; both were `me.roles` being read where the active role was meant.
   *
   * Empty only for an account holding no role at all (§14.4's no-role landing).
   */
  activeRoles: string[];
  /** Refused silently for a role the caller does not hold — see `select`. */
  setActiveRole: (role: string) => void;
}

const ActiveRoleContext = createContext<ActiveRoleState | null>(null);

/**
 * Held roles in precedence order.
 *
 * `ROLE_HOMES` already declares that order — most privileged first — and reusing
 * it is what keeps the switcher, the Dashboard button and the default selection
 * from disagreeing about which role is "first".
 */
export function orderedRoles(held: readonly string[]): string[] {
  const known = ROLE_HOMES.map((r) => r.role).filter((role) => held.includes(role));
  // A role the client does not know about is still shown rather than hidden: a
  // role added server-side must be visible, not silently unavailable.
  const unknown = held.filter((role) => !ROLE_HOMES.some((r) => r.role === role));
  return [...known, ...unknown];
}

/**
 * Which role is active, given what was stored and what is held.
 *
 * Exported and pure so the rule can be tested without a DOM: the resolution —
 * *honour the stored choice only while the person still holds it, otherwise
 * fall back to the most privileged* — is the whole behaviour, and testing it
 * through a rendered tree would test React instead.
 */
export function resolveActiveRole(stored: string | null, roles: readonly string[]): string | null {
  if (stored !== null && roles.includes(stored)) return stored;
  return roles[0] ?? null;
}

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage disabled. The switcher still works for the
    // current page; it simply forgets across navigations.
    return null;
  }
}

export function ActiveRoleProvider({ children }: { children: ReactNode }): ReactNode {
  const { me } = useSession();
  const [stored, setStored] = useState<string | null>(readStored);

  // `me.roles` stays the LIVE assignment list even while the token is narrowed
  // (R60.9), which is what keeps the menu complete and the switch reversible.
  const roles = useMemo(() => orderedRoles(me?.roles ?? []), [me]);

  const setActiveRole = useCallback(
    (role: string) => {
      // **The guard that matters.** The list comes from `/me`, which is derived
      // from the server-issued token, so a role absent from it is one the person
      // does not hold. Refusing here is a courtesy to the interface; the server
      // refuses the request itself regardless (TD-2).
      if (!roles.includes(role)) return;
      setStored(role);
      try {
        window.sessionStorage.setItem(STORAGE_KEY, role);
      } catch {
        // Not fatal — the in-memory value still drives this page.
      }
    },
    [roles],
  );

  const value = useMemo<ActiveRoleState>(() => {
    // A stored role the person no longer holds falls back to their most
    // privileged one rather than leaving the interface in a role that was
    // revoked — the same reasoning `ActiveChildProvider` applies to a revoked
    // link, reached differently because this value is persisted.
    // **The server's answer first.** `me.active_role` is what the token carries;
    // the stored value is only what this tab intends to request next. They differ
    // exactly when a role was revoked, and the granted one is the truth.
    const granted = me?.active_role ?? null;
    const active = granted ?? resolveActiveRole(stored, roles);
    return {
      roles,
      activeRole: active,
      activeRoles: active === null ? [] : [active],
      setActiveRole,
    };
  }, [roles, stored, setActiveRole, me]);

  return <ActiveRoleContext.Provider value={value}>{children}</ActiveRoleContext.Provider>;
}

export function useActiveRole(): ActiveRoleState {
  const context = useContext(ActiveRoleContext);
  if (!context) throw new Error('useActiveRole must be used inside ActiveRoleProvider');
  return context;
}
