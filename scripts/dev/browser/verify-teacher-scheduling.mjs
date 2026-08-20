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
const { send, evaluate, close } = await connect(process.env.PORT ?? '9253');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth/refresh', httpOnly: true,
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

await open('/teacher/schedules', '.admin-table, .state');
const page = await evaluate(`(() => {
  const body = document.querySelector('main')?.textContent ?? '';
  return {
    heading: body.includes('الجدولة'),
    // The shared calendar surface: the two views, the month controls, filters.
    views: [...document.querySelectorAll('.cal-segmented [role="tab"]')].map((b) => b.textContent.trim()),
    monthNav: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'اليوم'),
    filters: document.querySelector('.cal-header__filters') !== null,
    addItem: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('إضافة عنصر')),
    // And the definitions table, which carries the roster action nothing else
    // offers her.
    table: document.querySelector('.admin-table') !== null,
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

  const set = (el, value) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const labelled = (text) => {
    const label = [...dialog.querySelectorAll('label')].find((l) => l.textContent.trim() === text);
    if (!label) return null;
    return dialog.querySelector('#' + CSS.escape(label.getAttribute('for') || ''));
  };

  // The responsible selector, and what it is willing to offer.
  const responsible = labelled('المؤطِّرة المسؤولة');
  const options = responsible ? [...responsible.options].map((o) => o.textContent.trim()) : [];
  const locked = responsible ? responsible.disabled : null;

  const title = [...dialog.querySelectorAll('input')].find(
    (i) => (i.closest('.field') || {}).textContent?.includes('العنوان'),
  );
  if (title) set(title, '[notify] نشاط المؤطرة');
  const dates = [...dialog.querySelectorAll('input[type=date]')];
  for (const d of dates) set(d, ${JSON.stringify(S.spareDate)});
  await new Promise((r) => setTimeout(r, 600));

  // **Her scope.** TD-2 grants a مؤطرة the Administrative Groups she teaches
  // and nothing wider, so an activity without one is a save the server refuses
  // — and the first run reported «تعذّر الحفظ» for exactly that reason.
  dialog = document.querySelector('dialog[open]');
  // The scope selector is the one offering her own groups, labelled
  // {Level} — {Group}. Matching on the word المجموعة tied the probe to a label
  // and found nothing when the list was empty for an unrelated reason.
  const scopeSelect = [...dialog.querySelectorAll('select')].find((sel) =>
    [...sel.options].some((o) => o.textContent.includes('المجموعة 1')),
  );
  const scopeOptions = scopeSelect ? [...scopeSelect.options].map((o) => o.textContent.trim()) : [];
  if (scopeSelect && scopeSelect.options.length > 1) {
    set(scopeSelect, scopeSelect.options[1].value);
    await new Promise((r) => setTimeout(r, 800));
  }

  // One assistant, chosen from the shared multi-select. The options arrive from
  // /me/event-scope-options' sibling read, so the list may still be loading when
  // the scope is set — wait for her to appear rather than clicking into a gap.
  dialog = document.querySelector('dialog[open]');
  let assistant;
  for (let i = 0; i < 20; i += 1) {
    dialog = document.querySelector('dialog[open]');
    assistant = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent.includes('[notify] أمينة') && b.textContent.trim().startsWith('＋'),
    );
    if (assistant) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (assistant) assistant.click();
  await new Promise((r) => setTimeout(r, 900));
  // Did the choice register in the form? A chosen person shows as a ✕ chip.
  dialog = document.querySelector('dialog[open]');
  const chips = [...dialog.querySelectorAll('button')]
    .filter((b) => b.textContent.trim().endsWith('✕'))
    .map((b) => b.textContent.replace('✕', '').trim());

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

close();
process.exit(finish());
