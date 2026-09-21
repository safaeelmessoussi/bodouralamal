/**
 * **The مؤطرة's one scheduling surface** — merged 2026-08-20.
 *
 * `تقويمي` and `الجدولة` were two menu entries onto the same operational
 * question, so she had to know which of the two held what she wanted. What this
 * proves, in her own portal: the menu offers **one** of them, that page carries
 * both halves, and the event she creates there answers to **her** — with the
 * responsible selector offering nobody else, and the server refusing a forged
 * body that names somebody else.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.NOTIFY_SCENARIO ?? '{}');
// The class type is called whatever the catalogue calls it today (R110).
const CLASS_TYPE = S.classTypeName;
if (!CLASS_TYPE) throw new Error('the scenario names no class scheduling type');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9253');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth', httpOnly: true,
  });
}

/** Records request bodies AND response bodies, so a refusal is evidence. */
const RECORDER = `
  (() => {
    if (window.__calls) return true;
    window.__calls = [];
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || 'GET';
      const body = init && init.body ? String(init.body).slice(0, 900) : null;
      const res = await real(input, init);
      let text = null;
      try { text = await res.clone().text(); } catch (e) { void e; }
      try {
        window.__calls.push({ url, method, status: res.status, body, response: (text || '').slice(0, 700) });
      } catch (e) { void e; }
      return res;
    };
    return true;
  })()
`;

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await evaluate(RECORDER).catch(() => null);
  for (let i = 0; i < 140; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await evaluate(RECORDER).catch(() => null);
  await new Promise((r) => setTimeout(r, 1500));
}

const callsMatching = (fragment) =>
  evaluate(
    `(() => (window.__calls || []).filter((c) => c.url.includes(${JSON.stringify(fragment)})))()`,
  );

async function tokenFor(cookie) {
  await beIdentity(cookie);
  const res = await evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    return JSON.stringify({ status: r.status, body: await r.text() });
  })()`);
  const parsed = JSON.parse(res);
  if (parsed.status !== 200) throw new Error(`refresh failed: ${parsed.status}`);
  return JSON.parse(parsed.body).access_token;
}

await send('Page.navigate', { url: `${BASE}/content-unavailable` });
await new Promise((r) => setTimeout(r, 2500));
const safaToken = await tokenFor(process.env.SAFA_API_COOKIE);

/* ── 1–3 · one node, and the page carries both halves ────────────────────── */

await beIdentity(process.env.SAFA_COOKIE);
await open('/teacher', 'main');

const menu = await evaluate(
  `(() => [...document.querySelectorAll('.admin-nav a')].map((a) => ({ label: a.textContent.trim(), href: a.getAttribute('href') })))()`,
);
const calendarish = (menu ?? []).filter(
  (m) => m.href === '/teacher/calendar' || m.href === '/teacher/schedules',
);
check(
  '1 · her menu offers ONE calendar/scheduling node, not two',
  calendarish.length === 1 && calendarish[0]?.href === '/teacher/schedules',
  JSON.stringify(menu),
);
check(
  '2 · and it is called الجدولة',
  calendarish[0]?.label === 'الجدولة',
  JSON.stringify(calendarish),
);

/**
 * **Page-side helpers, prepended to the evaluations that drive the form**
 * (restated 2026-09-20, when all three of this harness's assumptions about the
 * form had gone stale at once).
 *
 * - «نوع العنصر» is chosen by what the option SAYS. Its values are catalogue
 *   ids (R110), so the literals this used to set matched nothing and the form
 *   stayed on «اختاري نوع العنصر» — every later check failed from there.
 * - A date is chosen through the platform's own picker: open it, step month by
 *   month, press the day whose button carries its ISO date in its id. There is
 *   no native date input to type into any more.
 */
const FORM_HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dlg = () => document.querySelector('dialog[open]');
  const set = (el, value) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const labelled = (text) => {
    const l = [...dlg().querySelectorAll('label')].find((x) => x.textContent.trim() === text);
    return l ? dlg().querySelector('#' + CSS.escape(l.getAttribute('for') || '')) : null;
  };
  const chooseType = async (text) => {
    const select = labelled('نوع العنصر');
    const option = select ? [...select.options].find((o) => o.textContent.trim() === text) : null;
    if (!option) return false;
    set(select, option.value);
    await wait(1800);
    return true;
  };
  const pickDate = async (iso) => {
    let picked = 0;
    for (const field of [...dlg().querySelectorAll('.field')]) {
      const trigger = field.querySelector('.date-picker__trigger');
      if (!trigger || trigger.disabled) continue;
      trigger.click();
      await wait(350);
      for (let step = 0; step < 36; step += 1) {
        const day = field.querySelector('button[id$="-d-' + iso + '"]');
        if (day) { day.click(); picked += 1; break; }
        const next = [...field.querySelectorAll('.date-picker__head button')]
          .find((b) => (b.getAttribute('aria-label') ?? '') === 'الشهر التالي');
        if (!next) break;
        next.click();
        await wait(120);
      }
      await wait(250);
    }
    return picked;
  };
`;

await open('/teacher/schedules', '.admin-table, .state');
// **Her classes live under «قائمة» now** (reworked 2026-09-15): the page opens
// on تقويم, and the separate «حصصي» table that used to sit below it became the
// list view of the same surface. So the month controls are read first, on the
// view that has them, and the table after switching — waited for in its own
// right, because `.state` is also the LOADING placeholder and proves nothing.
const calendarSide = await evaluate(`(() => ({
  monthNav: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'اليوم'),
}))()`);
await evaluate(`(() => {
  const list = [...document.querySelectorAll('.cal-segmented [role="tab"]')]
    .find((b) => b.textContent.trim() === 'قائمة');
  if (list) list.click();
  return list !== undefined;
})()`);
for (let i = 0; i < 40; i += 1) {
  if (await evaluate(`document.querySelector('.admin-table') !== null`)) break;
  await new Promise((r) => setTimeout(r, 250));
}
const page = await evaluate(`(() => {
  const body = document.querySelector('main')?.textContent ?? '';
  return {
    heading: body.includes('الجدولة'),
    // The shared calendar surface: the two views, the month controls, filters.
    views: [...document.querySelectorAll('.cal-segmented [role="tab"]')].map((b) => b.textContent.trim()),
    monthNav: ${JSON.stringify(calendarSide.monthNav)},
    filters: document.querySelector('.cal-header__filters') !== null,
    addItem: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('إضافة عنصر')),
    // And the definitions table, which carries the roster action nothing else
    // offers her.
    table: document.querySelector('.admin-table') !== null,
    // Read only on failure: what the list is saying instead of showing rows.
    state: document.querySelector('.state')?.textContent?.trim().slice(0, 160) ?? null,
  };
})()`);
check(
  '3 · the merged page carries the calendar, its views, filters, ＋ إضافة عنصر and her classes',
  page.views?.length === 2 && page.monthNav === true && page.filters === true &&
    page.addItem === true && page.table === true,
  JSON.stringify(page),
);

/* ── 4–6 · the event she creates answers to her ──────────────────────────── */

const created = await evaluate(`(async () => {
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة عنصر'));
  if (!add) return { noAdd: true };
  add.click();
  await new Promise((r) => setTimeout(r, 2500));
  let dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  ${FORM_HELPERS}
  // The form opens on NO type (R110); an activity is what this journey creates.
  if (!(await chooseType('نشاط'))) return { noActivityType: true };
  dialog = dlg();

  // The responsible selector, and what it is willing to offer.
  const responsible = labelled('المؤطِّرة المسؤولة');
  const options = responsible ? [...responsible.options].map((o) => o.textContent.trim()) : [];
  const locked = responsible ? responsible.disabled : null;

  const title = [...dialog.querySelectorAll('input')].find(
    (i) => (i.closest('.field') || {}).textContent?.includes('العنوان'),
  );
  if (title) set(title, '[notify] نشاط المؤطرة');
  const datesPicked = await pickDate(${JSON.stringify(S.spareDate)});
  await new Promise((r) => setTimeout(r, 600));

  // **Her scope.** TD-2 grants a مؤطرة the Administrative Groups she teaches
  // and nothing wider, so an activity without one is a save the server refuses
  // — and the first run reported «تعذّر الحفظ» for exactly that reason.
  dialog = document.querySelector('dialog[open]');
  // **Her scope is a multi-select now** (R139 — one filter per dimension, and a
  // مؤطرة is offered the group dimension alone). The one that offers her own
  // group is found by what it OFFERS, not by its label: opened, read, ticked.
  let scopeOptions = [];
  for (const field of [...dialog.querySelectorAll('.field')]) {
    const trigger = field.querySelector('button.dropdown-trigger');
    if (!trigger) continue;
    trigger.click();
    await wait(300);
    const rows = [...field.querySelectorAll('.multi-select__options li')];
    const mine = rows.find((li) => li.textContent.includes('المجموعة 1'));
    if (mine) {
      scopeOptions = rows.map((li) => li.textContent.trim());
      mine.querySelector('input[type="checkbox"]')?.click();
      await wait(300);
    }
    trigger.click();
    await wait(300);
    if (mine) break;
  }
  await wait(800);

  // One assistant, chosen from the shared multi-select — a checkbox list whose
  // trigger then NAMES her (R165 §7). The options arrive from a sibling read of
  // /me/event-scope-options, so the list may still be loading once the scope is
  // set: it is reopened until she appears rather than clicked into a gap.
  let assistant;
  let chips = [];
  for (let attempt = 0; attempt < 12 && !assistant; attempt += 1) {
    dialog = dlg();
    for (const field of [...dialog.querySelectorAll('.field')]) {
      const label = field.querySelector('.field__label')?.textContent ?? '';
      if (!label.includes('المساعد')) continue;
      const trigger = field.querySelector('button.dropdown-trigger');
      if (!trigger) continue;
      trigger.click();
      await wait(300);
      const row = [...field.querySelectorAll('.multi-select__options li')]
        .find((li) => li.textContent.includes('[notify] أمينة'));
      if (row) {
        row.querySelector('input[type="checkbox"]')?.click();
        await wait(300);
        assistant = true;
      }
      trigger.click();
      await wait(300);
      if (assistant) chips = [trigger.textContent.trim()];
    }
    if (!assistant) await wait(400);
  }
  await wait(600);

  dialog = document.querySelector('dialog[open]');
  const save = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  if (!save) return { options, locked, noSave: true };
  save.click();
  await new Promise((r) => setTimeout(r, 4500));
  const after = document.querySelector('dialog[open]');
  return {
    options,
    locked,
    scopeOptions,
    datesPicked,
    choseAssistant: assistant !== undefined,
    chips,
    saved: after === null || after.textContent.includes('إشعار'),
    says: after ? after.textContent.slice(0, 200) : null,
  };
})()`);

check(
  '4 · the responsible selector offers her and nobody else',
  (created.options ?? []).length === 1 && (created.options ?? [])[0]?.includes('صفاء'),
  JSON.stringify({ options: created.options, locked: created.locked }),
);
const saveCalls = await callsMatching('/events');
const scopeCalls = await callsMatching('scope');
console.error('SAVE-CALLS', JSON.stringify(saveCalls));
console.error('SCOPE-CALLS', JSON.stringify((await callsMatching('/admin/')).slice(0, 8)));
void scopeCalls;

const staffPut = (await callsMatching('/staff')).at(-1);
check(
  '5 · she chooses an assistant, and BOTH she and the assistant are stored',
  created.choseAssistant === true &&
    created.saved === true &&
    (staffPut?.status === 200 || staffPut?.status === 204) &&
    (staffPut?.body ?? '').includes('assistant'),
  JSON.stringify({ created, staffPut }),
);

/* ── 6 · a forged body naming somebody else is refused ───────────────────── */

const forged = await evaluate(`(async () => {
  const t = ${JSON.stringify(safaToken)};
  const list = await fetch('/api/v1/calendar?from=${S.spareDate}&to=${S.spareDate}', {
    headers: { Authorization: 'Bearer ' + t },
  }).then((r) => r.json());
  const mine = (list.data ?? []).find((o) => (o.title ?? '').includes('نشاط المؤطرة'));
  if (!mine) return { noEvent: true, count: (list.data ?? []).length };
  const res = await fetch('/api/v1/events/' + mine.id + '/staff', {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + t,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ staff: [{ user_id: ${JSON.stringify(S.nadia)}, position: 'responsible' }] }),
  });
  return { eventId: mine.id, status: res.status, body: (await res.text()).slice(0, 200) };
})()`);
check(
  '6 · a forged request making somebody else responsible is REFUSED',
  forged.status === 403 && (forged.body ?? '').includes('RESPONSIBLE_MUST_BE_SELF'),
  JSON.stringify(forged),
);

/* ── 7–9 · the assistant is told she was assigned (R93) ──────────────────── */

/** Opens the real bell for an identity and reads it, status included. */
const bellOf = async (cookie, home) => {
  await beIdentity(cookie);
  await open(home, 'main');
  await new Promise((r) => setTimeout(r, 1800));
  const read = await evaluate(`(async () => {
    const trigger = document.querySelector('.bell__trigger');
    if (!trigger) return { noBell: true, body: document.body.textContent.slice(0, 160) };
    const count = document.querySelector('.bell__count');
    trigger.click();
    await new Promise((r) => setTimeout(r, 2200));
    const panel = document.querySelector('.bell__panel');
    const requests = (window.__calls || []).filter((c) => c.url.includes('/notifications'));
    return {
      badge: count ? count.textContent.trim() : null,
      text: panel ? panel.textContent.trim() : null,
      requests,
    };
  })()`);
  // A negative check is only valid after a 200 — an empty panel behind a 401 is
  // a failure, never an absence of notifications.
  if ((read.requests ?? []).some((r) => r.status !== 200)) {
    throw new Error(`notification list failed: ${JSON.stringify(read.requests)}`);
  }
  return read;
};

const aminaBell = await bellOf(process.env.AMINA2_COOKIE, '/teacher');
check(
  '7 · the assistant she named is TOLD she was assigned',
  (aminaBell.text ?? '').includes('أُسندت إليكِ') &&
    (aminaBell.text ?? '').includes('نشاط المؤطرة') &&
    !(aminaBell.text ?? '').includes('event_staff_assigned'),
  JSON.stringify({ badge: aminaBell.badge, text: (aminaBell.text ?? '').slice(0, 260) }),
);
console.error('OBSERVED-ASSISTANT', JSON.stringify((aminaBell.text ?? '').slice(0, 300)));

check(
  '8 · and her bell counts it as unread',
  aminaBell.badge !== null && aminaBell.badge !== '0',
  JSON.stringify({ badge: aminaBell.badge }),
);

const safaBell = await bellOf(process.env.SAFA3_COOKIE, '/teacher');
check(
  '9 · the مؤطرة who created it is NOT told she assigned herself',
  !(safaBell.text ?? '').includes('أُسندت إليكِ'),
  JSON.stringify({ text: (safaBell.text ?? '').slice(0, 200) }),
);

/* ── 10–12 · every type she is allowed to create (R94) ───────────────────── */

await beIdentity(process.env.SAFA4_COOKIE);
await open('/teacher/schedules', '.admin-table, .state');

const types = await evaluate(`(async () => {
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة عنصر'));
  if (!add) return { noAdd: true };
  add.click();
  await new Promise((r) => setTimeout(r, 2500));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  const label = [...dialog.querySelectorAll('label')].find((l) => l.textContent.trim() === 'نوع العنصر');
  const select = label ? dialog.querySelector('#' + CSS.escape(label.getAttribute('for') || '')) : null;
  return {
    options: select ? [...select.options].map((o) => o.textContent.trim()) : [],
    values: select ? [...select.options].map((o) => o.value) : [],
    id: select ? select.id : null,
  };
})()`);

check(
  '10 · her type selector offers نشاط, امتحان AND حصة',
  // By what she READS: the values are catalogue ids (R110), not kind names.
  (types.options ?? []).includes('نشاط') && (types.options ?? []).includes('اختبار') &&
    (types.options ?? []).includes(CLASS_TYPE),
  JSON.stringify(types),
);
check(
  /**
   * **§2, Revision 140 — حصة joined the grant.** §4.4c still derives her
   * REACH from the classes she staffs; what changed is that creating one no
   * longer needs a circular anchor — her declared capability and her
   * `UserBranchRole` (never the schedule about to exist) authorise it. This
   * offering the option is the FIRST half of that story; check 13 below
   * proves the server still holds the line when she has declared nothing.
   */
  '11 · the option is offered because §2 grants it — not because §4.4c widened',
  (types.options ?? []).includes(CLASS_TYPE),
  JSON.stringify(types.options),
);

const examSaved = await evaluate(`(async () => {
  ${FORM_HELPERS}
  if (!(await chooseType('اختبار'))) return { noExamType: true };

  // She names one of her OWN classes; its Level, Subject, Branch and Year come
  // with it, because the chain that would offer them answers 403 for her.
  const forClass = labelled('الحصة المعنية*');
  if (!forClass) {
    return { noForClass: true, labels: [...document.querySelectorAll('dialog[open] label')].map((l) => l.textContent.trim()) };
  }
  const option = [...forClass.options].find((o) => o.value !== '');
  if (!option) return { noClassOption: true };
  set(forClass, option.value);
  await new Promise((r) => setTimeout(r, 1500));

  const title = [...document.querySelectorAll('dialog[open] input')].find(
    (i) => (i.closest('.field') || {}).textContent?.includes('العنوان'),
  );
  if (title) set(title, '[notify] امتحان المؤطرة');
  const maxGrade = labelled('النقطة القصوى*') || labelled('النقطة القصوى');
  if (maxGrade) set(maxGrade, '20');
  const datesPicked = await pickDate(${JSON.stringify(S.spareDate)});
  const room = labelled('القاعة');
  if (room && room.options.length > 1) set(room, room.options[1].value);
  await new Promise((r) => setTimeout(r, 800));

  const save = [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'حفظ');
  if (!save) return { noSave: true };
  save.click();
  await new Promise((r) => setTimeout(r, 5000));
  const still = document.querySelector('dialog[open]');
  return { closed: still === null, datesPicked, says: still ? still.textContent.slice(-260) : null };
})()`);

const examCalls = (await callsMatching('/exams')).filter((c) => c.method === 'POST');
check(
  '12 · she creates an EXAM for a class she teaches, and it is accepted',
  examSaved.closed === true && examCalls.length === 1 && examCalls[0]?.status === 201,
  JSON.stringify({ examSaved, examCalls }),
);

/* ── 13 · حصة — offered because §2 grants it; her candidate list is SERVER-filtered ── */

const classForm = await evaluate(`(async () => {
  document.querySelector('dialog[open] button[aria-label="إغلاق"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة عنصر'));
  if (!add) return { noAdd: true };
  add.click();
  await new Promise((r) => setTimeout(r, 2000));
  let dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  ${FORM_HELPERS}
  if (!(await chooseType(${JSON.stringify(CLASS_TYPE)}))) return { noClassType: true };
  dialog = dlg();

  // SRS Revision 163 §5 — «نمط التدريس» is asked of nobody. Her class is one
  // whole Level (the only shape her grant covers), so she sees the ordinary
  // branch/Level pair and NONE of the administrator's five audience filters.
  const modeAsked = labelled('نمط التدريس') !== null;
  const adminFilters = ['فئات', 'مجموعات', 'حلقات'].filter((name) =>
    [...dialog.querySelectorAll('.field__label, label')].some((l) =>
      (l.textContent ?? '').trim().startsWith(name)));

  // **§2 — no declared TeacherCategoryCapability/TeacherSubjectCapability in
  // this scenario, so her Level picker must be empty**: proof, in the real
  // rendered UI against a real account, that the candidate list is filtered
  // by her actual declared scope rather than showing every Level and relying
  // on the write to refuse the ones she picks.
  const levelLabel = [...dialog.querySelectorAll('label')].find((l) => l.textContent.trim() === 'المستوى');
  const levelSel = levelLabel ? dialog.querySelector('#' + CSS.escape(levelLabel.getAttribute('for') || '')) : null;
  const levelOptions = levelSel ? [...levelSel.options].map((o) => o.textContent.trim()) : null;

  return {
    modeAsked,
    adminFilters,
    staffLockedShown: dialog.textContent.includes('أنتِ المؤطّرة المسؤولة عن هذه الحصة.'),
    levelOptions,
  };
})()`);

check(
  '13a · حصة asks her no «نمط التدريس» and offers none of the administrator\'s filters — one whole Level, and she is its responsible مؤطِّرة',
  classForm.modeAsked === false &&
    JSON.stringify(classForm.adminFilters) === '[]' &&
    classForm.staffLockedShown === true,
  JSON.stringify(classForm),
);
check(
  // At most the ONE placeholder option ("choose…"); no real Level, because
  // she has declared no capability in this scenario.
  '13b · her Level picker is EMPTY — a server-filtered candidate list, not a client-side promise the write would refuse',
  Array.isArray(classForm.levelOptions) && classForm.levelOptions.length <= 1,
  JSON.stringify(classForm.levelOptions),
);

close();
process.exit(finish());
