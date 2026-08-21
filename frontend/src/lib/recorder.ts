/**
 * **The recorder's rules, as pure functions** (Revision 75).
 *
 * They live outside the component for the reason `reorderable.ts` does: this
 * project's component tests render with `renderToStaticMarkup` — no jsdom, no
 * `MediaRecorder`, no `navigator.mediaDevices` — so a rule expressed only inside
 * a React handler is a rule no test can reach. Extracted here, each is directly
 * testable against the specification's wording.
 */

/**
 * R75.4's containers, in preference order.
 *
 * All three are already on TD-9's whitelist, which is the point: the recorder
 * produces an ordinary library item through the ordinary pipeline, so a
 * container the server would reject is a container this must not choose.
 *
 * Opus first because it is far smaller at speech bitrates; `audio/mp4` is
 * Safari's only answer and is what makes the feature exist on iOS at all.
 */
export const CONTAINERS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'] as const;

/** R75.4 — speech, mono, small. Stated in the SRS, so it is not a tuning knob. */
export const RECORDER_OPTIONS = { audioBitsPerSecond: 32000, channelCount: 1 } as const;

/**
 * The first container this browser will actually produce, or `null`.
 *
 * **`null` means the control is not offered and the reason is stated** (R75.4,
 * §14.4) — never a button that fails on press. The phone-upload path is the
 * fallback and it is already there.
 *
 * `isTypeSupported` is passed in rather than reached for, so the rule is
 * testable without a browser.
 */
export function pickContainer(
  isSupported: ((type: string) => boolean) | undefined,
): string | null {
  if (typeof isSupported !== 'function') return null;
  return CONTAINERS.find((type) => isSupported(type)) ?? null;
}

/**
 * The file extension for a chosen container.
 *
 * Derived from the MIME the browser agreed to, never from a guess: the server
 * verifies the declared type **and the magic bytes** (TD-9), so a name claiming
 * `.webm` over an mp4 body would be rejected at `complete` — after the upload.
 */
export function extensionFor(mimeType: string): string {
  const base = mimeType.split(';')[0] ?? '';
  if (base === 'audio/mp4') return 'mp4';
  if (base === 'audio/ogg') return 'ogg';
  return 'webm';
}

/**
 * **The recording's name is the SERVER's** (R75.6, moved by R99).
 *
 * `recordingBaseName` and `defaultRecordingName` used to live here. R99 gives
 * the platform a **second** producer of recordings — its own server-side
 * capture of an online class, ingested by a worker with no browser involved —
 * and the two must number into **one namespace**, or a مؤطِّرة's browser
 * recording and the platform's capture of the same lesson end up with the same
 * name. A rule one of its producers cannot reach is a rule implemented twice.
 *
 * The algorithm is now `backend/src/lib/recording-name.ts`, and both surfaces
 * receive a ready `suggested_recording_name` — the Session page for a class, the
 * library list for a shelf. **The visible convention is unchanged**: the first is
 * the bare base name, then ` 2`, ` 3`; it is still only a suggestion, still
 * editable before saving, and still nothing reads it back.
 */

/**
 * **How long has been recorded, from timestamps rather than from ticks.**
 *
 * A counter incremented once a second drifts — `setInterval` is throttled in a
 * background tab, which is precisely the situation R75.7 warns about — so a
 * reading taken that way understates a long recording by however much the
 * browser skipped. This sums the actual wall-clock spans instead: the closed
 * segments, plus the open one when recording is in progress.
 *
 * It remains **UI only** (R75.5). Some containers write a duration that ignores
 * paused time, so this is not the file's duration and nothing persists it;
 * `EducationalContent` has no such column and gains none.
 */
export interface RecordedSpan {
  start: number;
  end: number | null;
}

export function elapsedSeconds(spans: readonly RecordedSpan[], now: number): number {
  const total = spans.reduce((sum, span) => sum + ((span.end ?? now) - span.start), 0);
  return Math.max(0, total) / 1000;
}

/**
 * Elapsed time as `m:ss`, **for the interface only** (R75.5).
 *
 * Some containers record a duration that ignores paused time, so a computed
 * elapsed value is **not** the file's duration and must never be presented as
 * one — and none is written to `EducationalContent`, which §7 gives no such
 * column and gains none.
 */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Whether an active recording must warn before the page goes away (R75.7).
 *
 * The accepted residual risk is a **truncated recording on a locked iOS
 * screen** — iOS suspends `MediaRecorder` when the screen locks or the tab is
 * backgrounded, and it can truncate without reporting an error. A navigation
 * during recording would discard silently, which is the one part of that risk a
 * guard can actually remove.
 */
export function shouldGuardUnload(state: 'idle' | 'recording' | 'paused' | 'saving'): boolean {
  return state === 'recording' || state === 'paused';
}
