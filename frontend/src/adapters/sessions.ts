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
