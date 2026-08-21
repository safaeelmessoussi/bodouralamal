import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FileUploader, uploadErrorMessage } from '../components/content/file-uploader.js';
import { t } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { ADMIN_MODULES } from '../lib/admin-modules.js';
import { TEACHER_MODULES } from '../lib/teacher-modules.js';
import { IMPLEMENTED_ADMIN_PATHS } from './admin/index.js';

/**
 * The content upload surface (§4.9, §5.5, §5.6, TD-9).
 *
 * The uploader's own value is mostly in what it says when the server says no:
 * §4.9 refuses four different things for four different reasons, and a screen
 * that reported "upload failed" for all of them would leave a teacher unable to
 * act on any of them.
 */

const envelope = (code: string, details: Record<string, unknown> = {}): ApiError =>
  new ApiError(400, {
    code,
    message_key: 'x',
    message: 'x',
    details,
    request_id: 'r',
  });

describe('what the uploader tells someone when the server refuses', () => {
  it('names the Global-scope rule rather than saying "failed"', () => {
    // §4.9: a Teacher cannot publish platform-wide. Told this, they choose a
    // branch; told "upload failed", they retry the same thing.
    expect(uploadErrorMessage(envelope('FORBIDDEN', { reason: 'GLOBAL_SCOPE_FORBIDDEN' }))).toBe(
      t('content.upload.globalForbidden'),
    );
  });

  it('distinguishes an out-of-scope branch from the Global refusal', () => {
    expect(uploadErrorMessage(envelope('FORBIDDEN', { reason: 'BRANCH_OUT_OF_SCOPE' }))).toBe(
      t('content.upload.branchForbidden'),
    );
  });

  it('names the subject/level mismatch, which is a data problem and not a permission', () => {
    expect(uploadErrorMessage(envelope('STATE_CONFLICT', { reason: 'SUBJECT_NOT_IN_LEVEL' }))).toBe(
      t('content.upload.subjectNotAtLevel'),
    );
  });

  it('reports the TD-9 cap and the hourly quota as different things', () => {
    // One is about this file, the other about the hour. Collapsing them would
    // have someone shrinking a file that was never too large.
    expect(uploadErrorMessage(envelope('PAYLOAD_TOO_LARGE'))).toBe(t('content.upload.tooLarge'));
    expect(uploadErrorMessage(envelope('RATE_LIMITED'))).toBe(t('content.upload.quotaExhausted'));
  });

  it('treats a rejected type and a magic-byte mismatch as one message', () => {
    // They are one thing from the person's side — this file is not a kind the
    // platform accepts — and the server answers `VALIDATION_FAILED` for both.
    expect(uploadErrorMessage(envelope('VALIDATION_FAILED'))).toBe(
      t('content.upload.typeRejected'),
    );
  });

  it('separates a network failure from any server refusal', () => {
    // A dropped connection is retryable and a refusal is not, and MVP uploads
    // have no resume (Risk R-9) — so this is the one case where "try again" is
    // genuinely the right advice.
    expect(uploadErrorMessage(new Error('offline'))).toBe(t('content.upload.networkFailed'));
  });
});

describe('the uploader before anything is chosen', () => {
  const props = {
    meta: { level_id: 'l', subject_id: 's', academic_year_id: 'y', branch_id: null },
    token: 't',
    submitLabel: 'رفع',
    onUploaded: () => undefined,
    onCancel: () => undefined,
  };

  it('states the TD-9 limits and that video is not accepted, before a file is picked', () => {
    const html = renderToStaticMarkup(<FileUploader {...props} />);
    expect(html).toContain(t('content.upload.limits'));
    // The whitelist is stated up front rather than discovered by rejection.
    expect(t('content.upload.limits')).toContain('الفيديو');
  });

  it('carries §4.9 phone-recording guidance, because the in-app recorder is post-MVP', () => {
    const html = renderToStaticMarkup(<FileUploader {...props} />);
    expect(html).toContain(t('content.upload.recordingGuidance'));
  });

  it('offers no video type in the picker filter (TD-9)', () => {
    const html = renderToStaticMarkup(<FileUploader {...props} />);
    expect(html).toContain('audio/mpeg');
    expect(html).not.toContain('video/');
  });

  it('renders no progress element until an upload starts', () => {
    // A bar at zero reads as a stalled upload rather than as an idle form.
    const html = renderToStaticMarkup(<FileUploader {...props} />);
    expect(html).not.toContain('<progress');
  });

  it('states an incomplete scope instead of leaving the button to fail', () => {
    const html = renderToStaticMarkup(
      <FileUploader {...props} disabledReason={t('content.upload.chooseScope')} />,
    );
    expect(html).toContain(t('content.upload.chooseScope'));
  });

  /**
   * **R99.12 — the boundary can say *this is a class recording*.**
   *
   * R99.10 makes «التسجيلات» a function of `origin` rather than of the MIME
   * type, and §4.9's MVP flow is a مؤطِّرة recording on her phone and uploading
   * the file. Without this control every phone recording uploaded after that
   * revision would arrive as a *material*.
   */
  it('offers the class-recording marker, unchecked, beside the phone guidance', () => {
    const html = renderToStaticMarkup(<FileUploader {...props} />);
    expect(html).toContain(t('content.upload.isRecording'));
    expect(html).toContain(t('content.upload.isRecordingHint'));
    expect(html).toContain('type="checkbox"');
    // Off by default: most uploads are materials, and defaulting it on would
    // misclassify the common case instead of the rare one.
    expect(html).not.toContain('checked=""');
  });

  it('uses the shared checkbox atom, not hand-written markup (rule C)', () => {
    const html = renderToStaticMarkup(<FileUploader {...props} />);
    // `CheckboxField` renders the platform's own `field field--choice` shape.
    expect(html).toContain('field field--choice');
  });
});

describe('the navigation registries agree with the routers', () => {
  it('lists /admin/content as ready and the router renders it', () => {
    const module = ADMIN_MODULES.find((m) => m.path === '/admin/content');
    expect(module?.status).toBe('ready');
    // A `ready` module with no screen is the defect this pairing exists to
    // catch: the sidebar would promise a page the router answers as pending.
    expect(IMPLEMENTED_ADMIN_PATHS).toContain('/admin/content');
  });

  it('lists /teacher/content as ready — §5.5 is the same capability, not a copy', () => {
    const module = TEACHER_MODULES.find((m) => m.path === '/teacher/content');
    expect(module?.status).toBe('ready');
    expect(module?.blockedReasonKey).toBeUndefined();
  });
});
