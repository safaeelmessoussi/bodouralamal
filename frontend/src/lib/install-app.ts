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
 *   the button says where. **R245 — a Chromium browser without its offer yet
 *   shows no button** (it appears with the offer, one click from installing).
 * - **Already installed** (running standalone): there is nothing to offer, so
 *   nothing is shown. **Installed, but opened in the browser** (R244 — Chrome
 *   then sends no offer, and its menu reads «فتح التطبيق»): the button says it
 *   is installed and where its icon is (`getInstalledRelatedApps`).
 * - **A desktop browser that announced nothing**: not shown either — the Owner
 *   asked for phones, and a button that can only say «not here» is noise.
 *
 * Pure, so it is tested without a browser.
 */
export type InstallOffer = 'prompt' | 'installed' | 'ios' | 'manual' | 'none';

export interface InstallFacts {
  /** `beforeinstallprompt` has fired and its event is held. */
  promptAvailable: boolean;
  /** `display-mode: standalone`, or iOS's `navigator.standalone`. */
  standalone: boolean;
  /** R244 — the browser reports this app installed on the device (it is open in a tab). */
  installed?: boolean;
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

/** The engines that announce `beforeinstallprompt` (Chrome, Samsung Internet, Edge, Opera). */
export function isChromium(userAgent: string): boolean {
  return /Chrome\/|SamsungBrowser|EdgA\/|OPR\//.test(userAgent) && !/Firefox/.test(userAgent);
}

export function installOffer(facts: InstallFacts): InstallOffer {
  if (facts.standalone) return 'none';
  if (facts.promptAvailable) return 'prompt';
  if (facts.installed) return 'installed';
  if (isIos(facts)) return 'ios';
  // R245 — a browser that installs in one click (Chrome, Samsung Internet,
  // Edge, Opera) shows the button only once it has made its offer: one click
  // then opens its own install sheet, and nowhere does it send the reader to
  // a menu. Only a phone browser that never offers (Firefox) gets the steps.
  if (isChromium(facts.userAgent)) return 'none';
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
  const register = (): void => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  };
  // R244 — since R209 the application starts after the language has loaded,
  // usually after `load` has fired: waiting for it registered nothing, and the
  // browsers that want a worker before offering «تثبيت» never offered it.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/**
 * R244 — whether this app is installed on the device although it is open in a
 * tab. Chrome on Android answers through `getInstalledRelatedApps` (the
 * manifest names the app itself, `platform: webapp`); a browser that cannot
 * answer says «no».
 */
export async function isInstalledHere(): Promise<boolean> {
  const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
  if (typeof nav.getInstalledRelatedApps !== 'function') return false;
  try {
    return (await nav.getInstalledRelatedApps()).length > 0;
  } catch {
    return false;
  }
}
