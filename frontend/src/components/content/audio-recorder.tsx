import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { uploadFile, type UploadMeta } from '../../adapters/uploads.js';
import { t } from '../../i18n/index.js';
import {
  elapsedSeconds,
  extensionFor,
  formatElapsed,
  pickContainer,
  RECORDER_OPTIONS,
  shouldGuardUnload,
  type RecordedSpan,
} from '../../lib/recorder.js';
import { Button } from '../ui/button.js';
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
 * ## Pause produces ONE file, and the clock is not the duration
 *
 * `pause()`/`resume()` keep a single `MediaRecorder`, so a session interrupted
 * mid-way is one recording rather than three. Some containers then record a
 * duration that ignores the paused time, which is exactly why **the elapsed
 * reading is UI only** (R75.5): nothing writes it anywhere, and
 * `EducationalContent` has no duration column and gains none.
 *
 * ## Risk R-4, reinstated and mitigated where a guard can reach
 *
 * iOS suspends `MediaRecorder` when the screen locks or the tab is
 * backgrounded, and can truncate a long recording **without reporting an
 * error** — the accepted residual risk (R75.7). What a guard can remove is the
 * silent discard: a warning while recording, a `visibilitychange` warning, and a
 * `beforeunload` guard so navigating away asks first.
 */
export interface AudioRecorderProps {
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
  onSaved: (contentId: string) => void;
  onCancel: () => void;
}

type RecorderState = 'idle' | 'recording' | 'paused' | 'saving';

export function AudioRecorder({
  meta,
  token,
  suggestedName,
  onSaved,
  onCancel,
}: AudioRecorderProps): ReactNode {
  const [state, setState] = useState<RecorderState>('idle');
  /**
   * **The spans actually recorded**, not a tick count. `setInterval` is
   * throttled in a background tab — the very case R75.7 warns about — so a
   * counter understates a long recording by whatever the browser skipped.
   */
  const [spans, setSpans] = useState<RecordedSpan[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const elapsed = elapsedSeconds(spans, now);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [title, setTitle] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [backgrounded, setBackgrounded] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Resolved once, at render: the answer cannot change under the user, and
  // asking on every press would make the control's absence conditional on
  // timing rather than on the browser.
  const container =
    typeof MediaRecorder === 'undefined'
      ? null
      : pickContainer((type) => MediaRecorder.isTypeSupported(type));

  /** Stops the microphone. A live track keeps the browser's recording indicator
   *  on, which reads as *still listening* long after it has stopped. */
  const releaseMicrophone = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => releaseMicrophone(), [releaseMicrophone]);

  // The clock only asks *what time is it* — the reading itself is computed from
  // the spans, so a skipped tick costs nothing but a late repaint.
  useEffect(() => {
    if (state !== 'recording') return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [state]);

  // R75.7 — the two guards a browser will actually let us install.
  useEffect(() => {
    if (!shouldGuardUnload(state)) return undefined;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Browsers show their own wording; assigning is what arms the dialog.
      event.returnValue = '';
    };
    const visibility = (): void => {
      if (document.visibilityState === 'hidden') setBackgrounded(true);
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [state]);

  async function start(): Promise<void> {
    if (container === null) return;
    setError(null);
    setBackgrounded(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: RECORDER_OPTIONS.channelCount },
      });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, {
        mimeType: container,
        audioBitsPerSecond: RECORDER_OPTIONS.audioBitsPerSecond,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        // ONE blob from every chunk — pause/resume never produces several files.
        setBlob(new Blob(chunksRef.current, { type: container }));
        releaseMicrophone();
      };
      recorderRef.current = recorder;
      recorder.start();
      setSpans([{ start: Date.now(), end: null }]);
      setNow(Date.now());
      setState('recording');
    } catch {
      // Permission refused, or no microphone. Both are the person's to fix, and
      // the phone-upload path is unaffected either way.
      setError(t('recorder.micDenied'));
      releaseMicrophone();
    }
  }

  /** Closes the open span, whichever transition asked for it. */
  function closeSpan(): void {
    setSpans((current) =>
      current.map((span) => (span.end === null ? { ...span, end: Date.now() } : span)),
    );
  }

  function stop(): void {
    recorderRef.current?.stop();
    recorderRef.current = null;
    closeSpan();
    setState('idle');
  }

  async function save(): Promise<void> {
    if (blob === null) return;
    setState('saving');
    setError(null);
    // The typed name wins; the server's suggestion fills an untouched field.
    // Neither can be empty in practice — a screen that cannot name a recording
    // does not offer the recorder — and an empty one would be refused by the
    // upload schema anyway, which is the right place for that rule.
    const name = title.trim() === '' ? suggestedName.trim() : title.trim();
    // The extension follows the MIME the browser agreed to: the server checks
    // the declared type AND the magic bytes (TD-9), so a mismatched name is
    // rejected at `complete`, after the whole upload has been spent.
    const file = new File([blob], `${name}.${extensionFor(blob.type || (container ?? ''))}`, {
      type: blob.type || (container ?? ''),
    });
    try {
      const contentId = await uploadFile(
        file,
        // **R99.12 — what this IS.** Every path through this component is a
        // recording of a class (R75.1); the screen it was opened from decides
        // only which class, never whether it is one. Leaving it to the caller
        // would make the classification a prop two screens could disagree about.
        { ...meta, origin: 'session_recording' },
        { title: name, description: null },
        token,
        setPercent,
        () => undefined,
      );
      setBlob(null);
      setState('idle');
      onSaved(contentId);
    } catch {
      // The blob is KEPT. A failed upload has no resume (Risk R-9), and
      // discarding the recording would make one network failure cost the class.
      setError(t('recorder.saveFailed'));
      setState('idle');
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

  return (
    <section className="recorder recorder--block" aria-labelledby="recorder-heading">
      <h3 id="recorder-heading" className="recorder__heading">
        <span aria-hidden="true" className="recorder__dot" />
        {t('recorder.title')}
      </h3>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {/* R75.7 — the warning is permanent while recording, because the risk is
          permanent while recording: it is not an error that has happened. */}
      {state === 'recording' || state === 'paused' ? (
        <p className="recorder__warning" role="status">
          {t('recorder.keepAwake')}
        </p>
      ) : null}
      {backgrounded ? (
        <p className="recorder__warning" role="alert">
          {t('recorder.wasBackgrounded')}
        </p>
      ) : null}

      <p className="recorder__elapsed" aria-live="off">
        {/* `aria-live="off"` deliberately: a clock announced every second is a
            screen reader nobody can use. The STATE changes are announced. */}
        {formatElapsed(elapsed)}
        <span className="visually-hidden"> {t(`recorder.state.${state}`)}</span>
      </p>

      <div className="form__actions">
        {state === 'idle' && blob === null ? (
          <Button variant="primary" onClick={() => void start()}>
            {t('recorder.start')}
          </Button>
        ) : null}
        {state === 'recording' ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                recorderRef.current?.pause();
                closeSpan();
                setState('paused');
              }}
            >
              {t('recorder.pause')}
            </Button>
            <Button variant="primary" onClick={stop}>
              {t('recorder.stop')}
            </Button>
          </>
        ) : null}
        {state === 'paused' ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                recorderRef.current?.resume();
                // A NEW span: the gap between them is the pause, and excluding
                // it is what makes the reading honest.
                setSpans((current) => [...current, { start: Date.now(), end: null }]);
                setState('recording');
              }}
            >
              {t('recorder.resume')}
            </Button>
            <Button variant="primary" onClick={stop}>
              {t('recorder.stop')}
            </Button>
          </>
        ) : null}
      </div>

      {blob !== null ? (
        <>
          <TextField
            label={t('recorder.name')}
            value={title}
            onChange={setTitle}
            placeholder={suggestedName}
            hint={t('recorder.nameHint')}
          />
          {state === 'saving' ? (
            <progress className="upload__progress" value={percent} max={100} />
          ) : null}
          <div className="form__actions">
            {/* Discarding is explicit and destructive-looking, because a
                recording that cannot be made again is exactly what it destroys. */}
            <Button
              variant="danger"
              disabled={state === 'saving'}
              onClick={() => {
                setBlob(null);
                setSpans([]);
              }}
            >
              {t('recorder.discard')}
            </Button>
            <Button variant="primary" disabled={state === 'saving'} onClick={() => void save()}>
              {t('recorder.save')}
            </Button>
          </div>
        </>
      ) : null}

      <Button variant="secondary" disabled={state !== 'idle'} onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </section>
  );
}
