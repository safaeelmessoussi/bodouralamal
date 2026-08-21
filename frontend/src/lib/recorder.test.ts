import { describe, expect, it } from 'vitest';

import {
  CONTAINERS,
  elapsedSeconds,
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

/**
 * **R75.6's naming assertions moved with the rule** to
 * `backend/src/lib/recording-name.test.ts` (R99). They are not restated here:
 * a copy of an assertion left behind on the side that no longer implements the
 * rule is the copy that passes while the rule drifts.
 *
 * What this file still guards is what the browser still decides — the
 * container, the elapsed clock, the unload guard and the copy.
 */

describe('R75.5 — elapsed time is measured, not counted', () => {
  it('sums the closed spans and the open one', () => {
    // Recorded 0–10s, paused, resumed at 20s and still running at 25s.
    expect(elapsedSeconds([{ start: 0, end: 10_000 }, { start: 20_000, end: null }], 25_000)).toBe(15);
  });

  it('excludes paused time entirely', () => {
    // The whole point of spans: a ten-minute pause adds nothing.
    expect(elapsedSeconds([{ start: 0, end: 5_000 }], 605_000)).toBe(5);
  });

  it('does not drift when the tab is throttled', () => {
    // A per-second counter loses every tick the browser skips — exactly the
    // background-tab case R75.7 warns about. A timestamp span cannot.
    expect(elapsedSeconds([{ start: 0, end: null }], 3_600_000)).toBe(3600);
  });

  it('is zero before anything is recorded', () => {
    expect(elapsedSeconds([], 1_000)).toBe(0);
  });
});
