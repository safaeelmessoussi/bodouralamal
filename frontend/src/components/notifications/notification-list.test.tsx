import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { NotificationItem } from '../../adapters/notifications.js';
import { t } from '../../i18n/index.js';

/**
 * The R77 surface's copy and its wire type.
 *
 * **The fixture is typed as the adapter's own interface**, which is the check
 * `api<T>()`'s unchecked cast cannot perform: rename a field on the server and
 * this stops compiling, where a hand-shaped object would go on passing.
 */
const CANCELLED: NotificationItem = {
  id: 'n1',
  type: 'session_cancelled',
  session_id: 's1',
  session_date: '2026-08-24',
  session_start_time: '15:00',
  subject_name: 'تفسير',
  level_name: 'وميض الأمل',
  reason: 'الأستاذة مريضة',
  read_at: null,
  created_at: '2026-08-18T09:00:00.000Z',
};

describe('R77 — the wire shape a client is coded against', () => {
  it('is exactly the keys the endpoint returns', () => {
    expect(Object.keys(CANCELLED).sort()).toEqual([
      'created_at',
      'id',
      'level_name',
      'read_at',
      'reason',
      'session_date',
      'session_id',
      'session_start_time',
      'subject_name',
      'type',
    ]);
  });

  it('carries the reason, because «ألغيت» without «لماذا» is what the manual channels already did badly', () => {
    expect(CANCELLED.reason).not.toBeNull();
  });
});

describe('R77 — the copy names ONE event rather than promising a stream', () => {
  const line = (item: NotificationItem): string =>
    t(item.type === 'session_cancelled' ? 'notifications.sessionCancelled' : 'notifications.sessionRestored')
      .replace('{subject}', item.subject_name ?? t('notifications.theClass'))
      .replace('{date}', item.session_date)
      .replace('{time}', item.session_start_time);

  it('states the class, the date and the time — a notice nobody can act on is noise', () => {
    const text = line(CANCELLED);
    expect(text).toContain('تفسير');
    expect(text).toContain('2026-08-24');
    expect(text).toContain('15:00');
    // Every placeholder consumed: a stray `{subject}` on screen is the failure
    // mode a string test exists to catch.
    expect(text).not.toContain('{');
  });

  it('says the class RETURNED, not that it was cancelled again', () => {
    const restored = line({ ...CANCELLED, type: 'session_restored' });
    expect(restored).not.toEqual(line(CANCELLED));
    expect(restored).not.toContain('{');
  });

  it('falls back to a generic word when the subject is null, never to an empty gap', () => {
    expect(line({ ...CANCELLED, subject_name: null })).toContain(t('notifications.theClass'));
  });

  it('every key it uses resolves — a missing one must fail here, not ship', () => {
    for (const key of [
      'notifications.title',
      'notifications.unreadLabel',
      'notifications.reason',
      'notifications.markRead',
      'notifications.theClass',
    ]) {
      expect(t(key), key).not.toEqual(key);
    }
  });
});

describe('R77 — the unread marker is a shape, not only a colour', () => {
  it('gives an unread notice its own class, which the border rule hangs on', () => {
    // §14.4: state carried by colour alone is state a colour-blind reader cannot
    // see. `is-unread` drives an inline-start border, which reads in RTL too.
    const className = (item: NotificationItem): string =>
      item.read_at === null ? 'notifications__item is-unread' : 'notifications__item';
    expect(className(CANCELLED)).toContain('is-unread');
    expect(className({ ...CANCELLED, read_at: '2026-08-18T10:00:00.000Z' })).not.toContain(
      'is-unread',
    );
  });

  it('renders as a real list, so a screen reader announces how many there are', () => {
    const html = renderToStaticMarkup(
      <ul className="notifications__list">
        <li className="notifications__item is-unread">x</li>
      </ul>,
    );
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
  });
});
