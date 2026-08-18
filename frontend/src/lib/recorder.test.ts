import { describe, expect, it } from 'vitest';

import {
  CONTAINERS,
  defaultRecordingName,
  extensionFor,
  formatElapsed,
  pickContainer,
  RECORDER_OPTIONS,
  shouldGuardUnload,
} from './recorder.js';

describe('R75.4 — the container is feature-detected, never assumed', () => {
  it('takes the first supported container in preference order', () => {
    expect(pickContainer(() => true)).toBe('audio/webm;codecs=opus');
    // Safari: mp4 only, which is what makes the feature exist on iOS at all.
    expect(pickContainer((type) => type === 'audio/mp4')).toBe('audio/mp4');
  });

  it('answers null when nothing is supported, and when MediaRecorder is absent', () => {
    // R75.4/§14.4 — the control is then NOT OFFERED and the reason is stated.
    // A button that fails on press would be the wrong answer.
    expect(pickContainer(() => false)).toBeNull();
    expect(pickContainer(undefined)).toBeNull();
  });

  it('offers only containers TD-9 already whitelists', () => {
    // The recorder produces an ordinary library item through the ordinary
    // pipeline, so a container the server would reject must never be chosen.
    const whitelisted = ['audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const type of CONTAINERS) {
      expect(whitelisted, type).toContain(type.split(';')[0]);
    }
  });

  it('pins the SRS-stated encoding, which is not a tuning knob', () => {
    expect(RECORDER_OPTIONS.audioBitsPerSecond).toBe(32000);
    expect(RECORDER_OPTIONS.channelCount).toBe(1);
  });

  it('derives the extension from the MIME the browser agreed to', () => {
    // The server verifies the declared type AND the magic bytes (TD-9), so a
    // name claiming `.webm` over an mp4 body is rejected at `complete` — after
    // the whole upload has been spent.
    expect(extensionFor('audio/mp4')).toBe('mp4');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
  });
});

describe('R75.6 — the default name, and its ` 2` / ` 3` suffix', () => {
  it('leaves the FIRST recording unnumbered', () => {
    expect(defaultRecordingName('تفسير — 2026-08-24', [])).toBe('تفسير — 2026-08-24');
  });

  it('numbers from 2, because the unnumbered one is the first', () => {
    const base = 'تفسير — 2026-08-24';
    expect(defaultRecordingName(base, [base])).toBe(`${base} 2`);
    expect(defaultRecordingName(base, [base, `${base} 2`])).toBe(`${base} 3`);
  });

  it('chooses from what is ALREADY LINKED, so concurrent saves cannot collide', () => {
    // The suffix is computed against the session's existing recordings rather
    // than a local counter — two people saving at once would otherwise both
    // pick the same name.
    const base = 'حصة';
    expect(defaultRecordingName(base, [base, `${base} 3`])).toBe(`${base} 2`);
  });

  it('ignores surrounding whitespace on both sides of the comparison', () => {
    expect(defaultRecordingName('  حصة  ', ['حصة'])).toBe('حصة 2');
  });

  it('falls back to a word rather than producing an empty title', () => {
    expect(defaultRecordingName('   ', [])).not.toBe('');
  });
});

describe('R75.5 — elapsed time is UI only', () => {
  it('formats as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9)).toBe('0:09');
    expect(formatElapsed(75)).toBe('1:15');
    expect(formatElapsed(3600)).toBe('60:00');
  });

  it('never renders a negative or fractional reading', () => {
    expect(formatElapsed(-5)).toBe('0:00');
    expect(formatElapsed(1.9)).toBe('0:01');
  });
});

describe('R75.7 — an active recording is guarded against navigation', () => {
  it('guards while recording and while paused, not otherwise', () => {
    // A paused recording is still an unsaved one: `pause()`/`resume()` produce
    // ONE file, so navigating away discards the whole thing.
    expect(shouldGuardUnload('recording')).toBe(true);
    expect(shouldGuardUnload('paused')).toBe(true);
    expect(shouldGuardUnload('idle')).toBe(false);
    // Saving is already in the upload pipeline's hands.
    expect(shouldGuardUnload('saving')).toBe(false);
  });
});

describe('R75 — the copy keeps the phone-upload path visible', () => {
  it('names it in every message where the recorder is unavailable', async () => {
    const { t } = await import('../i18n/index.js');
    // R75.4/R75.7 make the phone path the stated remedy, not a consolation: a
    // person told only *this does not work* has been told nothing they can act
    // on, and the association's teachers have been recording on phones all along.
    expect(t('recorder.unsupported')).toContain('هاتف');
    expect(t('recorder.micDenied')).toContain('هاتف');
  });

  it('says a failed save KEEPS the recording', async () => {
    const { t } = await import('../i18n/index.js');
    // There is no resume (Risk R-9), so a retry re-uploads — but discarding the
    // blob would make one network failure cost the class.
    expect(t('recorder.saveFailed')).toContain('ما يزال');
  });

  it('resolves every key the component asks for', async () => {
    const { t } = await import('../i18n/index.js');
    for (const key of [
      'recorder.title',
      'recorder.start',
      'recorder.pause',
      'recorder.resume',
      'recorder.stop',
      'recorder.save',
      'recorder.discard',
      'recorder.name',
      'recorder.nameHint',
      'recorder.keepAwake',
      'recorder.wasBackgrounded',
      'recorder.state.idle',
      'recorder.state.recording',
      'recorder.state.paused',
      'recorder.state.saving',
    ]) {
      expect(t(key), key).not.toEqual(key);
    }
  });
});
