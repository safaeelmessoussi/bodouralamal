import type { InstallPromptEvent } from './install-app.js';

/**
 * **The browser's install offer, caught on the first tick** (SRS Revision
 * 167 §4; R209 follow-up). Chrome fires `beforeinstallprompt` once, early —
 * and since R209 the application loads only after the page's language is
 * settled, so a listener in a screen module could be registered after the
 * event had already gone, and «تثبيت التطبيق» never appeared. `main.tsx`
 * imports this first; the button reads the held event from here.
 */
let held: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this Chrome shows its own mini-infobar, once, at a moment of its
    // choosing; the Owner asked for a button she can find.
    event.preventDefault();
    held = event as InstallPromptEvent;
    listeners.forEach((notify) => notify());
  });
  window.addEventListener('appinstalled', () => {
    held = null;
    listeners.forEach((notify) => notify());
  });
}

export function heldInstallPrompt(): InstallPromptEvent | null {
  return held;
}

/** The prompt is spent once shown; the button re-reads the offer after the
 *  reader has answered the browser (`announceInstallOfferChange`). */
export function releaseInstallPrompt(): void {
  held = null;
}

export function announceInstallOfferChange(): void {
  listeners.forEach((notify) => notify());
}

export function onInstallOfferChange(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}
