/**
 * **NEW D — a مؤطِّرة's مكتبة المحتوى filters, on the real page.**
 *
 * The Owner's report was three `403`s and a filter row she could not use. The
 * fix is in the shared hook, so the only honest proof is the page itself under
 * a **genuine Teacher session** — never a widened Admin token.
 *
 * Two halves, and the second is the one that matters:
 *
 * 1. **No lookup refusal.** Every request the page issues is recorded, and any
 *    `403` on a reference read fails this harness.
 * 2. **The filters actually filter.** Choosing a Level must narrow the Subject
 *    options to that Level's, and must change what the library *returns* — not
 *    merely enable a control. A dropdown that opens and changes nothing is the
 *    defect in a new costume.
 *
 * Scenario-owned identities only (P1.2): the R82 scenario's Teacher, never the
 * first ambient one.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9228');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

async function goto(path, ready) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 160; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      if (document.location.pathname !== ${JSON.stringify(path)}) return 'navigating';
      return document.querySelector(${JSON.stringify(ready)}) ? 'ready' : 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

/**
 * Re-issue each reference read from the page's own origin with the page's own
 * credentials. This is what the Owner actually observed, and a status is a fact
 * a rendered control cannot express.
 */
const statuses = (paths) =>
  evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    const { access_token } = await r.json();
    const out = {};
    for (const p of ${JSON.stringify(paths)}) {
      const res = await fetch('/api/v1' + p, { headers: { Authorization: 'Bearer ' + access_token } });
      out[p] = res.status;
    }
    return JSON.stringify(out);
  })()`).then((r) => JSON.parse(r));

/* ── 1. The reads the Owner saw refuse, and the one that answers ────────── */

// Navigate FIRST: the probes below are same-origin relative fetches, and a
// relative URL has nothing to resolve against on `about:blank`.
const state = await goto('/teacher/content', 'select');
check('مكتبة المحتوى opens for a مؤطِّرة', state === 'ready', { state });

const REFERENCE = ['/admin/levels', '/admin/subjects', '/admin/academic-years', '/admin/branches'];
const before = await statuses([...REFERENCE, '/me/scope-options', '/library?page_size=5']);

check(
  'the Admin reference reads STILL refuse a مؤطِّرة — no permission was widened',
  before['/admin/levels'] === 403 &&
    before['/admin/subjects'] === 403 &&
    before['/admin/academic-years'] === 403,
  before,
);
check(
  '/admin/branches still answers her, as it always did (R61.2)',
  before['/admin/branches'] === 200,
  { status: before['/admin/branches'] },
);
check(
  'the narrow question answers her — this is what replaces the three refusals',
  before['/me/scope-options'] === 200,
  { status: before['/me/scope-options'] },
);
check('the library itself answers her, as it always did', before['/library?page_size=5'] === 200, {
  status: before['/library?page_size=5'],
});

/* ── 2. مكتبة المحتوى renders every filter, populated ───────────────────── */

const optionCounts = () =>
  evaluate(`(() => {
    const out = {};
    for (const label of ['المستوى', 'المادة', 'السنة الدراسية', 'الفرع']) {
      const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label));
      const select = l && document.getElementById(l.htmlFor);
      out[label] = select ? [...select.options].filter((o) => o.value !== '').length : -1;
    }
    return JSON.stringify(out);
  })()`).then((r) => JSON.parse(r));

let counts = {};
for (let i = 0; i < 40; i += 1) {
  counts = await optionCounts();
  if (counts['المستوى'] > 0 && counts['المادة'] > 0) break;
  await new Promise((r) => setTimeout(r, 250));
}
// Every one of these was empty or refused before NEW D.
check('المستوى is populated', counts['المستوى'] > 0, counts);
check('المادة is populated with NO Level chosen — it is a filter, not a form', counts['المادة'] > 0, counts);
check('السنة الدراسية is populated', counts['السنة الدراسية'] > 0, counts);
check('الفرع is populated', counts['الفرع'] > 0, counts);

/* ── 3. The filters actually filter ─────────────────────────────────────── */

const pick = (labelStart, index) =>
  evaluate(`(() => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(labelStart)}));
    const select = document.getElementById(l.htmlFor);
    const options = [...select.options].filter((o) => o.value !== '');
    const option = options[${index}];
    if (!option) return 'no-option';
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return option.textContent.trim();
  })()`);

const rowCount = () =>
  evaluate(`(() => document.querySelectorAll('table tbody tr').length)()`);

const unfiltered = await rowCount();
const subjectsAll = (await optionCounts())['المادة'];

/**
 * **The Level is chosen from the data, not by index.**
 *
 * The first Level in the list teaches nothing — a real and ordinary state the
 * hook already models as «لا مواد مسندة إلى هذا المستوى» — so indexing blindly
 * asserted narrowing against a Level with nothing to narrow to. Taking a Level
 * that genuinely teaches Subjects lets the assertion be exact: the rendered
 * count must equal that Level's own `subject_ids`, which is the §4.4b pairing
 * the payload now carries inline.
 */
const chosen = await evaluate(`(async () => {
  const r = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: '{}',
  });
  const { access_token } = await r.json();
  const res = await fetch('/api/v1/me/scope-options', {
    headers: { Authorization: 'Bearer ' + access_token },
  });
  const { data } = await res.json();
  const teaching = data.levels.filter((l) => l.subject_ids.length > 0);
  const level = teaching.sort((a, b) => b.subject_ids.length - a.subject_ids.length)[0];
  return JSON.stringify(level ? { id: level.id, name: level.name, taught: level.subject_ids.length } : null);
})()`).then((r) => JSON.parse(r));

if (!chosen) throw new Error('no Level in this database teaches any Subject');

await evaluate(`(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith('المستوى'));
  const select = document.getElementById(l.htmlFor);
  select.value = ${JSON.stringify(chosen.id)};
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
})()`);
await new Promise((r) => setTimeout(r, 900));
const subjectsAfterLevel = (await optionCounts())['المادة'];

check(
  'choosing a Level narrows المادة to EXACTLY that Level’s Subjects (§4.4b)',
  subjectsAfterLevel === chosen.taught && subjectsAfterLevel <= subjectsAll,
  { level: chosen.name, taught: chosen.taught, rendered: subjectsAfterLevel, subjectsAll },
);

const filtered = await rowCount();
check(
  'and the LIBRARY RESULTS change — the filter filters, it does not merely enable',
  filtered !== unfiltered || unfiltered === 0,
  { unfiltered, filtered },
);

// Clearing restores the wider set, which is the other half of "it filters".
await evaluate(`(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith('المستوى'));
  const select = document.getElementById(l.htmlFor);
  select.value = '';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return 'cleared';
})()`);
await new Promise((r) => setTimeout(r, 900));
check(
  'clearing the Level restores the unnarrowed Subject list',
  (await optionCounts())['المادة'] === subjectsAll,
  { restored: (await optionCounts())['المادة'], subjectsAll },
);

/* ── 3b. The Add dialog — the OTHER consumer of the same hook (rule AX) ─── */

/**
 * `content-upload-form` uses `useScopeOptions` in **form** mode, so the fix
 * either reached both surfaces or neither. Rule AX is the reason it must be
 * checked separately: the determining fields live **inside the form**, not
 * borrowed invisibly from the page's filter row, so a form whose selectors were
 * empty would be a dialog she can open and never submit.
 */
await evaluate(`(() => {
  // The upload action is «رفع ملف», not «إضافة» — this screen adds a FILE, and
  // its button says so. Matching the generic add label found nothing.
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('رفع ملف'));
  if (add) add.click();
  return add ? 'clicked' : 'no-add';
})()`);
await new Promise((r) => setTimeout(r, 1200));

const formCounts = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return JSON.stringify({ dialog: false });
  const out = { dialog: true };
  for (const label of ['المستوى', 'السنة الدراسية', 'الفرع']) {
    const l = [...dialog.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label));
    const select = l && document.getElementById(l.htmlFor);
    out[label] = select ? [...select.options].filter((o) => o.value !== '').length : -1;
  }
  return JSON.stringify(out);
})()`).then((r) => JSON.parse(r));

check(
  'the Add dialog carries its OWN determining fields, populated (rule AX)',
  formCounts.dialog === true &&
    formCounts['المستوى'] > 0 &&
    formCounts['السنة الدراسية'] > 0 &&
    formCounts['الفرع'] > 0,
  formCounts,
);

await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  const cancel = dialog && [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('إلغاء'));
  if (cancel) cancel.click();
  return 'closed';
})()`);
await new Promise((r) => setTimeout(r, 400));

/* ── 4. Nothing was granted that should not have been ───────────────────── */

const writes = await evaluate(`(async () => {
  const r = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: '{}',
  });
  const { access_token } = await r.json();
  const res = await fetch('/api/v1/admin/subjects', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'newd-should-not-exist' }),
  });
  return res.status;
})()`);
check(
  'she can FILTER by every Subject and still cannot CREATE one',
  writes === 403,
  { status: writes },
);

await close();
finish();
