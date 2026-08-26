import { api } from '../lib/api.js';

/**
 * Sessions — the **materialized occurrences** of a Course Schedule (§4.4).
 *
 * ## The three scopes (SRS Revision 50)
 *
 * Editing, cancelling or deleting one occurrence of a recurring class must ask
 * **which occurrences the change applies to**, and the three answers reach three
 * different places — which is the whole reason this adapter and
 * `course-schedules.ts` are separate:
 *
 * | Scope | Endpoint | What it touches |
 * |---|---|---|
 * | This session only | `PATCH /sessions/{id}` | one occurrence, marked `overridden` |
 * | This and all future | `PATCH /admin/course-schedules/{id}` with `scope` | **splits** the schedule |
 * | All sessions | `PATCH /admin/course-schedules/{id}` | the rule itself |
 *
 * **"This session only" is a different resource, not a parameter.** It edits one
 * occurrence rather than the rule that produced it, so it is a different
 * endpoint — and the occurrence it leaves behind is `overridden`, which R43.6
 * then protects from every later schedule rewrite. That protection is the
 * mechanism, not a side effect.
 */

export type EditScope = 'this_session' | 'this_and_future' | 'all_sessions';

export interface ScheduleSession {
  id: string;
  /** TD-11 calendar date. */
  date: string;
  /** Wall-clock `HH:MM` (TD-11) — rendered as sent, never parsed. */
  start_time: string;
  end_time: string;
  status: string;
  /** R43.4 — *a human decided about this occurrence*, not *differs from the
   *  schedule*. What a "this session only" edit leaves behind. */
  overridden: boolean;
  room_id: string | null;
  /**
   * **R97 — طريقة الحضور.** `'in_person'` | `'online'`, with
   * `online_media_mode` non-null exactly when it is `'online'`. Rendered
   * through `deliveryLabel` in `components/scheduling/delivery.tsx` and never
   * hand-written per screen.
   */
  delivery_mode: string;
  online_media_mode: string | null;
  /**
   * **R109 — this occurrence's OWN tier**, snapshotted at materialization and
   * decidable for one date. The editor opens on THIS value, not on the
   * schedule's: after an override the two differ, and seeding from the schedule
   * would let a reader re-save an unrelated field and silently undo the
   * override — the same trap `delivery_mode` documents above.
   */
  visibility: string;
  /** TD-15: sent back on a single-occurrence edit. */
  version: number;
  staff: { user_id: string; position: string }[];
  /**
   * Stable R43.6 codes saying **why this occurrence will be spared**.
   *
   * Empty means a schedule edit or a split may rewrite it. §4.4 requires the
   * scope dialog to state which occurrences are about to change, and that is
   * unanswerable without this.
   */
  protected_reasons: string[];
}

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

export async function listScheduleSessions(
  scheduleId: string,
  token: string | null,
  page = 1,
): Promise<Page<ScheduleSession>> {
  return api<Page<ScheduleSession>>(
    `/admin/course-schedules/${scheduleId}/sessions?page=${page}&page_size=100`,
    { token },
  );
}

export interface SessionEdit {
  date?: string;
  start_time?: string;
  end_time?: string;
  room_id?: string | null;
  /**
   * **R97 — this occurrence's own delivery.** Sent as a unit: naming the mode
   * means naming the media mode that goes with it, and the server refuses a
   * combination that cannot be stored rather than dropping the odd field.
   */
  delivery_mode?: 'in_person' | 'online';
  online_media_mode?: 'audio_video' | 'audio_only' | null;
  /**
   * **This occurrence's own staffing** (R43.4, surfaced by R91 §11).
   *
   * A one-off cover: whoever is named here takes THIS lesson and nothing else.
   * The schedule's assignments are untouched, so the next occurrence resolves
   * to the normal مؤطِّرة — and a past occurrence keeps whoever actually took
   * it, whatever the schedule later says.
   *
   * **No period**: an occurrence IS a date, so a period on it would be a field
   * with one possible value.
   */
  staff?: { user_id: string; position: 'teacher' | 'assistant' }[];
  /**
   * **R109 — this occurrence's own tier** (§D). On exactly the footing
   * `room_id` has: it decides this date and nothing else, and the `overridden`
   * flag the server always sets is what protects it from the next resync.
   *
   * There is no separate hide-one-occurrence endpoint, because this is it.
   */
  visibility?: string;
}

/**
 * **Scope 1 — this session only.** Marks the occurrence `overridden`, which is
 * what protects it from every later schedule rewrite (R43.6).
 *
 * The write **always** sets that flag, even when the new values equal the
 * schedule's (R43.4): the flag records that *a human decided about this
 * occurrence*, and inferring it from *differs from the schedule* would silently
 * un-protect a session whose schedule later moved to match it.
 */
export async function updateSession(
  id: string,
  version: number,
  edit: SessionEdit,
  token: string | null,
): Promise<unknown> {
  return api(`/sessions/${id}`, { method: 'PATCH', token, body: { version, ...edit } });
}

/** TD-1 `scheduled → cancelled`. **The reason is mandatory** — it is the only
 *  record of why a class did not happen, and the audience size is written to the
 *  audit row at this moment, while it is still answerable. */
export async function cancelSession(
  id: string,
  version: number,
  reason: string,
  token: string | null,
): Promise<unknown> {
  return api(`/sessions/${id}/cancel`, { method: 'POST', token, body: { version, reason } });
}

/** TD-1 `cancelled → scheduled`, **refused once the date has passed**: restoring
 *  a class that already did not happen would assert it was scheduled when nobody
 *  could have attended. */
export async function restoreSession(
  id: string,
  version: number,
  token: string | null,
): Promise<unknown> {
  return api(`/sessions/${id}/restore`, { method: 'POST', token, body: { version } });
}

/**
 * `POST /sessions/{id}/content` — links an existing library item (TD-3.12, §4.9).
 *
 * **The body key is `educational_content_id`, spelled exactly as TD-3.12 names
 * it.** The boundary is `.strict()`, so the shorter `content_id` that reads
 * better would be refused — that exact slip was caught once already (M3b-14b),
 * and a key the specification spells out is copied, never paraphrased.
 *
 * Linking makes the session **protected** (R43.6): a later schedule edit will
 * spare this occurrence and report it rather than rewriting it.
 */
export async function linkSessionContent(
  sessionId: string,
  educationalContentId: string,
  token: string | null,
): Promise<unknown> {
  return api(`/sessions/${sessionId}/content`, {
    method: 'POST',
    token,
    body: { educational_content_id: educationalContentId },
  });
}

/** Unlinks — and **never deletes the file** (TD-3.12). The item is a library
 *  resource with its own lifecycle; removing it from one session's materials
 *  must not destroy it for every other session that references it. */
export async function unlinkSessionContent(
  sessionId: string,
  contentId: string,
  token: string | null,
): Promise<unknown> {
  return api(`/sessions/${sessionId}/content/${contentId}`, { method: 'DELETE', token });
}

/**
 * `POST /sessions/{id}/notify` — **the optional send for an occurrence** (R83.3).
 *
 * R77.4 and R78.4 wrote these notices inside the changing transaction, which
 * could not express *do not tell anyone*. The change now commits alone and this
 * decides delivery; recipients are the server's — the schedule's resolved
 * audience plus the occurrence's own staff, minus the actor.
 */
export async function notifySessionChange(
  sessionId: string,
  change: 'cancelled' | 'rescheduled',
  token: string | null,
): Promise<{ notified: number }> {
  const body = await api<{ data: { notified: number } }>(`/sessions/${sessionId}/notify`, {
    method: 'POST',
    token,
    body: { change },
  });
  return body.data;
}

/** R92 — this occurrence's audience branches, and where it physically happens. */
export interface SessionRoster {
  session_id: string;
  /** **Where the class meets.** A different fact from the audience, and the
   *  reason the two are separate fields rather than one branch. */
  venue: { branch_id: string; branch_name: string; room_name: string | null };
  /** The branch populations expected there — the schedule's own unless this
   *  occurrence states otherwise. */
  audience_branches: { id: string; name: string }[];
  overridden: boolean;
  students: { id: string; name: string; branch_id: string | null }[];
}

export async function fetchSessionRoster(
  id: string,
  token: string | null,
): Promise<SessionRoster> {
  const res = await api<{ data: SessionRoster }>(`/sessions/${id}/roster`, { token });
  return res.data;
}

/**
 * **Replacement, never addition**: the list submitted IS this occurrence's
 * audience, and an empty list clears the override so the audience returns to the
 * schedule's.
 */
export async function setSessionAudienceBranches(
  id: string,
  version: number,
  branchIds: string[],
  token: string | null,
): Promise<{ branch_ids: string[]; overridden: boolean }> {
  const res = await api<{ data: { branch_ids: string[]; overridden: boolean } }>(
    `/sessions/${id}/audience-branches`,
    { method: 'PUT', token, body: { version, branch_ids: branchIds } },
  );
  return res.data;
}
