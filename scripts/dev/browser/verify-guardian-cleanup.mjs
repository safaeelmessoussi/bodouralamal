/**
 * **Guardian-only cleanup, in a browser** (R131 §4.3, Owner decision 2026-09-04).
 *
 * ## Why this exists at this layer
 *
 * The service suite proves the invariants — the guard refuses while any purpose
 * remains, no child record is touched, the closure runs through the ordinary
 * machinery. What it cannot see is whether a Super Admin can actually *reach*
 * the decision, and whether the refusal tells her anything. That is rule P's
 * recurring defect on this project (a complete capability with no reach), and
 * here it would mean a guard nobody can invoke.
 *
 * **The refusal is the more important half.** A destructive action that is easy
 * to reach and silent about why it declined is worse than one that is hard to
 * reach: the administrator's next move is to go and revoke something, and the
 * screen has to say what. So this drives BOTH accounts — one that must close and
 * one that must not — and reads the sentence the second one produces.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const ADMIN_COOKIE = process.env.ADMIN_REFRESH_COOKIE;
const SPENT = process.env.SPENT_NAME;
/**
 * **The Arabic stem both accounts share.** Search is server-side over the TD-10
 * normalized ARABIC name, so the Latin `[gc-verify]` tag matches nothing — the
 * run failed on exactly that before this constant existed. The names it finds
 * are single tokens for a second reason, recorded in the shell harness: §14.2
 * splits a name across columns, and `innerText` puts a tab in the gap.
 */
const STEM = 'ولية';
const BUSY = process.env.BUSY_NAME;
if (!ADMIN_COOKIE || !SPENT || !BUSY) {
  throw new Error('ADMIN_REFRESH_COOKIE, SPENT_NAME and BUSY_NAME are required');
}

/**
 * **The last token of each name is what the screen can be matched on.** §14.2
 * renders a name across columns, so `innerText` puts a TAB inside it and no
 * whole-name match can ever succeed — the run failed on exactly that twice
 * before the diagnostic below printed the rows it was actually looking at.
 */
const spentToken = SPENT.split(' ').pop();
const busyToken = BUSY.split(' ').pop();

const { send, evaluate, close } = await connect(process.env.PORT ?? '9244');
const { check, finish } = results();
await send('Network.enable');

const bodyText = () => evaluate('document.body.innerText');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function navigate(url, selector) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(
      `(() => !!document.querySelector(${JSON.stringify(selector)}))()`,
    ).catch(() => false);
    if (ready) return true;
    await wait(250);
  }
  return false;
}

/**
 * **Confirms inside the OPEN dialog, never by global text match.**
 *
 * The row action and the dialog's confirm button carry the SAME label — they
 * are the same decision named once — so a document-wide search finds whichever
 * comes first in the DOM and can silently re-open the dialog instead of
 * confirming it. That is exactly what happened: every check passed and nothing
 * was closed, which is the worst shape a green test can have.
 */
const confirmInDialog = (text) => evaluate(`(() => {
  // Every OPEN dialog, not the first: this page mounts several and more than one
  // can be open at a time, so «the first open dialog» is not «the dialog I just
  // opened» — the run failed on precisely that, reporting the button missing
  // while it sat in the sixth dialog on the page.
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  if (dialogs.length === 0) return 'no-dialog';
  for (const dlg of dialogs) {
    const el = [...dlg.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(text)});
    if (el) { el.click(); return 'clicked'; }
  }
  return 'missing';
})()`);

/**
 * **Types into the real search box.**
 *
 * `?q=` on the URL does nothing here — this screen holds its filters in
 * component state, not in the query string, so a run that navigated with a
 * parameter would silently list page one of every account and then fail on a
 * row it never asked for. Driving the control is also the more honest test: it
 * is what an administrator does.
 */
const search = (value) => evaluate(`(() => {
  const el = [...document.querySelectorAll('input')].find((i) => i.type === 'search' || i.type === 'text');
  if (!el) return 'missing';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);

/** Opens the row-action menu for the row whose text contains `name`. */
const openRowMenu = (name) => evaluate(`(() => {
  const row = [...document.querySelectorAll('tbody tr')].find((r) => (r.textContent ?? '').includes(${JSON.stringify(name)}));
  if (!row) return 'no-row';
  const trigger = row.querySelector('details > summary, button');
  if (!trigger) return 'no-trigger';
  trigger.click();
  return 'opened';
})()`);

/** The action inside the OPEN menu — never a global text match, which would
 *  find the other row's copy of the same label. */
const clickRowAction = (name, label) => evaluate(`(() => {
  const row = [...document.querySelectorAll('tbody tr')].find((r) => (r.textContent ?? '').includes(${JSON.stringify(name)}));
  if (!row) return 'no-row';
  const el = [...row.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim().includes(${JSON.stringify(label)}));
  if (!el) return 'missing';
  el.click();
  return 'clicked';
})()`);

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: ADMIN_COOKIE,
  domain: 'localhost',
  path: '/',
});

/* ── 1 · The decision is REACHABLE ──────────────────────────────────────── */
check(
  'the account directory loads for a Super Admin',
  await navigate(`${BASE}/admin/users`, 'table'),
);
await wait(1200);
check('the search box accepts the scenario name', (await search(STEM)) === 'ok');
await wait(1800);

const listed = await bodyText();
/**
 * **Print what the table actually held when this fails.** A bare boolean here
 * says only *«not found»*, and the two causes — the search matched nothing, or
 * the row is there under a name the run did not expect — need completely
 * different fixes. It cost two rounds before the diagnostic was added.
 */
if (!listed.includes(spentToken) || !listed.includes(busyToken)) {
  const rows = await evaluate(
    `JSON.stringify([...document.querySelectorAll('tbody tr')].map((r) => (r.innerText ?? '').split('\t')[0]))`,
  );
  console.log('   rows on screen:', rows);
  console.log('   expected tokens:', JSON.stringify([spentToken, busyToken]));
}
check(
  'both scenario accounts are listed',
  listed.includes(spentToken) && listed.includes(busyToken),
);

check(
  'the guardian-cleanup action is offered on a row',
  (await openRowMenu(busyToken)) === 'opened',
);
await wait(300);
check(
  'the action carries its own label, not a reused delete label',
  (await bodyText()).includes('إغلاق حساب وليّ أمر'),
);

/* ── 2 · The account that MUST NOT close is refused, and told why ───────── */
check(
  'the action opens its confirmation',
  (await clickRowAction(busyToken, 'إغلاق حساب وليّ أمر')) === 'clicked',
);
await wait(400);
const confirming = await bodyText();
check(
  'the dialog says no child data is touched — the fear this action raises',
  confirming.includes('لا تُمسّ أي بيانات تخص الأطفال'),
);
check('it warns that a remaining reason will refuse the closure', confirming.includes('سيُرفض الإغلاق'));

const confirmed1 = await confirmInDialog('إغلاق حساب وليّ أمر');
if (confirmed1 !== 'clicked') {
  console.log('   confirm returned:', confirmed1);
  console.log('   dialogs:', await evaluate(`JSON.stringify([...document.querySelectorAll('dialog')].map((d) => ({open: d.hasAttribute('open'), buttons: [...d.querySelectorAll('button')].map((b) => b.textContent.trim())})))`));
}
check('the closure is confirmable', confirmed1 === 'clicked');
await wait(1500);

const refused = await bodyText();
check(
  'the guarded account was REFUSED rather than closed',
  !refused.includes('أُغلق حساب وليّ الأمر'),
);
/**
 * **Names the blocking purpose, not just «something went wrong».**
 *
 * The loose version of this check — any of «لا يمكن», «سبب», «ارتباط» — passed
 * while the API was answering `404 <unmatched>` for a route the container did
 * not have, because the dialog's own body text contains «سبب». A check that
 * passes when the feature is absent is worse than no check, so this one asserts
 * the exact label the live family link produces.
 */
check(
  'the refusal NAMES the purpose that blocks it',
  refused.includes('ارتباطات قائمة بأطفال'),
);
check(
  'and says plainly that refreshing will not help',
  refused.includes('تحديث الصفحة لن يغيّر هذه الحالة'),
);

/* ── 3 · The account with no purpose closes ─────────────────────────────── */
check('the directory reloads', await navigate(`${BASE}/admin/users`, 'table'));
await wait(1200);
check('the search box accepts the name again', (await search(STEM)) === 'ok');
await wait(1800);
check('the spent guardian is still listed', (await bodyText()).includes(spentToken));
check('its menu opens', (await openRowMenu(spentToken)) === 'opened');
await wait(300);
check(
  'its guardian-cleanup action is reachable',
  (await clickRowAction(spentToken, 'إغلاق حساب وليّ أمر')) === 'clicked',
);
await wait(400);
check(
  'the closure is confirmable',
  (await confirmInDialog('إغلاق حساب وليّ أمر')) === 'clicked',
);
await wait(1800);

const outcome = await bodyText();
if (!outcome.includes('أُغلق حساب وليّ الأمر')) {
  console.log('   screen after confirm:', JSON.stringify(outcome.slice(0, 900)));
}
check('the spent guardian was closed, and the screen says so', outcome.includes('أُغلق حساب وليّ الأمر'));

await close();
finish();
