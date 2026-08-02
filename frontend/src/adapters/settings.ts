import { api } from '../lib/api.js';

/**
 * Platform settings (§5.6, TD-3.11, Revision 42).
 *
 * **Super Admin only**, enforced server-side against live rows (TD-12) — the
 * `/admin/` prefix is not the permission boundary, so this adapter carries no
 * permission logic of its own.
 *
 * The screen renders whatever the server lists. `label_key` and `hint_key` are
 * **i18n keys chosen by the backend**, not copy: which settings are writable is
 * a server decision (an explicit allow-list), and a client holding its own list
 * would drift out of step with it the first time one was added.
 */

export interface Setting {
  key: string;
  label_key: string;
  hint_key: string;
  /** `null` when never configured — distinct from empty, which is refused. */
  value: string | null;
  /** TD-15: sent back on save; a stale one is a `409`. */
  version: number;
}

export async function listSettings(token: string | null): Promise<Setting[]> {
  const body = await api<{ data: Setting[] }>('/admin/settings', { token });
  return body.data;
}

/** TD-15 optimistic locking: `version` is required and a stale one is refused
 *  rather than overwriting another Super Admin's change. */
export async function updateSetting(
  key: string,
  value: string,
  version: number,
  token: string | null,
): Promise<Setting> {
  return api<Setting>(`/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    token,
    body: { value, version },
  });
}
