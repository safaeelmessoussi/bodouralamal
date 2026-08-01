import { api } from '../lib/api.js';

/**
 * Branch and Room administration (§5.6, §14.2, Revision 26).
 *
 * **Reference data: Super Admin writes, Admin reads** (Revision 26). The server
 * enforces that on every call — the `/admin/*` prefix is not the permission
 * boundary — so this adapter carries no permission logic of its own.
 *
 * ── A CONVENTION MISMATCH THIS ADAPTER ABSORBS ───────────────────────────────
 * `GET /admin/branches` returns **raw Prisma rows in camelCase**
 * (`operationalStartDate`, `openingHoursAr`, `deletedAt`, `deletedById`), while
 * every other endpoint in the platform returns an explicit `snake_case`
 * projection — the public `GET /branches` being the same entity in the other
 * convention.
 *
 * That is a real inconsistency and it is **reported, not silently normalised
 * away**: changing a live endpoint's response shape is a contract change and the
 * Document Owner's call, not an implementation detail.
 *
 * Meanwhile this is exactly what the adapter seam is for. The wire types below
 * describe what the endpoint **actually returns**, and the exported types are
 * what components consume — so when the endpoint is aligned, this file changes
 * and nothing else does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What the endpoint really sends today. Not exported: nothing outside this
 *  file should know the response is shaped this way. */
interface BranchWire {
  id: string;
  name: string;
  operationalStartDate: string | null;
  displayOrder: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHoursAr: string | null;
  googleMapsUrl: string | null;
  version: number;
}

interface RoomWire {
  id: string;
  name: string;
  branchId: string;
  version: number;
}

/** What the screens use. */
export interface Branch {
  id: string;
  name: string;
  /** `YYYY-MM-DD` local calendar date (TD-11) — never an instant. */
  operationalStartDate: string | null;
  displayOrder: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHoursAr: string | null;
  googleMapsUrl: string | null;
  /** TD-15: loaded with the row, sent back on edit. A stale one is a `409`. */
  version: number;
}

export interface Room {
  id: string;
  name: string;
  branchId: string;
  version: number;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

/** The API sends an instant; TD-11 says a branch's operational start is a
 *  **date**. Truncating at the seam keeps that mistake out of every screen. */
function toDateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function toBranch(wire: BranchWire): Branch {
  return { ...wire, operationalStartDate: toDateOnly(wire.operationalStartDate) };
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

export async function listBranches(
  token: string | null,
  page = 1,
): Promise<Page<Branch>> {
  const body = await api<Page<BranchWire>>(`/admin/branches?page=${page}&page_size=25`, { token });
  return { ...body, data: body.data.map(toBranch) };
}

export async function createBranch(input: BranchInput, token: string | null): Promise<Branch> {
  return toBranch(await api<BranchWire>('/admin/branches', { method: 'POST', token, body: input }));
}

/** TD-15: `version` is required and a stale one is refused with `409` rather
 *  than overwriting a colleague's edit. */
export async function updateBranch(
  id: string,
  version: number,
  input: Partial<BranchInput>,
  token: string | null,
): Promise<Branch> {
  return toBranch(
    await api<BranchWire>(`/admin/branches/${id}`, {
      method: 'PATCH',
      token,
      body: { version, ...input },
    }),
  );
}

/** TD-5: soft delete, **prohibited while rooms or groups reference the branch**
 *  — the server answers `409 STATE_CONFLICT`, which the screen surfaces as a
 *  reason rather than a generic failure. */
export async function deleteBranch(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/branches/${id}`, { method: 'DELETE', token });
}

export async function listRooms(branchId: string, token: string | null): Promise<Page<Room>> {
  const body = await api<Page<RoomWire>>(`/admin/branches/${branchId}/rooms?page_size=100`, {
    token,
  });
  return body;
}

export async function createRoom(
  branchId: string,
  name: string,
  token: string | null,
): Promise<Room> {
  return api<Room>(`/admin/branches/${branchId}/rooms`, {
    method: 'POST',
    token,
    body: { name },
  });
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
