/**
 * **The one deletion, in a browser** (Revision 133).
 *
 * ## Why this exists at this layer
 *
 * The service suites prove what deletion destroys and what it spares. What they
 * cannot see is whether a woman reading the confirmation understands what she is
 * agreeing to — and under R133 that is the whole risk. Deletion is now genuinely
 * destructive: her grades and progress go with her account, and an attestation
 * may become impossible afterwards. A confirmation that fails to say so is worse
 * than a missing feature, because she will click it.
 *
 * It also pins the **absences**. Three withdrawn workflows had screens and
 * navigation of their own — Option B's request block, the account-return queue,
 * the guardian-cleanup row action — and a removal that leaves dead UI behind is
 * the defect this pass exists to prevent.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.ADMIN_REFRESH_COOKIE;
if (!COOKIE) throw new Error('ADMIN_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9248');
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

const clickText = (text) => evaluate(`(() => {
  const el = [...document.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim().includes(${JSON.stringify(text)}));
  if (!el) return 'missing';
  el.click();
  return 'clicked';
})()`);

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/',
});

/* ── 1 · حسابي offers ONE deletion, and warns before it ─────────────────── */
check('the profile page loads', await navigate(`${BASE}/profile`, 'main'));
await wait(1500);

const profile = await bodyText();
check('it offers exactly one deletion concept', profile.includes('حذف حسابي'));
check(
  'the OLD second request is gone from the page',
  !profile.includes('طلب حذف السجل التعليمي'),
);
check('the lede names the seven days', profile.includes('سبعة أيام'));
check(
  'the lede says the educational record goes too',
  profile.includes('سجلك التعليمي'),
);

check('the confirmation opens', (await clickText('حذف حسابي')) === 'clicked');
await wait(500);
const confirm = await bodyText();
check('it says access stops immediately', confirm.includes('يتوقّف دخولك فوراً'));
check('it says the account is restorable for seven days', confirm.includes('سبعة أيام'));
check(
  'it warns an attestation may become impossible',
  confirm.includes('يتعذّر إصدار شهادة'),
);
check(
  'it says what SURVIVES, so deletion does not read as a cascade',
  confirm.includes('ما يخصّ غيرك'),
);
check(
  'it is honest about older backups rather than promising instant erasure',
  confirm.includes('نسخة احتياطية') && !confirm.includes('محو فوري من كل مكان'),
);
check(
  'no internal vocabulary reaches the screen',
  !/Option|MinIO|tombstone|HMAC|الخيار أ|الخيار ب/i.test(confirm),
);

/* ── 2 · The Trash is the recovery interface ────────────────────────────── */
check('the Trash loads for a Super Admin', await navigate(`${BASE}/admin/trash`, 'table'));
await wait(1200);
const trash = await bodyText();
check('it offers restore', trash.includes('استعادة'));
check('it offers an immediate permanent delete', trash.includes('حذف نهائي'));

/* ── 3 · The withdrawn workflows leave NO dead UI ───────────────────────── */
check(
  'the account-return queue is gone from navigation',
  !trash.includes('طلبات استعادة حساب'),
);

check('the users screen loads', await navigate(`${BASE}/admin/users`, 'table'));
await wait(1500);
const users = await bodyText();
check(
  'the guardian-cleanup row action is gone',
  !users.includes('إغلاق حساب وليّ أمر'),
);
check('the delete action uses the one deletion word', users.includes('حذف الحساب'));

/**
 * **Last, deliberately.** `navigate` polls for its selector before giving up, so
 * asserting an ABSENT page costs the full timeout — and doing that mid-run once
 * pushed the two checks after it past their own budget and reported them as
 * failures of the users screen, which loads perfectly well. An absence is
 * checked where nothing follows it.
 */
check(
  'the withdrawn account-return route renders no page',
  !(await navigate(`${BASE}/admin/account-return-requests`, 'table')),
);

await close();
finish();
