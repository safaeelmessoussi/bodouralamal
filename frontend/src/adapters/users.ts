import { api } from '../lib/api.js';
import { applySort } from './reorder.js';
import type { SortState } from '../components/ui/data-table.js';

/**
 * User search (§5.6, §14.2, TD-3.2).
 *
 * **The staff-facing legal name only.** `name_arabic` is what a back-office
 * screen renders; the separate value §7 reserves for **public** surfaces is
 * deliberately absent, and `check-display-identity.sh` enforces that absence.
 *
 * That guard caught this file: the type declared the public field because the
 * endpoint sends it, and no screen here needed it. **A client that cannot see
 * the raw inputs cannot choose between them** — which is the whole mechanism,
 * since the backend resolves the published name through one function and a
 * client picking for itself is how a legal name reaches a public page with
 * nothing in the interface revealing it to the person affected (§20 rule 21).
 */

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

/** One live assignment. `branch_id: null` is **all branches for that
 *  assignment** (§7 R24), never *no branch*. */
export interface RoleAssignment {
  role: string;
  branch_id: string | null;
  /** A label for display; `branch_id` is the identifier. `null` when unscoped. */
  branch_name: string | null;
}

export interface UserSummary {
  id: string;
  name_arabic: string;
  nickname: string | null;
  phone: string | null;
  /**
   * The bound Google address, or the pre-provisioned one for an account not yet
   * claimed (R15). **`null` is a fact, not a gap**: a minor student is a
   * login-less row with no address at all (§4.3).
   */
  email: string | null;
  account_status: string;
  roles: RoleAssignment[];
  /**
   * TD-15 — and why the edit dialog needs no second request. The list carries
   * the version the write must send back; a `GET /admin/users/{id}` returning
   * these same fields plus one would be a second projection of one concept.
   */
  version: number;
}

export interface UserQuery {
  q?: string;
  role?: string;
  branch_id?: string;
  status?: string;
  /**
   * R79.7 — **only the institute's مستفيدات**, whatever their roles and whatever
   * their enrolments. The durable fact, resolved server-side.
   */
  beneficiaries_only?: 'true';
}

export async function searchUsers(
  token: string | null,
  query: UserQuery = {},
  page = 1,
  sort: SortState | null = null,
): Promise<Page<UserSummary>> {
  const params = new URLSearchParams({ page: String(page), page_size: '25' });
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  applySort(params, sort);
  return api<Page<UserSummary>>(`/admin/users?${params.toString()}`, { token });
}

/**
 * The five roles §15.1 seeds and §4.2 defines.
 *
 * **A specification constant, not reference data.** There is no endpoint for it
 * and there should not be: the set is closed by the SRS, the server validates
 * against the same five, and every screen needs a translated label per value
 * regardless — so the list has to exist on this side whatever the API does.
 * `super_admin` is included because `PUT /admin/users/{id}/roles` accepts it
 * (Revision 22 — administrator changes happen through the application); the
 * server still refuses a caller who is not a Super Admin.
 */
export const ROLES = ['super_admin', 'admin', 'teacher', 'student', 'parent'] as const;
export type Role = (typeof ROLES)[number];

/** TD-1's account lifecycle. `rejected` is terminal — reachable as a filter,
 *  never as a destination. */
export const ACCOUNT_STATUSES = ['pending', 'active', 'suspended', 'rejected'] as const;

export interface UserProfileInput {
  name_arabic?: string;
  name_french?: string | null;
  nickname?: string | null;
  phone?: string | null;
}

/**
 * Edits the person's own fields.
 *
 * **`account_status` is not offered and the server refuses it**: suspension
 * revokes every live session in the same transaction (TD-4.15), which a field
 * assignment cannot carry. `suspendUser` is that operation.
 */
export async function updateUser(
  id: string,
  version: number,
  input: UserProfileInput,
  token: string | null,
): Promise<UserSummary> {
  const body = await api<{ data: UserSummary }>(`/admin/users/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
  return body.data;
}

/** TD-1 `Active → Suspended`. The reason is mandatory — it is the only record
 *  of why access was withdrawn. */
export async function suspendUser(
  id: string,
  version: number,
  reason: string,
  token: string | null,
): Promise<UserSummary> {
  const body = await api<{ data: UserSummary }>(`/admin/users/${id}/suspend`, {
    method: 'POST',
    token,
    body: { version, reason },
  });
  return body.data;
}

/** TD-1 `Suspended → Active`. Sessions stay revoked, so the person signs in
 *  again — the only way the new state is proven rather than assumed. */
export async function reactivateUser(
  id: string,
  version: number,
  token: string | null,
): Promise<UserSummary> {
  const body = await api<{ data: UserSummary }>(`/admin/users/${id}/reactivate`, {
    method: 'POST',
    token,
    body: { version },
  });
  return body.data;
}

/**
 * **Replaces** the complete assignment set.
 *
 * Not add/remove: one call is one decision and one audit row, and there is no
 * window in which the user holds half of an intended change — which
 * add-then-remove creates every time a role moves between branches.
 */
export async function setUserRoles(
  id: string,
  assignments: { role: string; branch_id: string | null }[],
  token: string | null,
): Promise<UserSummary> {
  const body = await api<{ data: UserSummary }>(`/admin/users/${id}/roles`, {
    method: 'PUT',
    token,
    body: { assignments },
  });
  return body.data;
}

/**
 * Pre-provisions an account against a Google address (§4.1b step 4b).
 *
 * **Answers a bare object rather than the list's shape** — this endpoint
 * predates the DTO the management operations share, and the screen reloads the
 * list afterwards rather than inserting the row, so adapting here is cheaper
 * than changing a contract that is already in use.
 *
 * `super_admin` is absent from `role` deliberately: pre-provisioning an
 * unclaimed account straight into the highest role is a different risk from
 * promoting an approved one, which is what `setUserRoles` is for.
 */
export async function createUser(
  input: {
    name_arabic: string;
    email: string;
    role?: Exclude<Role, 'super_admin'>;
    branch_id?: string;
    pre_approved?: boolean;
  },
  token: string | null,
): Promise<{ id: string; account_status: string }> {
  return api<{ id: string; account_status: string }>('/admin/users', {
    method: 'POST',
    token,
    body: input,
  });
}
