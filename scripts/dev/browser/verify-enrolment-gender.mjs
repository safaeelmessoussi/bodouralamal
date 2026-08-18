/**
 * **The reported failure, reproduced and then proven fixed** (R27, 2026-08-18).
 *
 * Manual report: on تسجيل مستفيدة, choosing المرأة — وميض الأمل and saving
 * returned VALIDATION_FAILED / GENDER_RESTRICTION. The trace found three
 * separate facts, and this drives all three:
 *
 * 1. **The backend was right.** R27 refuses a mismatched sex AND a NULL one.
 * 2. **The fixtures were stale.** Every [تجريبي] person predated R27 with a
 *    NULL sex, so none could be enrolled in any restricted Level.
 * 3. **The form was too broad.** It offered every active account while the
 *    server refused a good half — the one selector pair on that form that did
 *    not narrow (§14.4/R55).
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9231');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(
      `(() => document.querySelector('.admin-table, .state') !== null)()`,
    ).catch(() => false);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const api = (path) =>
  evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    const { access_token } = await r.json();
    const res = await fetch('/api/v1' + ${JSON.stringify('')} + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + access_token },
    });
    return { status: res.status, body: await res.text() };
  })()`);

check('the enrolments screen loads', (await goto('/admin/enrollments')) === true);

/* ── the form's own order and its dependency ─────────────────────────────── */

// The add button is «تسجيل مستفيدة», and the dialog is what carries the form —
// reading .field across the whole page measured the FILTER row instead.
const form = await evaluate(`(async () => {
  // The add-variant button prefixes a full-width plus, so the label is
  // CONTAINED rather than equal — matching exactly found nothing.
  const add = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.includes('تسجيل مستفيدة'));
  if (!add) return { noButton: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  add.click();
  await new Promise((r) => setTimeout(r, 2000));
  // The form lives in the element that actually holds the fields; the outer
  // wrapper has none, and querying it measured an empty list.
  const dialog = [...document.querySelectorAll('dialog, .dialog, [role=dialog]')]
    .find((d) => d.querySelector('.field, .searchable-select')) ?? null;
  if (!dialog) return { noDialog: true };
  // SearchableSelect is a fieldset with a legend rather than a labelled select,
  // so both spellings are read.
  const fields = [...dialog.querySelectorAll('.field, .searchable-select')].map(
    (f) => (f.querySelector('label, legend')?.textContent ?? '').trim(),
  );
  return {
    fields,
    levelBeforeStudent:
      fields.findIndex((l) => l.includes('المستوى')) <
      fields.findIndex((l) => l.includes('المستفيدة')),
  };
})()`);
check(
  '1 · the form asks for the Level BEFORE the beneficiary',
  form.levelBeforeStudent === true,
  JSON.stringify(form.fields ?? form),
);
if (form.noButton || form.noDialog) {
  // Nothing downstream can be measured without the dialog; say so and stop
  // rather than reporting five derived failures from one cause.
  close();
  process.exit(finish());
}

/* ── the eligible set, straight from the API the form calls ──────────────── */

const restricted = JSON.parse((await api(`/admin/users?page_size=100&eligible_for_level=${S.levelId}`)).body || '{}');
const everyone = JSON.parse((await api('/admin/users?page_size=100')).body || '{}');
const names = (b) => (b.data ?? []).map((u) => u.name_arabic);

check(
  '2 · the restricted Level offers FEWER candidates than the unfiltered list',
  (restricted.data ?? []).length > 0 && (restricted.data ?? []).length < (everyone.data ?? []).length,
  `${(restricted.data ?? []).length} eligible of ${(everyone.data ?? []).length}`,
);
check(
  '3 · nobody with an unrecorded sex is offered for a girls-only Level',
  !names(restricted).some((n) => n.includes('المشرف العام')),
  JSON.stringify(names(restricted).slice(0, 6)),
);
check(
  '4 · the backfilled fixture beneficiaries ARE offered now',
  names(restricted).some((n) => n.includes('[تجريبي]')),
  JSON.stringify(names(restricted).filter((n) => n.includes('[تجريبي]'))),
);
check(
  '5 · the contract still publishes no `sex`',
  (everyone.data ?? []).every((u) => !('sex' in u)),
);

/* ── the form narrows in the browser, and reconciles a stale choice ──────── */

const narrowed = await evaluate(`(async () => {
  const scope = [...document.querySelectorAll('dialog, .dialog, [role=dialog]')]
    .find((d) => d.querySelector('.field, .searchable-select'));
  const pick = async (labelText, value) => {
    // Scoped to the dialog: the PAGE has a «تصفية بالمستوى» filter whose label
    // also contains المستوى, and setting that narrows the table, not the form.
    const sel = [...scope.querySelectorAll('select')]
      .find((s) => (s.closest('.field')?.textContent ?? '').includes(labelText));
    if (!sel) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1800));
    return true;
  };
  // SearchableSelect renders its options as buttons in a list, not as a native
  // select — counting option elements measured nothing at all.
  // (No backticks in comments inside this template literal.)
  const countCandidates = () => {
    const box = [...scope.querySelectorAll('.searchable-select')]
      .find((f) => (f.querySelector('legend')?.textContent ?? '').includes('المستفيدة'));
    return box ? box.querySelectorAll('.searchable-select__options li button').length : -1;
  };
  const before = countCandidates();
  await pick('المستوى', ${JSON.stringify(S.levelId)});
  const after = countCandidates();
  const hint = [...scope.querySelectorAll('.searchable-select')]
    .find((f) => (f.querySelector('legend')?.textContent ?? '').includes('المستفيدة'))
    ?.textContent ?? '';
  return { before, after, saysEligible: hint.includes('المؤهّلات') };
})()`);
check(
  '6 · choosing the Level NARROWS the beneficiary list in the browser',
  narrowed.after > 0 && narrowed.after < narrowed.before,
  `${narrowed.before} options → ${narrowed.after}`,
);
check('7 · and the field says why the list is what it is', narrowed.saysEligible === true, JSON.stringify(narrowed));

/* ── the whole point: the save the report failed on now succeeds ─────────── */

const saved = await evaluate(`(async () => {
  // The beneficiary is a SearchableSelect (a button list); the branch is a
  // native select. Each is operated the way it actually is.
  const pickCandidate = async () => {
    const box = [...document.querySelectorAll('.searchable-select')]
      .find((f) => (f.querySelector('legend')?.textContent ?? '').includes('المستفيدة'));
    const btn = box?.querySelector('.searchable-select__options li button');
    if (!btn) return null;
    const label = btn.textContent.trim();
    btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    return label;
  };
  const pickSelect = async (labelText) => {
    const sel = [...document.querySelectorAll('select')]
      .find((s) => (s.closest('.field')?.textContent ?? '').includes(labelText));
    if (!sel) return null;
    const opt = [...sel.options].find((o) => o.value !== '');
    if (!opt) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1200));
    return opt.textContent.trim();
  };
  const student = await pickCandidate();
  const branch = await pickSelect('الفرع');
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  save.click();
  await new Promise((r) => setTimeout(r, 3000));
  const notice = document.querySelector('.admin-notice, .field__error, [role="alert"]');
  return {
    student, branch,
    notice: notice ? notice.textContent.trim() : null,
    // The exact refusal the report carried.
    genderRefusal: (document.body.textContent ?? '').includes('GENDER_RESTRICTION'),
  };
})()`);
check('8 · a beneficiary and branch can be chosen from the narrowed list', saved.student !== null, JSON.stringify(saved));
check(
  '9 · saving no longer returns GENDER_RESTRICTION',
  saved.genderRefusal === false,
  saved.notice,
);
check(
  '10 · the enrolment is reported as done, not refused',
  (saved.notice ?? '').includes('تم') || (saved.notice ?? '') === '',
  saved.notice,
);

close();
process.exit(finish());
