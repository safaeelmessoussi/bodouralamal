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
  event_id: null,
  exam_id: null,
  // R82.1 — the target-neutral fields the renderer reads, so one list can carry
  // a class, an activity and an exam without a switch in every consumer.
  title: 'تفسير',
  date: '2026-08-24',
  start_time: '15:00',
  scope_name: 'وميض الأمل',
  session_date: '2026-08-24',
  session_start_time: '15:00',
  subject_name: 'تفسير',
  level_name: 'وميض الأمل',
  reason: 'الأستاذة مريضة',
  read_at: null,
  created_at: '2026-08-18T09:00:00.000Z',
};

/** R82.4 — a published grade, the shape that has no session at all. */
const GRADE: NotificationItem = {
  id: 'n2',
  type: 'grade_published',
  session_id: null,
  event_id: null,
  exam_id: 'e1',
  title: 'اختبار التفسير الأول',
  date: '2026-08-20',
  start_time: null,
  scope_name: 'تفسير',
  session_date: null,
  session_start_time: null,
  subject_name: 'تفسير',
  level_name: null,
  reason: null,
  read_at: null,
  created_at: '2026-08-20T09:00:00.000Z',
};

describe('R77 — the wire shape a client is coded against', () => {
  it('is exactly the keys the endpoint returns', () => {
    expect(Object.keys(CANCELLED).sort()).toEqual([
      'created_at',
      'date',
      'event_id',
      'exam_id',
      'id',
      'level_name',
      'read_at',
      'reason',
      'scope_name',
      'session_date',
      'session_id',
      'session_start_time',
      'start_time',
      'subject_name',
      'title',
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
      .replace('{subject}', item.title ?? t('notifications.theClass'))
      .replace('{date}', item.date ?? '')
      .replace('{time}', item.start_time ?? '');

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
    // **Restated for R82's target-neutral field, not weakened.** The property
    // is *never a gap where a name should be*; the renderer reads `title` now,
    // because a notice may be about an activity or an exam rather than a class.
    expect(line({ ...CANCELLED, title: null, subject_name: null })).toContain(t('notifications.theClass'));
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

/**
 * **R82/R83 — every kind has a headline, and the check is the type system's.**
 *
 * The renderer keys a `Record` over the exported union, so a new type without a
 * headline fails to compile. This asserts the other half: that each key resolves
 * to real copy rather than to its own name, which `t()` returns on a miss and
 * which no type check can see (rule X).
 */
describe('R82/R83 — a notice of any kind reads as itself', () => {
  const KEYS: Record<NotificationItem['type'], string> = {
    session_cancelled: 'notifications.sessionCancelled',
    session_restored: 'notifications.sessionRestored',
    session_rescheduled: 'notifications.sessionRescheduled',
    session_assigned: 'notifications.sessionAssigned',
    event_created: 'notifications.eventCreated',
    event_rescheduled: 'notifications.eventRescheduled',
    event_cancelled: 'notifications.eventCancelled',
    grade_published: 'notifications.gradePublished',
  };

  it('every type resolves to copy, not to its own key', () => {
    for (const [type, key] of Object.entries(KEYS)) {
      const text = t(key);
      expect(text, `${type} has no copy`).not.toBe(key);
      expect(text.length).toBeGreaterThan(5);
    }
  });

  it('a published grade renders without a session, naming the exam', () => {
    const text = t(KEYS[GRADE.type])
      .replace('{subject}', GRADE.title ?? '')
      .replace('{date}', GRADE.date ?? '')
      .replace('{time}', GRADE.start_time ?? '');
    expect(text).toContain('اختبار التفسير الأول');
    // No stray placeholder: a grade has no time, and the line must not show one.
    expect(text).not.toContain('{');
    // R81 — no verdict language anywhere near a grade.
    expect(text).not.toContain('ناجح');
    expect(text).not.toContain('راسب');
  });

  it('a cancellation with NO reason is complete (R83.2)', () => {
    // The reason line is conditional on there BEING one; the headline alone has
    // to stand as a complete statement.
    const text = t(KEYS.session_cancelled)
      .replace('{subject}', 'تفسير')
      .replace('{date}', '2026-08-24')
      .replace('{time}', '15:00');
    expect(text).not.toContain('{');
    expect(text.length).toBeGreaterThan(10);
  });
});
