import { useRef, useState, type ReactNode } from 'react';

import { uploadFile, type UploadMeta, type UploadStage } from '../../adapters/uploads.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Button } from '../ui/button.js';
import { CheckboxField, TextArea, TextField } from '../ui/field.js';
import { Feedback } from '../ui/feedback.js';

/**
 * The single-shot uploader (§4.9, §14.3, TD-9).
 *
 * **Progress and a clean retry are not decoration here — they are the stated
 * mitigation for a risk the specification accepted.** MVP uploads have no
 * resume: a failure restarts from zero (Risk R-9), and §4.9 requires the UI to
 * *"display upload progress and clear retry affordances"* in exchange. So the
 * bar is the contract, and a spinner would not be.
 *
 * **Retry re-runs the whole flow, deliberately.** A new ticket, a new key, a new
 * hash segment (TD-9) — never a resumption of the last attempt, because there is
 * nothing to resume and pretending otherwise is how a half-written object gets
 * completed as if it were whole.
 *
 * The same component serves the library screen and the session materials dialog:
 * one uploader, one set of states, one place where the retry rule lives.
 */

/** TD-9's whitelist, as the file picker's `accept` hint. **Advisory only** — the
 *  server checks the declared type against the same list and then checks the
 *  magic bytes, because a picker filter is a convenience a caller can bypass. */
const ACCEPT = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  '.docx',
  '.pptx',
  '.xlsx',
].join(',');

export interface FileUploaderProps {
  meta: UploadMeta;
  token: string | null;
  /** Prefilled when replacing: the record keeps its title unless changed. */
  initialTitle?: string;
  initialDescription?: string;
  submitLabel: string;
  onUploaded: (contentId: string) => void;
  onCancel: () => void;
  /** Blocks submission with a stated reason — an incomplete scope above the
   *  form, rather than a button that fails on click. */
  disabledReason?: string | null;
}

export function FileUploader({
  meta,
  token,
  initialTitle = '',
  initialDescription = '',
  submitLabel,
  onUploaded,
  onCancel,
  disabledReason = null,
}: FileUploaderProps): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  /**
   * **R99.12 — the upload boundary must be able to say *this is a class
   * recording*.**
   *
   * §4.9's MVP flow is a مؤطِّرة recording on her phone and uploading the file,
   * and since R99.10 «التسجيلات» is decided by `origin` rather than by the MIME
   * type. Without this control every phone recording uploaded after that
   * revision would arrive as a *material* — a regression dressed as a
   * refinement. It defaults to off: most uploads are materials, and a marker
   * that defaults to on would misclassify the common case instead of the rare
   * one.
   */
  const [isRecording, setIsRecording] = useState(false);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = stage === 'preparing' || stage === 'uploading' || stage === 'finalising';

  function chooseFile(chosen: File | null): void {
    setFile(chosen);
    setError(null);
    setStage('idle');
    setPercent(0);
    // The filename is the best first guess at a title and the worst thing to
    // leave a person retyping. The extension goes: it names the format, which
    // the card already shows.
    if (chosen && title.trim() === '') setTitle(chosen.name.replace(/\.[^.]+$/, ''));
  }

  async function submit(): Promise<void> {
    if (!file || title.trim() === '') return;
    setError(null);
    setPercent(0);
    try {
      const id = await uploadFile(
        file,
        { ...meta, ...(isRecording ? { origin: 'session_recording' as const } : {}) },
        { title: title.trim(), description: description.trim() || null },
        token,
        setPercent,
        setStage,
      );
      onUploaded(id);
    } catch (e) {
      setStage('failed');
      setError(uploadErrorMessage(e));
    }
  }

  return (
    <div className="uploader">
      {disabledReason ? (
        <Feedback>
          {disabledReason}
        </Feedback>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="uploader-file">
          {t('content.upload.file')}
        </label>
        <input
          id="uploader-file"
          ref={inputRef}
          className="field__control"
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
        />
        <p className="field__hint">{t('content.upload.limits')}</p>
      </div>

      {/* §4.9: teachers record on their phone and upload the file — the in-app
          recorder is post-MVP, so the guidance is part of the screen. */}
      <p className="muted">{t('content.upload.recordingGuidance')}</p>

      {/* R99.12 — beside that guidance on purpose: the sentence tells a مؤطِّرة
          to upload what she recorded on her phone, and this is where she says
          that is what it is. */}
      <CheckboxField
        label={t('content.upload.isRecording')}
        checked={isRecording}
        onChange={setIsRecording}
        hint={t('content.upload.isRecordingHint')}
        disabled={busy}
      />

      <TextField
        label={t('content.upload.title')}
        value={title}
        onChange={setTitle}
        required
        disabled={busy}
      />
      <TextArea
        label={t('content.upload.description')}
        value={description}
        onChange={setDescription}
        rows={3}
        disabled={busy}
      />

      {stage !== 'idle' && stage !== 'failed' ? (
        <div className="uploader__progress">
          {/* A real progress element, so assistive technology reads the value
              rather than inferring it from a styled div. */}
          <progress value={stage === 'uploading' ? percent : undefined} max={100} />
          <span aria-live="polite">
            {stage === 'uploading'
              ? `${String(percent)}٪`
              : t(`content.upload.stage.${stage}`)}
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="dialog__actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={busy || !file || title.trim() === '' || disabledReason !== null}
        >
          {stage === 'failed' ? t('content.upload.retry') : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Turns the server's refusal into something a person can act on.
 *
 * **Every branch here corresponds to a rule the server enforces**, and saying
 * "upload failed" for all of them would hide the one thing the person needs: a
 * teacher who cannot publish Globally must be told that, not told to try again.
 */
export function uploadErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t('content.upload.networkFailed');
  const reason = error.details?.['reason'];
  if (reason === 'GLOBAL_SCOPE_FORBIDDEN') return t('content.upload.globalForbidden');
  if (reason === 'BRANCH_OUT_OF_SCOPE') return t('content.upload.branchForbidden');
  if (reason === 'SUBJECT_NOT_IN_LEVEL') return t('content.upload.subjectNotAtLevel');
  switch (error.code) {
    case 'PAYLOAD_TOO_LARGE':
      return t('content.upload.tooLarge');
    case 'RATE_LIMITED':
      return t('content.upload.quotaExhausted');
    case 'VALIDATION_FAILED':
      // Covers both the whitelist refusal at initiate and the magic-byte
      // mismatch at completion — from the person's side they are one thing:
      // this file is not a kind the platform accepts.
      return t('content.upload.typeRejected');
    case 'UPLOAD_INCOMPLETE':
      return t('content.upload.incomplete');
    default:
      return t('content.upload.failed');
  }
}
