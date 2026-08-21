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
   * Read once on entry, so a مؤطِّرة who reloads mid-class sees «إيقاف التسجيل»
   * rather than an invitation to start a second recording. The banner does not
   * depend on this succeeding.
   */
  useEffect(() => {
    if (!mayRecord) return;
    let alive = true;
    void readRecordingState(sessionId, accessToken, null)
      .then((found) => {
        if (alive) setState(found);
      })
      .catch(() => {
        /* The banner is the room's; a failed read must not hide it. */
      });
    return () => {
      alive = false;
    };
  }, [sessionId, accessToken, mayRecord]);

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
           * **The status, in her words — and «متاح» is deliberately not among
           * them** (R99.14). The platform does not tell a مؤطِّرة a recording is
           * available until the asset genuinely exists in Bodour storage, which
           * this section does not yet build.
           */}
          {state ? <p className="classroom__recording-state">{statusLabel(state)}</p> : null}

          {/* Said once, where the decision is made: recording is a choice. */}
          {!live && !state ? (
            <p className="classroom__recording-hint">{t('classroom.recordingHint')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The state machine in Arabic. Unknown states fall back to a sentence rather
 *  than rendering a raw enum, the same discipline every other label here has. */
export function statusLabel(state: RecordingState): string {
  switch (state.status) {
    case 'starting':
      return t('classroom.recordingStarting');
    case 'recording':
      return t('classroom.recordingLive');
    case 'stopping':
      return t('classroom.recordingStopping');
    case 'processing':
      return t('classroom.recordingProcessing');
    case 'completed':
      // NOT «متاح». The provider has finished; the library item does not exist
      // yet (R99.14).
      return t('classroom.recordingDone');
    case 'failed':
    case 'aborted':
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
