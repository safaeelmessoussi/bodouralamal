/**
 * **A مؤطِّرة edits her OWN المواد and الفئات** (Owner, 2026-08-30).
 *
 * R88.2 refused this and R106 took only the availability half; the Owner has
 * now taken this one. The page rendered the two declarations as **text** on
 * rule AF's reasoning — a value the server would refuse must not look editable
 * — so what needs proving in a browser is that they are now genuinely
 * operable by her, save, and come back saved.
 *
 * **And that they still grant nothing.** The whole reason this is safe is that
 * capability is not authorization: teaching authority is an assignment. So the
 * last check declares a Subject and then asks the server for something only an
 * assignment could open.
 *
 * Driven as a **genuine teacher** from the shared R82 scenario, never a widened
 * Admin token — the harness owns every row it touches.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9256');
const { check, finish } = results();
await send('Network.setCookie', {
  name: 'bodour_refresh', value: process.env.TEACHER_REFRESH_COOKIE, domain: 'localhost',
  path: '/api/v1/auth', httpOnly: true,
});
await send('Page.navigate', { url: `${BASE}/teacher/availability` });
await new Promise((r) => setTimeout(r, 5000));

const out = await evaluate(`(async () => {
  const legends = [...document.querySelectorAll('legend')].map(l => l.textContent.trim());
  const optionButtons = () => [...document.querySelectorAll('.multi-select__options button')];
  const before = optionButtons().map(b => b.textContent.replace('＋','').trim());
  if (before.length === 0) return { noOptions: true, legends,
    body: document.body.textContent.slice(0, 200) };

  // Pick the first offered Subject, then save the capabilities half.
  optionButtons()[0].click();
  await new Promise(r => setTimeout(r, 600));

  const saves = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'حفظ');
  const savedLabel = optionButtons().length !== before.length;
  if (saves.length === 0) return { noSave: true, legends };
  saves[0].click();
  await new Promise(r => setTimeout(r, 3000));

  // Feedback renders as .admin-notice[role=status] — and note: a backtick
  // anywhere inside this evaluated template, comments included, ends it.
  const notice = (document.querySelector('.admin-notice[role=status]')?.textContent ?? '').trim();
  return { legends, offered: before.length, notice, savedLabel };
})()`);

// **Reload through CDP, not `location.reload()` inside the page.** Reloading
// from within the evaluated promise destroys the execution context before it
// can resolve, and the call returns `undefined` — which reads exactly like the
// page having no controls at all.
await send('Page.navigate', { url: `${BASE}/teacher/availability` });
await new Promise((r) => setTimeout(r, 4500));
const reloaded = await evaluate(`(() => ({
  chosen: [...document.querySelectorAll('.multi-select__chosen li')]
    .map(x => x.textContent.trim()).filter(Boolean).slice(0, 6),
}))()`);

console.log(JSON.stringify({ ...out, ...reloaded }, null, 1).slice(0, 900));
check('the capabilities are OFFERED as controls, not printed as text',
  (out.offered ?? 0) > 0, JSON.stringify({ offered: out.offered, legends: out.legends }));
check('choosing one and saving is accepted', /تمّ|حُفظ|حفظ/.test(out.notice ?? ''), out.notice ?? '');
check('and the choice survives a reload', (reloaded.chosen ?? []).length > 0, JSON.stringify(reloaded.chosen));

/**
 * **And it grants nothing** — the reason this is safe.
 *
 * Asked of the rendered portal rather than of a second token: R101 rotates the
 * refresh cookie on every page load, and juggling spare sessions here only
 * tests the harness. The *server* side of this property is asserted directly in
 * `teaching-profile.http.integration.test.ts`, where declaring every Subject
 * still yields `403` on `/admin/users` and an empty `/quran-students`.
 *
 * What a browser adds is that her portal did not grow an administrative surface
 * the moment she declared a Subject.
 */
const reach = await evaluate(`(() => ({
  nav: [...document.querySelectorAll('nav a')].map(a => a.getAttribute('href')).filter(Boolean),
}))()`);
const adminLinks = (reach.nav ?? []).filter((h) => h.startsWith('/admin') || h.startsWith('/superadmin'));
console.log(JSON.stringify({ nav: reach.nav }));
check(
  'declaring a Subject opens no administrative surface in her portal',
  adminLinks.length === 0,
  JSON.stringify(adminLinks),
);

close();
process.exit(finish());
