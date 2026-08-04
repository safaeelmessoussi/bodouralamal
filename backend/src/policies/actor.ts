import type { RoleScope } from './branch-scope.js';

/**
 * The authenticated caller, as every service receives them.
 *
 * Extracted from `group.service.ts` when that module was retired with the
 * Revision 43 contract migration. It had lived there for no reason beyond
 * being the first service written, and eleven modules imported it from a file
 * about groups — so deleting groups would have taken the platform's notion of
 * "who is asking" with it.
 *
 * It belongs beside `branch-scope.ts` because that is what reads it: the shape
 * exists so a service can answer *"may this person act here"* without knowing
 * how the session was established.
 */
export interface Actor {
  userId: string;
  roles: string[];
  /**
   * Carried so a **public** endpoint can apply §4.4's rule that a `Pending`
   * account sees only the public tier — the guarded router refuses non-active
   * callers outright, but `/calendar` must serve them something.
   */
  accountStatus?: string;
  /**
   * The branches this actor is scoped to, **per role** (§4.2, Revision 24).
   * `branches: null` on an assignment means *all branches for that role*, never
   * "no branches" — collapsing the two is how a scoped admin ends up seeing
   * everything or nothing by accident.
   */
  roleScopes: RoleScope[];
}
