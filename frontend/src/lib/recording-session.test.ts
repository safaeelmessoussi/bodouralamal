import { describe, expect, it } from 'vitest';

import {
  CHUNK_MS,
  type PersistedSession,
  type Platform,
  type RecorderHandle,
  type RecordingStore,
  RecordingSession,
} from './recording-session.js';

/**
 * The lifecycle behind the recorder (SRS Revision 172 §4), driven with a fake
 * microphone and an in-memory store — exactly what the browser gives it,
 * minus the browser.
 */
function memoryStore(): RecordingStore & { session: PersistedSession | null; chunks: Blob[] } {
  const box = {
    session: null as PersistedSession | null,
    chunks: [] as Blob[],
    saveSession: async (session: PersistedSession) => {
      box.session = session;
    },
    appendChunk: async (chunk: Blob) => {
      box.chunks.push(chunk);
    },
    load: async () => (box.session ? { session: box.session, chunks: [...box.chunks] } : null),
    clear: async () => {
      box.session = null;
      box.chunks = [];
    },
  };
  return box;
}

function fakePlatform(options: { refuseMic?: boolean; wakeLock?: boolean } = {}) {
  let clock = 1_000_000;
  const store = memoryStore();
  const recorder: RecorderHandle & { calls: string[]; timeslice: number | null } = {
    calls: [],
    timeslice: null,
    start(timeslice) {
      this.calls.push('start');
      this.timeslice = timeslice;
    },
    pause() {
      this.calls.push('pause');
    },
    resume() {
      this.calls.push('resume');
    },
    stop() {
      this.calls.push('stop');
      // The browser hands the tail over, then says it stopped.
      this.ondataavailable?.(new Blob(['tail'], { type: 'audio/webm' }));
      this.onstop?.();
    },
    ondataavailable: null,
    onstop: null,
    onerror: null,
  };
  const gapListeners: (() => void)[] = [];
  const wake = { held: 0, released: 0 };
  const platform: Platform = {
    async openRecorder() {
      if (options.refuseMic) throw new Error('NotAllowedError');
      return {
        recorder,
        release: () => recorder.calls.push('release'),
        onCaptureGap: (listener) => gapListeners.push(listener),
      };
    },
    store,
    ...(options.wakeLock === false
      ? {}
      : {
          requestWakeLock: async () => {
            wake.held += 1;
            return () => {
              wake.released += 1;
            };
          },
        }),
    now: () => clock,
  };
  return {
    platform,
    store,
    recorder,
    wake,
    tick: (ms: number) => {
      clock += ms;
    },
    chunk: (text: string) => recorder.ondataavailable?.(new Blob([text], { type: 'audio/webm' })),
    gap: () => gapListeners.forEach((listener) => listener()),
  };
}

const origin = { key: 'library', sessionId: null, label: 'مكتبة المحتوى', path: '/content' };
const meta = { level_id: 'L', subject_id: 'S', academic_year_id: 'Y', branch_id: null };
const startInput = { origin, meta, suggestedName: 'تسجيل صوتي — 2026-09-23 10:00', saveBlockedReason: null, container: 'audio/webm' };

describe('RecordingSession — the recording outlives the screen', () => {
  it('starts with ten-second chunks, persists each one, and keeps the screen awake', async () => {
    const f = fakePlatform();
    const session = new RecordingSession(f.platform);
    await session.start(startInput);
    expect(session.getSnapshot().status).toBe('recording');
    expect(f.recorder.timeslice).toBe(CHUNK_MS);
    expect(f.wake.held).toBe(1);

    f.chunk('one');
    f.tick(10_000);
    f.chunk('two');
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot().chunks).toBe(2);
    expect(f.store.chunks.map((c) => c.size)).toEqual([3, 3]);
    expect(f.store.session?.status).toBe('recording');
    expect(f.store.session?.origin.key).toBe('library');
  });

  it('pause and resume are one file and an honest clock; stop releases the microphone and the screen', async () => {
    const f = fakePlatform();
    const session = new RecordingSession(f.platform);
    await session.start(startInput);
    f.tick(20_000);
    session.pause();
    expect(session.getSnapshot().status).toBe('paused');
    expect(f.wake.released).toBe(1);
    f.tick(60_000); // a minute of pause counts for nothing
    session.resume();
    expect(f.wake.held).toBe(2);
    await Promise.resolve(); // the lock is granted asynchronously
    f.tick(10_000);
    await session.stop();
    expect(session.getSnapshot().status).toBe('stopped');
    expect(session.elapsed()).toBe(30);
    expect(f.recorder.calls).toEqual(['start', 'pause', 'resume', 'stop', 'release']);
    expect(f.wake.released).toBe(2);
    // ONE blob from every chunk.
    const blob = session.blob();
    expect(blob?.size).toBe(4); // the tail the fake hands over on stop
    expect(f.store.session?.status).toBe('stopped');
  });

  it('a page hidden while recording is noted; capture suspended by the browser is a gap', async () => {
    const f = fakePlatform();
    const session = new RecordingSession(f.platform);
    await session.start(startInput);
    session.noteBackgrounded();
    expect(session.getSnapshot().backgrounded).toBe(true);
    expect(session.getSnapshot().captureGap).toBe(false);
    f.gap();
    expect(session.getSnapshot().captureGap).toBe(true);
  });

  it('a microphone refused leaves nothing started, and says so', async () => {
    const f = fakePlatform({ refuseMic: true });
    const session = new RecordingSession(f.platform);
    await session.start(startInput);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', error: 'mic_denied' });
    expect(session.active).toBe(false);
  });

  it('a second start while one is active is ignored (one recording at a time)', async () => {
    const f = fakePlatform();
    const session = new RecordingSession(f.platform);
    await session.start(startInput);
    await session.start({ ...startInput, origin: { ...origin, key: 'session:x' } });
    expect(session.getSnapshot().origin?.key).toBe('library');
    expect(f.recorder.calls.filter((c) => c === 'start')).toHaveLength(1);
  });

  it('the screen it is shown on may correct where it lands and what it is called — carried across pages', async () => {
    const f = fakePlatform();
    const session = new RecordingSession(f.platform);
    await session.start({ ...startInput, meta: null, saveBlockedReason: 'اختاري المستوى' });
    session.setMeta(meta, null);
    session.setTitle('درس الثلاثاء');
    await Promise.resolve();
    expect(session.getSnapshot()).toMatchObject({ meta, saveBlockedReason: null, title: 'درس الثلاثاء' });
    expect(f.store.session).toMatchObject({ meta, saveBlockedReason: null, title: 'درس الثلاثاء' });
  });

  it('a failed save keeps the audio; a successful one (or a discard) clears the page AND the storage', async () => {
    const f = fakePlatform();
    const session = new RecordingSession(f.platform);
    await session.start(startInput);
    f.chunk('a');
    await session.stop();
    session.saving(40);
    expect(session.getSnapshot()).toMatchObject({ status: 'saving', percent: 40 });
    session.saveFailed();
    expect(session.getSnapshot()).toMatchObject({ status: 'stopped', error: 'save_failed' });
    expect(session.blob()?.size).toBe(5);
    expect(f.store.chunks).toHaveLength(2);

    await session.clear();
    expect(session.getSnapshot().status).toBe('idle');
    expect(f.store.session).toBeNull();
    expect(f.store.chunks).toEqual([]);
  });

  it('a recording the page died on is found at the next start-up, offered as stopped, and its tail said to be missing', async () => {
    const f = fakePlatform();
    const first = new RecordingSession(f.platform);
    await first.start(startInput);
    f.tick(10_000);
    f.chunk('one');
    f.tick(10_000);
    f.chunk('two');
    await Promise.resolve();
    await Promise.resolve();
    // …the page dies here: no stop, no clear. A new page starts.
    f.tick(3_600_000);
    const second = new RecordingSession(f.platform);
    expect(await second.restore()).toBe(true);
    const state = second.getSnapshot();
    expect(state).toMatchObject({ status: 'stopped', restored: true, captureGap: true, chunks: 2 });
    expect(state.origin?.key).toBe('library');
    // The clock says what was recorded — up to the last chunk, not the hour since.
    expect(second.elapsed()).toBe(20);
    expect(second.blob()?.size).toBe(6);

    // Nothing pending: nothing found, nothing changed.
    await second.clear();
    const third = new RecordingSession(f.platform);
    expect(await third.restore()).toBe(false);
    expect(third.getSnapshot().status).toBe('idle');
  });

  it('a lock granted after the recording already stopped is let go at once', async () => {
    const f = fakePlatform();
    const session = new RecordingSession(f.platform);
    await session.start(startInput);
    session.pause();
    session.resume(); // asks for the lock…
    await session.stop(); // …and stops before it is granted
    await Promise.resolve();
    expect(f.wake.held).toBe(2);
    expect(f.wake.released).toBe(2);
  });

  it('a recorder without a Wake Lock still records', async () => {
    const f = fakePlatform({ wakeLock: false });
    const session = new RecordingSession(f.platform);
    await session.start(startInput);
    expect(session.getSnapshot().status).toBe('recording');
  });
});
