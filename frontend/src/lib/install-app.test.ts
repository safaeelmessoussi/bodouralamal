import { describe, expect, it } from 'vitest';

import { installOffer, isIos } from './install-app.js';
import manifest from '../../public/manifest.json';
import worker from '../../public/sw.js?raw';
import indexHtml from '../../index.html?raw';

/**
 * SRS Revision 167 §4 — «تثبيت التطبيق». What the button does is a decision
 * about the DEVICE, and the wrong one is a button that does nothing.
 */
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

const facts = (over: Partial<Parameters<typeof installOffer>[0]>) => ({
  promptAvailable: false,
  standalone: false,
  userAgent: ANDROID_CHROME,
  maxTouchPoints: 5,
  ...over,
});

describe('what «تثبيت التطبيق» offers', () => {
  it('the browser’s own install sheet wherever the browser announced one — phone or desktop', () => {
    expect(installOffer(facts({ promptAvailable: true }))).toBe('prompt');
    expect(installOffer(facts({ promptAvailable: true, userAgent: DESKTOP_FIREFOX, maxTouchPoints: 0 }))).toBe('prompt');
  });

  it('the Share-sheet steps on iPhone and iPad — including an iPad calling itself a Mac', () => {
    expect(installOffer(facts({ userAgent: IPHONE }))).toBe('ios');
    expect(installOffer(facts({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }))).toBe('ios');
    expect(isIos({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(false);
  });

  it('the browser-menu steps on any other phone, and before Chrome has announced anything', () => {
    expect(installOffer(facts({ userAgent: ANDROID_FIREFOX }))).toBe('manual');
    expect(installOffer(facts({}))).toBe('manual');
  });

  it('nothing once installed, and nothing on a desktop that cannot install', () => {
    expect(installOffer(facts({ standalone: true, promptAvailable: true }))).toBe('none');
    expect(installOffer(facts({ standalone: true, userAgent: IPHONE }))).toBe('none');
    expect(installOffer(facts({ userAgent: DESKTOP_FIREFOX, maxTouchPoints: 0 }))).toBe('none');
  });
});

describe('what makes the platform installable', () => {
  it('a manifest a browser accepts: standalone, RTL Arabic, a 192 and a 512 icon and a maskable one', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.dir).toBe('rtl');
    expect(manifest.lang).toBe('ar');
    expect(manifest.start_url).toBe('/');
    const sizes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.json" />');
    expect(indexHtml).toContain('apple-touch-icon');
  });

  it('a service worker that CACHES NOTHING — a private recording must never outlive its permission on a device', () => {
    expect(worker).toContain("addEventListener('fetch'");
    expect(worker).not.toContain('respondWith');
    expect(worker).not.toContain('caches.open');
    expect(worker).not.toMatch(/cache\.(put|add|addAll)/);
  });
});
