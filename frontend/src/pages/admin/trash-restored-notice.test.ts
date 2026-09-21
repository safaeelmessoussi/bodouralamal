import { describe, expect, it } from 'vitest';

import { ar } from '../../i18n/ar.js';
import { restoredNotice } from './trash.js';

/**
 * SRS Revision 169 §8 — «تمت الاستعادة» says what came back WITH the record. A
 * seat that could not return, or an occurrence whose date has passed, is said —
 * a plain success would hide exactly the thing she needs to go and check.
 */
const base = { target_entity: 'X', target_id: 'id' };

describe('what a restore reports', () => {
  it('a record that takes nothing with it is a plain success', () => {
    expect(restoredNotice(base)).toBe(ar.admin.trash.restored);
  });

  it('a circle says how many seats returned — and how many could not', () => {
    const all = restoredNotice({ ...base, seats_restored: 3, seats_not_restored: 0 });
    expect(all).toContain(ar.admin.trash.seatsRestored.replace('{n}', '3'));
    expect(all).not.toContain('لم تعد');
    const some = restoredNotice({ ...base, seats_restored: 1, seats_not_restored: 2 });
    expect(some).toContain(ar.admin.trash.seatsNotRestored.replace('{n}', '2'));
  });

  it('a class schedule says which occurrences came back and which had already passed', () => {
    const text = restoredNotice({ ...base, sessions_restored: 4, sessions_not_restored: 1 });
    expect(text).toContain(ar.admin.trash.sessionsRestored.replace('{n}', '4'));
    expect(text).toContain(ar.admin.trash.sessionsNotRestored.replace('{n}', '1'));
  });

  it('a Level says its activities were re-addressed — or that an old tombstone never recorded them', () => {
    expect(restoredNotice({ ...base, event_links_restored: 2, event_links_unknown: false })).toContain(
      ar.admin.trash.eventLinksRestored.replace('{n}', '2'),
    );
    expect(restoredNotice({ ...base, event_links_restored: 0, event_links_unknown: true })).toContain(
      ar.admin.trash.eventLinksUnknown,
    );
    // Nothing to re-address is not worth a sentence.
    expect(restoredNotice({ ...base, event_links_restored: 0, event_links_unknown: false })).toBe(
      ar.admin.trash.restored,
    );
  });
});
