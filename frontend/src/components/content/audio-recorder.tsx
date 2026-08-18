import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { uploadFile, type UploadMeta } from '../../adapters/uploads.js';
import { t } from '../../i18n/index.js';
import {
  defaultRecordingName,
  extensionFor,
  formatElapsed,
  pickContainer,
  RECORDER_OPTIONS,
  shouldGuardUnload,
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
  /** The session's own name and date, which R75.6 derives the default from. */
  baseName: string;
  /** The titles already linked to this session — the suffix is chosen from
   *  these, so two concurrent saves cannot land on the same name (R75.6). */
  existingTitles: readonly string[];
  onSaved: (contentId: string) => void;
  onCancel: () => void;
}

type RecorderState = 'idle' | 'recording' | 'paused' | 'saving';

export function AudioRecorder({
  meta,
  token,
  baseName,
  existingTitles,
  onSaved,
  onCancel,
}: AudioRecorderProps): ReactNode {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
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

  // The clock. `paused` stops it, which is the honest reading of a stopwatch —
  // and is also why it cannot be the file's duration (R75.5).
  useEffect(() => {
    if (state !== 'recording') return undefined;
    const id = window.setInterval(() => setElapsed((n) => n + 1), 1000);
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
      setElapsed(0);
      setState('recording');
    } catch {
      // Permission refused, or no microphone. Both are the person's to fix, and
      // the phone-upload path is unaffected either way.
      setError(t('recorder.micDenied'));
      releaseMicrophone();
    }
  }

  function stop(): void {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setState('idle');
  }

  async function save(): Promise<void> {
    if (blob === null) return;
    setState('saving');
    setError(null);
    const name = title.trim() === '' ? defaultRecordingName(baseName, existingTitles) : title.trim();
    // The extension follows the MIME the browser agreed to: the server checks
    // the declared type AND the magic bytes (TD-9), so a mismatched name is
    // rejected at `complete`, after the whole upload has been spent.
    const file = new File([blob], `${name}.${extensionFor(blob.type || (container ?? ''))}`, {
      type: blob.type || (container ?? ''),
    });
    try {
      const contentId = await uploadFile(
        file,
        meta,
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
    <section className="recorder" aria-labelledby="recorder-heading">
      <h3 id="recorder-heading">{t('recorder.title')}</h3>

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
            placeholder={defaultRecordingName(baseName, existingTitles)}
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
                setElapsed(0);
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
