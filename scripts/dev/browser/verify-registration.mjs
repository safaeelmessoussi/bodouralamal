/**
 * **The registration journey a beneficiary actually performs**, in a browser.
 *
 * ## Why this exists
 *
 * A `POST /api/v1/registrations` returned **500** to an Owner using the real
 * form, and nothing in the repository noticed. The cause was environmental — a
 * fail-closed migration correctly refusing ambiguous data, so `normalized_email_lock`
 * did not exist — but the *reason it reached a person* is that the one journey
 * every beneficiary performs had **no browser regression at all**. The service
 * tests pass against a migrated database and can never see that.
 *
 * It also pins the thing that is NOT a defect and must not be "fixed": the SPA
 * calls `/auth/refresh` on every page load, so an anonymous registration page
 * produces **401 AUTH_REQUIRED** by design (§3.1, TD-12). What must never
 * happen is that envelope reaching the reader as raw JSON.
 *
 * §4.1b's only issuer of an onboarding token is the Google callback, which a
 * headless browser cannot complete — hence `issue-dev-onboarding.sh`, the
 * sibling of `issue-dev-session.sh`, calling the same production issuer under
 * the same guards.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const TOKEN = process.env.ONBOARDING_TOKEN;
const EMAIL = process.env.ONBOARDING_EMAIL;
const ADMIN_COOKIE = process.env.ADMIN_REFRESH_COOKIE;
if (!TOKEN || !EMAIL || !ADMIN_COOKIE) {
  throw new Error('ONBOARDING_TOKEN, ONBOARDING_EMAIL and ADMIN_REFRESH_COOKIE are required');
}

const { send, evaluate, close } = await connect(process.env.PORT ?? '9241');
const { check, finish } = results();

await send('Network.enable');

/** Records every API status this run produces, so "no 500" is measured. */
const installProbe = () => evaluate(`(() => {
  if (window.__calls) return 'already';
  window.__calls = [];
  const real = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const res = await real.apply(this, arguments);
    if (url && url.includes('/api/v1/')) {
      window.__calls.push({ url: String(url), status: res.status, method: (init && init.method) || 'GET' });
    }
    return res;
  };
  return 'installed';
})()`);
const calls = () => evaluate('JSON.stringify(window.__calls || [])').then((r) => JSON.parse(r));

const setInput = (label, value, occurrence = 0) => evaluate(`(() => {
  const f = [...document.querySelectorAll('.field')].filter((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)}))[${occurrence}];
  const el = f?.querySelector('input, textarea');
  if (!el) return 'missing';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);

const setSelect = (label, index, occurrence = 0) => evaluate(`(() => {
  const f = [...document.querySelectorAll('.field')].filter((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)}))[${occurrence}];
  const el = f?.querySelector('select');
  if (!el) return 'missing';
  const opt = [...el.options].filter((o) => o.value !== '')[${index}];
  if (!opt) return 'no-option';
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
})()`);

const setSelectValue = (label, value, occurrence = 0) => evaluate(`(() => {
  const f = [...document.querySelectorAll('.field')].filter((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)}))[${occurrence}];
  const el = f?.querySelector('select');
  if (!el || ![...el.options].some((option) => option.value === ${JSON.stringify(value)})) return 'missing';
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`);

const selectedText = (label, occurrence = 0) => evaluate(`(() => {
  const f = [...document.querySelectorAll('.field')].filter((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)}))[${occurrence}];
  const el = f?.querySelector('select');
  return el?.selectedOptions[0]?.textContent?.trim() ?? null;
})()`);

const clickButton = (text) => evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((entry) => (entry.textContent ?? '').includes(${JSON.stringify(text)}));
  if (!button) return 'missing';
  button.click();
  return 'clicked';
})()`);

const bodyText = () => evaluate('document.body.innerText');

async function open(token) {
  await send('Page.navigate', { url: `${BASE}/register#onboarding_token=${token}` });
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`(() => !!document.querySelector('form.register-form'))()`).catch(() => false);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* ── 1. The form is reachable from the onboarding state ─────────────────── */
check('the registration form renders from an onboarding token', await open(TOKEN));
await installProbe();

/* ── 2. No raw envelope reaches the reader, though a 401 IS produced ────── */
const text = await bodyText();
check(
  'no raw JSON error envelope is rendered to the applicant',
  !text.includes('"error"') && !text.includes('message_key') && !text.includes('request_id'),
  text.slice(0, 160),
);

/* ── 3. Fill the exact multi-child shape that failed in controlled UAT ──── */
check(
  'the parent + children registration path is selectable',
  (await setSelectValue('نوع التسجيل', 'parent_child')) === 'parent_child',
);
await new Promise((r) => setTimeout(r, 200));
check(
  'the guardian option explains that the applicant is registering children as وليّة أمر',
  (await bodyText()).includes('أُسجّل أبناءً أو بنات بصفتي وليّة أمر'),
);

check('ولي الأمر: الاسم الشخصي accepted', (await setInput('الاسم الشخصي*', 'ولية', 0)) === 'ok');
check('ولي الأمر: الاسم العائلي accepted', (await setInput('الاسم العائلي*', 'تحقق', 0)) === 'ok');
check('ولي الأمر: الجنس accepted', (await setSelect('الجنس*', 0, 0)) !== 'missing');
check(
  'the new-registration phone control is visibly required',
  (await bodyText()).includes('رقم الهاتف*'),
);

check('الطفلة 1: الاسم الشخصي accepted', (await setInput('الاسم الشخصي*', 'مريم', 1)) === 'ok');
check('الطفلة 1: الاسم العائلي accepted', (await setInput('الاسم العائلي*', 'تحقق', 1)) === 'ok');
check('الطفلة 1: الجنس accepted', (await setSelect('الجنس*', 0, 1)) !== 'missing');

check('الطفلة 1: تاريخ الميلاد accepted', (await setInput('تاريخ الميلاد*', '2015-06-02', 0)) === 'ok');
check('الطفلة 1: المقر accepted', (await setSelect('المقر المطلوب', 0, 0)) !== 'missing');
check('الطفلة 1: الفئة accepted', (await setSelect('الفئة*', 0, 0)) !== 'missing');
const child1Branch = await selectedText('المقر المطلوب', 0);
const child1Category = await selectedText('الفئة*', 0);
check(
  'الطفلة 1: media release YES accepted',
  (await setSelectValue('الموافقة على نشر الصوت/التسجيلات', 'yes', 0)) === 'yes',
);

check('a second child can be added', (await clickButton('إضافة ابن/ابنة')) === 'clicked');
await new Promise((r) => setTimeout(r, 200));
check(
  'the repeated child fieldset renders twice',
  (await evaluate(`document.querySelectorAll('fieldset legend').length`)) >= 4,
);

check('الطفلة 2: الاسم الشخصي accepted', (await setInput('الاسم الشخصي*', 'سلمى', 2)) === 'ok');
check('الطفلة 2: الاسم العائلي accepted', (await setInput('الاسم العائلي*', 'تحقق', 2)) === 'ok');
check('الطفلة 2: الجنس accepted', (await setSelect('الجنس*', 0, 2)) !== 'missing');
// A DIFFERENT date from her sister's: two children on one request are two
// people, and a payload that collapsed them onto one would pass with equal ones.
check('الطفلة 2: تاريخ الميلاد accepted', (await setInput('تاريخ الميلاد*', '2012-11-30', 1)) === 'ok');

/**
 * **R130 in a browser — the asymmetry IS the assertion.**
 *
 * Every child on a family request carries her own date of birth; the guardian
 * carries none, because she is admitted to nothing (R129). With two children on
 * the form the count must be exactly two — never three. Asserted here rather
 * than earlier because the second fieldset does not exist until it is added.
 *
 * A source test cannot see this: the control is rendered behind a prop each
 * caller decides, so the failure it guards against is a field appearing on the
 * wrong person's fieldset.
 */
const birthDateLabels = await evaluate(`JSON.stringify([...document.querySelectorAll('.field')].filter((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith('تاريخ الميلاد')).map((f) => (f.closest('fieldset')?.querySelector('legend')?.textContent ?? '(no fieldset)').trim()))`);
check(
  'R130: one تاريخ الميلاد per CHILD, and none for the guardian',
  JSON.parse(birthDateLabels).length === 2,
  birthDateLabels,
);
const child2BranchValue = await setSelect('المقر المطلوب', 1, 1);
const child2CategoryValue = await setSelect('الفئة*', 1, 1);
check('الطفلة 2: المقر accepted', !['missing', 'no-option'].includes(child2BranchValue));
check('الطفلة 2: الفئة accepted', !['missing', 'no-option'].includes(child2CategoryValue));
const child2Branch = await selectedText('المقر المطلوب', 1);
const child2Category = await selectedText('الفئة*', 1);
check(
  'the two children can carry different requested branches and categories',
  child1Branch !== null && child2Branch !== null && child1Branch !== child2Branch &&
    child1Category !== null && child2Category !== null && child1Category !== child2Category,
  JSON.stringify({ child1Branch, child2Branch, child1Category, child2Category }),
);
check(
  'الطفلة 2: media release NO accepted',
  (await setSelectValue('الموافقة على نشر الصوت/التسجيلات', 'no', 1)) === 'no',
);
check(
  'all six optional French-name controls explain the pair rule',
  (await bodyText()).split('اختياريان معاً: أدخلي الاسمين بالفرنسية أو اتركي الحقلين فارغين.').length - 1 === 6,
);

/* Prove the prospective phone rule independently of the consent rule below. */
await evaluate(`(() => {
  const c = document.querySelector('input[type="checkbox"]');
  if (c && !c.checked) c.click();
  return c ? c.checked : 'none';
})()`);
await new Promise((r) => setTimeout(r, 200));
await clickButton('إرسال الطلب');
await new Promise((r) => setTimeout(r, 250));
check(
  'missing required phone sends no registration request',
  (await calls()).filter((c) => c.url.includes('/registrations')).length === 0,
);
check(
  'missing required phone is explained in Arabic',
  (await bodyText()).includes('هذا الحقل مطلوب.'),
);
check('ولي الأمر: رقم الهاتف accepted', (await setInput('رقم الهاتف*', '+212600000099')) === 'ok');

await evaluate(`(() => {
  const c = document.querySelector('input[type="checkbox"]');
  if (c?.checked) c.click();
  return c ? c.checked : 'none';
})()`);
await new Promise((r) => setTimeout(r, 200));

/* The required request-level processing consent must fail before the wire. */
await clickButton('إرسال الطلب');
await new Promise((r) => setTimeout(r, 250));
check(
  'unchecked data-processing consent sends no registration request',
  (await calls()).filter((c) => c.url.includes('/registrations')).length === 0,
);
check(
  'unchecked data-processing consent is explained in Arabic',
  (await bodyText()).includes('لا يمكن إنشاء الحساب دون الموافقة على معالجة البيانات.'),
);

/* ── 4. Consent and submit the real form ────────────────────────────────── */
await evaluate(`(() => {
  const c = document.querySelector('input[type="checkbox"]');
  if (c && !c.checked) c.click();
  return c ? c.checked : 'none';
})()`);
await new Promise((r) => setTimeout(r, 300));

await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  if (b) b.click();
  return b ? 'submitted' : 'no-submit';
})()`);
await new Promise((r) => setTimeout(r, 3000));

/* ── 5. What actually happened on the wire ──────────────────────────────── */
const seen = await calls();
const reg = seen.filter((c) => c.url.includes('/registrations'));
const refresh = seen.filter((c) => c.url.includes('/auth/refresh'));

check('a registration request was made', reg.length >= 1, JSON.stringify(seen));
check(
  'registration did NOT return 500',
  reg.every((c) => c.status !== 500),
  JSON.stringify(reg),
);
check('registration succeeded', reg.some((c) => c.status === 201 || c.status === 200), JSON.stringify(reg));
check(
  'the anonymous /auth/refresh 401 is unchanged and treated as normal',
  refresh.length === 0 || refresh.every((c) => c.status === 401),
  JSON.stringify(refresh),
);

const after = await bodyText();
check(
  'the applicant sees a human confirmation, never an envelope',
  !after.includes('"error"') && !after.includes('request_id') && !after.includes('INTERNAL'),
  after.slice(0, 200),
);

/* ── 6. A retry of the single-use token creates nothing more ────────────── */
await open(TOKEN);
await installProbe();
await new Promise((r) => setTimeout(r, 800));
const replayText = await bodyText();
check(
  'replaying the consumed onboarding token does not present an envelope',
  !replayText.includes('"error"') && !replayText.includes('request_id'),
  replayText.slice(0, 160),
);

/* ── 7. The administrator follows the real notice to this exact request ─── */
await send('Network.clearBrowserCookies');
await send('Network.setCookie', {
  name: 'bodour_refresh', value: ADMIN_COOKIE,
  domain: new URL(BASE).hostname, path: '/api/v1/auth', httpOnly: true,
});
await send('Page.navigate', { url: `${BASE}/admin` });
for (let i = 0; i < 100; i += 1) {
  const ready = await evaluate(`(() => !!document.querySelector('.bell__trigger'))()`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
const bell = await evaluate(`(() => {
  const button = document.querySelector('.bell__trigger');
  if (!button) return false;
  button.click();
  return true;
})()`);
check('the authenticated administrator notification bell opens', bell === true);
for (let i = 0; i < 80; i += 1) {
  const ready = await evaluate(`(() => !!document.querySelector('.bell__panel .notifications__item'))()`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
const noticeClick = await evaluate(`(() => {
  const item = [...document.querySelectorAll('.bell__panel .notifications__item')]
    .find((entry) => (entry.textContent ?? '').includes('ولية تحقق'));
  const link = item?.querySelector('a');
  if (!link) return { clicked: false, panel: document.querySelector('.bell__panel')?.textContent?.slice(0, 300) ?? '' };
  link.click();
  return { clicked: true };
})()`);
check(
  'the new-registration notification exposes a review action for this applicant',
  noticeClick.clicked === true,
  JSON.stringify(noticeClick),
);
for (let i = 0; i < 100; i += 1) {
  const ready = await evaluate(`(() => document.body.innerText.includes('تفاصيل طلب التسجيل'))()`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
const review = await evaluate(`(() => ({
  path: window.location.pathname,
  query: window.location.search,
  text: document.body.innerText,
  hasMain: document.querySelector('main') !== null,
}))()`);
check(
  'notification navigation reaches the valid exact registration-review route',
  review.path === '/admin/approvals' && /^\?review_user_id=[0-9a-f-]{36}$/.test(review.query),
  `${review.path}${review.query}`,
);
check(
  'the exact review opens complete parent contact and both child blocks',
  review.text.includes('ولية') && review.text.includes('تحقق') &&
    review.text.includes('+212600000099') && review.text.includes(EMAIL) &&
    review.text.includes('مريم') && review.text.includes('سلمى'),
  review.text.slice(0, 600),
);
check(
  'the review preserves each child’s distinct requested branch and category',
  [child1Branch, child2Branch, child1Category, child2Category]
    .every((label) => label !== null && review.text.includes(label)),
  JSON.stringify({ child1Branch, child2Branch, child1Category, child2Category }),
);

/* An obsolete/already-decided coordinate must render an answer, never a blank
 * page. The HTTP integration owns decision races; this pins the browser state. */
await send('Page.navigate', {
  url: `${BASE}/admin/approvals?review_user_id=00000000-0000-4000-8000-000000000117`,
});
for (let i = 0; i < 80; i += 1) {
  const ready = await evaluate(`(() => document.body.innerText.includes('تم البتّ في هذا الطلب أو لم يعد متاحاً للمراجعة.'))()`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
const stale = await evaluate(`(() => ({
  hasMain: document.querySelector('main') !== null,
  text: document.body.innerText,
}))()`);
check(
  'a stale registration-review coordinate fails gracefully rather than blanking',
  stale.hasMain === true && stale.text.includes('تم البتّ في هذا الطلب أو لم يعد متاحاً للمراجعة.'),
  stale.text.slice(0, 300),
);

close();
process.exit(finish());
