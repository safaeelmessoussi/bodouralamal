import { describe, expect, it } from 'vitest';

import type { ScheduleSession } from '../../adapters/sessions.js';
import { ar } from '../../i18n/ar.js';

/**
 * The §4.4 (Revision 50) scope question — the client half of the contract, and
 * the vocabulary the dialog is required to state.
 */
const WIRE: ScheduleSession = {
  id: '00000000-0000-4000-8000-000000000001',
  date: '2026-06-16',
  start_time: '15:00',
  end_time: '17:00',
  status: 'scheduled',
  overridden: false,
  room_id: null,
  // R97 — the occurrence's own delivery, snapshotted from its schedule.
  delivery_mode: 'in_person',
  online_media_mode: null,
  // R109 (§D) — the occurrence carries its own tier; the fixture states one so
  // the editor cannot be seen to hydrate from a default.
  visibility: 'public',
  version: 0,
  staff: [{ user_id: '00000000-0000-4000-8000-000000000002', position: 'teacher' }],
  protected_reasons: [],
};

describe('the adapter type matches the wire contract', () => {
  it('carries exactly the keys the endpoint publishes', () => {
    expect(Object.keys(WIRE).sort()).toEqual([
      'date',
      // R97 — the occurrence's OWN delivery, which after an override is not
      // its schedule's. The list renders it and the editor opens on it.
      'delivery_mode',
      'end_time',
      'id',
      'online_media_mode',
      'overridden',
      'protected_reasons',
      'room_id',
      'staff',
      'start_time',
      'status',
      'version',
      // R109 (§D) — this occurrence's OWN tier, on exactly the footing
      // `delivery_mode` above has: snapshotted at materialization and decidable
      // for one date. Pinned so it cannot join the contract by accident.
      'visibility',

    ]);
  });

  it('carries no schedule_id — the screen already knows which schedule it is', () => {
    // It came from `/admin/course-schedules/{id}/sessions`, so the id is in the
    // URL. `GET /calendar` deliberately omits it on the public surface, which is
    // exactly why that endpoint could not serve this screen.
    expect(WIRE).not.toHaveProperty('schedule_id');
  });

  it('treats an EMPTY protected_reasons as a meaningful answer', () => {
    // Not "unknown": it says a wider scope MAY rewrite this occurrence, which is
    // what makes the scope dialog's claim about what will change truthful.
    expect(WIRE.protected_reasons).toEqual([]);
  });

  it('keeps times as wall-clock strings, never parsed', () => {
    // TD-11: parsing these would move the class for a reader in another
    // timezone. They are rendered exactly as sent.
    expect(WIRE.start_time).toBe('15:00');
    expect(typeof WIRE.start_time).toBe('string');
  });
});

describe('the three scopes are all stated, and each says what it changes', () => {
  it('names every scope', () => {
    // §4.4 makes the question mandatory, so a missing label would silently
    // reduce a three-way decision to a two-way one.
    for (const scope of ['this_session', 'this_and_future', 'all_sessions'] as const) {
      expect(ar.admin.sessions.scope[scope]).toBeTruthy();
      expect(ar.admin.sessions.scopeHint[scope]).toBeTruthy();
    }
  });

  it('states what will change BEFORE confirming, for each scope', () => {
    // The clause's actual requirement: "states which occurrences are about to
    // change before the administrator confirms".
    for (const scope of ['this_session', 'this_and_future', 'all_sessions'] as const) {
      expect(ar.admin.sessions.willChange[scope]).toBeTruthy();
    }
  });

  it('says the date can only move under "this session only"', () => {
    // The wider scopes edit the recurrence RULE, and a rule has times but no
    // single date — a reader who expected to move the day needs to be told.
    expect(ar.admin.sessions.dateOnlyThisSession).toBeTruthy();
  });

  it('has a label for every protection code the server can return', () => {
    // The codes are part of the contract (R43.6) — an unlabelled one would
    // surface as a raw enum in the "why was this spared" column.
    for (const code of ['OVERRIDDEN', 'LIFECYCLE', 'HAS_CONTENT', 'HAS_ATTENDANCE'] as const) {
      expect(ar.admin.sessions.protection[code]).toBeTruthy();
    }
  });

  it('names the two refusals TD-1 produces', () => {
    expect(ar.admin.sessions.pastRestore).toBeTruthy();
    expect(ar.admin.sessions.alreadyHeld).toBeTruthy();
  });
});
