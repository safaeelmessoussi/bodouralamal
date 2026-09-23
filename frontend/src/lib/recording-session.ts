import type { UploadMeta } from '../adapters/uploads.js';
import { type RecordedSpan, elapsedSeconds } from './recorder.js';

/**
 * **One recording, owned by the application rather than by a screen** (SRS
 * Revision 172 §4).
 *
 * Until Revision 172 the `MediaRecorder` lived inside the recorder component:
 * leaving the page unmounted it, which released the microphone and lost the
 * audio; a phone whose screen went dark, or a tab the browser put to sleep,
 * lost it the same way, and the only guard was a warning. The Owner records
 * mostly on a phone and asked for the opposite: **the screen may go dark and
 * she may leave the page, and the recording goes on.**
 *
 * So the recording is a module-level session, and three things follow:
 *
 *  1. **It survives navigation.** Any screen's recorder binds to it; a global
 *     bar (`RecordingBar`) shows it wherever she is, with the same controls.
 *  2. **It survives a dead page.** Every ten seconds the recorder hands over
 *     what it captured (`timeslice`) and the chunk is written to the
 *     browser's own storage (IndexedDB, per origin, never leaving the phone).
 *     A reload, a crash or a closed tab leaves the audio where the next visit
 *     finds it and offers to save it.
 *  3. **The screen is kept awake while recording** (the Wake Lock API) so a
 *     phone does not lock itself mid-class; if she locks it herself, capture
 *     continues wherever the browser allows it (Android Chrome does; iOS
 *     Safari suspends and says nothing — the guard for that is the capture-gap
 *     notice, raised from the track's own `mute` event).
 *
 * The browser is behind `Platform` so the whole lifecycle is unit-testable
 * without a DOM: tests hand in a fake recorder and an in-memory store.
 */
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped' | 'saving';

/** Where the recording was started — which screen it belongs to. */
export interface RecordingOrigin {
  /** `library` or `session:<id>`; a host binds only to its own key. */
  key: string;
  /** The occurrence to link the saved item to, when it was started from one. */
  sessionId: string | null;
  /** What the bar calls it («حصة الثلاثاء 17:00», «مكتبة المحتوى»). */
  label: string;
  /** Where «العودة» goes. */
  path: string;
}

export interface RecordingSessionState {
  status: RecordingStatus;
  origin: RecordingOrigin | null;
  meta: UploadMeta | null;
  /** The server's suggestion (R75.6), carried so the bar can save without the page. */
  suggestedName: string;
  /** What she typed, kept across pages. */
  title: string;
  /** Why the host could not save (an incomplete scope) — carried for the bar. */
  saveBlockedReason: string | null;
  container: string | null;
  spans: RecordedSpan[];
  chunks: number;
  bytes: number;
  /** The page was hidden while recording (R75.7's warning). */
  backgrounded: boolean;
  /** The browser suspended capture while recording — a gap is likely. */
  captureGap: boolean;
  /** Found in the browser's storage after a reload; the page that started it died. */
  restored: boolean;
  /** Save progress, 0–100, while `saving`. */
  percent: number;
  error: 'mic_denied' | 'save_failed' | null;
}

export interface PersistedSession {
  origin: RecordingOrigin;
  meta: UploadMeta | null;
  suggestedName: string;
  title: string;
  saveBlockedReason: string | null;
  container: string;
  spans: RecordedSpan[];
  /** When the last chunk arrived — where a dead page's open span is closed. */
  lastChunkAt: number | null;
  /** What the recorder was doing when the page last wrote: a session found
   *  `recording` after a reload was cut off by the page's death. */
  status: 'recording' | 'paused' | 'stopped';
}

/** The browser's own storage for the audio, per origin (IndexedDB in production). */
export interface RecordingStore {
  saveSession(session: PersistedSession): Promise<void>;
  appendChunk(chunk: Blob): Promise<void>;
  load(): Promise<{ session: PersistedSession; chunks: Blob[] } | null>;
  clear(): Promise<void>;
}

/** The slice of `MediaRecorder` the session drives. */
export interface RecorderHandle {
  start(timesliceMs: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  ondataavailable: ((chunk: Blob) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface Platform {
  /** Asks for the microphone and builds a recorder on it; rejects when refused. */
  openRecorder(container: string): Promise<{
    recorder: RecorderHandle;
    /** Stops the microphone. */
    release(): void;
    /** Subscribes to capture being suspended/resumed by the browser. */
    onCaptureGap(listener: () => void): void;
  }>;
  store: RecordingStore;
  /** Keeps the screen on; resolves to a release. Absent where unsupported. */
  requestWakeLock?: () => Promise<() => void>;
  now(): number;
}

/** Ten seconds: what a crash may cost, and the same figure the platform's own
 *  recorder uses for its safety segments (R168 §2). */
export const CHUNK_MS = 10_000;

const IDLE: RecordingSessionState = {
  status: 'idle',
  origin: null,
  meta: null,
  suggestedName: '',
  title: '',
  saveBlockedReason: null,
  container: null,
  spans: [],
  chunks: 0,
  bytes: 0,
  backgrounded: false,
  captureGap: false,
  restored: false,
  percent: 0,
  error: null,
};

type Listener = () => void;

export class RecordingSession {
  private state: RecordingSessionState = IDLE;
  private readonly listeners = new Set<Listener>();
  private chunks: Blob[] = [];
  private recorder: RecorderHandle | null = null;
  private release: (() => void) | null = null;
  private releaseWakeLock: (() => void) | null = null;
  private stopped: Promise<void> | null = null;
  private lastChunkAt: number | null = null;
  /** Between the press and the microphone's answer: a second press waits. */
  private starting = false;

  constructor(private readonly platform: Platform) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RecordingSessionState => this.state;

  private set(patch: Partial<RecordingSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Seconds actually recorded, pauses excluded (R75.5 — a reading, never stored). */
  elapsed(now = this.platform.now()): number {
    return elapsedSeconds(this.state.spans, now);
  }

  get active(): boolean {
    return this.state.status !== 'idle';
  }

  async start(input: {
    origin: RecordingOrigin;
    meta: UploadMeta | null;
    suggestedName: string;
    saveBlockedReason: string | null;
    container: string;
  }): Promise<void> {
    if (this.active || this.starting) return;
    this.starting = true;
    this.set({ ...IDLE, ...input, error: null });
    let opened: Awaited<ReturnType<Platform['openRecorder']>>;
    try {
      opened = await this.platform.openRecorder(input.container);
    } catch {
      // Permission refused, or no microphone — the person's to fix.
      this.set({ ...IDLE, error: 'mic_denied' });
      this.starting = false;
      return;
    }
    this.starting = false;
    this.chunks = [];
    this.lastChunkAt = null;
    this.recorder = opened.recorder;
    this.release = opened.release;
    opened.onCaptureGap(() => {
      if (this.state.status === 'recording') this.set({ captureGap: true });
    });
    opened.recorder.ondataavailable = (chunk) => {
      if (chunk.size === 0) return;
      this.chunks.push(chunk);
      this.lastChunkAt = this.platform.now();
      this.set({ chunks: this.chunks.length, bytes: this.state.bytes + chunk.size });
      void this.platform.store
        .appendChunk(chunk)
        .then(() => this.persist())
        .catch(() => undefined);
    };
    opened.recorder.onerror = () => {
      // The browser gave up (a device lost mid-class): what was captured is
      // kept and offered exactly as a stop would.
      this.finish();
    };
    const started = this.platform.now();
    this.set({ status: 'recording', spans: [{ start: started, end: null }] });
    opened.recorder.start(CHUNK_MS);
    await this.persist();
    await this.keepAwake();
  }

  pause(): void {
    if (this.state.status !== 'recording') return;
    this.recorder?.pause();
    this.set({ status: 'paused', spans: closeSpan(this.state.spans, this.platform.now()) });
    this.letSleep();
    void this.persist();
  }

  resume(): void {
    if (this.state.status !== 'paused') return;
    this.recorder?.resume();
    // A NEW span: the gap between them is the pause, and excluding it is what
    // makes the reading honest.
    this.set({
      status: 'recording',
      spans: [...this.state.spans, { start: this.platform.now(), end: null }],
    });
    void this.keepAwake();
    void this.persist();
  }

  /** Ends the capture; resolves once the last chunk has been handed over. */
  stop(): Promise<void> {
    if (this.state.status !== 'recording' && this.state.status !== 'paused') {
      return Promise.resolve();
    }
    this.stopped ??= new Promise<void>((resolve) => {
      const recorder = this.recorder;
      if (recorder === null) {
        this.finish();
        resolve();
        return;
      }
      recorder.onstop = () => {
        this.finish();
        resolve();
      };
      recorder.stop();
    });
    return this.stopped;
  }

  private finish(): void {
    this.recorder = null;
    this.release?.();
    this.release = null;
    this.letSleep();
    this.stopped = null;
    this.set({ status: 'stopped', spans: closeSpan(this.state.spans, this.platform.now()) });
    void this.persist();
  }

  /** ONE blob from every chunk — pause/resume never produces several files. */
  blob(): Blob | null {
    if (this.state.status !== 'stopped' && this.state.status !== 'saving') return null;
    return new Blob(this.chunks, { type: this.state.container ?? '' });
  }

  /** The screen it is shown on may correct where it lands and what it is called. */
  setMeta(meta: UploadMeta | null, saveBlockedReason: string | null): void {
    if (!this.active) return;
    this.set({ meta, saveBlockedReason });
    void this.persist();
  }

  setSuggestedName(suggestedName: string): void {
    if (!this.active || suggestedName === this.state.suggestedName) return;
    this.set({ suggestedName });
    void this.persist();
  }

  setTitle(title: string): void {
    if (!this.active) return;
    this.set({ title, error: null });
    void this.persist();
  }

  /** The page was hidden while recording — R75.7's warning, carried. */
  noteBackgrounded(): void {
    if (this.state.status === 'recording' || this.state.status === 'paused') {
      this.set({ backgrounded: true });
    }
  }

  /** A page that returns to view re-takes the screen lock the browser dropped. */
  noteVisible(): void {
    if (this.state.status === 'recording') void this.keepAwake();
  }

  saving(percent: number): void {
    if (this.state.status !== 'stopped' && this.state.status !== 'saving') return;
    this.set({ status: 'saving', percent, error: null });
  }

  /** The upload failed: the audio is KEPT, on the page and in storage. */
  saveFailed(): void {
    if (this.state.status !== 'saving') return;
    this.set({ status: 'stopped', percent: 0, error: 'save_failed' });
  }

  /** Saved, or deliberately discarded: nothing remains, anywhere. */
  async clear(): Promise<void> {
    this.recorder = null;
    this.release?.();
    this.release = null;
    this.letSleep();
    this.stopped = null;
    this.chunks = [];
    this.lastChunkAt = null;
    this.set(IDLE);
    await this.platform.store.clear().catch(() => undefined);
  }

  /**
   * What the browser's storage holds from a page that died. Called once at
   * start-up; a recording found there is offered as `stopped` — its page is
   * gone, so it cannot be resumed, only saved or discarded.
   */
  async restore(): Promise<boolean> {
    if (this.active) return false;
    const found = await this.platform.store.load().catch(() => null);
    if (found === null || found.chunks.length === 0) {
      if (found !== null) await this.platform.store.clear().catch(() => undefined);
      return false;
    }
    this.chunks = found.chunks;
    const { session } = found;
    this.set({
      ...IDLE,
      status: 'stopped',
      origin: session.origin,
      meta: session.meta,
      suggestedName: session.suggestedName,
      title: session.title,
      saveBlockedReason: session.saveBlockedReason,
      container: session.container,
      spans: closeSpan(session.spans, session.lastChunkAt ?? lastMoment(session.spans)),
      chunks: found.chunks.length,
      bytes: found.chunks.reduce((sum, chunk) => sum + chunk.size, 0),
      restored: true,
      // Found still `recording`: the page died mid-capture, so the tail is missing.
      captureGap: session.status === 'recording',
    });
    return true;
  }

  private async persist(): Promise<void> {
    const { origin, container, status } = this.state;
    if (origin === null || container === null) return;
    if (status !== 'recording' && status !== 'paused' && status !== 'stopped') return;
    await this.platform.store
      .saveSession({
        origin,
        meta: this.state.meta,
        suggestedName: this.state.suggestedName,
        title: this.state.title,
        saveBlockedReason: this.state.saveBlockedReason,
        container,
        spans: this.state.spans,
        lastChunkAt: this.lastChunkAt,
        status,
      })
      .catch(() => undefined);
  }

  private async keepAwake(): Promise<void> {
    if (this.releaseWakeLock !== null || this.platform.requestWakeLock === undefined) return;
    try {
      const release = await this.platform.requestWakeLock();
      // Granted after the recording already paused or stopped (the grant is
      // asynchronous): let go at once rather than hold the screen for nothing.
      if (this.state.status !== 'recording' || this.releaseWakeLock !== null) release();
      else this.releaseWakeLock = release;
    } catch {
      // Not granted (a hidden page, an unsupported browser): the recording
      // goes on; only the screen's own timeout is left to the phone.
    }
  }

  private letSleep(): void {
    this.releaseWakeLock?.();
    this.releaseWakeLock = null;
  }
}

function closeSpan(spans: readonly RecordedSpan[], at: number): RecordedSpan[] {
  return spans.map((span) => (span.end === null ? { ...span, end: at } : span));
}

/** The best guess at when a dead page last recorded: its latest span edge. */
function lastMoment(spans: readonly RecordedSpan[]): number {
  return spans.reduce((latest, span) => Math.max(latest, span.end ?? span.start), 0);
}
