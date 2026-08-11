import { api } from '../lib/api.js';

/**
 * `GET`/`PATCH /profile` — the personal section's data (§5.2, R65).
 *
 * **Not `/me`, and the difference is deliberate.** `/me` answers *which account
 * is this* — roles, scopes, status, approved child links — and carries no
 * personal detail at all (R63). This answers *who is the person behind it*.
 *
 * **The editable shape is two fields**, and the type is where that holds:
 * §5.2 permits *"basic contact info"*, and a client offering a name field would
 * be refused by the server's `.strict()` schema rather than quietly ignored.
 */
export interface OwnProfile {
  id: string;
  name_arabic: string;
  name_french: string | null;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  sex: string | null;
  account_status: string;
  /** R62.6 — present for an account created through a child application. */
  reference_code: string | null;
  /** TD-15: loaded with the row, sent back on edit. A stale one is a `409`. */
  version: number;
}

export interface OwnProfileEdit {
  phone?: string | null;
  nickname?: string | null;
}

export async function fetchOwnProfile(token: string | null): Promise<OwnProfile> {
  return api<OwnProfile>('/profile', { token });
}

export async function updateOwnProfile(
  edit: OwnProfileEdit,
  version: number,
  token: string | null,
): Promise<OwnProfile> {
  return api<OwnProfile>('/profile', { method: 'PATCH', token, body: { ...edit, version } });
}
