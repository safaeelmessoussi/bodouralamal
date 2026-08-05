import { api } from '../lib/api.js';

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

export interface UserSummary {
  id: string;
  name_arabic: string;
  nickname: string | null;
  phone: string | null;
  account_status: string;
  roles: { role: string; branch_id: string | null; branch_name: string | null }[];
}

export interface UserQuery {
  q?: string;
  role?: string;
  branch_id?: string;
  status?: string;
}

export async function searchUsers(
  token: string | null,
  query: UserQuery = {},
  page = 1,
): Promise<Page<UserSummary>> {
  const params = new URLSearchParams({ page: String(page), page_size: '25' });
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  return api<Page<UserSummary>>(`/admin/users?${params.toString()}`, { token });
}
