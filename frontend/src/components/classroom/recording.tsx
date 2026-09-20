import { useIsRecording } from '@livekit/components-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  readRecordingState,
  startRecording,
  stopRecording,
  type JoinCredentials,
  type RecordingState,
} from '../../adapters/online-class.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Button } from '../ui/button.js';
import { Feedback } from '../ui/feedback.js';

/**
 * **R99 — recording a class, which is optional and never automatic.**
 *
 * Two separate things live here, and keeping them separate is the whole design:
 *
 * | | who sees it | where the truth comes from |
 * |---|---|---|
 * | **«جاري التسجيل»** | **everyone in the room** | the **room itself** |
 * | **بدء / إيقاف التسجيل** | teaching staff only | the platform's authorization |
 *
 * ## The indicator is not polled, and that is why it is trustworthy
 *
 * `useIsRecording()` reads the state the media server attaches to the **room**,
 * so it is true for every participant the instant a recording starts and true
 * for **somebody who joins while it is already running** — which is exactly
 * R99.5's requirement and the half a naive implementation forgets. A banner
 * driven by the starter's own click would be invisible to everybody else; a
 * banner driven by polling would be late. Neither is acceptable for *«nobody is
 * recorded silently»*.
 *
 * ## The controls decide nothing
 *
 * They are shown from the **role on the credential the server issued**, and the
 * server refuses a beneficiary regardless of what any client renders (rule O).
 * Hiding them is courtesy; the refusal is the security.
 */

/** Who is offered the controls — mirrors the server's `MAY_RECORD` and is not
 *  the authority (the server is). A beneficiary and a guardian see none. */
const MAY_RECORD: JoinCredentials['role'][] = ['teacher', 'assistant', 'admin'];

export function RecordingPanel({
  sessionId,
  role,
  accessToken,
}: {
  sessionId: string;
  /** From the credential the SERVER issued — never chosen by the client. */
  role: JoinCredentials['role'];
  /**
   * **The platform's own access token, not the media token.** Recording is a
   * Bodour operation authorised by Bodour; the provider's participant token
   * authorises nothing here and must never be sent to this API.
   */
  accessToken: string;
}): ReactNode {
  /**
   * **The room's own answer, for every participant.** Not derived from
   * `state` below: a beneficiary never reads that endpoint's staff-facing
   * detail, and she must still see the banner.
   */
  const live = useIsRecording();
  const mayRecord = MAY_RECORD.includes(role);

  const [state, setState] = useState<RecordingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * **Follow the recording while it is BETWEEN states** (Owner-reported,
   * 2026-09-20 — SRS Revision 165 §1).
   *
   * `state` was set once, from the answer to «بدء» or «إيقاف» — which is
   * `starting` or `stopping` by construction — and never read again. So «جارٍ بدء
   * التسجيل…» stayed on screen beside «جاري التسجيل» for the rest of the class,
   * and «جارٍ إيقاف التسجيل…» long after the recording had ended: two sentences
   * contradicting each other, one of them frozen. The recorder takes several
   * seconds to join a room, and that wait is real — the sentence describing it
   * simply has to end when it does.
   *
   * It also runs once on entry, so a مؤطِّرة who reloads mid-class sees «إيقاف
   * التسجيل» rather than an invitation to start a second recording.
   *
   * Two triggers, because they are two facts: the ROOM announcing that recording
   * began or ended (`live`), and the clock, for the states the room says nothing
   * about (the provider finishing, the platform importing the file).
   */
  const settled =
    state === null ||
    (state.status !== 'starting' &&
      state.status !== 'stopping' &&
      state.availability !== 'processing' &&
      state.availability !== 'importing');
  useEffect(() => {
    if (!mayRecord) return;
    let alive = true;
    const read = (): void => {
      void readRecordingState(sessionId, accessToken, null)
        .then((found) => {
          if (alive && found !== null) setState(found);
        })
        .catch(() => {
          /* A missed poll is retried by the next one; the banner is the room's. */
        });
    };
    // The room changed its mind: ask at once rather than at the next tick.
    read();
    if (settled) return () => {
      alive = false;
    };
    const timer = setInterval(read, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, accessToken, mayRecord, live, settled]);

  const act = useCallback(
    async (run: () => Promise<RecordingState>) => {
      setBusy(true);
      setProblem(null);
      try {
        setState(await run());
      } catch (error) {
        setProblem(recordingProblem(error));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <div className="classroom__recording">
      {/**
       * **Persistent, and shown to everybody.** `role="status"` announces it
       * once when it appears rather than on every render, and the word carries
       * the meaning — the colour only reinforces it (rule AV).
       */}
      {live ? (
        <p className="classroom__recording-live" role="status">
          <span aria-hidden="true" className="classroom__recording-dot" />
          {t('classroom.recordingLive')}
        </p>
      ) : null}

      {mayRecord ? (
        <div className="classroom__recording-controls">
          {problem ? <Feedback tone="warn">{problem}</Feedback> : null}

          {/**
           * **One control, and which one depends on what is actually
           * happening** — never both, and never a «بدء» button while a
           * recording runs.
           */}
          {live || state?.live ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                void act(() => stopRecording(sessionId, accessToken));
              }}
            >
              {t('classroom.stopRecording')}
            </Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() => {
                void act(() => startRecording(sessionId, accessToken));
              }}
            >
              {t('classroom.startRecording')}
            </Button>
          )}

          {/**
           * **The status, in her words — and «متاح» is said only when it is
           * true** (R99.14). It is driven by `availability`, which the server
           * derives from the library item existing, and never by the provider's
           * `status`: the provider finishing means an object is in a staging
           * bucket, which is not availability.
           */}
          {state && !(live && statusLabel(state) === t('classroom.recordingLive')) ? (
            <p className="classroom__recording-state">{statusLabel(state)}</p>
          ) : null}

          {/* Said once, where the decision is made: recording is a choice. */}
          {!live && !state ? (
            <p className="classroom__recording-hint">{t('classroom.recordingHint')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * **The six states R99.14 requires the interface to distinguish, in Arabic.**
 *
 * Keyed on `availability` — the ASSOCIATION's answer — and not on `status`,
 * which is the provider's. The two genuinely differ and the difference is the
 * clause: `status = completed` means an object exists in a staging bucket, and
 * a مؤطِّرة told «متاح» on the strength of that would go looking for a library
 * item that is not there.
 *
 * `capturing` is deliberately narrowed by the live `status` underneath it, so a
 * مؤطِّرة sees «جارٍ بدء التسجيل…» rather than «جاري التسجيل» in the second
 * before the provider confirms. Unknown values fall back to a sentence rather
 * than rendering a raw enum, the same discipline every other label here has.
 */
export function statusLabel(state: RecordingState): string {
  switch (state.availability) {
    case 'capturing':
      if (state.status === 'starting') return t('classroom.recordingStarting');
      if (state.status === 'stopping') return t('classroom.recordingStopping');
      return t('classroom.recordingLive');
    case 'processing':
      return t('classroom.recordingProcessing');
    case 'importing':
      // The provider has finished; the library item does not exist yet.
      return t('classroom.recordingDone');
    case 'available':
      // Said only here, and only because `educational_content_id` is set.
      return t('classroom.recordingAvailable');
    case 'import_failed':
      // Distinguished from a failed CAPTURE: there IS an artefact, and the
      // remedy is different — this one is retried.
      return t('classroom.recordingImportFailed');
    case 'failed':
      return t('classroom.recordingFailed');
    default:
      return t('classroom.recordingFailed');
  }
}

/** A refusal in the reader's words — never the operator-facing message. */
export function recordingProblem(error: unknown): string {
  if (!(error instanceof ApiError)) return t('classroom.recordingFailed');
  if (error.details['reason'] === 'RECORDING_NOT_PERMITTED') {
    return t('classroom.recordingNotPermitted');
  }
  if (error.code === 'SERVICE_UNAVAILABLE') return t('classroom.recordingUnavailable');
  return t('classroom.recordingFailed');
}
