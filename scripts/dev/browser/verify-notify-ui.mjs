/**
 * **The notification feature, driven the way a person drives it.**
 *
 * The rule this file exists to enforce: *nothing here proves a notification
 * except seeing it, as the recipient, in her own bell.*
 *
 * So it does not insert a `Notification` row, and it does not POST to
 * `/notify` — those are what the previous harness did, and they proved the
 * backend while leaving the button a person actually presses untested. Every
 * notice below is produced by clicking «إرسال الإشعار» in the real confirmation
 * dialog, and read back by opening the real bell.
 *
 * **Every request the page makes is recorded**, so *exactly one notify request
 * was sent* is evidence rather than inference — and so an empty panel behind a
 * 401 is reported as a failure, never as an absence of notifications.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.NOTIFY_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9251');
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

/** Records every API call the PAGE makes, so the network layer is evidence. */
const RECORDER = `
  (() => {
    if (window.__calls) return true;
    window.__calls = [];
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || 'GET';
      const res = await real(input, init);
      try { window.__calls.push({ url, method, status: res.status }); } catch (e) { void e; }
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

const clearCalls = () => evaluate(`(() => { window.__calls = []; return true; })()`);

/** One refresh per identity, bearer kept. */
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

const json = async (token, path) => {
  const raw = await evaluate(`(async () => {
    const res = await fetch('/api/v1' + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + ${JSON.stringify(token)} },
    });
    return { status: res.status, body: await res.text() };
  })()`);
  return { status: raw.status, ...JSON.parse(raw.body || '{}') };
};

/**
 * Opens the occurrences screen; returns the row index of a session id.
 *
 * **A FRESH Admin page cookie each time.** The app refreshes on load and rotates
 * the cookie, so coming back to this screen with the one already spent renders a
 * logged-out shell — an empty table, which the harness read as *the occurrence
 * is gone* and reported as a missing row. Two checks failed that way, both
 * describing an unauthenticated page rather than the product.
 */
const ADMIN_PAGE_COOKIES = [
  process.env.ADMIN_COOKIE,
  process.env.ADMIN_COOKIE_2,
  process.env.ADMIN_COOKIE_3,
  process.env.ADMIN_COOKIE_4,
  process.env.ADMIN_COOKIE_5,
  process.env.ADMIN_COOKIE_6,
  process.env.ADMIN_COOKIE_7,
  process.env.ADMIN_COOKIE_8,
  process.env.ADMIN_COOKIE_9,
];
let adminPhase = 0;

async function occurrences(scheduleId, sessionId, adminToken) {
  const listed = await json(
    adminToken,
    `/admin/course-schedules/${scheduleId}/sessions?page=1&page_size=200`,
  );
  const index = (listed.data ?? []).findIndex((x) => x.id === sessionId);
  const cookie = ADMIN_PAGE_COOKIES[adminPhase];
  adminPhase += 1;
  if (!cookie) throw new Error('ran out of Admin page sessions — mint another in the .sh');
  await beIdentity(cookie);
  await open(`/admin/schedules/${scheduleId}/sessions`, '.admin-table, .state');
  const rows = await evaluate(`(() => document.querySelectorAll('.admin-table tbody tr').length)()`);
  if (rows === 0) throw new Error('occurrences screen rendered no rows — check the Admin session');
  return index;
}

/** Cancels one occurrence through the UI and answers the notice question. */
const cancelThroughUi = (index, reason, decision) =>
  evaluate(`(async () => {
    const rows = [...document.querySelectorAll('.admin-table tbody tr')];
    const row = rows[${index}];
    if (!row) return { noRow: true, rows: rows.length };
    const action = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('إلغاء'));
    if (!action) return { noAction: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    action.click();
    await new Promise((r) => setTimeout(r, 1500));

    let dialog = document.querySelector('dialog[open]');
    if (!dialog) return { noCancelDialog: true };
    const reasonText = ${JSON.stringify(reason)};
    if (reasonText) {
      const field = dialog.querySelector('textarea, input[type=text]');
      if (field) {
        const proto = Object.getPrototypeOf(field);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, reasonText);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    const labelsBefore = [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim());
    const confirm = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'تأكيد' || b.textContent.trim() === 'إلغاء الحصة',
    );
    if (!confirm) return { noConfirm: true, labelsBefore };
    confirm.click();
    await new Promise((r) => setTimeout(r, 4000));

    dialog = document.querySelector('dialog[open]');
    if (!dialog) return { noNotifyDialog: true, labelsBefore, body: document.body.textContent.slice(0, 240) };
    const asksAboutNotice = dialog.textContent.includes('إشعار');
    const wanted = ${JSON.stringify(decision)} === 'send' ? 'إرسال الإشعار' : 'بدون إشعار';
    const button = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === wanted);
    if (!button) {
      return { noButton: true, asksAboutNotice, labels: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    }
    button.click();
    await new Promise((r) => setTimeout(r, 4000));
    return {
      asksAboutNotice,
      pressed: wanted,
      notice: (document.body.textContent.match(/أُرسل[^.]*\\./) || [null])[0],
    };
  })()`);

/** Opens the real bell and reads it, capturing the list request's status. */
const readBell = async (pageCookie, home = '/dashboard/student') => {
  await beIdentity(pageCookie);
  await open(home, 'main');
  await new Promise((r) => setTimeout(r, 1800));
  return evaluate(`(async () => {
    const trigger = document.querySelector('.bell__trigger');
    if (!trigger) return { noBell: true, body: document.body.textContent.slice(0, 200) };
    // The unread count is .bell__count. The first version of this harness
    // looked for .bell__badge, which nothing renders, and reported a missing
    // count while the panel plainly showed one — a harness defect that would
    // have been filed as a product one.
    // (No backticks in this comment: it lives inside a template literal.)
    const badgeEl = document.querySelector('.bell__count');
    const badge = badgeEl ? badgeEl.textContent.trim() : null;
    trigger.click();
    await new Promise((r) => setTimeout(r, 2200));
    const panel = document.querySelector('.bell__panel');
    const requests = (window.__calls || []).filter((c) => c.url.includes('/notifications'));
    return {
      badge,
      opened: panel !== null,
      text: panel ? panel.textContent.trim() : null,
      requests,
    };
  })()`);
};

/* ── 1–3 · cancel with NO reason, and send ───────────────────────────────── */

// Park the page on a real origin first: `about:blank` has no base URL, so a
// relative `fetch` cannot be parsed at all.
await send('Page.navigate', { url: `${BASE}/content-unavailable` });
await new Promise((r) => setTimeout(r, 2500));

const adminToken = await tokenFor(process.env.ADMIN_API_COOKIE);
const idx = await occurrences(S.targaSchedule, S.first, adminToken);
await clearCalls();
const cancelled = await cancelThroughUi(idx, '', 'send');

check(
  '1 · the occurrence cancels and the platform ASKS about the notice',
  cancelled.asksAboutNotice === true && cancelled.pressed === 'إرسال الإشعار',
  JSON.stringify(cancelled),
);

const notifyCalls = await callsMatching('/notify');
check(
  '2 · «إرسال الإشعار» sends EXACTLY ONE notify request, and it succeeds',
  notifyCalls.length === 1 && notifyCalls[0]?.status === 200,
  JSON.stringify(notifyCalls),
);

const stored = await json(
  adminToken,
  `/admin/course-schedules/${S.targaSchedule}/sessions?page=1&page_size=200`,
);
const row = (stored.data ?? []).find((x) => x.id === S.first);
check('3 · and the occurrence really is cancelled', row?.status === 'cancelled', JSON.stringify({ status: row?.status }));

/* ── 4–6 · the recipient opens her own bell ──────────────────────────────── */

const aBell = await readBell(process.env.A_COOKIE);
check(
  '4 · the concerned beneficiary’s notification LIST request succeeded',
  (aBell.requests ?? []).length > 0 && (aBell.requests ?? []).every((r) => r.status === 200),
  JSON.stringify({ requests: aBell.requests, noBell: aBell.noBell, body: aBell.body }),
);
check(
  '5 · her bell shows an unread count',
  aBell.badge !== null && aBell.badge !== '' && aBell.badge !== '0',
  JSON.stringify({ badge: aBell.badge, opened: aBell.opened }),
);
check(
  '6 · and the panel names the cancelled class in Arabic, with no raw enum',
  (aBell.text ?? '').includes('أُلغيت') && !(aBell.text ?? '').includes('session_cancelled'),
  JSON.stringify({ text: (aBell.text ?? '').slice(0, 260) }),
);
console.error('OBSERVED-A', JSON.stringify((aBell.text ?? '').slice(0, 400)));

/* ── 7 · the unrelated beneficiary ───────────────────────────────────────── */

const cBell = await readBell(process.env.C_COOKIE);
check(
  '7 · an unrelated beneficiary’s list also returns 200 — and shows no cancellation',
  (cBell.requests ?? []).length > 0 &&
    (cBell.requests ?? []).every((r) => r.status === 200) &&
    !(cBell.text ?? '').includes('أُلغيت'),
  JSON.stringify({ requests: cBell.requests, text: (cBell.text ?? '').slice(0, 160) }),
);

/* ── 8 · declining sends nothing ─────────────────────────────────────────── */

const idx2 = await occurrences(S.targaSchedule, S.secondOcc, adminToken);
await clearCalls();
const declined = await cancelThroughUi(idx2, '', 'skip');
const afterDecline = await callsMatching('/notify');
check(
  '8 · «بدون إشعار» sends NO notify request at all',
  declined.pressed === 'بدون إشعار' && afterDecline.length === 0,
  JSON.stringify({ declined, calls: afterDecline }),
);

const aAfterDecline = await readBell(process.env.A2_COOKIE);
check(
  '9 · and the recipient’s bell gains nothing from the declined change',
  ((aAfterDecline.text ?? '').match(/أُلغيت/g) ?? []).length === 1,
  JSON.stringify({ text: (aAfterDecline.text ?? '').slice(0, 300) }),
);

/* ── 10–11 · a cancellation WITH a reason carries it ─────────────────────── */

const idx3 = await occurrences(S.targaSchedule, S.combinable, adminToken);
await clearCalls();
const withReason = await cancelThroughUi(idx3, 'المؤطرة مريضة', 'send');
const reasonCalls = await callsMatching('/notify');
check(
  '10 · a cancellation WITH a reason also sends exactly one notice',
  withReason.pressed === 'إرسال الإشعار' && reasonCalls.length === 1 && reasonCalls[0]?.status === 200,
  JSON.stringify({ withReason, reasonCalls }),
);

const aWithReason = await readBell(process.env.A3_COOKIE);
check(
  '11 · and the recipient SEES the reason — absent on the one that had none',
  (aWithReason.text ?? '').includes('المؤطرة مريضة') &&
    ((aWithReason.text ?? '').match(/أُلغيت/g) ?? []).length === 2,
  JSON.stringify({ text: (aWithReason.text ?? '').slice(0, 400) }),
);
console.error('OBSERVED-A-REASON', JSON.stringify((aWithReason.text ?? '').slice(0, 400)));

/* ── 12–13 · marking read, and that it survives a reload ─────────────────── */

const marked = await evaluate(`(async () => {
  const buttons = [...document.querySelectorAll('.bell__panel button')].filter(
    (b) => b.textContent.trim() === 'تم الاطّلاع',
  );
  const before = buttons.length;
  if (before === 0) return { none: true, panel: (document.querySelector('.bell__panel') || {}).textContent };
  buttons[0].click();
  await new Promise((r) => setTimeout(r, 2500));
  const after = [...document.querySelectorAll('.bell__panel button')].filter(
    (b) => b.textContent.trim() === 'تم الاطّلاع',
  ).length;
  const countEl = document.querySelector('.bell__count');
  return { before, after, count: countEl ? countEl.textContent.trim() : null };
})()`);
check(
  '12 · «تم الاطّلاع» marks one read, and the unread count drops',
  marked.before > 0 && marked.after === marked.before - 1,
  JSON.stringify(marked),
);

const reloaded = await readBell(process.env.A4_COOKIE);
const stillUnread = await evaluate(`(() => {
  const el = document.querySelector('.bell__count');
  return el ? el.textContent.trim() : '0';
})()`);
check(
  '13 · and the read state survives a reload — one fewer unread than notices',
  Number(stillUnread) === marked.before - 1,
  JSON.stringify({ badge: reloaded.badge, stillUnread, wasUnread: marked.before }),
);

/* ── 14–16 · a reschedule, through «تعديل» ───────────────────────────────── */

const idx4 = await occurrences(S.targaSchedule, S.inReplacement, adminToken);
await clearCalls();
const moved = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const row = rows[${idx4}];
  if (!row) return { noRow: true };
  const edit = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
  if (!edit) return { noEdit: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  edit.click();
  await new Promise((r) => setTimeout(r, 1800));
  let dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };

  const set = (el, value) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  // Any input already holding a wall-clock value. Selecting on the type
  // attribute missed them: the platform renders a time as a TextField with an
  // HH:MM hint (TD-11 wall-clock), never as a native time control.
  const times = [...dialog.querySelectorAll('input')].filter((i) =>
    /^[0-9][0-9]:[0-9][0-9]$/.test(i.value),
  );
  if (times.length === 0) return { noTime: true, inputs: [...dialog.querySelectorAll('input')].map((i) => i.type + ':' + i.value) };
  set(times[0], '16:30');
  await new Promise((r) => setTimeout(r, 400));

  // The occurrence editor saves with «حفظ»; only the cancellation dialog says
  // «تأكيد». Matching one label for both reported a missing button on a form
  // that was simply a different one.
  const confirm = [...dialog.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'حفظ' || b.textContent.trim() === 'تأكيد',
  );
  if (!confirm) return { noConfirm: true, labels: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  confirm.click();
  await new Promise((r) => setTimeout(r, 4500));

  dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noNotifyDialog: true, body: document.body.textContent.slice(0, 240) };
  const button = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'إرسال الإشعار');
  if (!button) return { noSend: true, labels: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  button.click();
  await new Promise((r) => setTimeout(r, 4000));
  return { sent: true };
})()`);

const moveCalls = await callsMatching('/notify');
check(
  '14 · a reschedule asks the same question and sends one notice',
  moved.sent === true && moveCalls.length === 1 && moveCalls[0]?.status === 200,
  JSON.stringify({ moved, moveCalls }),
);

const aMoved = await readBell(process.env.A5_COOKIE);
check(
  '15 · the recipient sees a RESCHEDULE notice carrying the new time',
  // «تغيّر موعد …» is the platform's wording; «نُقلت» was the harness's guess,
  // and asserting a sentence nobody wrote reported a working feature as broken.
  (aMoved.text ?? '').includes('تغيّر موعد') && (aMoved.text ?? '').includes('16:30'),
  JSON.stringify({ text: (aMoved.text ?? '').slice(0, 320) }),
);
console.error('OBSERVED-A-MOVED', JSON.stringify((aMoved.text ?? '').slice(0, 320)));

/**
 * **R91 — the replacement is told, and the one who teaches before is not.**
 *
 * The occurrence just moved sits inside Amina's window, so its staffing snapshot
 * names her and the assistant. Safa staffs the same schedule before and after,
 * and must hear nothing about a date she does not take.
 */
const bellOf = async (cookie, home = '/dashboard/student') => {
  const r = await readBell(cookie, home);
  if ((r.requests ?? []).some((x) => x.status !== 200)) {
    throw new Error(`notification list failed: ${JSON.stringify(r.requests)}`);
  }
  return r.text ?? '';
};

const aminaText = await bellOf(process.env.AMINA_COOKIE, '/teacher');
const nadiaText = await bellOf(process.env.NADIA_COOKIE, '/teacher');
const safaText = await bellOf(process.env.SAFA_COOKIE, '/teacher');

check(
  '16 · R91 — the EFFECTIVE مؤطِّرة and her assistant are told',
  aminaText.includes('تغيّر موعد') && nadiaText.includes('تغيّر موعد'),
  JSON.stringify({ amina: aminaText.slice(0, 140), nadia: nadiaText.slice(0, 140) }),
);
check(
  '17 · and the one who teaches BEFORE and AFTER that window is not',
  !safaText.includes('تغيّر موعد'),
  JSON.stringify({ safa: safaText.slice(0, 200) }),
);

/* ── 18–20 · R92 — a combined occurrence tells BOTH branches ─────────────── */

const idx5 = await occurrences(S.targaSchedule, S.spare, adminToken);
const combinedOk = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const row = rows[${idx5}];
  if (!row) return { noRow: true };
  const action = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('الحضور من الفروع'));
  if (!action) return { noAction: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  action.click();
  await new Promise((r) => setTimeout(r, 2500));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  const add = [...dialog.querySelectorAll('button')].find(
    (b) => b.textContent.includes('الفرع الثاني') && b.textContent.trim().startsWith('＋'),
  );
  if (!add) return { noOption: true, options: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  add.click();
  await new Promise((r) => setTimeout(r, 600));
  const save = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  save.click();
  await new Promise((r) => setTimeout(r, 3500));
  return { closed: document.querySelector('dialog[open]') === null };
})()`);
check('18 · the occurrence is combined across both branches, through the UI', combinedOk.closed === true, JSON.stringify(combinedOk));

await clearCalls();
const combinedCancel = await cancelThroughUi(idx5, '', 'send');
const combinedCalls = await callsMatching('/notify');
check(
  '19 · cancelling it sends one notice',
  combinedCancel.pressed === 'إرسال الإشعار' && combinedCalls.length === 1 && combinedCalls[0]?.status === 200,
  JSON.stringify({ combinedCancel, combinedCalls }),
);

const bText = await bellOf(process.env.B2_COOKIE, '/dashboard/student');
check(
  '20 · R92 — the OTHER branch’s beneficiary is told about a class at Targa',
  bText.includes(`${S.spareDate}`) && bText.includes('أُلغيت'),
  JSON.stringify({ text: bText.slice(0, 240), spareDate: S.spareDate }),
);
console.error('OBSERVED-B-CROSSBRANCH', JSON.stringify(bText.slice(0, 260)));

/* ── 21–23 · a published grade, through the grade sheet ──────────────────── */

const gradeToken = await tokenFor(process.env.ADMIN_GRADE_COOKIE);
await beIdentity(process.env.ADMIN_GRADE_COOKIE);
await open(`/admin/exam-grades?exam=${S.exam}`, '.admin-table, .state');

const drafted = await evaluate(`(async () => {
  const input = [...document.querySelectorAll('.admin-table input')].find(
    (i) => i.type === 'text' || i.type === 'number',
  );
  if (!input) return { noInput: true, body: document.body.textContent.slice(0, 200) };
  const proto = Object.getPrototypeOf(input);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '17');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  // The sheet's own labels: «حفظ كمسودة» keeps it a teacher's working document
  // (BR-8) and «نشر النقاط» is what makes it a grade a family has been given.
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('حفظ كمسودة'));
  if (!save) return { noSave: true, labels: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 12) };
  save.click();
  await new Promise((r) => setTimeout(r, 3000));
  return { saved: true };
})()`);
check('21 · a draft grade saves', drafted.saved === true, JSON.stringify(drafted));

const aAfterDraft = await bellOf(process.env.A7_COOKIE, '/dashboard/student');
check(
  '22 · a DRAFT tells the student nothing (BR-8)',
  !aAfterDraft.includes('نتيجة') && !aAfterDraft.includes('نُشرت'),
  JSON.stringify({ text: aAfterDraft.slice(0, 200) }),
);

await beIdentity(process.env.ADMIN_COOKIE_8);
await open(`/admin/exam-grades?exam=${S.exam}`, '.admin-table, .state');
const published = await evaluate(`(async () => {
  const publish = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('نشر النقاط'));
  if (!publish) return { noPublish: true, labels: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 14) };
  publish.click();
  await new Promise((r) => setTimeout(r, 2000));
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    const confirm = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'تأكيد' || b.textContent.includes('نشر'),
    );
    if (confirm) confirm.click();
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { published: true, body: document.body.textContent.slice(0, 160) };
})()`);
check('23 · the sheet publishes', published.published === true, JSON.stringify(published));

const aAfterPublish = await bellOf(process.env.A8_COOKIE, '/dashboard/student');
check(
  '24 · and publishing tells her — in Arabic, naming the exam',
  aAfterPublish.includes('نتيجة') || aAfterPublish.includes('نُشرت'),
  JSON.stringify({ text: aAfterPublish.slice(0, 260) }),
);
console.error('OBSERVED-A-GRADE', JSON.stringify(aAfterPublish.slice(0, 260)));

/* ── 25–27 · an Event, created through الجدولة ───────────────────────────── */

await beIdentity(process.env.ADMIN_EVENT_COOKIE);
await open('/admin/schedules', '.admin-table, .state');

const evented = await evaluate(`(async () => {
  const create = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة'));
  if (!create) return { noCreate: true, labels: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 12) };
  create.click();
  await new Promise((r) => setTimeout(r, 2500));
  let dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };

  const set = (el, value) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pick = (labelText, value) => {
    const label = [...dialog.querySelectorAll('label')].find((l) => l.textContent.trim() === labelText);
    if (!label) return false;
    const control = dialog.querySelector('#' + CSS.escape(label.getAttribute('for') || ''));
    if (!control) return false;
    set(control, value);
    return true;
  };

  // A نشاط scoped to the Level, so its audience is exactly the beneficiaries of
  // that Level — a deterministic recipient set.
  if (!pick('نوع العنصر', 'activity')) return { noType: true };
  await new Promise((r) => setTimeout(r, 1200));
  dialog = document.querySelector('dialog[open]');

  const title = [...dialog.querySelectorAll('input')].find(
    (i) => (i.closest('.field') || {}).textContent?.includes('العنوان'),
  );
  if (!title) return { noTitle: true };
  set(title, '[notify] نشاط للمستوى');
  await new Promise((r) => setTimeout(r, 400));

  // An activity needs a date before it will save. Leaving it empty kept the
  // form open on its own validation message, and the harness read the absent
  // notice dialog as a missing feature.
  const dates = [...dialog.querySelectorAll('input[type=date]')];
  for (const d of dates) set(d, ${JSON.stringify(S.spareDate)});
  await new Promise((r) => setTimeout(r, 500));

  // The label is النطاق — نطاق النشاط was a guess, and pick returning false
  // silently left the scope unset, so no Level selector ever appeared.
  // (No backticks in this comment: it lives inside a template literal.)
  if (!pick('النطاق', 'level')) return { noScopeKind: true };
  await new Promise((r) => setTimeout(r, 1000));
  dialog = document.querySelector('dialog[open]');
  // **By the TAGGED name.** The development database already holds a Level
  // called وميض الأمل, and matching the bare name attached the event to it —
  // a Level this fixture's student is not enrolled in. The send then correctly
  // reached nobody, and the harness read that as a broken feature.
  const wanted = '[notify] وميض الأمل';
  const scopeSelect = [...dialog.querySelectorAll('select')].find((sel) =>
    [...sel.options].some((o) => o.textContent.includes(wanted)),
  );
  if (!scopeSelect) return { noScope: true, selects: [...dialog.querySelectorAll('select')].map((x) => (x.closest('.field') || {}).textContent?.slice(0, 40)) };
  const option = [...scopeSelect.options].find((o) => o.textContent.includes(wanted));
  set(scopeSelect, option.value);
  await new Promise((r) => setTimeout(r, 800));

  dialog = document.querySelector('dialog[open]');
  const save = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  if (!save) return { noSave: true };
  save.click();
  await new Promise((r) => setTimeout(r, 5000));

  dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noNotifyDialog: true, body: document.body.textContent.slice(0, 240) };
  const send = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'إرسال الإشعار');
  if (!send) {
    // Report what the form is SAYING, not just that a button is absent: a
    // validation message left on screen is the answer, and hiding it behind
    // "no send button" is how a form defect gets filed as a missing dialog.
    return { noSend: true, says: dialog.textContent.slice(0, 260) };
  }
  send.click();
  await new Promise((r) => setTimeout(r, 4000));
  // How many the server said it told. A 200 with notified: 0 is a
  // resolved-empty audience, which is a completely different defect from a
  // request that never happened — the diagnostic ladder depends on telling
  // them apart.
  // (No backticks in this comment: it lives inside a template literal.)
  return { sent: true, notice: document.body.textContent.match(/أُرسل[^.]*\./)?.[0] ?? null };
})()`);

check(
  '25 · a scoped نشاط is created and offers the same notice question',
  evented.sent === true,
  JSON.stringify(evented),
);

const eventCalls = await callsMatching('/notify');
check(
  '26 · and «إرسال الإشعار» sends exactly one event notify request',
  eventCalls.length === 1 && eventCalls[0]?.status === 200,
  JSON.stringify(eventCalls),
);

/**
 * **What the server actually stored, before asking what she can see.**
 *
 * A 200 tells us the request happened, not that anybody was resolved. R82.7 is
 * explicit that an Event with **no scope rows at all is global — visible to
 * everyone and notified to nobody** — so a form that saved without attaching the
 * Level would produce exactly this shape: a successful send that reaches
 * no one. Reading the stored event distinguishes that from a delivery defect.
 */
const createdEvent = await json(adminToken, `/calendar?from=${S.spareDate}&to=${S.spareDate}`);
const mine = (createdEvent.data ?? []).find((o) => (o.title ?? '').includes('نشاط للمستوى'));
console.error('EVENT-AS-STORED', JSON.stringify(mine ?? null));

const aEvent = await bellOf(process.env.A9_COOKIE, '/dashboard/student');
check(
  '27 · the beneficiary of that Level sees the new activity in her bell',
  aEvent.includes('نشاط للمستوى'),
  JSON.stringify({ text: aEvent.slice(0, 260) }),
);
console.error('OBSERVED-A-EVENT', JSON.stringify(aEvent.slice(0, 260)));

/* ── 28–32 · a REPUBLISH after the score changes must reach her ──────────── */

/** Marks every notice read, so "unread again" is a real observation. */
const markAllRead = async (cookie) => {
  await beIdentity(cookie);
  await open('/dashboard/student', 'main');
  await new Promise((r) => setTimeout(r, 1800));
  return evaluate(`(async () => {
    const trigger = document.querySelector('.bell__trigger');
    if (!trigger) return { noBell: true };
    trigger.click();
    await new Promise((r) => setTimeout(r, 2000));
    let guard = 0;
    while (guard < 12) {
      const button = [...document.querySelectorAll('.bell__panel button')].find(
        (b) => b.textContent.trim() === 'تم الاطّلاع',
      );
      if (!button) break;
      button.click();
      await new Promise((r) => setTimeout(r, 1200));
      guard += 1;
    }
    const count = document.querySelector('.bell__count');
    return { unread: count ? count.textContent.trim() : '0' };
  })()`);
};

const cleared = await markAllRead(process.env.A10_COOKIE);
check('28 · she reads everything, so the bell is quiet', cleared.unread === '0', JSON.stringify(cleared));

/** Changes the score on the sheet and publishes again. */
const republish = (score) =>
  evaluate(`(async () => {
    const input = [...document.querySelectorAll('.admin-table input')].find(
      (i) => i.type === 'text' || i.type === 'number',
    );
    if (!input) return { noInput: true };
    const before = input.value;
    const proto = Object.getPrototypeOf(input);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(String())} + ${JSON.stringify('')} + '${'${score}'}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    // **Save the change before republishing.** Publishing flips status; it does
    // not persist an unsaved edit, so republishing straight after typing left
    // the score untouched — and the platform stayed silent, correctly, because
    // nothing had changed. The manual flow is type, save, republish.
    const draftSave = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('حفظ كمسودة'));
    if (draftSave) {
      draftSave.click();
      await new Promise((r) => setTimeout(r, 3000));
    }
    // Once anything is published the control reads إعادة النشر, not نشر النقاط.
    // Matching only the first label reported a missing button on a sheet that
    // simply had the other one.
    const publish = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.includes('نشر النقاط') || b.textContent.includes('إعادة النشر'),
    );
    if (!publish) return { noPublish: true, labels: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 12) };
    publish.click();
    await new Promise((r) => setTimeout(r, 2000));
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      const confirm = [...dialog.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'تأكيد' || b.textContent.includes('نشر'),
      );
      if (confirm) confirm.click();
      await new Promise((r) => setTimeout(r, 3000));
    }
    return { before, republished: true };
  })()`.replace('${score}', String(score)));

await beIdentity(process.env.ADMIN_REPUB_COOKIE);
await open(`/admin/exam-grades?exam=${S.exam}`, '.admin-table, .state');
const changed = await republish(11);
check('29 · the score is changed and the sheet republished', changed.republished === true, JSON.stringify(changed));

const afterRepublish = await readBell(process.env.A11_COOKIE);
check(
  '30 · her bell is UNREAD again — the corrected mark reached her',
  afterRepublish.badge !== null && afterRepublish.badge !== '0',
  JSON.stringify({ badge: afterRepublish.badge, text: (afterRepublish.text ?? '').slice(0, 200) }),
);
console.error('OBSERVED-A-REPUBLISH', JSON.stringify((afterRepublish.text ?? '').slice(0, 260)));

const clearedAgain = await markAllRead(process.env.A12_COOKIE);
check('31 · she reads it again', clearedAgain.unread === '0', JSON.stringify(clearedAgain));

await beIdentity(process.env.ADMIN_REPUB2_COOKIE);
await open(`/admin/exam-grades?exam=${S.exam}`, '.admin-table, .state');
const unchanged = await evaluate(`(async () => {
  const publish = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.includes('نشر النقاط') || b.textContent.includes('إعادة النشر'),
  );
  if (!publish) return { noPublish: true, labels: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 12) };
  publish.click();
  await new Promise((r) => setTimeout(r, 2000));
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    const confirm = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'تأكيد' || b.textContent.includes('نشر'),
    );
    if (confirm) confirm.click();
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { republished: true };
})()`);

const afterNoChange = await readBell(process.env.A6_COOKIE);
check(
  '32 · republishing with NOTHING changed makes no noise',
  unchanged.republished === true && (afterNoChange.badge === null || afterNoChange.badge === '0'),
  JSON.stringify({ unchanged, badge: afterNoChange.badge }),
);

close();
process.exit(finish());
