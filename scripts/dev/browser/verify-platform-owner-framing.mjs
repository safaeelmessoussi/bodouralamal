/**
 * R115 in a real browser over a disposable PostgreSQL/MinIO/pg-boss/Nginx
 * stack. The shell wrapper supplies only tagged synthetic identities.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE;
const FIXTURE = JSON.parse(process.env.R115_BROWSER_FIXTURE ?? '{}');
const ONBOARDING_TOKEN = process.env.ONBOARDING_TOKEN;
const OWNER_COOKIE = process.env.OWNER_REFRESH_COOKIE;
const OWNER_API_COOKIE = process.env.OWNER_API_REFRESH_COOKIE;
if (!BASE || !ONBOARDING_TOKEN || !OWNER_COOKIE || !OWNER_API_COOKIE || !FIXTURE.ownerId) {
  throw new Error('R115 browser environment is incomplete');
}

const { send, evaluate, close } = await connect(process.env.PORT ?? '9257');
const { check, finish } = results();

await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});

const pause = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(expression, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await evaluate(expression).catch(() => false);
    if (value) return value;
    await pause(250);
  }
  return false;
}

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  const found = await waitFor(`document.querySelector(${JSON.stringify(ready)}) !== null`);
  await pause(700);
  return found;
}

const setSelect = (label, value) => evaluate(`(() => {
  const field = [...document.querySelectorAll('.field')].find((node) =>
    (node.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)})
  );
  const select = field?.querySelector('select');
  if (!select) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(
    select,
    ${JSON.stringify(value)},
  );
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
})()`);

const setInput = (label, value) => evaluate(`(() => {
  const field = [...document.querySelectorAll('.field')].find((node) =>
    (node.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)})
  );
  const input = field?.querySelector('input, textarea');
  if (!input) return false;
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value;
})()`);

const framingState = () => evaluate(`(() => {
  const group = [...document.querySelectorAll('fieldset')].find((node) =>
    (node.querySelector('legend')?.textContent ?? '').includes('تفضيلات التأطير')
  );
  if (!group) return null;
  const multi = group.querySelector('.multi-select');
  return {
    text: group.textContent,
    chosen: multi ? multi.querySelectorAll('.multi-select__chosen li').length : 0,
    offers: multi ? [...multi.querySelectorAll('.multi-select__options button')].map((b) => b.textContent.trim()) : [],
    multiPresent: multi !== null,
    allPresent: [...group.querySelectorAll('label')].some((label) => label.textContent.includes('كل المقرات')),
    allChecked: [...group.querySelectorAll('label')].some((label) =>
      label.textContent.includes('كل المقرات') && label.closest('.field')?.querySelector('input')?.checked
    ),
  };
})()`);

const chooseFramingOffer = (index) => evaluate(`(() => {
  const group = [...document.querySelectorAll('fieldset')].find((node) =>
    (node.querySelector('legend')?.textContent ?? '').includes('تفضيلات التأطير')
  );
  const button = group?.querySelectorAll('.multi-select__options button')[${index}];
  if (!button) return false;
  button.click();
  return true;
})()`);

const setAllBranches = (checked) => evaluate(`(() => {
  const label = [...document.querySelectorAll('label')].find((node) => node.textContent.includes('كل المقرات'));
  const input = label?.closest('.field')?.querySelector('input[type=checkbox]');
  if (!input) return false;
  if (input.checked !== ${checked}) input.click();
  return input.checked;
})()`);

/* Registration: every framing shape is operated, not inferred from source. */
check('1 · the real registration form opens', await open(`/register#onboarding_token=${ONBOARDING_TOKEN}`, '.register-form'));
check('2 · choosing هيئة التأطير reveals the planning-only framing section', (await setSelect('نوع التسجيل', 'teacher')) === 'teacher' && (await waitFor("document.body.innerText.includes('تفضيلات التأطير')")));
check('3 · in-person framing requires an explicit physical scope', (await setSelect('طريقة التأطير', 'in_person')) === 'in_person' && (await framingState())?.multiPresent === true);
check('4 · one physical branch can be selected', (await chooseFramingOffer(0)) === true && (await framingState())?.chosen === 1);
check('5 · several physical branches can be selected', (await chooseFramingOffer(0)) === true && (await framingState())?.chosen === 2);
check('6 · future-inclusive all branches replaces the explicit branch set', (await setAllBranches(true)) === true && (await framingState())?.multiPresent === false);
check('7 · online framing exposes no physical branch control', (await setSelect('طريقة التأطير', 'online')) === 'online' && (await framingState())?.allPresent === false && (await framingState())?.multiPresent === false);
check('8 · switching away clears stale physical choices', (await setSelect('طريقة التأطير', 'in_person')) === 'in_person' && (await framingState())?.chosen === 0 && (await framingState())?.allChecked === false);
check('9 · both mode accepts the durable all-branches statement', (await setSelect('طريقة التأطير', 'both')) === 'both' && (await setAllBranches(true)) === true);

await setInput('الاسم الشخصي', '[r115-browser]');
await setInput('الاسم العائلي', 'طالبة التأطير');
await setSelect('الجنس', 'female');
await evaluate(`(() => {
  const boxes = [...document.querySelectorAll('input[type=checkbox]')];
  const consent = boxes.find((box) => !box.closest('fieldset')?.textContent.includes('تفضيلات التأطير'));
  if (consent && !consent.checked) consent.click();
  document.querySelector('form.register-form button[type=submit]')?.click();
})()`);
if (!(await waitFor("document.body.innerText.includes('تم استلام طلبك')"))) {
  throw new Error('registration did not reach the pending confirmation');
}

/* Real sessions and real API authority, still against synthetic users only. */
const accessTokenFor = async (cookie) => {
  const response = await fetch(`${BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE,
      Cookie: `bodour_refresh=${cookie}`,
    },
  });
  const body = await response.json();
  return body.access_token;
};
const ownerToken = await accessTokenFor(OWNER_API_COOKIE);
if (!ownerToken) throw new Error('synthetic owner session did not yield an access token');
const api = async (method, path, body) => {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: OWNER_COOKIE,
  url: `${BASE}/api/v1/auth`,
  path: '/api/v1/auth',
  httpOnly: true,
});

check('10 · the approver sees the requested framing mode', await open('/admin/approvals', '.admin-table') && (await waitFor("document.body.innerText.includes('[r115-browser]')")) && (await evaluate("document.body.innerText.includes('حضوري وعن بُعد')")));
check('11 · the approver sees future-inclusive all branches, not today’s ids', (await evaluate("document.body.innerText.includes('كل المقرات الحالية والمستقبلية') || document.body.innerText.includes('كل المقرات')")) === true);

const approvals = await api('GET', '/admin/approvals?page=1&page_size=100');
const applicantApproval = approvals.body?.data?.find((row) =>
  row.applicants?.some((person) => person.name.includes('[r115-browser]')),
);
if (!applicantApproval) throw new Error('tagged framing applicant is missing from the approval API');
const applicantId = applicantApproval.applicants.find((person) => person.role === 'applicant')?.id;
if (!applicantId) throw new Error('tagged framing applicant has no user id');
const approved = await api('POST', `/admin/approvals/${applicantApproval.id}/approve`, {
  assignments: [{ role: 'teacher', branch_id: FIXTURE.branchIds[0] }],
});
if (approved.status !== 200) throw new Error(`staff approval failed: ${approved.status}`);

const savedProfile = await api('PUT', `/admin/users/${applicantId}/teaching-profile`, {
  subject_ids: [],
  category_ids: [],
  availability: [
    { weekday: 'monday', start_time: '09:00', end_time: '10:00', mode: 'online' },
    { weekday: 'tuesday', start_time: '11:00', end_time: '12:00', mode: null },
  ],
});
if (savedProfile.status !== 200) throw new Error(`teaching profile save failed: ${savedProfile.status}`);

await open('/admin/teachers', '.admin-table');
await waitFor("document.body.innerText.includes('[r115-browser]')");
const openedProfile = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')].find((node) =>
    node.textContent.includes('[r115-browser]') && node.textContent.includes('طالبة التأطير')
  );
  const button = [...(row?.querySelectorAll('button') ?? [])].find((node) =>
    node.textContent.includes('الملف التدريسي')
  );
  button?.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const dialog = document.querySelector('dialog[open]');
  return {
    text: dialog?.textContent ?? '',
    modes: [...(dialog?.querySelectorAll('select') ?? [])]
      .filter((select) => [...select.options].some((option) => option.value === 'online'))
      .map((select) => select.value),
  };
})()`);
check('12 · the approved teaching profile preserves general framing read-only', openedProfile.text.includes('حضوري وعن بُعد') && openedProfile.text.includes('كل المقرات'), JSON.stringify(openedProfile));
const profileRoundTrip = await api('GET', `/admin/users/${applicantId}/teaching-profile`);
check('13 · a stated per-window mode round-trips through the real API and browser editor', profileRoundTrip.body?.data?.availability?.some((range) => range.mode === 'online') && openedProfile.modes.includes('online'), JSON.stringify({ api: profileRoundTrip.body?.data?.availability, browser: openedProfile.modes }));
check('14 · legacy/not-stated availability remains null and renders as unknown', profileRoundTrip.body?.data?.availability?.some((range) => range.mode === null) && openedProfile.modes.includes(''), JSON.stringify({ api: profileRoundTrip.body?.data?.availability, browser: openedProfile.modes }));

/* Platform Owner presentation and server backstops. */
check('15 · the synthetic Platform Owner reaches the real admin user surface', await open('/admin/users', '.admin-table') && (await evaluate("document.body.innerText.includes('المستخدمون')")));

const ownerList = await api('GET', `/admin/users?q=${encodeURIComponent('[r115-browser] المالكة المؤقتة')}&page=1&page_size=25`);
const ownerRow = ownerList.body?.data?.find((row) => row.id === FIXTURE.ownerId);
if (!ownerRow) throw new Error('synthetic owner is missing from the user API');
const ownerSearch = await evaluate(`(async () => {
  const input = document.querySelector('input[type=search]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '[r115-browser] المالكة المؤقتة');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 900));
  const row = [...document.querySelectorAll('.admin-table tbody tr')].find((node) =>
    node.textContent.includes('المالكة المؤقتة')
  );
  return { text: row?.textContent ?? '', actions: [...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()) };
})()`);
check('16 · owner lifecycle/transfer actions are withheld on her own row', ownerSearch.text.includes('مالكة المنصة') && !ownerSearch.actions.some((label) => label.includes('إيقاف') || label.includes('حذف') || label.includes('نقل ملكية')));

const ownerRoleSave = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')].find((node) =>
    node.textContent.includes('المالكة المؤقتة')
  );
  const edit = [...(row?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent.trim() === 'تعديل'
  );
  edit?.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { offered: Boolean(edit), noDialog: true };
  const fields = [...dialog.querySelectorAll('.field')];
  const role = fields.find((field) =>
    (field.querySelector('.field__label')?.textContent ?? '').trim().startsWith('إضافة دور'))
    ?.querySelector('select');
  const scope = fields.filter((field) =>
    (field.querySelector('.field__label')?.textContent ?? '').trim().startsWith('نطاق الفرع'))
    .at(-1)?.querySelector('select');
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  if (!role || !scope) return { offered: Boolean(edit), noDraft: true };
  set.call(role, 'teacher');
  role.dispatchEvent(new Event('change', { bubbles: true }));
  set.call(scope, ${JSON.stringify(FIXTURE.branchIds[0])});
  scope.dispatchEvent(new Event('change', { bubbles: true }));
  // Deliberately do NOT press «إضافة دور»: this proves the primary Save owns
  // the visible draft rather than silently discarding it.
  const save = [...dialog.querySelectorAll('button')].find((button) =>
    button.textContent.trim() === 'حفظ'
  );
  save?.click();
  await new Promise((resolve) => setTimeout(resolve, 1400));
  return { offered: Boolean(edit), draft: role.value, scope: scope.value,
           saved: Boolean(save), dialogOpen: Boolean(document.querySelector('dialog[open]')) };
})()`);
check('17 · the Owner edit form offers an ordinary role and primary Save commits its visible draft', ownerRoleSave.offered && ownerRoleSave.draft === 'teacher' && ownerRoleSave.scope === FIXTURE.branchIds[0] && ownerRoleSave.saved && ownerRoleSave.dialogOpen === false, JSON.stringify(ownerRoleSave));

const ownerAfterRoleSave = await api('GET', `/admin/users?q=${encodeURIComponent('[r115-browser] المالكة المؤقتة')}&page=1&page_size=25`);
const savedOwner = ownerAfterRoleSave.body?.data?.find((row) => row.id === FIXTURE.ownerId);
check('18 · global Super Admin stays protected while the branch-scoped Teacher role persists', savedOwner?.roles?.some((entry) => entry.role === 'super_admin' && entry.branch_id === null) && savedOwner?.roles?.some((entry) => entry.role === 'teacher' && entry.branch_id === FIXTURE.branchIds[0]), JSON.stringify(savedOwner?.roles));

const suspendOwner = await api('POST', `/admin/users/${FIXTURE.ownerId}/suspend`, {
  version: ownerRow.version,
  reason: 'synthetic browser refusal proof',
});
const stripOwnerRole = await api('PUT', `/admin/users/${FIXTURE.ownerId}/roles`, {
  assignments: [],
});
const deleteOwner = await api('DELETE', `/admin/users/${FIXTURE.ownerId}`);
check('19 · direct forged owner lifecycle/global-role writes fail closed server-side', suspendOwner.status === 409 && stripOwnerRole.status === 409 && deleteOwner.status === 409, JSON.stringify({ suspend: suspendOwner.status, roles: stripOwnerRole.status, delete: deleteOwner.status }));

await open('/admin/users', '.admin-table');
const targetState = await evaluate(`(async () => {
  const input = document.querySelector('input[type=search]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '[r115-browser] المالكة التالية');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const target = rows.find((row) => row.textContent.includes('المالكة التالية'));
  const ownerVisible = rows.some((row) => row.textContent.includes('المالكة المؤقتة'));
  const transfer = [...(target?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent.includes('نقل ملكية المنصة')
  );
  transfer?.click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const confirm = [...document.querySelectorAll('dialog[open] button')].find((button) =>
    button.textContent.includes('نقل ملكية المنصة')
  );
  confirm?.click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return {
    ownerVisible,
    offered: Boolean(transfer),
    notice: document.body.innerText.includes('تم نقل ملكية المنصة'),
    remainingTransferActions: [...document.querySelectorAll('.admin-table button')].filter((button) =>
      button.textContent.includes('نقل ملكية المنصة')
    ).length,
  };
})()`);
check('20 · the real confirmation transfers ownership between synthetic Global Super Admins', targetState.offered && targetState.notice, JSON.stringify(targetState));
check('21 · transfer works while the current owner row is absent from the filtered page', targetState.ownerVisible === false, JSON.stringify(targetState));
check('22 · the stale former-owner page cannot offer a second transfer', targetState.remainingTransferActions === 0, JSON.stringify(targetState));

const afterTransfer = await api('POST', '/admin/platform-owner/transfer', {
  target_user_id: FIXTURE.ownerId,
  confirmation: 'TRANSFER_PLATFORM_OWNERSHIP',
});
check('23 · the former owner’s still-live bearer is rejected after the singleton transfer', afterTransfer.status === 403, JSON.stringify(afterTransfer.body));

close();
process.exit(finish());
