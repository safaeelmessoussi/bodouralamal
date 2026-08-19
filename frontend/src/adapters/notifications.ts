import { api } from '../lib/api.js';

/**
 * The caller's own notifications (§4.8 as narrowed by Revision 77).
 *
 * **No id names a user in either call**, and that is the contract, not an
 * omission: the recipient is the authenticated caller, so there is nothing here
 * for a client to get wrong and no role that widens the read.
 */
/**
 * Every kind a notice can be (R77, R78, R82, R83).
 *
 * Exported so the renderer's headline map can be keyed by it — a `Record` over
 * this union means **adding a type without a headline fails the type check**,
 * which is what stops the fall-through the list's own docstring warns about: a
 * class that MOVED once risked being announced as one called off.
 */
export type NotificationType =
  | 'session_cancelled'
  | 'session_restored'
  | 'session_assigned'
  | 'session_rescheduled'
  | 'event_created'
  | 'event_rescheduled'
  | 'event_cancelled'
  | 'grade_published';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  /** Exactly one target is set (R82.1); the fields below are already resolved. */
  session_id: string | null;
  event_id: string | null;
  exam_id: string | null;
  /** What it is about — a subject, an event's name, an exam's title. */
  title: string | null;
  date: string | null;
  start_time: string | null;
  /** The Level for a class, the Subject for an exam; `null` where neither. */
  scope_name: string | null;
  /** R83.2 — a cancellation may carry no reason at all. */
  reason: string | null;
  session_date: string | null;
  session_start_time: string | null;
  subject_name: string | null;
  level_name: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPage {
  data: NotificationItem[];
  meta: { page: number; page_size: number; total: number; unread: number };
}

export async function listNotifications(
  token: string | null,
  options: { unreadOnly?: boolean; page?: number; pageSize?: number } = {},
): Promise<NotificationPage> {
  // `pageSize` exists for the bell, which needs the unread META and none of the
  // rows — fetching a full page to render one number would make every screen
  // pay for a list nobody has opened.
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    page_size: String(options.pageSize ?? 25),
  });
  if (options.unreadOnly === true) params.set('unread_only', 'true');
  return api<NotificationPage>(`/notifications?${params.toString()}`, { token });
}

/** Idempotent — a retry does not move when the person actually read it. */
export async function markNotificationRead(
  id: string,
  token: string | null,
): Promise<NotificationItem> {
  const body = await api<{ data: NotificationItem }>(`/notifications/${id}/read`, {
    method: 'POST',
    token,
  });
  return body.data;
}
