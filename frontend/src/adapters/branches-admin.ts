import { api } from '../lib/api.js';

/**
 * Branch and Room administration (§5.6, §14.2, Revision 26).
 *
 * **Reference data: Super Admin writes, Admin reads** (Revision 26). The server
 * enforces that on every call — the `/admin/*` prefix is not the permission
 * boundary — so this adapter carries no permission logic of its own.
 *
 * The types below are exactly the endpoint's contract DTO (§16.2, Revision 38),
 * so a field the API stops sending becomes a type error here rather than an
 * empty cell on the page.
 *
 * This file used to be twice as long. `GET /admin/branches` returned raw Prisma
 * rows — `camelCase` names and an instant where TD-11 defines a calendar date —
 * and the mismatch was absorbed here by a parallel set of wire types and a
 * truncating converter. Revision 38 fixed the endpoint instead. **Adapters
 * adapt backend contracts to UI models; they do not repair inconsistent backend
 * contracts** — a repair at this seam leaves the contract wrong for the next
 * client, and hides that it is wrong from everyone.
 */

export interface Branch {
  id: string;
  name: string;
  /** `YYYY-MM-DD` calendar date (TD-11) — never an instant. */
  operational_start_date: string | null;
  display_order: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  opening_hours_ar: string | null;
  google_maps_url: string | null;
  /** TD-15: loaded with the row, sent back on edit. A stale one is a `409`. */
  version: number;
}

export interface Room {
  id: string;
  name: string;
  branch_id: string;
  version: number;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

export interface BranchInput {
  name: string;
  operational_start_date?: string | null;
  display_order?: number | null;
  address?: string;
  phone?: string | null;
  email?: string | null;
  opening_hours_ar?: string;
  google_maps_url?: string | null;
}

/**
 * R76 — `sort` is the **server's** sort, not the client's.
 *
 * Omitting it returns BR-19's own order, which is also the **canonical** order:
 * the only state in which manual reordering is offered, because under any other
 * sort the visible sequence is not the business one.
 */
export async function listBranches(
  token: string | null,
  page = 1,
  sort: { by: string; dir: 'asc' | 'desc' } | null = null,
): Promise<Page<Branch>> {
  const params = new URLSearchParams({ page: String(page), page_size: '25' });
  if (sort) {
    params.set('sort_by', sort.by);
    params.set('sort_dir', sort.dir);
  }
  return api<Page<Branch>>(`/admin/branches?${params.toString()}`, { token });
}

/**
 * `PATCH /admin/branches/order` — **the branches, in the order given** (R76.4).
 *
 * The body is the sequence; the server assigns positions from it, so a duplicate
 * or gapped `display_order` is impossible rather than something this client must
 * avoid producing. Returns the resulting order, so the caller re-renders from the
 * server's answer rather than its own optimistic guess.
 */
export async function reorderBranches(
  ids: readonly string[],
  token: string | null,
): Promise<string[]> {
  const body = await api<{ data: { ids: string[] } }>('/admin/branches/order', {
    method: 'PATCH',
    token,
    body: { ids },
  });
  return body.data.ids;
}

export async function createBranch(input: BranchInput, token: string | null): Promise<Branch> {
  return api<Branch>('/admin/branches', { method: 'POST', token, body: input });
}

/** TD-15: `version` is required and a stale one is refused with `409` rather
 *  than overwriting a colleague's edit. */
export async function updateBranch(
  id: string,
  version: number,
  input: Partial<BranchInput>,
  token: string | null,
): Promise<Branch> {
  return api<Branch>(`/admin/branches/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
}

/** TD-5: soft delete, **prohibited while rooms or groups reference the branch**
 *  — the server answers `409 STATE_CONFLICT`, which the screen surfaces as a
 *  reason rather than a generic failure. */
export async function deleteBranch(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/branches/${id}`, { method: 'DELETE', token });
}

export async function listRooms(branchId: string, token: string | null): Promise<Page<Room>> {
  return api<Page<Room>>(`/admin/branches/${branchId}/rooms?page_size=100`, { token });
}

export async function createRoom(
  branchId: string,
  name: string,
  token: string | null,
): Promise<Room> {
  return api<Room>(`/admin/branches/${branchId}/rooms`, { method: 'POST', token, body: { name } });
}

export async function updateRoom(
  id: string,
  version: number,
  name: string,
  token: string | null,
): Promise<Room> {
  return api<Room>(`/admin/rooms/${id}`, { method: 'PATCH', token, body: { version, name } });
}

export async function deleteRoom(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/rooms/${id}`, { method: 'DELETE', token });
}
