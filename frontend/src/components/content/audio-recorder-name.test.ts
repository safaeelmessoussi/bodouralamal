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
    expect(source).toContain("required={suggestedName.trim() === ''}");
    expect(source).toContain("'recorder.nameHintNoSuggestion'");
  });
});
