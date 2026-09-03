/**
 * **A beneficiary claims her own account, in a browser** (R132).
 *
 * ## Why this exists at this layer
 *
 * The service suite proves the invariants — nothing binds until approval, the
 * binding lands on the same `User`, an identity is never overwritten. What it
 * cannot see is whether the two people involved can actually *do* it: whether
 * the beneficiary's entry point exists and says the honest sentence, and whether
 * a Super Admin can find the pending claim and decide it. That is rule P's
 * recurring defect on this project — a complete capability with no reach — and
 * for a credential-binding flow the cost of it would be an account nobody can
 * ever claim.
 *
 * It also pins one thing that must NOT appear: the Google provider subject. It
 * is a credential coordinate, and a review screen that renders it would be
 * handing an administrator something no decision needs.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const TOKEN = process.env.ONBOARDING_TOKEN;
const EMAIL = process.env.ONBOARDING_EMAIL;
const SUBJECT = process.env.ONBOARDING_SUBJECT;
const CODE = process.env.REFERENCE_CODE;
const ADMIN_COOKIE = process.env.ADMIN_REFRESH_COOKIE;
if (!TOKEN || !EMAIL || !CODE || !ADMIN_COOKIE || !SUBJECT) {
  throw new Error('ONBOARDING_TOKEN, ONBOARDING_EMAIL, ONBOARDING_SUBJECT, REFERENCE_CODE and ADMIN_REFRESH_COOKIE are required');
}

const { send, evaluate, close } = await connect(process.env.PORT ?? '9243');
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

async function navigate(url, selector) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`(() => !!document.querySelector(${JSON.stringify(selector)}))()`).catch(() => false);
    if (ready) return true;
    await wait(250);
  }
  return false;
}

/* ── 1 · Her entry point exists and is reachable from the onboarding state ─ */
check(
  'the register form renders from an onboarding token',
  await navigate(`${BASE}/register#onboarding_token=${TOKEN}`, 'form.register-form'),
);

check(
  'R132: the self-managed option is offered',
  (await bodyText()).includes('لديّ سجل سابق في الجمعية وأريد حساباً خاصاً بي'),
);

check(
  'the self-managed mode is selectable',
  (await setSelectValue('نوع التسجيل', 'self_managed')) === 'self_managed',
);
await wait(250);

/* ── 2 · The honest sentence — verification is NOT a transfer ───────────── */
const notice = await bodyText();
check(
  'it says the administration reviews the request rather than implying instant transfer',
  notice.includes('تراجع الإدارة الطلب') && notice.includes('لا ينقل الحساب فوراً'),
);
check(
  'it promises the educational history stays on the same account',
  notice.includes('يبقى سجلك التعليمي كاملاً على الحساب نفسه'),
);

/* ── 3 · She asks for nothing but her code ──────────────────────────────── */
check(
  'the form asks for the reference code and not for her name or a branch',
  notice.includes('رقم التسجيل الخاص بك') && !notice.includes('الاسم الشخصي*'),
);
check('the reference code is accepted', (await setInput('رقم التسجيل الخاص بك', CODE)) === 'ok');

check('the request is submittable', (await clickText('إرسال')) === 'clicked');
await wait(1200);
check(
  'the request was accepted and she is told it is under review',
  (await bodyText()).includes('وصل طلبك') || (await bodyText()).includes('شكراً'),
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
  await navigate(`${BASE}/admin/self-managed-claims`, 'table'),
);
await wait(800);

const review = await bodyText();
check('the pending claim is listed by its record', review.includes(CODE), review.slice(0, 200));
check('the address that would become her login is shown', review.includes(EMAIL));
/* ── 5 · And the credential coordinate is NOWHERE on the page ───────────── */
check(
  'R132: the Google provider subject is never rendered',
  !review.includes(SUBJECT) && !(await evaluate('document.body.innerHTML')).includes(SUBJECT),
);

await close();
finish();
