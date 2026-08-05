import { describe, expect, it } from 'vitest';

import type { Occurrence } from '../../adapters/calendar.js';
import { ADMIN_MODULES } from '../../lib/admin-modules.js';
import { collapseEvents } from './calendar.js';
import { IMPLEMENTED_ADMIN_PATHS } from './index.js';

/**
 * `/admin/calendar` — the dedupe that let this screen need no new endpoint.
 *
 * `GET /calendar` expands a recurrence into one occurrence per date, each
 * carrying the event's own id. Grouping by that id recovers exactly the rows an
 * administrator created, which is why no `GET /events` was invented (§20 r16).
 */
const occurrence = (over: Partial<Occurrence>): Occurrence =>
  ({
    kind: 'event',
    id: 'e1',
    title: 'عطلة',
    date: '2026-09-01',
    start_time: null,
    end_time: null,
    visibility: 'public',
    branch_id: null,
    description: null,
    recurrence: 'weekly',
    branch_name: null,
    room_name: null,
    category_id: null,
    category_name: null,
    level_id: null,
    level_name: null,
    instructor_names: [],
    hijri_date: null,
    subject_id: null,
    subject_name: null,
    teaching_mode: null,
    audience_label: null,
    status: null,
    // The override goes LAST, or the helper silently ignores its own argument —
    // which is exactly what the first version did, and three tests caught it.
    ...over,
  }) as unknown as Occurrence;

describe('collapsing occurrences back into the events that produced them', () => {
  it('lists a recurring event ONCE, however many dates it falls on', () => {
    // The calendar shows *when it happens*; this screen shows *what was
    // created*. Listing eight rows for one holiday would be the calendar's
    // answer to a different question.
    const rows = collapseEvents([
      occurrence({ date: '2026-09-01' }),
      occurrence({ date: '2026-09-08' }),
      occurrence({ date: '2026-09-15' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurrences).toBe(3);
  });

  it('reports the FIRST date in the window, not whichever arrived first', () => {
    // Occurrences come back in date order today; the list must not depend on
    // that continuing to be true.
    const rows = collapseEvents([
      occurrence({ date: '2026-09-15' }),
      occurrence({ date: '2026-09-01' }),
    ]);
    expect(rows[0]!.first_date).toBe('2026-09-01');
  });

  it('ignores sessions entirely', () => {
    // A teaching occurrence is never an Event (§4.4). This screen manages the
    // non-teaching layer, and Course Schedules is a separate screen for a
    // separate model — conflating them is what §20 rule 22 forbids.
    const rows = collapseEvents([
      occurrence({ kind: 'session', id: 's1' } as Partial<Occurrence>),
      occurrence({ id: 'e2' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['e2']);
  });

  it('keeps events apart when they share a date', () => {
    const rows = collapseEvents([
      occurrence({ id: 'e1', title: 'عطلة' }),
      occurrence({ id: 'e2', title: 'حفل' }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('sorts by first occurrence, so the list reads as a timeline', () => {
    const rows = collapseEvents([
      occurrence({ id: 'later', date: '2026-10-01' }),
      occurrence({ id: 'earlier', date: '2026-09-01' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['earlier', 'later']);
  });
});

describe('the module is live', () => {
  it('/admin/calendar is ready and has a screen', () => {
    expect(ADMIN_MODULES.find((m) => m.path === '/admin/calendar')?.status).toBe('ready');
    expect(IMPLEMENTED_ADMIN_PATHS).toContain('/admin/calendar');
  });

  it('every `ready` module still has a screen', () => {
    const ready = ADMIN_MODULES.filter((m) => m.status === 'ready').map((m) => m.path);
    expect([...ready].sort()).toEqual([...IMPLEMENTED_ADMIN_PATHS].sort());
  });
});
