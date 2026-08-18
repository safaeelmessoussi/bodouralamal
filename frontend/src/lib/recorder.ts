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
 * **The default name for a recording** (R75.6).
 *
 * The first carries no number; the second and subsequent are suffixed ` 2`,
 * ` 3`, … — and the suffix is chosen from the recordings **already linked to
 * that session**, so two people saving at once cannot both land on the same
 * name.
 *
 * It is a **default and never an invariant**: nothing reads it back, and it is
 * edited through the ordinary content-edit flow. That is why this returns a
 * string rather than enforcing anything.
 */
export function defaultRecordingName(base: string, existingTitles: readonly string[]): string {
  const trimmed = base.trim() === '' ? 'تسجيل' : base.trim();
  const taken = new Set(existingTitles.map((title) => title.trim()));
  if (!taken.has(trimmed)) return trimmed;
  // Starts at 2, because the unnumbered one IS the first. Bounded rather than
  // unbounded: a session with a thousand recordings is a different problem.
  for (let n = 2; n <= 999; n += 1) {
    const candidate = `${trimmed} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${trimmed} ${Date.now()}`;
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
