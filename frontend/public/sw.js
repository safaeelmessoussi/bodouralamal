/*
 * بذور الأمل — the installed app's service worker (SRS Revision 167 §4).
 *
 * IT CACHES NOTHING, ON PURPOSE. It exists so that browsers which still ask
 * for a service worker before offering «تثبيت» (Samsung Internet, older
 * Chrome on Android) will offer it. Every request goes to the network exactly
 * as it does in a browser tab: Nginx already revalidates the shell on every
 * load and serves content-hashed assets as immutable, the API is never
 * cacheable (tiers, consent and child context are decided per request), and a
 * private recording must never be readable from a device cache after its
 * permission is gone.
 *
 * Offline therefore shows the browser's own offline page — honest, and the
 * same as the website. An offline mode is a separate decision with privacy
 * consequences, not a side effect of being installable.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Nothing of ours is ever stored; remove anything an earlier worker kept.
      for (const key of await caches.keys()) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Deliberately answers nothing: the browser handles every request itself.
self.addEventListener('fetch', () => {});
