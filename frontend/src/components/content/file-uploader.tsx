import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  /** R178 §4 — a composed title each file's field shows and follows until typed in. */
  suggestedTitle?: string;
  initialDescription?: string;
  submitLabel: string;
  /** Once every chosen file is uploaded — their ids, in the order chosen. */
  onUploaded: (contentIds: string[]) => void;
  onCancel: () => void;
  /** Blocks submission with a stated reason — a curriculum state the person
   *  must fix first (a Level that teaches nothing), never a missing choice. */
  disabledReason?: string | null;
  /** Blocks submission silently: a required field (marked *) is still empty. */
  incomplete?: boolean;
  /** R53 — a replacement swaps ONE file on one record. */
  single?: boolean;
}

/**
 * **One chosen file, and what it will be saved as** (SRS Revision 198 §1).
 * Each file says on its own whether it is a class recording, and carries its
 * own title and description; the scope above is shared by all of them.
 */
interface Item {
  key: number;
  file: File | null;
  isRecording: boolean;
  title: string;
  titleTouched: boolean;
  description: string;
  stage: UploadStage;
  percent: number;
  error: string | null;
  contentId: string | null;
  /** R199 §1 — the connection dropped and the upload is being retried on its own. */
  retrying: boolean;
}

let nextKey = 1;
function blankItem(title: string, touched: boolean, description: string): Item {
  return {
    key: nextKey++,
    file: null,
    isRecording: false,
    title,
    titleTouched: touched,
    description,
    stage: 'idle',
    percent: 0,
    error: null,
    contentId: null,
    retrying: false,
  };
}

/** The suggestion for the i-th of n files: numbered when there are several,
 *  so two files are never proposed the same title. */
function suggestionFor(suggestedTitle: string, index: number, count: number): string {
  if (suggestedTitle === '') return '';
  return count > 1 ? `${suggestedTitle} (${String(index + 1)})` : suggestedTitle;
}

export function FileUploader({
  meta,
  token,
  initialTitle = '',
  suggestedTitle = '',
  initialDescription = '',
  submitLabel,
  onUploaded,
  onCancel,
  disabledReason = null,
  incomplete = false,
  single = false,
}: FileUploaderProps): ReactNode {
  // There is always one item, so the title and description are there from
  // the start (the composed title shows before a file is picked).
  const [items, setItems] = useState<Item[]>(() => [
    blankItem(initialTitle || suggestedTitle, initialTitle !== '', initialDescription),
  ]);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // An untouched title follows the composed one as the scope above changes.
  useEffect(() => {
    setItems((current) =>
      current.map((item, index) =>
        item.titleTouched || suggestedTitle === ''
          ? item
          : { ...item, title: suggestionFor(suggestedTitle, index, current.length) },
      ),
    );
  }, [suggestedTitle, items.length]);

  const update = (key: number, patch: Partial<Item>): void =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  function chooseFiles(chosen: File[]): void {
    if (chosen.length === 0) return;
    setItems((current) => {
      const picked = single ? chosen.slice(0, 1) : chosen;
      // The empty slots take the first files; the rest are added after them.
      const empty = current.filter((item) => item.file === null);
      const filled = single ? [] : current.filter((item) => item.file !== null);
      const slots = [...empty];
      while (slots.length < picked.length) slots.push(blankItem('', false, ''));
      const placed = picked.map((file, i) => {
        const slot = slots[i] as Item;
        // The filename is the best first guess when nothing is composed — and
        // the worst thing to leave a person retyping. The extension names the
        // format, which the card already shows.
        const fallback = file.name.replace(/\.[^.]+$/, '');
        return {
          ...slot,
          file,
          stage: 'idle' as const,
          percent: 0,
          error: null,
          title: slot.titleTouched || slot.title !== '' ? slot.title : fallback,
        };
      });
      const remaining = slots.slice(picked.length).filter((slot) => slot.file !== null);
      return [...filled, ...placed, ...remaining];
    });
    // The same file may be picked again after it is removed.
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(key: number): void {
    setItems((current) => {
      const left = current.filter((item) => item.key !== key);
      return left.length > 0 ? left : [blankItem(suggestedTitle, false, '')];
    });
  }

  const pending = items.filter((item) => item.contentId === null);
  const ready =
    pending.length > 0 &&
    pending.every((item) => item.file !== null && item.title.trim() !== '');

  async function submit(): Promise<void> {
    if (!ready) return;
    setRunning(true);
    const ids = new Map(items.filter((i) => i.contentId !== null).map((i) => [i.key, i.contentId as string]));
    let failed = false;
    // One after another: each is its own initiate → PUT → complete (TD-3.5),
    // and the per-person quota (TD-4.12) counts each.
    for (const item of pending) {
      if (item.file === null) continue;
      update(item.key, { error: null, percent: 0, retrying: false });
      try {
        const id = await uploadFile(
          item.file,
          { ...meta, ...(item.isRecording ? { origin: 'session_recording' as const } : {}) },
          { title: item.title.trim(), description: item.description.trim() || null },
          token,
          (percent) => update(item.key, { percent, retrying: false }),
          (stage) => update(item.key, { stage, retrying: false }),
          // R199 §1 — a dropped connection is retried here, with a growing
          // wait (about three minutes in all), never left to the person.
          { attempts: 8, onRetry: () => update(item.key, { retrying: true }) },
        );
        ids.set(item.key, id);
        update(item.key, { contentId: id, stage: 'done', percent: 100, retrying: false });
      } catch (e) {
        failed = true;
        update(item.key, { stage: 'failed', error: uploadErrorMessage(e), retrying: false });
      }
    }
    setRunning(false);
    if (!failed) onUploaded(items.map((item) => ids.get(item.key)).filter((id): id is string => id !== undefined));
  }

  const anyFailed = items.some((item) => item.stage === 'failed');
  const withFiles = items.filter((item) => item.file !== null);
  const doneCount = withFiles.filter((item) => item.contentId !== null).length;

  return (
    <div className="uploader">
      {disabledReason ? <Feedback>{disabledReason}</Feedback> : null}

      <div className="field">
        <label className="field__label" htmlFor="uploader-file">
          {t(single ? 'content.upload.file' : 'content.upload.files')}
        </label>
        <input
          id="uploader-file"
          ref={inputRef}
          className="field__control"
          type="file"
          accept={ACCEPT}
          multiple={!single}
          disabled={running}
          onChange={(e) => chooseFiles([...(e.target.files ?? [])])}
        />
        <p className="field__hint">{t('content.upload.limits')}</p>
      </div>

      {/* §4.9: teachers record on their phone and upload the file — the
          guidance is part of the screen. */}
      <p className="muted">{t('content.upload.recordingGuidance')}</p>

      {items.map((item) => {
        const done = item.contentId !== null;
        const locked = running || done;
        return (
          <fieldset key={item.key} className="uploader__item">
            {item.file !== null ? (
              <legend className="uploader__item-name">
                <span dir="auto">{item.file.name}</span>
              </legend>
            ) : null}

            {/* R99.12 — where she says that what she recorded on her phone is
                a class recording; per file since R198 §1. */}
            <CheckboxField
              label={t('content.upload.isRecording')}
              checked={item.isRecording}
              onChange={(isRecording) => update(item.key, { isRecording })}
              hint={t('content.upload.isRecordingHint')}
              disabled={locked}
            />

            <TextField
              label={t('content.upload.title')}
              value={item.title}
              onChange={(title) => update(item.key, { title, titleTouched: true })}
              required
              disabled={locked}
              {...(suggestedTitle !== '' && !item.titleTouched ? { hint: t('content.upload.titleSuggested') } : {})}
            />
            <TextArea
              label={t('content.upload.description')}
              value={item.description}
              onChange={(description) => update(item.key, { description })}
              rows={3}
              disabled={locked}
            />

            {/* R199 §1 — every file has its bar from the moment the upload
                starts: waiting, moving, retrying on its own, or done. */}
            {item.file !== null && (running || item.stage !== 'idle') ? (
              <div className="uploader__progress">
                {/* A real progress element, so assistive technology reads the
                    value rather than inferring it from a styled div. */}
                <progress
                  value={
                    item.stage === 'preparing' || item.stage === 'finalising' || item.retrying
                      ? undefined
                      : done
                        ? 100
                        : item.percent
                  }
                  max={100}
                />
                <span aria-live="polite">
                  {item.retrying
                    ? t('content.upload.retrying')
                    : done
                      ? t('content.upload.stage.done')
                      : item.stage === 'uploading'
                        ? `${String(item.percent)}٪`
                        : item.stage === 'idle' || item.stage === 'failed'
                          ? item.stage === 'idle'
                            ? t('content.upload.stage.queued')
                            : ''
                          : t(`content.upload.stage.${item.stage}`)}
                </span>
              </div>
            ) : null}

            {item.error ? (
              <p className="field__error" role="alert">
                {item.error}
              </p>
            ) : null}

            {!single && !locked && (item.file !== null || items.length > 1) ? (
              <div className="form__actions">
                <Button variant="ghost" onClick={() => remove(item.key)}>
                  {t('content.upload.removeFile')}
                </Button>
              </div>
            ) : null}
          </fieldset>
        );
      })}

      {withFiles.length > 1 && (running || doneCount > 0) ? (
        <p className="muted" aria-live="polite">
          {t('content.upload.overall').replace('{done}', String(doneCount)).replace('{total}', String(withFiles.length))}
        </p>
      ) : null}

      <div className="dialog__actions">
        <Button variant="ghost" onClick={onCancel} disabled={running}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={running || !ready || disabledReason !== null || incomplete}
        >
          {anyFailed ? t('content.upload.retry') : submitLabel}
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
      // The whitelist refusal at initiate and the byte check at completion
      // (409) — from the person's side one thing: this file is not a kind the
      // platform accepts. R200 — any OTHER refused field is not called a
      // wrong file type: that sentence sent the Owner looking at a good MP3.
      return reason === 'TYPE_NOT_ACCEPTED' || error.status === 409
        ? t('content.upload.typeRejected')
        : t('content.upload.failed');
    case 'UPLOAD_INCOMPLETE':
      return t('content.upload.incomplete');
    default:
      return t('content.upload.failed');
  }
}
