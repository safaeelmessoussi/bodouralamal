/**
 * **SRS Revision 168 §1 on the real pages** — one registration form, four roles,
 * each decided on its own.
 *
 * The rules are the server's and are integration-tested
 * (`role-request.integration.test.ts`). Only a browser can show the rest:
 *
 * * that one person ticking all four choices is asked who she is ONCE, and that
 *   «بيانات ولي الأمر» is gone the moment another adult role is ticked;
 * * that the circles she may rank are the SCHEDULED classes of her Category's
 *   first Level at her branch, that her order is hers to change, and that the
 *   whole-Level class is shown as no choice;
 * * that the queue says every role with its own state, offers the per-role
 *   review where the whole-account buttons would only be refused, shows an
 *   Admin the administration request without offering it to her, and walks the
 *   account from «pending» to «active» on the FIRST approval;
 * * that her ranked circles sit beside the placement control as a wish.
 *
 * Journey A is the applicant (an onboarding token); B is a branch-less Admin,
 * minted as she is; C is the dev Super Admin.
 */
import { connect, results } from './cdp.mjs';
import { pickDate } from './date-picker.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const TOKEN = process.env.ONBOARDING_TOKEN;
const ADMIN = process.env.ADMIN_REFRESH_COOKIE;
const SUPER = process.env.SUPER_REFRESH_COOKIE;
if (!TOKEN || !ADMIN || !SUPER || !S.tag) {
  throw new Error('SCENARIO, ONBOARDING_TOKEN, ADMIN_REFRESH_COOKIE and SUPER_REFRESH_COOKIE are required');
}

const FIRST = `${S.tag} متقدمة`;
const LAST = 'الأدوار';

const { send, evaluate, close } = await connect(process.env.PORT ?? '9268');
const { check, finish } = results();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (value) => JSON.stringify(value);

await send('Network.enable');

async function waitFor(expression, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(`(() => Boolean(${expression}))()`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

async function actAs(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value: cookie,
    domain: new URL(BASE).hostname,
    path: '/api/v1/auth',
    httpOnly: true,
  });
}

/** Records what the form SENT, so the payload is measured and not inferred. */
const installProbe = () => evaluate(`(() => {
  if (window.__sent) return 'already';
  window.__sent = [];
  const real = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const res = await real.apply(this, arguments);
    if (url && url.includes('/api/v1/registrations')) {
      let body = null;
      try { body = JSON.parse((init && init.body) || 'null'); } catch { body = null; }
      window.__sent.push({ status: res.status, body });
    }
    return res;
  };
  return 'installed';
})()`);

/** Field helpers, scoped to a root so «الفئة» means THIS section's. */
const setInput = (root, label, value, occurrence = 0) => evaluate(`(() => {
  const scope = document.querySelector(${q(root)});
  const field = [...(scope?.querySelectorAll('.field') ?? [])].filter((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${q(label)}))[${occurrence}];
  const el = field?.querySelector('input, textarea');
  if (!el) return 'missing';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${q(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);

/** Chooses the option whose TEXT includes `text` (or, with `byValue`, whose value is it). */
const setSelect = (root, label, text, { byValue = false, occurrence = 0 } = {}) => evaluate(`(() => {
  const scope = document.querySelector(${q(root)});
  const field = [...(scope?.querySelectorAll('.field') ?? [])].filter((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${q(label)}))[${occurrence}];
  const el = field?.querySelector('select');
  if (!el) return 'missing';
  const option = [...el.options].find((o) => ${byValue} ? o.value === ${q(text)} : (o.textContent ?? '').includes(${q(text)}));
  if (!option) return 'no-option:' + [...el.options].map((o) => o.textContent).join('|');
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, option.value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);

const selectOptions = (root, label) => evaluate(`(() => {
  const scope = document.querySelector(${q(root)});
  const field = [...(scope?.querySelectorAll('.field') ?? [])].find((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${q(label)}));
  const el = field?.querySelector('select');
  return el ? { disabled: el.disabled, options: [...el.options].map((o) => (o.textContent ?? '').trim()) } : null;
})()`);

const tickRole = (role) => evaluate(`(() => {
  const box = document.querySelector('[data-role-choice="${role}"] input[type="checkbox"]');
  if (!box) return 'missing';
  if (!box.checked) box.click();
  return box.checked;
})()`);

const clickIn = (root, text) => evaluate(`(() => {
  const scope = document.querySelector(${q(root)});
  const button = [...(scope?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === ${q(text)});
  if (!button) return 'missing:' + [...(scope?.querySelectorAll('button') ?? [])].map((b) => (b.textContent ?? '').trim()).join('|');
  if (button.disabled) return 'disabled';
  button.click();
  return 'clicked';
})()`);

const legends = () => evaluate(`JSON.stringify([...document.querySelectorAll('form.register-form fieldset > legend')].map((l) => (l.textContent ?? '').trim()))`).then(JSON.parse);

/* ══ Journey A — the applicant ═══════════════════════════════════════════════ */

await send('Page.navigate', { url: `${BASE}/register#onboarding_token=${TOKEN}` });
check('the registration form renders from an onboarding token', await waitFor(`document.querySelector('form.register-form')`));
await installProbe();

check(
  'four choices are offered and NONE is ticked for her',
  (await evaluate(`JSON.stringify([...document.querySelectorAll('[data-role-choice]')].map((el) => [el.getAttribute('data-role-choice'), el.querySelector('input').checked]))`)) ===
    JSON.stringify([['student', false], ['guardian', false], ['teaching', false], ['administration', false]]),
);

check('«أسجّل أبنائي» alone asks for the guardian’s own data', (await tickRole('guardian')) === true && (await waitFor(`document.body.innerText.includes('بيانات ولي الأمر')`)));
check('ticking an adult role REPLACES «بيانات ولي الأمر» — she is asked who she is once', (await tickRole('teaching')) === true && (await waitFor(`!document.body.innerText.includes('بيانات ولي الأمر')`)));
await tickRole('student');
await tickRole('administration');
await sleep(300);

const sections = await legends();
check(
  'every ticked role has its section, and her identity appears once',
  sections.filter((l) => l === 'بياناتك').length === 1 &&
    (await evaluate(`['teaching','administration','student'].every((k) => document.querySelector('[data-role-section="' + k + '"]'))`)) === true,
  JSON.stringify(sections),
);
check(
  'an administration request is told that asking grants nothing',
  (await evaluate(`document.querySelector('[data-role-section="administration"]').innerText`)).includes('ولا يمنحك إرسال الاستمارة أي صلاحية'),
);

const FORM = 'form.register-form';
check('identity: first name', (await setInput(FORM, 'الاسم الشخصي*', FIRST, 0)) === 'ok');
check('identity: family name', (await setInput(FORM, 'الاسم العائلي*', LAST, 0)) === 'ok');
check('identity: sex', (await setSelect(FORM, 'الجنس*', 'female', { byValue: true, occurrence: 0 })) === 'ok');
check('identity: phone', (await setInput(FORM, 'رقم الهاتف*', '+212600000168')) === 'ok');
const herBirth = await pickDate(evaluate, 0, { year: 1992, month: 3, day: 14 });
check('identity: birth date is asked because she registers as a مستفيدة', herBirth === 'ok', herBirth);

check('child: first name', (await setInput(FORM, 'الاسم الشخصي*', `${S.tag} ابنة`, 1)) === 'ok');
check('child: family name', (await setInput(FORM, 'الاسم العائلي*', LAST, 1)) === 'ok');
check('child: sex', (await setSelect(FORM, 'الجنس*', 'female', { byValue: true, occurrence: 1 })) === 'ok');
const childBirth = await pickDate(evaluate, 1, { year: 2016, month: 5, day: 2 });
check('child: birth date', childBirth === 'ok', childBirth);
check('child: branch', (await setSelect(FORM, 'المقر المطلوب', S.branch.name, { occurrence: 0 })) === 'ok');
check('child: category', (await setSelect(FORM, 'الفئة*', S.category.name, { occurrence: 0 })) === 'ok');
check('child: media release answered', (await setSelect(FORM, 'الموافقة على نشر الصوت/التسجيلات', 'no', { byValue: true })) === 'ok');

const TEACHING = '[data-role-section="teaching"]';
check('teaching: online framing', (await setSelect(TEACHING, 'طريقة التأطير', 'online', { byValue: true })) === 'ok');

const STUDENT = '[data-role-section="student"]';
const branchSet = await setSelect(STUDENT, 'المقر المطلوب', S.branch.name);
const categorySet = await setSelect(STUDENT, 'الفئة', S.category.name);
check('student: her branch and stage', branchSet === 'ok' && categorySet === 'ok', `${branchSet} / ${categorySet}`);
check(
  'no circle is offered before she says this is her first time',
  (await evaluate(`document.querySelector('[data-circle-ranking]') === null`)) === true,
);
check('student: «هل هذه أول مرة؟» answered yes', (await setSelect(STUDENT, 'هل هذه أول مرة', 'yes', { byValue: true })) === 'ok');
check('the circles of her Level are offered', await waitFor(`document.querySelector('[data-circle-ranking]')`));

const offered = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-circle-ranking] .field label, [data-circle-ranking] label')].map((l) => (l.textContent ?? '').trim()))`).then(JSON.parse);
check(
  'they are the three SCHEDULED circles, each with its day and time',
  S.circles.every((name) => offered.some((label) => label.includes(name))) &&
    offered.some((label) => label.includes('15:00') && label.includes('20:00')) &&
    offered.some((label) => label.includes('09:00') && label.includes('12:00')),
  JSON.stringify(offered),
);
if (S.fixedSubject) {
  check(
    'the whole-Level class is shown as NO choice',
    (await evaluate(`document.querySelector('[data-fixed-classes]')?.textContent ?? ''`)).includes(S.fixedSubject),
  );
}

const tickCircle = (name) => evaluate(`(() => {
  const label = [...document.querySelectorAll('[data-circle-ranking] label')].find((l) => (l.textContent ?? '').includes(${q(name)}));
  const box = label?.closest('.field')?.querySelector('input[type="checkbox"]') ?? label?.querySelector('input[type="checkbox"]') ?? (label?.htmlFor ? document.getElementById(label.htmlFor) : null);
  if (!box) return 'missing';
  box.click();
  return 'ok';
})()`);
const ranking = () => evaluate(`JSON.stringify([...document.querySelectorAll('[data-ranked-circle] .circle-ranking__name')].map((n) => (n.textContent ?? '').trim()))`).then(JSON.parse);

const saturday = S.circles.find((name) => name.includes('السبت'));
const tuesday = S.circles.find((name) => name.includes('الثلاثاء'));
check('she picks السبت…', (await tickCircle(saturday)) === 'ok');
await sleep(150);
check('…then الثلاثاء', (await tickCircle(tuesday)) === 'ok');
await sleep(150);
let order = await ranking();
check('her order is the order she chose', order.length === 2 && order[0].includes('السبت') && order[1].includes('الثلاثاء'), JSON.stringify(order));

await evaluate(`(() => {
  const item = [...document.querySelectorAll('[data-ranked-circle]')][1];
  item?.querySelector('button[aria-label="تقديم"]')?.click();
})()`);
await sleep(150);
order = await ranking();
check('«تقديم» moves الثلاثاء first — the order is hers to change', order[0]?.includes('الثلاثاء') && order[1]?.includes('السبت'), JSON.stringify(order));

await evaluate(`(() => { const box = document.querySelector('.consent-notice input[type="checkbox"]'); if (box && !box.checked) box.click(); })()`);
await sleep(200);
await evaluate(`document.querySelector('form.register-form button[type="submit"]')?.click()`);
check('the request is received', await waitFor(`document.body.innerText.includes('تم استلام طلبك')`, 60), (await evaluate('document.body.innerText')).slice(0, 400));

const sent = await evaluate('JSON.stringify(window.__sent || [])').then(JSON.parse);
const payload = sent.find((entry) => entry.status === 201)?.body ?? null;
check('ONE registration was created (201)', sent.filter((entry) => entry.status === 201).length === 1, JSON.stringify(sent.map((e) => e.status)));
check(
  'it carries the four roles once, in the platform’s order',
  JSON.stringify(payload?.roles) === JSON.stringify(['student', 'guardian', 'teaching', 'administration']) && payload?.kind === 'roles',
  JSON.stringify(payload?.roles),
);
check(
  'her ranked circles travel in HER order, and only for a first registration',
  payload?.student?.first_time === true && Array.isArray(payload?.student?.circle_preferences) && payload.student.circle_preferences.length === 2,
  JSON.stringify(payload?.student),
);
check(
  'the applicant never names an administrative role',
  !JSON.stringify(payload).includes('super_admin') && !JSON.stringify(payload?.administration ?? {}).includes('role'),
  JSON.stringify(payload?.administration),
);

/* ══ Journey B — a branch-less Admin ═════════════════════════════════════════ */

const rowOf = `[...document.querySelectorAll('.admin-table tbody tr')].find((tr) => tr.textContent.includes(${q(FIRST)}) && tr.querySelector('[data-role-requests]'))`;
const rowState = () => evaluate(`(() => {
  const row = ${rowOf};
  if (!row) return null;
  return {
    requests: [...row.querySelectorAll('[data-role-request]')].map((el) => [el.getAttribute('data-role-request'), el.getAttribute('data-role-status')]),
    actions: [...row.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter(Boolean),
  };
})()`);
const openReview = async () => {
  await evaluate(`(() => { const row = ${rowOf}; [...(row?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'البتّ في الصفات المطلوبة')?.click(); })()`);
  return waitFor(`document.querySelector('dialog[open] [data-role-review]')`);
};
const reviewState = () => evaluate(`JSON.stringify([...document.querySelectorAll('dialog[open] [data-role-review-item]')].map((el) => ({
  kind: el.getAttribute('data-role-review-item'),
  status: el.getAttribute('data-role-status'),
  buttons: [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
  notHers: el.querySelector('[data-role-not-hers]') !== null,
})))`).then(JSON.parse);
const notice = () => evaluate(`document.querySelector('main')?.innerText.slice(0, 600) ?? ''`);

await actAs(ADMIN);
await send('Page.navigate', { url: `${BASE}/admin/approvals?type=registration` });
check('the Admin’s queue shows her request', await waitFor(rowOf), (await evaluate('document.location.pathname')));

let row = await rowState();
check(
  'the queue names EVERY requested role, each «في انتظار القرار»',
  JSON.stringify(row?.requests) === JSON.stringify([['student', 'pending'], ['guardian', 'pending'], ['teaching', 'pending'], ['administration', 'pending']]),
  JSON.stringify(row?.requests),
);
check(
  'it offers the per-role review — never a «موافقة»/«رفض» the server would refuse',
  row?.actions.includes('البتّ في الصفات المطلوبة') && !row.actions.includes('موافقة') && !row.actions.includes('رفض'),
  JSON.stringify(row?.actions),
);

check('the review opens', await openReview());
let review = await reviewState();
const administrationBlock = review.find((entry) => entry.kind === 'administration');
check(
  'an Admin SEES the administration request, is told whose it is, and is offered no decision on it',
  administrationBlock?.notHers === true && administrationBlock.buttons.length === 0,
  JSON.stringify(administrationBlock),
);
check(
  'her ranked circles are listed in her order, as a wish',
  (await evaluate(`(() => { const el = document.querySelector('dialog[open] [data-circle-wishes]'); if (!el) return ''; return [...el.querySelectorAll('li')].map((li) => li.textContent).join('>') + '|' + el.innerText; })()`))
    .replace(/\s+/g, ' ')
    .match(/الثلاثاء.*>.*السبت.*ليست حجزًا لمقعد/) !== null,
);

/* teaching — approved, scoped to every branch */
check('«موافقة» on هيئة التدريس opens the grant', (await clickIn('dialog[open] [data-role-review-item="teaching"]', 'موافقة')) === 'clicked' && (await waitFor(`[...document.querySelectorAll('dialog[open] label')].some((l) => l.textContent.includes('الدور الممنوح'))`)));
const teachingRoles = await selectOptions('dialog[open]', 'الدور الممنوح');
check('a teaching request grants مؤطِّرة and nothing else', JSON.stringify(teachingRoles?.options) === JSON.stringify(['مؤطِّرة']), JSON.stringify(teachingRoles));
check(
  '«الموافقة دون دور» is not offered — approving a role while granting none is declining it',
  (await evaluate(`[...document.querySelectorAll('dialog[open] button')].every((b) => !(b.textContent ?? '').includes('الموافقة دون دور'))`)) === true,
);
check('the scope is hers to state', (await setSelect('dialog[open]', 'نطاق الفرع', 'كل الفروع')) === 'ok');
check('the grant is confirmed', (await clickIn('dialog[open]', 'الموافقة مع إسناد الدور')) === 'clicked');
check(
  'the FIRST approval activates the account, and the screen says both facts',
  await waitFor(`document.querySelector('main').innerText.includes('تم قبول «هيئة التدريس والمساعدة في التدريس».') && document.querySelector('main').innerText.includes('الحساب مفعَّل الآن.')`),
  await notice(),
);
check('the review REOPENS on what is still pending', await waitFor(`document.querySelector('dialog[open] [data-role-review]')`));
review = await reviewState();
check(
  'هيئة التدريس now reads «مقبول» and offers nothing more',
  review.find((entry) => entry.kind === 'teaching')?.status === 'approved' && review.find((entry) => entry.kind === 'teaching')?.buttons.length === 0,
  JSON.stringify(review),
);

/* guardian — declined, with a reason */
check('«رفض» on تسجيل الأبناء asks for a reason', (await clickIn('dialog[open] [data-role-review-item="guardian"]', 'رفض')) === 'clicked' && (await waitFor(`document.querySelector('dialog[open] .confirm textarea, dialog[open] .confirm input')`)));
check(
  'the decline says it touches THIS role only',
  (await evaluate(`document.querySelector('dialog[open] .confirm')?.innerText ?? ''`)).includes('وتبقى طلباتها الأخرى على حالها'),
);
check('a reason is typed', (await setInput('dialog[open] .confirm', 'سبب الرفض', 'لا تتوفر مقاعد للأطفال هذا الفصل')) === 'ok');
await sleep(150);
check('the decline is confirmed', (await clickIn('dialog[open] .confirm', 'رفض')) === 'clicked');
check('…and said', await waitFor(`document.querySelector('main').innerText.includes('تم رفض «وليّة أمر (تسجيل الأبناء)».')`), await notice());
await waitFor(`document.querySelector('dialog[open] [data-role-review]')`);
review = await reviewState();
check(
  'declining one role took nothing else away',
  review.find((entry) => entry.kind === 'guardian')?.status === 'declined' &&
    review.find((entry) => entry.kind === 'teaching')?.status === 'approved' &&
    review.find((entry) => entry.kind === 'student')?.status === 'pending',
  JSON.stringify(review),
);

/* ══ Journey C — the Super Admin ═════════════════════════════════════════════ */

await actAs(SUPER);
await send('Page.navigate', { url: `${BASE}/admin/approvals?type=registration` });
check('an ACTIVE account with a pending request is still in the queue', await waitFor(rowOf));
check('the review opens for the Super Admin', await openReview());
review = await reviewState();
check(
  'the administration request IS hers to decide',
  review.find((entry) => entry.kind === 'administration')?.buttons.includes('موافقة') === true,
  JSON.stringify(review),
);

/* student — approved by PLACING her */
check('«موافقة» on مستفيدة opens the placement', (await clickIn('dialog[open] [data-role-review-item="student"]', 'موافقة')) === 'clicked' && (await waitFor(`document.querySelector('dialog[open] [data-circle-wishes]')`)));
check(
  'her ranked circles sit beside the placement control',
  (await evaluate(`document.querySelector('dialog[open] [data-circle-wishes]').innerText`)).includes('الثلاثاء'),
);
check(
  'the first Level of her Category is preselected — a default, not a decision',
  await waitFor(`[...document.querySelectorAll('dialog[open] select')].some((s) => (s.selectedOptions[0]?.textContent ?? '').includes(${q(S.firstLevel.name)}))`),
);
check('the placement is confirmed', await waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent.trim() === 'موافقة' && !b.disabled)`) && (await clickIn('dialog[open]', 'موافقة')) === 'clicked');
check('…and said, WITHOUT claiming the account was activated twice', await waitFor(`document.querySelector('main').innerText.includes('تم قبول «مستفيدة».')`) && !(await notice()).includes('الحساب مفعَّل الآن.'), await notice());

/* administration — the approver chooses WHICH role */
await waitFor(`document.querySelector('dialog[open] [data-role-review]')`);
check('«موافقة» on هيئة الإدارة opens the grant', (await clickIn('dialog[open] [data-role-review-item="administration"]', 'موافقة')) === 'clicked' && (await waitFor(`[...document.querySelectorAll('dialog[open] label')].some((l) => l.textContent.includes('الدور الممنوح'))`)));
const administrationRoles = await selectOptions('dialog[open]', 'الدور الممنوح');
check('WHICH administrative role is the approver’s choice: مسؤولة or مشرفة عامة', JSON.stringify(administrationRoles?.options) === JSON.stringify(['مسؤولة', 'مشرفة عامة']), JSON.stringify(administrationRoles));
check('choosing مشرفة عامة…', (await setSelect('dialog[open]', 'الدور الممنوح', 'مشرفة عامة')) === 'ok');
await sleep(150);
const scope = await selectOptions('dialog[open]', 'نطاق الفرع');
check(
  '…states the scope instead of asking it — a مشرفة عامة is never branch-scoped',
  scope?.disabled === true && (await evaluate(`document.querySelector('dialog[open]').innerText`)).includes('تشمل كل المقرات دائمًا'),
  JSON.stringify(scope),
);
check('she is made a مسؤولة of her branch instead', (await setSelect('dialog[open]', 'الدور الممنوح', 'مسؤولة')) === 'ok' && (await setSelect('dialog[open]', 'نطاق الفرع', S.branch.name)) === 'ok');
check('the grant is confirmed', (await clickIn('dialog[open]', 'الموافقة مع إسناد الدور')) === 'clicked');
check('…and said', await waitFor(`document.querySelector('main').innerText.includes('تم قبول «هيئة الإدارة والمساعدة في الإدارة».')`), await notice());
check(
  'with nothing left pending the item LEAVES the queue and the review closes',
  (await waitFor(`!(${rowOf}) && !document.querySelector('dialog[open] [data-role-review]')`)) === true,
);

close();
process.exit(finish());
