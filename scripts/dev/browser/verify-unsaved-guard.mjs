/**
 * **Unsaved work is not thrown away, and a pristine form does not nag.**
 *
 * Both halves, because either alone is a defect: a form that discards typing
 * silently loses work, and a form that questions somebody who changed nothing
 * teaches them to click through the question that matters.
 *
 * ## The scenario this exists for
 *
 * An Owner filled in `＋إضافة مقر`, clicked outside, and lost everything —
 * while the identical gesture on `＋تسجيل مستفيدة` asked first. The protection
 * had lived inside `FormDialog` since 2026-08-17 and simply never reached the
 * six dialogs assembled from a bare `Dialog`. The guard meant to catch that
 * scoped itself to `FormDialog` callers, so it was structurally blind to
 * exactly the dialogs that opted out — and had never failed.
 *
 * Source inspection cannot settle any of this: whether a backdrop click closes
 * a dialog is browser behaviour.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9243');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh', value: COOKIE, domain: 'localhost',
  path: '/api/v1/auth', httpOnly: true,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const state = await evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return 'login';
      if (document.querySelector('.datatable__skeleton')) return 'loading';
      return document.querySelector('.admin-table, .state') ? 'ready' : 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await sleep(250);
  }
  return 'timeout';
}

/** Clicks a page-level button, waiting for it — «the screen is ready» and «the
 *  action has rendered» are different moments, and a fixed sleep confuses them. */
async function clickByText(text) {
  for (let i = 0; i < 24; i += 1) {
    const r = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(text)}) && !b.closest('dialog[open]'));
      if (!b) return 'missing';
      b.click();
      return 'ok';
    })()`);
    if (r === 'ok') return 'ok';
    await sleep(200);
  }
  return 'missing';
}

/** A real backdrop click: the native <dialog> element itself is the backdrop. */
const clickBackdrop = () => evaluate(`(() => {
  const d = document.querySelector('dialog[open]');
  if (!d) return 'no-dialog';
  const r = d.getBoundingClientRect();
  // A point inside the dialog ELEMENT but outside its content box is the
  // backdrop; dispatching on the element is what the platform's own handler
  // tests for (event.target === the dialog).
  d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 1, clientY: r.top + 1 }));
  return 'clicked';
})()`);

const state = () => evaluate(`(() => {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  // The shared discard question, by its own title — «إغلاق النموذج؟».
  const confirm = dialogs.find((d) => (d.textContent ?? '').includes('إغلاق النموذج؟'));
  const form = dialogs.find((d) => d !== confirm);
  return {
    open: dialogs.length,
    confirming: !!confirm,
    formOpen: !!form,
    firstValue: form?.querySelector('input[type="text"]')?.value ?? null,
  };
})()`);

const typeFirstField = (value) => evaluate(`(() => {
  const d = document.querySelector('dialog[open]');
  const i = d?.querySelector('input[type="text"]');
  if (!i) return 'missing';
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);

/** Waits for a settled state rather than sleeping a guessed number of
 *  milliseconds — a fixed sleep made one assertion read the frame before React
 *  committed, and reported a question that was about to appear as absent. */
async function waitFor(predicate, tries = 24) {
  for (let i = 0; i < tries; i += 1) {
    const s = await state();
    if (predicate(s)) return s;
    await sleep(150);
  }
  return state();
}

/**
 * Clicks inside a named dialog — `'form'` or `'confirm'` — never "the last one".
 *
 * "Last open dialog" looked equivalent and is not: the confirmation stacks over
 * the form, so after dismissing it the two are momentarily both present and the
 * next click landed on the wrong «إلغاء». The harness then reported a missing
 * question that had actually appeared.
 */
const clickInDialog = (text, which = 'form') => evaluate(`(() => {
  const ds = [...document.querySelectorAll('dialog[open]')];
  const confirm = ds.find((d) => (d.textContent ?? '').includes('إغلاق النموذج؟'));
  const form = ds.find((d) => d !== confirm);
  const d = ${JSON.stringify('WHICH')} === 'confirm' ? confirm : form;
  const b = [...(d?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'missing';
  b.click();
  return 'ok';
})()`.replace('"WHICH"', JSON.stringify(which)));

/* ── ＋إضافة مقر — the exact scenario reported ───────────────────────────── */
check('the branches screen loads', (await goto('/admin/branches')) === 'ready');

// (a) pristine: a backdrop click closes with NO question
check('＋إضافة مقر opens', (await clickByText('إضافة مقر')) === 'ok');
await sleep(500);
check('the add form is open', (await state()).formOpen === true);
await clickBackdrop();
await sleep(400);
let s1 = await state();
check(
  'PRISTINE: a backdrop click closes it directly, with no discard question',
  s1.open === 0,
  JSON.stringify(s1),
);

// (b) dirty: backdrop is refused, then the question, then "continue editing"
await clickByText('إضافة مقر');
await sleep(500);
check('a field can be typed into', (await typeFirstField('مقر التحقق')) === 'ok');
await sleep(300);
await clickBackdrop();
await sleep(400);
let s2 = await state();
check(
  'DIRTY: the backdrop does not discard the work',
  s2.formOpen === true,
  JSON.stringify(s2),
);

// **Escape, asserted on its own.** It was originally dispatched here without
// an assertion, which silently opened the question — so the next click landed
// on the CONFIRM dialog's «إلغاء» (continue editing) and closed it again, and
// the harness reported a missing question that had in fact appeared. A step
// that acts without asserting is a step that can only mislead.
await evaluate(`(() => {
  const d = document.querySelector('dialog[open]');
  d?.dispatchEvent(new Event('cancel', { cancelable: true, bubbles: true }));
  return 'esc';
})()`);
const esc = await waitFor((x) => x.confirming);
check('ESCAPE on a dirty form asks rather than discarding', esc.confirming === true, JSON.stringify(esc));
check('“continue editing” returns to the form', (await clickInDialog('إلغاء', 'confirm')) === 'ok');
// Wait for the confirmation to be fully gone AND the form to be the only open
// dialog again. Clicking the form's cancel while the confirmation is still
// unmounting sets a flag that the same render then clears.
await waitFor((x) => !x.confirming && x.open === 1);
await sleep(250);

check('X / إلغاء asks before discarding', (await clickInDialog('إلغاء')) === 'ok');
let s3 = await waitFor((x) => x.confirming);
check('DIRTY: a discard question is shown', s3.confirming === true, JSON.stringify(s3));

check('“continue editing” is offered', (await clickInDialog('إلغاء', 'confirm')) === 'ok');
await sleep(400);
let s4 = await state();
check(
  'choosing to continue keeps the dialog open AND the typed value intact',
  s4.formOpen === true && s4.firstValue === 'مقر التحقق',
  JSON.stringify(s4),
);

// (c) restoring the original value makes it pristine again
await typeFirstField('');
await sleep(400);
await clickBackdrop();
await sleep(400);
let s5 = await state();
check(
  'restoring the original value makes it PRISTINE again — the backdrop closes it',
  s5.open === 0,
  JSON.stringify(s5),
);

// (d) dirty again, and this time confirm the discard
await clickByText('إضافة مقر');
await sleep(500);
await typeFirstField('مقر التحقق');
await sleep(300);
await clickInDialog('إلغاء');
check('the question is shown again', (await waitFor((x) => x.confirming)).confirming === true);
check('confirming discard is offered', (await clickInDialog('إغلاق دون حفظ', 'confirm')) === 'ok');
await sleep(500);
let s6 = await state();
check('confirming discard closes the dialog', s6.open === 0, JSON.stringify(s6));

/* ── الشركاء — the reference must not have regressed ─────────────────────── */

/**
 * **Restated 2026-08-28: the reference moved.**
 *
 * It drove `＋تسجيل مستفيدة` on المستفيدات, which the Owner **removed** —
 * enrolling now starts from a مستفيدة's own row rather than from a form that
 * begins by asking who she is. A harness pointed at a withdrawn control proves
 * nothing, so the reference is now الشركاء: a plain pristine `FormDialog`
 * reached from a header Add, which is what this check was ever about.
 */
check('the partners screen loads', (await goto('/admin/partners')) === 'ready');
const opened = await clickByText('إضافة شريك');
if (opened === 'ok') {
  await sleep(600);
  check('the reference form opens', (await state()).formOpen === true);
  await clickBackdrop();
  await sleep(400);
  const r1 = await state();
  check(
    'REFERENCE pristine: still closes on a backdrop click, unchanged',
    r1.open === 0,
    JSON.stringify(r1),
  );

  await clickByText('إضافة شريك');
  await sleep(600);
  // A real change to a field that would be SAVED — not a search term, which is
  // not unsaved work and which the guard is right to ignore.
  const typed = await evaluate(`(() => {
    const d = document.querySelector('dialog[open]');
    const input = d ? d.querySelector('input[type=text], input:not([type])') : null;
    if (!input) return 'no-input';
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, 'شريك مؤقّت');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  check('a real value can be entered on the reference form', typed === 'ok', typed);
  await sleep(300);
  await clickBackdrop();
  await sleep(400);
  const r2 = await state();
  check(
    'REFERENCE dirty: still refuses the backdrop, exactly as before the refactor',
    r2.formOpen === true,
    JSON.stringify(r2),
  );
} else {
  check('the reference form could be opened', false, `state=${opened}`);
}

/* ── الجدولة: a pristine add/edit form asks nothing (2026-08-28) ─────────── */

/**
 * **A second cause, on a different screen.**
 *
 * مجموعات المستويات was dirty because a closing form's pristine had been
 * cleared. الجدولة was dirty for the whole time it was open, and every value
 * matched: its two snapshots are **separate literals**, and `schedulingTypeId`
 * sat second in one and twentieth in the other, so the serialised comparison
 * differed on key position alone. Both are checked here because both reached the
 * reader as the same sentence.
 */
const sched = await goto('/admin/schedules');
if (sched === 'ready') {
  const opened = await evaluate(`(async () => {
    const add = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.trim().includes('إضافة عنصر'));
    if (!add) return { noAdd: true };
    add.click();
    await new Promise((r) => setTimeout(r, 1500));
    const dlg = document.querySelector('dialog[open]');
    if (!dlg) return { noDialog: true };
    const close = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'إغلاق');
    if (!close) return { noCloseButton: true };
    close.click();
    await new Promise((r) => setTimeout(r, 800));
    return { closed: true };
  })()`);

  if (opened.closed !== true) {
    check('PRISTINE الجدولة: the add form could be opened', false, JSON.stringify(opened));
  } else {
    const after = await state();
    check(
      'PRISTINE: an untouched إضافة عنصر closes with no discard question',
      after.confirming === false && after.open === 0,
      JSON.stringify(after),
    );
  }
} else {
  check('PRISTINE الجدولة: the page could be reached', false, `state=${sched}`);
}

close();
process.exit(finish());
