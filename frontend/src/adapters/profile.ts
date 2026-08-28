import { api } from '../lib/api.js';
import type { QrMatrix } from '../components/ui/user-qr.js';

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
  /** R96 — this person's stable QR identity. Identifies; never authenticates. */
  qr: QrMatrix;
  /**
   * **NEW G — where she is placed.** Empty is a fact, not a gap: a parent holds
   * no enrolments of her own, and an applicant awaiting approval holds none yet.
   */
  enrolments: OwnEnrolment[];
  circles: OwnCircle[];
  /**
   * **The guardian relationship, and almost nothing about the guardian.** NEW G
   * forbids guardian email, guardian phone and any unrelated guardian field by
   * default, so the server sends a name and a status and nothing else — the
   * absence is a projection, not something this client filters out.
   */
  guardians: OwnGuardianLink[];
  /** TD-15: loaded with the row, sent back on edit. A stale one is a `409`. */
  version: number;
}

export interface OwnEnrolment {
  id: string;
  category_name: string;
  level_name: string;
  branch_name: string;
  /** `null` when she is enrolled in the Level itself rather than a group. */
  group_name: string | null;
}

export interface OwnCircle {
  id: string;
  name: string;
  subject_name: string;
  level_name: string;
}

export interface OwnGuardianLink {
  id: string;
  name: string;
  status: string;
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

/**
 * `DELETE /profile` — **delete my own account** (R111).
 *
 * Available to every authenticated user. The server may **refuse** with a `409`
 * naming what holds it: live teaching responsibilities
 * (`RESPONSIBILITIES_ASSIGNED`, with a `blocked_by` breakdown) or being the last
 * active Super Admin (`LAST_SUPER_ADMIN`). Those are blocks to clear, not
 * permanent refusals, which is why the screen shows what must move.
 */
export async function deleteOwnAccount(token: string | null): Promise<void> {
  await api<void>('/profile', { method: 'DELETE', token });
}
