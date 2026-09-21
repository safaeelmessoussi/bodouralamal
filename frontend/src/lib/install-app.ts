/**
 * **«تثبيت التطبيق» — what this device can do, decided in one place** (SRS
 * Revision 167 §4).
 *
 * There is no one way to install a web app, and the button must not pretend
 * there is:
 *
 * - **Chrome, Edge, Samsung Internet, Opera (Android and desktop)** announce
 *   `beforeinstallprompt`. The page keeps the event and the button calls its
 *   `prompt()` — the browser's own install sheet, one tap.
 * - **iPhone and iPad** have no such event in ANY browser: every iOS browser is
 *   Safari underneath, and only «مشاركة ← إضافة إلى الشاشة الرئيسية» installs.
 *   The button opens those steps, with the icons she will actually see.
 * - **Other mobile browsers** (Firefox on Android) install from their own menu;
 *   the button says where.
 * - **Already installed** (running standalone): there is nothing to offer, so
 *   nothing is shown.
 * - **A desktop browser that announced nothing**: not shown either — the Owner
 *   asked for phones, and a button that can only say «not here» is noise.
 *
 * Pure, so it is tested without a browser.
 */
export type InstallOffer = 'prompt' | 'ios' | 'manual' | 'none';

export interface InstallFacts {
  /** `beforeinstallprompt` has fired and its event is held. */
  promptAvailable: boolean;
  /** `display-mode: standalone`, or iOS's `navigator.standalone`. */
  standalone: boolean;
  userAgent: string;
  /** iPadOS reports itself as a Mac; touch points are what tell them apart. */
  maxTouchPoints: number;
}

export function isIos(facts: Pick<InstallFacts, 'userAgent' | 'maxTouchPoints'>): boolean {
  return (
    /iPhone|iPad|iPod/.test(facts.userAgent) ||
    (/Macintosh/.test(facts.userAgent) && facts.maxTouchPoints > 1)
  );
}

export function installOffer(facts: InstallFacts): InstallOffer {
  if (facts.standalone) return 'none';
  if (facts.promptAvailable) return 'prompt';
  if (isIos(facts)) return 'ios';
  if (/Android|Mobile/.test(facts.userAgent)) return 'manual';
  return 'none';
}

/** The part of `BeforeInstallPromptEvent` this uses; TypeScript's DOM library
 *  does not declare it. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Registers the service worker. Failure is silent by design: the platform is a
 * website first, and a browser that refuses a worker (private mode, an old
 * WebView) must lose nothing but the install offer.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
