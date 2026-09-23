import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { uploadFile, type UploadMeta } from '../../adapters/uploads.js';
import { t } from '../../i18n/index.js';
import { extensionFor, formatElapsed, pickContainer } from '../../lib/recorder.js';
import { recordingSession } from '../../lib/recording-platform.js';
import type { RecordingOrigin, RecordingSession } from '../../lib/recording-session.js';
import { Button } from '../ui/button.js';
import { Feedback } from '../ui/feedback.js';
import { TextField } from '../ui/field.js';

/**
 * **Recording a class session in the browser** (§4.9 as amended by Revision 75).
 *
 * ## It is a second WAY, never a second MODEL
 *
 * A saved recording is an ordinary `EducationalContent` with an `audio/*` MIME,
 * created through the **existing** `initiate → PUT → complete` pipeline and
 * linked through the **existing** `SessionContent` join. No new entity, no new
 * endpoint, no new storage path — so the §4.9 consent gate, the visibility
 * tiers, the quarantine-on-replace rule and R14's upload quota all apply here
 * without being mentioned again, because it is the same pipeline.
 *
 * The phone-record-and-upload path is untouched. This adds one; it removes none,
 * and it is the stated remedy whenever this one is unavailable.
 *
 * ## Where it is not offered, it says why
 *
 * `MediaRecorder` absent, or every whitelisted container unsupported, and the
 * control does not render at all — a stated reason instead (R75.4, §14.4). A
 * button that fails on press would teach a person that the platform is broken
 * rather than that their browser is.
 *
 * ## The recording is not this component's (SRS Revision 172 §4)
 *
 * It lives in `RecordingSession`, application-wide: this component is a VIEW
 * of it, bound by the screen's `origin.key`. Leaving the screen unmounts the
 * view and nothing else — the microphone stays open, the chunks keep landing
 * in the browser's storage, and `RecordingBar` shows the same controls from
 * wherever she went. A screen whose key is not the active recording's shows a
 * notice instead of a second recorder (one recording at a time).
 *
 * Pause produces ONE file, and the clock is the spans actually recorded, never
 * a tick count (R75.5 — a reading; `EducationalContent` has no duration
 * column and gains none).
 */
export interface AudioRecorderProps {
  /** Which screen this is (`library`, `session:<id>`), and where it returns to. */
  origin: RecordingOrigin;
  meta: UploadMeta;
  token: string | null;
  /**
   * **The name to suggest, already decided by the SERVER** (R75.6, R99).
   *
   * The recorder is reachable from two places with different notions of what a
   * recording is *of* — a class occurrence on الجدولة, a Subject-and-year scope
   * in مكتبة المحتوى — and since R99 there is a **third** producer that is not a
   * browser at all. So neither this component nor its callers compose a name:
   * each surface receives `suggested_recording_name` from the endpoint it
   * already loads, and the numbering rule has one implementation.
   *
   * It remains a **suggestion**: it fills the field, the person may replace it,
   * and nothing reads it back.
   */
  suggestedName: string;
  /**
   * **Why saving is not possible yet, or `null`** (§10).
   *
   * Recording is deliberately NOT gated on it: somebody may reasonably start
   * recording and decide where it belongs afterwards, and losing captured audio
   * to a scope that was not chosen would be the worse failure. So the refusal
   * lands on **save**, next to the button it disables, and says which fields —
   * all of which are now on this form (rule AX) rather than behind it.
   */
  saveBlockedReason?: string | null;
  onSaved: (contentId: string) => void;
  onCancel: () => void;
  /** The global bar's rendering: no heading, no cancel, a «العودة» link. */
  compact?: boolean;
  /** Test seam; the application's one session otherwise. */
  session?: RecordingSession;
}

/** §7: `EducationalContent.title` is `VarChar(120)` (TD-9) — the same bound the
 *  completion schema holds; asked here first so no upload is spent on it. */
export const RECORDING_NAME_MAX = 120;

/** How many screens currently show the active recording — the bar hides while one does. */
let mountedHosts = 0;
const hostListeners = new Set<() => void>();
function noteHosts(delta: number): void {
  mountedHosts += delta;
  for (const listener of hostListeners) listener();
}
export function subscribeHosts(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}
export function hostsMounted(): number {
  return mountedHosts;
}

export function AudioRecorder({
  origin,
  meta,
  token,
  suggestedName,
  saveBlockedReason = null,
  onSaved,
  onCancel,
  compact = false,
  session = recordingSession(),
}: AudioRecorderProps): ReactNode {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const mine = state.origin === null || state.origin.key === origin.key;
  const bound = mine && state.status !== 'idle';
  const [now, setNow] = useState(() => Date.now());
  const [nameError, setNameError] = useState<string | null>(null);

  // Resolved once, at render: the answer cannot change under the user, and
  // asking on every press would make the control's absence conditional on
  // timing rather than on the browser.
  const container =
    typeof MediaRecorder === 'undefined'
      ? null
      : pickContainer((type) => MediaRecorder.isTypeSupported(type));

  // This screen is a host of the recording while it shows it (the bar stands
  // down). Registered only while bound, so a screen showing the «elsewhere»
  // notice does not hide the bar that is the way to the recording.
  useEffect(() => {
    if (!bound || compact) return undefined;
    noteHosts(1);
    return () => noteHosts(-1);
  }, [bound, compact]);

  // The screen it is shown on may correct where it lands and what it is
  // called: carried into the session so the bar can save without the page.
  useEffect(() => {
    if (bound && !compact) session.setMeta(meta, saveBlockedReason);
  }, [bound, compact, meta, saveBlockedReason, session]);
  useEffect(() => {
    if (bound && !compact) session.setSuggestedName(suggestedName);
  }, [bound, compact, suggestedName, session]);

  // The clock only asks *what time is it* — the reading itself is computed from
  // the spans, so a skipped tick costs nothing but a late repaint.
  useEffect(() => {
    if (state.status !== 'recording') return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [state.status]);

  async function start(): Promise<void> {
    if (container === null) return;
    setNameError(null);
    await session.start({ origin, meta, suggestedName, saveBlockedReason, container });
  }

  async function save(): Promise<void> {
    const blob = session.blob();
    if (blob === null) return;
    const effectiveMeta = state.meta ?? meta;
    // The typed name wins; the server's suggestion fills an untouched field.
    // **Both CAN be empty** (R75.6 — nothing to name after, before R172 §3).
    // The Owner met that on 2026-09-22: a fifteen-second upload, then
    // «تعذّر الحفظ» from the completion's schema (`title` 1–120). So the rule is
    // asked HERE, before a byte is spent, in her words and on the field.
    const suggested = state.suggestedName || suggestedName;
    const name = state.title.trim() === '' ? suggested.trim() : state.title.trim();
    if (name === '') {
      setNameError(t('recorder.nameRequired'));
      return;
    }
    if (name.length > RECORDING_NAME_MAX) {
      setNameError(t('recorder.nameTooLong').replace('{max}', String(RECORDING_NAME_MAX)));
      return;
    }
    setNameError(null);
    session.saving(0);
    // The extension follows the MIME the browser agreed to: the server checks
    // the declared type AND the magic bytes (TD-9), so a mismatched name is
    // rejected at `complete`, after the whole upload has been spent.
    const type = blob.type || state.container || container || '';
    const file = new File([blob], `${name}.${extensionFor(type)}`, { type });
    try {
      const contentId = await uploadFile(
        file,
        // **R99.12 — what this IS.** Every path through this component is a
        // recording of a class (R75.1); the screen it was opened from decides
        // only which class, never whether it is one. Leaving it to the caller
        // would make the classification a prop two screens could disagree about.
        { ...effectiveMeta, origin: 'session_recording' },
        { title: name, description: null },
        token,
        (percent) => session.saving(percent),
        () => undefined,
      );
      await session.clear();
      onSaved(contentId);
    } catch {
      // The audio is KEPT — on the page and in the browser's storage. A failed
      // upload has no resume (Risk R-9), and discarding the recording would
      // make one network failure cost the class.
      session.saveFailed();
    }
  }

  if (container === null) {
    // §14.4 — not offered, and the reason stated, with the path that does work.
    return (
      <p className="state" role="status">
        {t('recorder.unsupported')}
      </p>
    );
  }

  if (!mine) {
    // Another screen's recording is running: one at a time, and the bar is
    // the way to it (rule AH — the reason, beside the control that is absent).
    return (
      <section className="recorder recorder--block" aria-labelledby="recorder-heading">
        <h3 id="recorder-heading" className="recorder__heading">
          <span aria-hidden="true" className="recorder__dot" />
          {t('recorder.title')}
        </h3>
        <Feedback>{t('recorder.elsewhere').replace('{label}', state.origin?.label ?? '')}</Feedback>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </section>
    );
  }

  const elapsed = session.elapsed(state.status === 'recording' ? now : Date.now());
  const effectiveSuggested = state.suggestedName || suggestedName;
  const blocked = state.saveBlockedReason ?? saveBlockedReason;
  const live = state.status === 'recording' || state.status === 'paused';
  const stopped = state.status === 'stopped' || state.status === 'saving';

  return (
    <section
      className={compact ? 'recorder recorder--bar' : 'recorder recorder--block'}
      aria-labelledby={compact ? undefined : 'recorder-heading'}
      aria-label={compact ? t('recorder.title') : undefined}
    >
      {compact ? null : (
        <h3 id="recorder-heading" className="recorder__heading">
          <span aria-hidden="true" className="recorder__dot" />
          {t('recorder.title')}
        </h3>
      )}

      {state.error === 'mic_denied' ? (
        <p className="field__error" role="alert">
          {t('recorder.micDenied')}
        </p>
      ) : null}
      {state.error === 'save_failed' ? (
        <p className="field__error" role="alert">
          {t('recorder.saveFailed')}
        </p>
      ) : null}

      {/* R172 §4 — what a phone may do while recording, said plainly: the
          screen is kept awake, and leaving this page does not stop it. */}
      {live ? (
        <p className="recorder__warning" role="status">
          {t('recorder.keepsGoing')}
        </p>
      ) : null}
      {state.captureGap ? (
        <p className="recorder__warning" role="alert">
          {t(state.restored ? 'recorder.restoredCutOff' : 'recorder.captureGap')}
        </p>
      ) : state.restored ? (
        <p className="recorder__warning" role="status">
          {t('recorder.restored')}
        </p>
      ) : state.backgrounded && stopped ? (
        <p className="recorder__warning" role="status">
          {t('recorder.wasBackgrounded')}
        </p>
      ) : null}

      <p className="recorder__elapsed" aria-live="off">
        {/* `aria-live="off"` deliberately: a clock announced every second is a
            screen reader nobody can use. The STATE changes are announced. */}
        {formatElapsed(elapsed)}
        <span className="visually-hidden"> {t(`recorder.state.${state.status}`)}</span>
      </p>

      <div className="form__actions">
        {state.status === 'idle' ? (
          <Button variant="primary" onClick={() => void start()}>
            {t('recorder.start')}
          </Button>
        ) : null}
        {state.status === 'recording' ? (
          <>
            <Button variant="secondary" onClick={() => session.pause()}>
              {t('recorder.pause')}
            </Button>
            <Button variant="primary" onClick={() => void session.stop()}>
              {t('recorder.stop')}
            </Button>
          </>
        ) : null}
        {state.status === 'paused' ? (
          <>
            <Button variant="secondary" onClick={() => session.resume()}>
              {t('recorder.resume')}
            </Button>
            <Button variant="primary" onClick={() => void session.stop()}>
              {t('recorder.stop')}
            </Button>
          </>
        ) : null}
      </div>

      {stopped ? (
        <>
          <TextField
            label={t('recorder.name')}
            value={state.title}
            onChange={(next) => {
              session.setTitle(next);
              setNameError(null);
            }}
            placeholder={effectiveSuggested}
            required={effectiveSuggested.trim() === ''}
            hint={t(effectiveSuggested.trim() === '' ? 'recorder.nameHintNoSuggestion' : 'recorder.nameHint')}
            error={nameError}
          />
          {state.status === 'saving' ? (
            <progress className="upload__progress" value={state.percent} max={100} />
          ) : null}
          <div className="form__actions">
            {/* Discarding is explicit and destructive-looking, because a
                recording that cannot be made again is exactly what it destroys. */}
            <Button
              variant="danger"
              disabled={state.status === 'saving'}
              onClick={() => void session.clear()}
            >
              {t('recorder.discard')}
            </Button>
            <Button
              variant="primary"
              disabled={state.status === 'saving' || blocked !== null}
              onClick={() => void save()}
            >
              {t('recorder.save')}
            </Button>
          </div>
          {/* One message, beside the control it explains (rule AH). */}
          {blocked !== null ? (
            <Feedback>
              {blocked}
              {compact && state.origin ? (
                <>
                  {' '}
                  <a href={state.origin.path}>{t('recorder.returnTo').replace('{label}', state.origin.label)}</a>
                </>
              ) : null}
            </Feedback>
          ) : null}
        </>
      ) : null}

      {compact ? (
        state.origin ? (
          <a className="recorder__return" href={state.origin.path}>
            {t('recorder.returnTo').replace('{label}', state.origin.label)}
          </a>
        ) : null
      ) : (
        // Leaving the screen never stops the recording (R172 §4): «إلغاء»
        // closes the recorder here; the bar keeps showing it while it runs.
        <Button variant="secondary" disabled={state.status === 'saving'} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      )}
    </section>
  );
}
