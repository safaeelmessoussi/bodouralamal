/**
 * **NEW P — the legal pages, and the link Google actually requires.**
 *
 * Google's OAuth policy (verified against Google's own documentation,
 * 2026-08-28) requires the privacy policy to be *hosted within the domain that
 * hosts your homepage* and *linked on your homepage so that users can find this
 * information easily*. Both halves are page-level facts: a route test proves the
 * path resolves, and only a browser proves the homepage carries the link and
 * that an anonymous visitor reaches the page.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9228');
const { check, finish } = results();

const goto = async (path) => {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 80; i += 1) {
    const ok = await evaluate(`document.readyState === 'complete' && !!document.querySelector('h1')`)
      .catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 400));
};

/* ── 1. The homepage links to both, ANONYMOUSLY ─────────────────────────── */
await goto('/');
const links = await evaluate(`(() => {
  const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  return { privacy: hrefs.includes('/privacy'), terms: hrefs.includes('/terms') };
})()`);
check(
  '1 · the homepage links to the privacy policy — Google requires exactly this',
  links.privacy === true,
  JSON.stringify(links),
);
check('2 · and to the terms of service', links.terms === true, JSON.stringify(links));

/* ── 2. Each page opens for a signed-OUT visitor ────────────────────────── */
for (const [path, key] of [['/privacy', 'privacy'], ['/terms', 'terms']]) {
  await goto(path);
  const page = await evaluate(`(() => ({
    heading: (document.querySelector('h1')?.textContent ?? '').trim(),
    // The visible marker for anything the association must still supply.
    markers: (document.body.textContent.match(/⚠/g) ?? []).length,
    // A translation key rendering raw would mean a missing string (rule X).
    leakedKey: document.body.textContent.includes('legal.'),
    redirected: document.location.pathname,
  }))()`);
  check(
    `3 · ${path} opens for a signed-out visitor and is not redirected`,
    page.heading.length > 0 && page.redirected.startsWith(path),
    JSON.stringify(page),
  );
  check(
    `4 · ${path} leaks no translation key`,
    page.leakedKey === false,
    JSON.stringify({ leakedKey: page.leakedKey }),
  );
  check(
    `5 · ${path} shows its OWNER-INPUT markers rather than invented text`,
    page.markers > 0,
    `${page.markers} markers`,
  );
  void key;
}

await close();
process.exit(finish());
