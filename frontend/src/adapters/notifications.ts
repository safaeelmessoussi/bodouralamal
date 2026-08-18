import { api } from '../lib/api.js';

/**
 * The caller's own notifications (§4.8 as narrowed by Revision 77).
 *
 * **No id names a user in either call**, and that is the contract, not an
 * omission: the recipient is the authenticated caller, so there is nothing here
 * for a client to get wrong and no role that widens the read.
 */
export interface NotificationItem {
  id: string;
  type: 'session_cancelled' | 'session_restored' | 'session_assigned' | 'session_rescheduled';
  session_id: string;
  session_date: string;
  session_start_time: string;
  subject_name: string | null;
  level_name: string | null;
  reason: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPage {
  data: NotificationItem[];
  meta: { page: number; page_size: number; total: number; unread: number };
}

export async function listNotifications(
  token: string | null,
  options: { unreadOnly?: boolean; page?: number } = {},
): Promise<NotificationPage> {
  const params = new URLSearchParams({ page: String(options.page ?? 1), page_size: '25' });
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
