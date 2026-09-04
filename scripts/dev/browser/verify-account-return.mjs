/**
 * **A former beneficiary gets her closed account back, in a browser** (Owner
 * decision, 2026-09-04).
 *
 * ## Why this exists at this layer
 *
 * The service suite proves the invariants — the same `User` is reactivated, no
 * duplicate beneficiary appears, nothing binds before approval, every identity
 * conflict fails closed. What it cannot see is whether the two people involved
 * can actually *do* it: whether her entry point exists and says the honest
 * sentence, and whether a Super Admin can find the request and decide it. That
 * is rule P's recurring defect on this project — a complete capability with no
 * reach — and for a credential-binding flow the cost would be an archive nobody
 * can ever recover.
 *
 * It also pins two things that must NOT appear on the review screen: the Google
 * provider subject, which is a credential coordinate no decision needs, and the
 * reference code, which proves nothing and whose presence would suggest that
 * matching it *is* the decision.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const TOKEN = process.env.ONBOARDING_TOKEN;
const SUBJECT = process.env.ONBOARDING_SUBJECT;
const CODE = process.env.REFERENCE_CODE;
const ADMIN_COOKIE = process.env.ADMIN_REFRESH_COOKIE;
if (!TOKEN || !SUBJECT || !CODE || !ADMIN_COOKIE) {
  throw new Error('ONBOARDING_TOKEN, ONBOARDING_SUBJECT, REFERENCE_CODE and ADMIN_REFRESH_COOKIE are required');
}

const { send, evaluate, close } = await connect(process.env.PORT ?? '9247');
const { check, finish } = results();
await send('Network.enable');

const bodyText = () => evaluate('document.body.innerText');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const setInput = (label, value) => evaluate(`(() => {
  const f = [...document.querySelectorAll('.field')].find((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)}));
  const el = f?.querySelector('input, textarea');
  if (!el) return 'missing';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);

const setSelectValue = (label, value) => evaluate(`(() => {
  const f = [...document.querySelectorAll('.field')].find((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)}));
  const el = f?.querySelector('select');
  if (!el) return 'missing';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`);

const clickText = (text) => evaluate(`(() => {
  const el = [...document.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim().includes(${JSON.stringify(text)}));
  if (!el) return 'missing';
  el.click();
  return 'clicked';
})()`);

/** Confirms inside an OPEN dialog — the page mounts several, and more than one
 *  can be open, so «the first open dialog» is not «the one I just opened». */
const confirmInDialog = (text) => evaluate(`(() => {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  if (dialogs.length === 0) return 'no-dialog';
  for (const dlg of dialogs) {
    const el = [...dlg.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(text)});
    if (el) { el.click(); return 'clicked'; }
  }
  return 'missing';
})()`);

async function navigate(url, selector) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`(() => !!document.querySelector(${JSON.stringify(selector)}))()`).catch(() => false);
    if (ready) return true;
    await wait(250);
  }
  return false;
}

/* ── 1 · Her entry point exists, from the onboarding state ──────────────── */
check(
  'the register form renders from an onboarding token',
  await navigate(`${BASE}/register#onboarding_token=${TOKEN}`, 'form.register-form'),
);
check(
  'the returning-beneficiary option is offered',
  (await bodyText()).includes('كان لي حساب في الجمعية وأُغلق'),
);
check(
  'the mode is selectable',
  (await setSelectValue('نوع التسجيل', 'account_return')) === 'account_return',
);
await wait(300);

/* ── 2 · The honest sentences ───────────────────────────────────────────── */
const notice = await bodyText();
check('it says NO new account is created', notice.includes('لا يُنشأ حساب جديد'));
check('it says the administration reviews and verifies her', notice.includes('تراجع الإدارة الطلب'));
check(
  'the code is described as a LOOKUP, not a proof of identity',
  notice.includes('يُستعمل للبحث فقط ولا يُثبت الهوية'),
);
check(
  'it asks for her CURRENT name rather than the erased one',
  notice.includes('اسمك الشخصي الحالي'),
);

/* ── 3 · She asks ───────────────────────────────────────────────────────── */
check('the reference code is accepted', (await setInput('رقم التسجيل', CODE)) === 'ok');
check('her current first name is accepted', (await setInput('اسمك الشخصي الحالي', 'عائدة')) === 'ok');
check('her current last name is accepted', (await setInput('اسمك العائلي الحالي', 'المستعيدة')) === 'ok');
check('the request is submittable', (await clickText('إرسال')) === 'clicked');
await wait(1500);
check(
  'she is told it was received and nothing opens before approval',
  (await bodyText()).includes('وصل طلبك'),
);

/* ── 4 · The Super Admin can FIND it — rule P, on a binding decision ────── */
await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: ADMIN_COOKIE,
  domain: 'localhost',
  path: '/',
});
check(
  'the review screen loads for a Super Admin',
  await navigate(`${BASE}/admin/account-return-requests`, 'table'),
);
await wait(1200);

const review = await bodyText();
check('the request is listed under the name she gave', review.includes('عائدة'));
// A credential coordinate no decision needs, and a code that proves nothing.
check('the Google provider subject is NOT shown', !review.includes(SUBJECT));
check('the reference code is NOT shown', !review.includes(CODE));

/* ── 5 · Approving says what it does, and does it ───────────────────────── */
check('the approval action is reachable', (await clickText('الموافقة والاستعادة')) === 'clicked');
await wait(400);
const confirming = await bodyText();
check(
  'the confirmation says the SAME archived account reopens',
  confirming.includes('سيُعاد فتح الحساب المؤرشف نفسه'),
);
check('it says no new account is created', confirming.includes('لا يُنشأ حساب جديد'));

check(
  'the approval is confirmable',
  (await confirmInDialog('الموافقة والاستعادة')) === 'clicked',
);
await wait(1800);
check(
  'the screen reports the account reopened',
  (await bodyText()).includes('أُعيد فتح الحساب'),
);

await close();
finish();
