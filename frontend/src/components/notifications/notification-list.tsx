import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  listNotifications,
  markNotificationRead,
  type NotificationItem,
} from '../../adapters/notifications.js';
import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { ErrorState } from '../states.js';

/**
 * **What the platform has told this student** (§4.8 as narrowed by Revision 77).
 *
 * This is the MVP surface and deliberately not §10.1's bell-and-dropdown: one
 * event exists, so a chrome-level control implying a stream of them would
 * promise a feature that is postponed. R77.8 says whatever §10.1 later specifies
 * **replaces** this rather than extending it.
 *
 * ## Why a notice is rendered even when it has been read
 *
 * A read notice is still true — the class is still cancelled — and hiding it
 * would make the section answer *what is new* while looking like it answers
 * *what has happened*. Unread ones are marked; the section is not an inbox that
 * empties.
 *
 * ## Nothing is marked read automatically
 *
 * Rendering a notice is not evidence a person read it, and R77.5 turns on that
 * distinction: an unread notice is **withdrawn** when a class is reinstated,
 * while a read one is **corrected**. Auto-marking on render would make every
 * notice "read" and turn every restore into a correction nobody needed.
 */
/**
 * One key per event type, in one place.
 *
 * A chain of ternaries silently fell through to *cancelled* for anything it did
 * not know, which is the worst possible default: a class that MOVED would have
 * been announced as one that was called off.
 */
/**
 * **A `Record` over the union, not a lookup with a fallback.**
 *
 * The fallback was the danger this comment described: a chain of ternaries fell
 * through to *cancelled*, so a class that MOVED would have been announced as one
 * called off. Keying by the exported union means adding a type without a
 * headline **fails the type check** — which is exactly what happened when R82's
 * four types arrived, and is why nothing shipped announcing a published grade as
 * a cancellation.
 */
const HEADLINE_KEYS: Record<NotificationItem['type'], string> = {
  session_cancelled: 'notifications.sessionCancelled',
  session_restored: 'notifications.sessionRestored',
  session_rescheduled: 'notifications.sessionRescheduled',
  session_assigned: 'notifications.sessionAssigned',
  event_created: 'notifications.eventCreated',
  event_rescheduled: 'notifications.eventRescheduled',
  event_cancelled: 'notifications.eventCancelled',
  grade_published: 'notifications.gradePublished',
};

export function NotificationList({ token }: { token: string | null }): ReactNode {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const body = await listNotifications(token);
      setItems(body.data);
      setUnread(body.meta.unread);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function read(id: string): Promise<void> {
    setBusy(id);
    try {
      const updated = await markNotificationRead(id, token);
      // Patch in place rather than reloading: the list must not reorder or lose
      // the reader's position because they acknowledged one line of it.
      setItems((current) => current.map((n) => (n.id === id ? updated : n)));
      setUnread((n) => Math.max(0, n - 1));
    } catch {
      setStatus('error');
    } finally {
      setBusy(null);
    }
  }

  if (status === 'error') return <ErrorState onRetry={() => void load()} />;
  // Nothing to say is said by saying nothing: an empty "no notifications" panel
  // on every student's dashboard is noise on the screen they use most.
  if (status === 'loading' || items.length === 0) return null;

  return (
    <section className="card" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading">
        {t('notifications.title')}
        {unread > 0 ? (
          <span className="notifications__count" aria-label={t('notifications.unreadLabel')}>
            {unread}
          </span>
        ) : null}
      </h2>
      <ul className="notifications__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={
              item.read_at === null ? 'notifications__item is-unread' : 'notifications__item'
            }
          >
            <p className="notifications__headline">
              {/* The target-neutral fields (R82.1): a notice is about a class,
                  an activity or an exam, and the reader experiences one list. */}
              {t(HEADLINE_KEYS[item.type])
                .replace('{subject}', item.title ?? t('notifications.theClass'))
                .replace('{date}', item.date ?? '')
                .replace('{time}', item.start_time ?? '')
                .trim()}
            </p>
            {/* The reason is the whole point of the notice — «ألغيت» without
                «لماذا» is what the association's manual channels already
                managed, badly. Absent on a restoration, where the stored reason
                describes the cancellation that no longer applies. */}
            {/* The reason belongs to a cancellation. On a restoration or a
                reschedule the stored reason describes something that no longer
                applies, and on an assignment there is none. */}
            {/* R83.2 — a cancellation may carry NO reason, and that is a
                complete answer rather than a gap: the line is simply absent. */}
            {(item.type === 'session_cancelled' || item.type === 'event_cancelled') &&
            item.reason ? (
              <p className="notifications__reason">
                {t('notifications.reason').replace('{reason}', item.reason)}
              </p>
            ) : null}
            {item.read_at === null ? (
              <Button
                variant="secondary"
                className="row-action"
                disabled={busy === item.id}
                onClick={() => void read(item.id)}
              >
                {t('notifications.markRead')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
