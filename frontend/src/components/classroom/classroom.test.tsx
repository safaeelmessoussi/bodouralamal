import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MediaDeviceFailure } from 'livekit-client';

import { EventDetailsDialog } from '../calendar/event-details-dialog.js';
import { SessionContext } from '../../contexts/session.js';
import { deviceMessage } from './online-classroom.js';
import { refusalMessage } from '../../pages/classroom.js';
import { ApiError } from '../../lib/api.js';
import { resolveRoute } from '../../lib/route.js';
import { ar } from '../../i18n/ar.js';
import CLASSROOM from './online-classroom.tsx?raw';
import CLASSROOM_PAGE from '../../pages/classroom.tsx?raw';
import DIALOG from '../calendar/event-details-dialog.tsx?raw';
import ADAPTER from '../../adapters/online-class.ts?raw';
import MAIN from '../../main.tsx?raw';
import recordingSource from './recording.tsx?raw';
import { recordingProblem, statusLabel } from './recording.js';
import type { Occurrence } from '../../adapters/calendar.js';

/**
 * **R98 on the client — «دخول الحصة» and the room behind it.**
 *
 * What is actually guarded here, and why each is a *client* property rather
 * than a server one:
 *
 * 1. **The door appears exactly where it can lead somewhere.** An in-person
 *    class, an Event, an Exam and an anonymous reader each get no button —
 *    R97 shipped with none deliberately, and a control that cannot work is
 *    worse than none.
 * 2. **There is ONE classroom** (rule C). Three copies per portal is the
 *    recurring shape of this project's UI defects, and the cheapest place to
 *    catch a second one is before it is written.
 * 3. **Nothing here decides authorization** (rule O) and **no vendor is named**
 *    in anything a reader sees (rule M).
 * 4. **Every refusal is a sentence.** `t()` returns its own argument on a miss
 *    (rule X), so a mapping to a key that does not exist ships as the key —
 *    every message below is resolved against the real catalogue.
 */

/** Comments are prose; these assertions are about code. */
const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const occurrence = (over: Partial<Occurrence> = {}): Occurrence =>
  ({
    kind: 'session',
    id: 'session-1',
    title: 'تفسير',
    date: '2026-06-09',
    start_time: '15:00',
    end_time: '17:00',
    branch_id: null,
    branch_name: null,
    room_name: null,
    level_name: null,
    category_name: null,
    description: null,
    hijri_date: null,
    recurrence: 'weekly',
    visibility: null,
    instructors: [],
    delivery_mode: 'online',
    online_media_mode: 'audio_video',
    ...over,
  }) as Occurrence;

/** The dialog, rendered as a given reader sees it. `null` is anonymous. */
function dialogFor(o: Occurrence, accessToken: string | null): string {
  return renderToStaticMarkup(
    <SessionContext.Provider
      value={
        accessToken === null
          ? null
          : ({ accessToken } as unknown as React.ContextType<typeof SessionContext>)
      }
    >
      <EventDetailsDialog occurrence={o} branchNames={new Map()} onClose={() => {}} />
    </SessionContext.Provider>,
  );
}

describe('«دخول الحصة» is offered exactly where it can lead somewhere (R98.19)', () => {
  it('appears for a signed-in reader on an online class', () => {
    const html = dialogFor(occurrence(), 'token');
    expect(html).toContain(ar.classroom.join);
    expect(html).toContain('/classroom/session-1');
  });

  it('is ABSENT for an in-person class', () => {
    const html = dialogFor(
      occurrence({ delivery_mode: 'in_person', online_media_mode: null }),
      'token',
    );
    expect(html).not.toContain(ar.classroom.join);
    // …while the delivery itself is still stated, which is a different fact.
    expect(html).toContain(ar.delivery.in_person);
  });

  it('is ABSENT for an Event and an Exam, which have no delivery model at all', () => {
    for (const kind of ['event', 'exam'] as const) {
      const html = dialogFor(
        occurrence({ kind, delivery_mode: null, online_media_mode: null } as Partial<Occurrence>),
        'token',
      );
      expect(html).not.toContain(ar.classroom.join);
    }
  });

  it('is ABSENT for an anonymous reader on the PUBLIC calendar (R98.16)', () => {
    const html = dialogFor(occurrence(), null);
    expect(html).not.toContain(ar.classroom.join);
    // The public calendar still says «عن بُعد» — that is a fact about the
    // class, and withholding it would be hiding something harmless.
    expect(html).toContain(ar.delivery.online);
  });

  it('leaks no room identity or credential into the public dialog', () => {
    const html = dialogFor(occurrence(), null);
    expect(html).not.toContain('bodour-');
    expect(html.toLowerCase()).not.toContain('token');
    expect(html.toLowerCase()).not.toContain('wss://');
  });
});

describe('there is ONE classroom, for every portal (R98.20, rule C)', () => {
  it('only one component renders a room', () => {
    const rooms = import.meta.glob('../../**/*.tsx', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>;
    const mounting = Object.entries(rooms).filter(([, source]) =>
      /<LiveKitRoom\b/.test(code(source)),
    );
    expect(mounting.map(([path]) => path)).toEqual(['./online-classroom.tsx']);
  });

  it('is reached by ONE route, owned by no portal', () => {
    expect(resolveRoute('/classroom/abc-123')).toBe('classroom');
    expect(resolveRoute('/classroom/abc-123/')).toBe('classroom');
    // Not a portal sub-path — a مؤطِّرة, a مستفيدة and an administrator all
    // arrive at the same URL.
    expect(resolveRoute('/teacher/classroom/abc')).not.toBe('classroom');
    expect(resolveRoute('/dashboard/student/classroom/abc')).not.toBe('classroom');
    // Still never nothing (§14.4).
    expect(resolveRoute('/classroom')).toBe('not-found');
  });

  it('is mounted once, behind the Pending guard like every authenticated screen', () => {
    const main = code(MAIN);
    expect((main.match(/<ClassroomPage\s*\/>/g) ?? []).length).toBe(1);
    expect(main).toMatch(/case 'classroom':[\s\S]*?<PendingGuard>[\s\S]*?<ClassroomPage/);
  });
});

describe('the client decides nothing about authorization (rule O, R98.4)', () => {
  it('sends the Session and an empty body — no identity, role or room', () => {
    const adapter = code(ADAPTER);
    expect(adapter).toContain('online-join');
    // The REQUEST, not the response type: `role` and `media_mode` are things
    // the server tells the client, and asserting over the whole file would
    // have confused *what we send* with *what we are told*.
    const request = adapter.slice(adapter.indexOf('export async function requestJoin'));
    expect(request).toContain('body: {}');
    for (const forbidden of ['identity', 'role', 'room', 'student_id', 'can_publish']) {
      expect(request).not.toContain(forbidden);
    }
  });

  it('carries the active child in the header, never in a body (§4.3)', () => {
    expect(code(ADAPTER)).toContain('activeChildId');
    expect(code(ADAPTER)).not.toMatch(/body:\s*\{\s*[^}]*child/i);
  });

  it('never persists a credential', () => {
    const page = code(CLASSROOM_PAGE);
    expect(page).not.toContain('localStorage');
    expect(page).not.toContain('sessionStorage');
  });
});

describe('the classroom adapts to the credential, and names no vendor (R98.13)', () => {
  it('requests no camera at all for an audio-only class (R98.14)', () => {
    // Not a CSS decision: `video={!audioOnly}` is what keeps `getUserMedia`
    // from asking for a camera in a class that has none.
    expect(code(CLASSROOM)).toContain('video={!audioOnly}');
  });

  it('renders a listening surface for audio-only, not an empty video grid', () => {
    const source = code(CLASSROOM);
    expect(source).toContain('audioOnly ? <AudioStage /> : <VideoStage />');
    // The camera control is ABSENT rather than disabled in an audio class.
    expect(source).toMatch(/audioOnly \? null : \(\s*<Button/);
  });

  /**
   * **RESTATED for R99, not deleted.**
   *
   * R98.18 read *«mounts no recording affordance»*, which was that revision's
   * true and deliberate position: recording did not exist, and a control that
   * could start an unconsented one must not ship before the gate that governs
   * it. R99 authorised recording, so the sentence stopped being the property.
   *
   * **The property was never "no recording UI".** It is that recording is
   * **the platform's**, driven by its own control and its own server-side
   * capture — never a capability handed to a browser. So: the classroom
   * composes بذور الأمل's own panel, mounts **no vendor recording component**,
   * and the participant token still carries **no `roomRecord` grant** (asserted
   * server-side, where the token is minted).
   */
  it('recording is the platform’s own, never a vendor affordance or a client grant', () => {
    const source = code(CLASSROOM);
    // The platform's panel, composed — one concept, one component (rule C).
    expect(source).toContain('<RecordingPanel');
    // No vendor recording component anywhere in the classroom.
    for (const vendorAffordance of [
      'StartRecording',
      'RecordingIndicator',
      'useIsRecording',
      'egress',
      'Egress',
    ]) {
      expect(source).not.toContain(vendorAffordance);
    }
    // And the capability is never granted to the client: capture is
    // server-side, so a browser that stops talking cannot stop the recording.
    expect(source).not.toContain('roomRecord');
  });

  it('names no media platform in any string a reader sees', () => {
    const catalogue = JSON.stringify(ar);
    expect(catalogue.toLowerCase()).not.toContain('livekit');
    // …and the classroom's own visible text comes from that catalogue, so a
    // hand-written Arabic string here would be invisible to the check above.
    const visible = code(CLASSROOM).match(/>[^<>{}]*[؀-ۿ][^<>{}]*</g) ?? [];
    expect(visible).toEqual([]);
  });

  it('uses the shared Button and the shared Feedback, never hand-written markup', () => {
    const source = code(CLASSROOM);
    expect(source).toContain('<Button');
    expect(source).toContain('<Feedback');
    expect(source).not.toContain('className="button');
  });
});

describe('every failure is a sentence in Arabic (R98.15, rule X)', () => {
  const envelope = (
    status: number,
    code: string,
    details: Record<string, unknown> = {},
  ): ApiError =>
    new ApiError(status, {
      code,
      message_key: 'errors.x',
      message: 'operator text that must never be rendered',
      details,
      request_id: 'r',
    });

  it('maps every reason the server can answer', () => {
    expect(refusalMessage(envelope(409, 'STATE_CONFLICT', { reason: 'NOT_ONLINE' }))).toBe(
      ar.classroom.notOnline,
    );
    expect(refusalMessage(envelope(409, 'STATE_CONFLICT', { reason: 'CANCELLED' }))).toBe(
      ar.classroom.cancelled,
    );
    expect(
      refusalMessage(envelope(409, 'STATE_CONFLICT', { reason: 'BEFORE_WINDOW' })),
    ).toBe(ar.classroom.beforeWindow);
    expect(refusalMessage(envelope(409, 'STATE_CONFLICT', { reason: 'AFTER_WINDOW' }))).toBe(
      ar.classroom.afterWindow,
    );
    expect(refusalMessage(envelope(404, 'NOT_FOUND'))).toBe(ar.classroom.notAllowed);
    expect(refusalMessage(envelope(503, 'SERVICE_UNAVAILABLE'))).toBe(
      ar.classroom.unavailable,
    );
    expect(refusalMessage(envelope(401, 'AUTH_REQUIRED'))).toBe(ar.classroom.expired);
  });

  it('never renders the operator-facing message, and never a bare code', () => {
    const message = refusalMessage(envelope(409, 'STATE_CONFLICT', { reason: 'MYSTERY' }));
    expect(message).toBe(ar.classroom.failed);
    expect(message).not.toContain('operator text');
    expect(message).not.toContain('STATE_CONFLICT');
  });

  it('says something readable even when the failure is not an API error at all', () => {
    expect(refusalMessage(new TypeError('Failed to fetch'))).toBe(ar.classroom.failed);
  });
});

describe('device failures are stated in the reader’s words (R98.15)', () => {
  it('distinguishes denied from absent, and microphone from camera', () => {
    expect(deviceMessage(MediaDeviceFailure.PermissionDenied, 'audioinput')).toBe(
      ar.classroom.micDenied,
    );
    expect(deviceMessage(MediaDeviceFailure.PermissionDenied, 'videoinput')).toBe(
      ar.classroom.cameraDenied,
    );
    expect(deviceMessage(MediaDeviceFailure.NotFound, 'audioinput')).toBe(
      ar.classroom.micUnavailable,
    );
    expect(deviceMessage(MediaDeviceFailure.DeviceInUse, 'videoinput')).toBe(
      ar.classroom.cameraUnavailable,
    );
  });

  it('a camera failure does not end the class — it offers to continue by voice', () => {
    // The sentence itself carries the promise, so this asserts the wording
    // rather than a control: a beneficiary with no working camera must not be
    // put out of a lesson.
    expect(ar.classroom.cameraDenied).toContain('بالصوت');
    expect(ar.classroom.cameraUnavailable).toContain('بالصوت');
  });

  it('never renders a raw browser or SDK exception', () => {
    const unknown = deviceMessage(undefined, undefined);
    expect(unknown).toBe(ar.classroom.micUnavailable);
    expect(unknown).not.toContain('Error');
  });
});

describe('the dialog is the SHARED one, not a per-portal copy', () => {
  it('the join action lives in the one occurrence dialog every calendar opens', () => {
    expect(code(DIALOG)).toContain('function JoinAction');
    const dialogs = import.meta.glob('../../**/*.tsx', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>;
    const withJoin = Object.entries(dialogs).filter(([, source]) =>
      code(source).includes(ar.classroom.join) || code(source).includes("classroom.join"),
    );
    expect(withJoin.map(([path]) => path)).toEqual([
      '../calendar/event-details-dialog.tsx',
    ]);
  });
});

/* ── R99: recording ───────────────────────────────────────────────────────── */

describe('recording is optional, explicit, and visible to everyone (R99)', () => {
  const RECORDING = recordingSource;

  it('the client never starts a recording as a side effect of joining', () => {
    // R99.2's non-negotiable: `دخول الحصة` must not imply recording. The
    // classroom mounts the panel; nothing in the join path calls start.
    const page = code(CLASSROOM_PAGE);
    const room = code(CLASSROOM);
    expect(page).not.toContain('startRecording');
    expect(room).not.toContain('startRecording(');
    // …and the adapter's start is reached only from the panel's own control.
    expect(code(RECORDING)).toContain('startRecording(sessionId, accessToken)');
  });

  it('«جاري التسجيل» comes from the ROOM, not from whoever pressed the button', () => {
    // A banner driven by the starter's own click is invisible to everybody
    // else; one driven by polling is late. `useIsRecording` is the room's own
    // state and reaches latecomers on arrival (R99.5).
    expect(code(RECORDING)).toContain('useIsRecording()');
    expect(code(RECORDING)).toMatch(/live \?[\s\S]*classroom\.recordingLive/);
  });

  it('offers the controls to teaching staff and to nobody else', () => {
    expect(code(RECORDING)).toContain(
      "const MAY_RECORD: JoinCredentials['role'][] = ['teacher', 'assistant', 'admin']",
    );
    // The role comes from the credential the SERVER issued (rule O).
    expect(code(RECORDING)).toContain('mayRecord ?');
  });

  /**
   * **Restated for C2, not deleted.** In C1 the guard was *«متاح» appears
   * nowhere*, because there was no ingestion and therefore nothing that could
   * ever be available. C2 builds the ingestion, so the property becomes the one
   * R99.14 actually states: **«متاح» is said only when the asset exists**, and
   * the provider having finished is not that.
   *
   * Absence was the right assertion while the state was unreachable; keeping it
   * would now mean deleting the feature to satisfy the test.
   */
  it('says «متاح» ONLY for the derived available state (R99.14)', () => {
    // The provider is finished. The library item does not exist. Not available.
    expect(
      statusLabel({ status: 'completed', availability: 'importing' } as never),
    ).not.toContain('متاح');
    expect(
      statusLabel({ status: 'completed', availability: 'importing' } as never),
    ).toContain('تهيئته');

    // Only this one, and the server sets it only from `educational_content_id`.
    expect(
      statusLabel({ status: 'completed', availability: 'available' } as never),
    ).toContain('متاح');
  });

  it('distinguishes a failed CAPTURE from a failed IMPORT — different remedies', () => {
    // One means there is no artefact; the other means there is one and the
    // platform could not accept it yet, and only the second is retried.
    const capture = statusLabel({ status: 'failed', availability: 'failed' } as never);
    const importing = statusLabel({
      status: 'completed',
      availability: 'import_failed',
    } as never);
    expect(capture).not.toBe(importing);
    expect(importing).toContain('تهيئته');
  });

  it('states every availability in Arabic, and never a raw enum', () => {
    const seen = (
      [
        ['capturing', 'starting'],
        ['capturing', 'recording'],
        ['capturing', 'stopping'],
        ['processing', 'processing'],
        ['importing', 'completed'],
        ['available', 'completed'],
        ['import_failed', 'completed'],
        ['failed', 'failed'],
      ] as const
    ).map(([availability, status]) => statusLabel({ availability, status } as never));
    for (const label of seen) {
      expect(label).not.toMatch(/^[a-z_]+$/);
      expect(label.length).toBeGreaterThan(3);
    }
    // Each state says something different — a label table that collapsed two
    // states would pass the "not an enum" check while hiding the distinction.
    expect(new Set(seen).size).toBeGreaterThanOrEqual(6);
  });

  it('maps a refusal to her words, never the operator message', () => {
    const forbidden = new ApiError(403, {
      code: 'FORBIDDEN',
      message_key: 'errors.forbidden',
      message: 'only teaching staff may record a class',
      details: { reason: 'RECORDING_NOT_PERMITTED' },
      request_id: 'r',
    });
    expect(recordingProblem(forbidden)).toBe(ar.classroom.recordingNotPermitted);
    expect(recordingProblem(forbidden)).not.toContain('teaching staff');
  });

  it('says recording is a CHOICE where the choice is made', () => {
    expect(ar.classroom.recordingHint).toContain('اختياري');
  });
});
