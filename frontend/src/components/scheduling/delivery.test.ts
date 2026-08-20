import { describe, expect, it } from 'vitest';

import { deliveryLabel, mediaLabel, venueLabel } from './delivery.js';
import DELIVERY from './delivery.tsx?raw';
import CLASS_SECTION from './class-section.tsx?raw';
import SESSIONS_PAGE from '../../pages/admin/schedule-sessions.tsx?raw';
import SCHEDULING_PAGE from '../../pages/admin/scheduling.tsx?raw';
import DIALOG from '../calendar/event-details-dialog.tsx?raw';
import { ar } from '../../i18n/ar.js';

/** Comments are prose, and these assertions are about code (the parity guard's
 *  own lesson: a docstring explaining why something is wrong reads as the wrong
 *  thing being present). */
const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * **R97 — طريقة الحضور on the client.**
 *
 * The property under guard is *one concept, one implementation* (rule C). The
 * platform has shipped the opposite twice: a shared component nobody opened
 * (rule AT) and a shared rule each caller had to opt into (rule AE). So both
 * directions are asserted — the shared section exists, **and** no screen writes
 * the words or the controls itself.
 */
describe('the labels read the wire honestly', () => {
  it('names the two modes in Arabic', () => {
    expect(deliveryLabel({ delivery_mode: 'in_person', online_media_mode: null })).toBe('حضوري');
    expect(
      deliveryLabel({ delivery_mode: 'online', online_media_mode: 'audio_video' }),
    ).toBe('عن بُعد');
  });

  it('returns null for a kind with NO delivery model — an Event, an Exam', () => {
    // The failure this prevents: an Event rendering «حضوري», which states a
    // fact the row does not hold. Same discipline as every other kind-specific
    // field on the occurrence projection.
    expect(deliveryLabel({ delivery_mode: null, online_media_mode: null })).toBe(null);
  });

  it('gives a media label only for an online occurrence', () => {
    expect(mediaLabel({ delivery_mode: 'online', online_media_mode: 'audio_only' })).toBe(
      'صوت فقط',
    );
    // A media mode on an in-person row cannot be stored (R97.1), so rendering
    // one would be showing a value the server refuses to hold.
    expect(mediaLabel({ delivery_mode: 'in_person', online_media_mode: 'audio_only' })).toBe(
      null,
    );
    expect(mediaLabel({ delivery_mode: 'online', online_media_mode: null })).toBe(null);
  });

  it('answers *where does this happen* — room, or عن بُعد', () => {
    expect(
      venueLabel({ delivery_mode: 'in_person', online_media_mode: null, room_name: 'قاعة 5' }),
    ).toBe('قاعة 5');
    expect(
      venueLabel({ delivery_mode: 'online', online_media_mode: 'audio_video', room_name: null }),
    ).toBe('عن بُعد');
    expect(
      venueLabel(
        { delivery_mode: 'online', online_media_mode: 'audio_only', room_name: null },
        { withMedia: true },
      ),
    ).toBe('عن بُعد · صوت فقط');
  });

  it('never invents a venue for an in-person class that has no room', () => {
    // §4.4c allows a class with no room; `null` says *not recorded* and an
    // em dash would be the caller's decision, not this function's.
    expect(
      venueLabel({ delivery_mode: 'in_person', online_media_mode: null, room_name: null }),
    ).toBe(null);
  });
});

describe('every word comes from ONE catalogue', () => {
  it('publishes the six user-facing strings', () => {
    const d = ar.delivery as Record<string, string>;
    expect(d['label']).toBe('طريقة الحضور');
    expect(d['in_person']).toBe('حضوري');
    expect(d['online']).toBe('عن بُعد');
    expect(d['mediaLabel']).toBe('نوع الاتصال');
    expect(d['audio_video']).toBe('صوت وصورة');
    expect(d['audio_only']).toBe('صوت فقط');
  });

  it('and no screen hand-writes them', () => {
    // The drift this catches is the one this project has had six times: a
    // second copy that renders correctly today and diverges on the next edit.
    for (const [name, source] of [
      ['class-section', CLASS_SECTION],
      ['schedule-sessions', SESSIONS_PAGE],
      ['scheduling', SCHEDULING_PAGE],
      ['event-details-dialog', DIALOG],
    ] as const) {
      expect(`${name}: ${code(source)}`).not.toContain('عن بُعد');
      expect(`${name}: ${code(source)}`).not.toContain('صوت وصورة');
    }
  });
});

describe('one section, composed — never a second implementation (rule C)', () => {
  it('the class form composes DeliverySection', () => {
    expect(code(CLASS_SECTION)).toContain('<DeliverySection');
  });

  it('the occurrence editor composes THE SAME one', () => {
    // The alternative — a dialog-local copy — is how one screen ends up
    // missing «صوت فقط» while the other has it.
    expect(code(SESSIONS_PAGE)).toContain('<DeliverySection');
  });

  it('and nobody built a parallel control', () => {
    for (const source of [CLASS_SECTION, SESSIONS_PAGE, SCHEDULING_PAGE]) {
      expect(code(source)).not.toContain('DeliveryPicker');
      expect(code(source)).not.toContain('OnlineModeSelect');
    }
  });

  it('the room selector lives INSIDE the delivery section, not beside it', () => {
    // A room is meaningful only for an in-person class, so a room control the
    // section does not own is a control that survives switching to عن بُعد.
    expect(code(DELIVERY)).toContain("t('admin.schedules.room')");
    expect(code(CLASS_SECTION)).not.toContain("t('admin.schedules.room')");
  });
});

describe('what is hidden is CLEARED, not merely unsubmitted (§13)', () => {
  it('the class form sends no room when online', () => {
    expect(code(SCHEDULING_PAGE)).toContain("roomId: delivery === 'online' ? null : roomId || null");
  });

  it('the class form sends no media mode when in person', () => {
    expect(code(SCHEDULING_PAGE)).toContain(
      "onlineMediaMode: delivery === 'online' ? mediaMode : null",
    );
  });

  it('the occurrence editor does the same', () => {
    expect(code(SESSIONS_PAGE)).toContain("room_id: delivery === 'online' ? null : roomId || null");
    expect(code(SESSIONS_PAGE)).toContain(
      "online_media_mode: delivery === 'online' ? mediaMode : null",
    );
  });

  it('irrelevant controls are HIDDEN rather than disabled', () => {
    // A greyed-out room selector on an online class looks like a control that
    // could matter; the absent one says what is true.
    expect(code(DELIVERY)).toContain("mode === 'online' ? (");
  });
});

describe('the occurrence editor opens on the OCCURRENCE, not on its schedule', () => {
  it('seeds delivery from the session row', () => {
    // After an override the two differ, and seeding from the schedule would let
    // an unrelated re-save silently undo the override.
    expect(code(SESSIONS_PAGE)).toContain("session.delivery_mode === 'online'");
    expect(code(SESSIONS_PAGE)).toContain("session.online_media_mode === 'audio_only'");
  });

  it('joins the dirty check so unsaved work is not lost (rule U)', () => {
    expect(code(SCHEDULING_PAGE)).toContain('delivery,');
    expect(code(SCHEDULING_PAGE)).toContain('mediaMode,');
  });
});

describe('the details dialog shows delivery and offers no dead Join button', () => {
  it('renders طريقة الحضور through the shared label', () => {
    expect(code(DIALOG)).toContain('deliveryLabel(occurrence)');
    expect(code(DIALOG)).toContain("t('delivery.label')");
  });

  it('renders نوع الاتصال for an online occurrence', () => {
    expect(code(DIALOG)).toContain('mediaLabel(occurrence)');
  });

  it('has NO «دخول الحصة» — the infrastructure for it does not exist yet', () => {
    // §19: a control that cannot work is worse than none. Section B builds the
    // rooms and tokens; until then the dialog must not pretend.
    expect(code(DIALOG)).not.toContain('دخول الحصة');
    expect(code(DIALOG)).not.toContain('joinSession');
    expect(code(DIALOG)).not.toContain('livekit');
  });
});

describe('Section A is provider-independent (R97.9)', () => {
  it('names no media vendor anywhere on the delivery surface', () => {
    for (const source of [DELIVERY, CLASS_SECTION, SESSIONS_PAGE, DIALOG]) {
      const lower = source.toLowerCase();
      for (const vendor of ['livekit', 'daily.co', 'agora', 'jitsi', 'zoom']) {
        expect(lower).not.toContain(vendor);
      }
    }
  });
});
