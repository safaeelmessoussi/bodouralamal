import { describe, expect, it } from 'vitest';

import RECORDER from './audio-recorder.tsx?raw';
import { RECORDING_NAME_MAX } from './audio-recorder.js';

/**
 * **A recording's name is asked BEFORE a byte is uploaded** (2026-09-22).
 *
 * «مكتبة المحتوى» offers the recorder with no Subject in view and then suggests
 * no name (R75.6 — nothing to name after). The Owner recorded, waited fifteen
 * seconds for the upload, and was told «تعذّر الحفظ»: the completion's schema
 * refused the empty `title`. Source-pinned — the component needs a microphone,
 * a MediaRecorder and a session to render meaningfully.
 */
const source = RECORDER.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the recorder refuses an empty or over-long name before uploading', () => {
  it('checks the resolved name and returns before uploadFile', () => {
    const check = source.indexOf("if (name === '')");
    const tooLong = source.indexOf('name.length > RECORDING_NAME_MAX');
    const upload = source.indexOf('await uploadFile(');
    expect(check).toBeGreaterThan(-1);
    expect(tooLong).toBeGreaterThan(-1);
    expect(check).toBeLessThan(upload);
    expect(tooLong).toBeLessThan(upload);
    expect(source).toContain("setNameError(t('recorder.nameRequired'))");
  });

  it('holds the same bound as the completion schema (title 1–120)', () => {
    expect(RECORDING_NAME_MAX).toBe(120);
  });

  it('marks the field required, with its own hint, when nothing is suggested', () => {
    // R172 §4 — the suggestion is the session's (carried across pages), with
    // the screen's own as the fallback.
    expect(source).toContain("required={effectiveSuggested.trim() === ''}");
    expect(source).toContain("'recorder.nameHintNoSuggestion'");
  });

  it('R172 §4 — leaving the screen never stops the recording: the view unmounts, the session does not', () => {
    // No microphone release and no stop on unmount: the component owns no
    // MediaRecorder at all.
    expect(source).not.toContain('new MediaRecorder(');
    expect(source).not.toContain('getUserMedia(');
    expect(source).not.toContain('releaseMicrophone');
    // A failed save keeps the audio (in the session, and in the browser's storage).
    expect(source).toContain('session.saveFailed()');
    // A saved (or discarded) recording clears both.
    expect(source).toContain('await session.clear();');
  });
});
