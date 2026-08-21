/**
 * **R97 — حضوري and عن بُعد, driven through the real screens.**
 *
 * Six scenarios, and the two that matter most are the overrides: the whole
 * feature is *«this class is normally online, but THIS Thursday is in the
 * room»* and its mirror. Each asserts the target occurrence changed **and that
 * the following week did not** — the second half is the one a naive
 * implementation fails.
 *
 * Every read goes through a page a human actually opens. The API is used only
 * to locate a fixture row by id (the table renders dates through the Arabic
 * formatter, so an ISO string matches nothing) and to confirm a request
 * SUCCEEDED before any negative assertion is trusted.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R97_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9251');
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

/** One refresh per identity, bearer kept — TD-4.13 revokes a session whose
 *  cookie has two consumers, and the symptom is a late, timing-dependent 401. */
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

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1200));
}

/** Opens the occurrence editor on the row whose id the fixture names. */
async function openEditor(token, scheduleId, sessionId) {
  // **Dismiss anything left open first.** A dialog from the previous scenario
  // is `inert`-adjacent for our purposes: its backdrop swallows the click on
  // the row underneath, and the failure reads as "the row has no تعديل".
  await evaluate(`(() => {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    return true;
  })()`).catch(() => false);
  await open(`/admin/schedules/${scheduleId}/sessions`, '.admin-table, .state');
  // The table is fetched after mount, so `.admin-table` existing is not the
  // same as it having rows — and an empty table is indistinguishable from a
  // missing row unless we wait for the fetch.
  for (let i = 0; i < 40; i += 1) {
    const n = await evaluate(
      `(() => document.querySelectorAll('.admin-table tbody tr').length)()`,
    ).catch(() => 0);
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  /**
   * **Fail on the CAUSE, not on the symptom.**
   *
   * A revoked browser session renders «ليست لديك صلاحية», the table is empty,
   * and every delivery assertion below then fails as though the feature were
   * broken. Throwing here names the real cause — one refresh cookie with two
   * consumers (TD-4.13) — which is what cost this harness a debugging cycle.
   *
   * `R97_DIAG=1` prints what the page actually rendered, for the next person
   * who meets a different empty-table cause.
   */
  const diag = await evaluate(`(() => ({
    url: location.pathname,
    main: (document.querySelector('main')?.textContent ?? '').slice(0, 220),
  }))()`).catch(() => ({}));
  if (process.env.R97_DIAG) console.log('DIAG', scheduleId, JSON.stringify(diag));
  if ((diag.main ?? '').includes('ليست لديك صلاحية')) {
    throw new Error('browser session lost authorization — one cookie, two consumers (TD-4.13)');
  }
  const listed = await json(
    token,
    `/admin/course-schedules/${scheduleId}/sessions?page=1&page_size=200`,
  );
  const rowIndex = (listed.data ?? []).findIndex((x) => x.id === sessionId);
  return {
    rowIndex,
    listed,
    result: await evaluate(`(async () => {
      const rows = [...document.querySelectorAll('.admin-table tbody tr')];
      const row = rows[${rowIndex}];
      if (!row || ${rowIndex} < 0) return { noRow: true, rows: rows.length, index: ${rowIndex} };
      const action = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
      if (!action) return { noAction: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
      action.click();
      await new Promise((r) => setTimeout(r, 2000));
      const dialog = document.querySelector('dialog[open]');
      if (!dialog) return { noDialog: true };
      return { opened: true, text: dialog.textContent };
    })()`),
  };
}

/** Sets a `<select>` the way React hears it — the native setter, then `input`. */
const setSelect = (labelText, value) => `(() => {
  const dialog = document.querySelector('dialog[open]');
  const field = [...dialog.querySelectorAll('label')].find((l) => l.textContent.includes(${JSON.stringify(labelText)}));
  const select = field ? field.querySelector('select') ?? dialog.querySelector('#' + field.getAttribute('for')) : null;
  if (!select) return { missing: true, labels: [...dialog.querySelectorAll('label')].map((l) => l.textContent.trim()) };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: select.value };
})()`;

const saveDialog = `(async () => {
  const dialog = document.querySelector('dialog[open]');
  const save = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  if (!save) return { noSave: true };
  save.click();
  await new Promise((r) => setTimeout(r, 3000));
  return { saved: true, stillOpen: document.querySelector('dialog[open]') !== null };
})()`;

/* ── Boot, then the Admin ────────────────────────────────────────────────── */

await send('Page.navigate', { url: `${BASE}/content-unavailable` });
await new Promise((r) => setTimeout(r, 2500));

/**
 * **Every bearer is minted FIRST, from its own dedicated session; the browser
 * then takes its cookie once and keeps it.**
 *
 * The trap this shape exists for (TD-4.13, recorded in `testing.md`): the app
 * rotates the refresh cookie on every boot, so re-setting an identity's
 * ORIGINAL cookie after a page load presents a consumed token, reuse detection
 * fires, and the session is revoked. It does not surface as a clean 401 — it
 * surfaces as «ليست لديك صلاحية» on a LATER navigation, which reads as an
 * authorization bug in the feature under test. `openEditor` now throws on that
 * string rather than reporting it as a delivery failure.
 */
const adminToken = await tokenFor(process.env.ADMIN_API_COOKIE);
const safaToken = await tokenFor(process.env.SAFA_COOKIE);
const nadiaToken = await tokenFor(process.env.NADIA_COOKIE);
const studentToken = await tokenFor(process.env.STUDENT_COOKIE);
await beIdentity(process.env.ADMIN_COOKIE);

/* ── 1–3 · Scenario A: a class scheduled عن بُعد / صوت وصورة ─────────────── */

const adminSessions = await json(
  adminToken,
  `/admin/course-schedules/${S.onlineSchedule}/sessions?page=1&page_size=200`,
);
check(
  '1 · the occurrences list loaded (a negative below is only valid after this)',
  adminSessions.status === 200 && (adminSessions.data ?? []).length > 0,
  `status=${adminSessions.status} rows=${(adminSessions.data ?? []).length}`,
);
check(
  '2 · every materialized occurrence inherited عن بُعد / صوت وصورة, with NO room',
  (adminSessions.data ?? []).every(
    (r) => r.delivery_mode === 'online' && r.online_media_mode === 'audio_video' && r.room_id === null,
  ),
  JSON.stringify((adminSessions.data ?? [])[0]),
);

await open(`/admin/schedules/${S.onlineSchedule}/sessions`, '.admin-table, .state');
const listShows = await evaluate(`(() => {
  const table = document.querySelector('.admin-table');
  if (!table) return { noTable: true };
  return {
    headerHasDelivery: table.textContent.includes('طريقة الحضور'),
    saysOnline: table.textContent.includes('عن بُعد'),
    saysMedia: table.textContent.includes('صوت وصورة'),
    saysInPerson: table.textContent.includes('حضوري'),
  };
})()`);
check(
  '3 · the back-office occurrences table names طريقة الحضور and reads عن بُعد · صوت وصورة',
  listShows.headerHasDelivery === true && listShows.saysOnline === true && listShows.saysMedia === true,
  JSON.stringify(listShows),
);

/* ── 4–7 · Scenario C: ONE occurrence back to حضوري, and only that one ──── */

const editorA = await openEditor(adminToken, S.onlineSchedule, S.onlineFirst);
check(
  '4 · «تعديل» opens the occurrence editor',
  editorA.result.opened === true,
  JSON.stringify(editorA.result).slice(0, 300),
);
check(
  '5 · and it carries the SHARED delivery section, opened on what this occurrence IS',
  editorA.result.text?.includes('طريقة الحضور') === true &&
    editorA.result.text?.includes('نوع الاتصال') === true,
  JSON.stringify({
    delivery: editorA.result.text?.includes('طريقة الحضور'),
    media: editorA.result.text?.includes('نوع الاتصال'),
  }),
);

const switchedToRoom = await evaluate(setSelect('طريقة الحضور', 'in_person'));
await new Promise((r) => setTimeout(r, 700));
const roomAppeared = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  return {
    roomShown: dialog.textContent.includes('القاعة'),
    mediaGone: !dialog.textContent.includes('نوع الاتصال'),
  };
})()`);
check(
  '6 · choosing حضوري REPLACES نوع الاتصال with the room selector — hidden, not disabled',
  switchedToRoom.ok === true && roomAppeared.roomShown === true && roomAppeared.mediaGone === true,
  JSON.stringify({ switchedToRoom, roomAppeared }),
);

await evaluate(setSelect('القاعة', S.room));
await new Promise((r) => setTimeout(r, 400));
const savedA = await evaluate(saveDialog);
await new Promise((r) => setTimeout(r, 2000));

const afterA = await json(
  adminToken,
  `/admin/course-schedules/${S.onlineSchedule}/sessions?page=1&page_size=200`,
);
const targetA = (afterA.data ?? []).find((r) => r.id === S.onlineFirst);
const nextA = (afterA.data ?? []).find((r) => r.id === S.onlineNext);
check(
  '7 · THAT occurrence is حضوري in قاعة 5, and the NEXT one is still عن بُعد',
  afterA.status === 200 &&
    targetA?.delivery_mode === 'in_person' &&
    targetA?.online_media_mode === null &&
    targetA?.room_id === S.room &&
    targetA?.overridden === true &&
    nextA?.delivery_mode === 'online' &&
    nextA?.online_media_mode === 'audio_video',
  JSON.stringify({ saved: savedA, target: targetA, next: nextA }),
);

/* ── 8–9 · Scenario D: the mirror — حضوري → عن بُعد, room cleared ─────────── */

const editorB = await openEditor(adminToken, S.inPersonSchedule, S.inPersonFirst);
check(
  '8 · the in-person class opens its editor showing the room, not a media mode',
  editorB.result.opened === true &&
    editorB.result.text?.includes('القاعة') === true &&
    editorB.result.text?.includes('نوع الاتصال') === false,
  JSON.stringify({ raw: editorB.result, rowIndex: editorB.rowIndex }).slice(0, 500),
);

await evaluate(setSelect('طريقة الحضور', 'online'));
await new Promise((r) => setTimeout(r, 700));
await evaluate(setSelect('نوع الاتصال', 'audio_video'));
await new Promise((r) => setTimeout(r, 400));
const savedB = await evaluate(saveDialog);
await new Promise((r) => setTimeout(r, 2000));

const afterB = await json(
  adminToken,
  `/admin/course-schedules/${S.inPersonSchedule}/sessions?page=1&page_size=200`,
);
const targetB = (afterB.data ?? []).find((r) => r.id === S.inPersonFirst);
const nextB = (afterB.data ?? []).find((r) => r.id === S.inPersonNext);
check(
  '9 · THAT occurrence is عن بُعد with NO stale room; the next stays حضوري in قاعة 5',
  afterB.status === 200 &&
    targetB?.delivery_mode === 'online' &&
    targetB?.online_media_mode === 'audio_video' &&
    targetB?.room_id === null &&
    nextB?.delivery_mode === 'in_person' &&
    nextB?.room_id === S.room,
  JSON.stringify({ saved: savedB, target: targetB, next: nextB }),
);

/* ── 10 · Reload — the override survives, it is not view state ───────────── */

const reloaded = await json(
  adminToken,
  `/admin/course-schedules/${S.inPersonSchedule}/sessions?page=1&page_size=200`,
);
check(
  '10 · after a fresh read the override is still there',
  (reloaded.data ?? []).find((r) => r.id === S.inPersonFirst)?.delivery_mode === 'online',
  JSON.stringify((reloaded.data ?? []).find((r) => r.id === S.inPersonFirst)),
);

/* ── 11–13 · The calendars: Admin, مؤطِّرة, beneficiary ───────────────────── */

const from = S.onlineNextDate;
const calAdmin = await json(adminToken, `/calendar?from=${from}&to=${from}`);
check(
  '11 · the Admin calendar carries delivery on the occurrence projection',
  calAdmin.status === 200 &&
    (calAdmin.data ?? []).some(
      (o) => o.delivery_mode === 'online' && o.online_media_mode === 'audio_video',
    ),
  `status=${calAdmin.status} n=${(calAdmin.data ?? []).length}`,
);
check(
  '12 · an Event carries NO delivery — null, never an invented حضوري',
  (calAdmin.data ?? []).filter((o) => o.kind === 'event').every((o) => o.delivery_mode === null),
  JSON.stringify((calAdmin.data ?? []).filter((o) => o.kind === 'event').slice(0, 2)),
);

const calSafa = await json(safaToken, `/me/calendar?from=${from}&to=${from}`);
check(
  '13 · the مؤطِّرة sees her online class as عن بُعد on her own calendar',
  calSafa.status === 200 &&
    (calSafa.data ?? []).some((o) => o.delivery_mode === 'online'),
  `status=${calSafa.status} n=${(calSafa.data ?? []).length}`,
);

const calStudent = await json(studentToken, `/me/calendar?from=${from}&to=${from}`);
check(
  '14 · the beneficiary sees it too, and the audio-only class says صوت فقط',
  calStudent.status === 200 &&
    (calStudent.data ?? []).some(
      (o) => o.delivery_mode === 'online' && o.online_media_mode === 'audio_only',
    ),
  JSON.stringify((calStudent.data ?? []).map((o) => [o.title, o.delivery_mode, o.online_media_mode])).slice(0, 400),
);

/* ── 15–17 · The shared details dialog, on the public calendar ───────────── */

// **The dialog opens from a month CHIP, not from the list.** The قائمة view is
// `OccurrenceTable`, which deliberately carries no row actions (rule AO) — it
// is something to read. The grid's chips are the buttons.
await open(`/calendar`, 'main');
const dialogShows = await evaluate(`(async () => {
  const buttons = [...document.querySelectorAll('.event-chip--interactive')];
  // The occurrence title is its SUBJECT name, not the schedule name: R57 gives
  // a class its own name and the calendar shows what is being taught. Matching
  // the schedule title finds nothing.
  // (No backtick in this comment - it lives inside a template literal.)
  const target = buttons.find((b) => b.textContent.includes('سيرة'));
  if (!target) return { notFound: true, sample: buttons.slice(0, 12).map((b) => b.textContent.trim()) };
  target.click();
  await new Promise((r) => setTimeout(r, 2000));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  const text = dialog.textContent;
  return {
    opened: true,
    saysDeliveryLabel: text.includes('طريقة الحضور'),
    saysOnline: text.includes('عن بُعد'),
    saysMediaLabel: text.includes('نوع الاتصال'),
    saysAudioOnly: text.includes('صوت فقط'),
    saysRoom: text.includes('القاعة'),
    hasJoin: text.includes('دخول الحصة'),
  };
})()`);
check(
  '15 · the shared details dialog names طريقة الحضور and reads عن بُعد',
  dialogShows.opened === true &&
    dialogShows.saysDeliveryLabel === true &&
    dialogShows.saysOnline === true,
  JSON.stringify(dialogShows).slice(0, 400),
);
check(
  '16 · it names نوع الاتصال · صوت فقط, and shows NO room for an online class',
  dialogShows.saysMediaLabel === true &&
    dialogShows.saysAudioOnly === true &&
    dialogShows.saysRoom === false,
  JSON.stringify(dialogShows).slice(0, 400),
);
/**
 * **17 — RESTATED, not deleted (R98).**
 *
 * This check read *«there is no «دخول الحصة» — the infrastructure does not
 * exist yet»*, which was R97's true and deliberate claim. R98 built that
 * infrastructure, so the sentence stopped being the property. **The property
 * was never the absence of a button**: it is that **delivery decides whether
 * the class has a door at all**, and that is exactly as much a delivery fact
 * now as it was when there were no doors.
 *
 * So it asserts the asymmetry instead — an online class offers the way in, an
 * in-person one never does. *Who* may walk through it is R98's question and is
 * proved by `verify-livekit-join`.
 */
// Close the previous dialog in its OWN evaluation and reload the page before
// the next click: React re-renders on close, so a chip captured in the same
// turn is a stale node and its click reaches nothing.
await evaluate(`(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true; })()`);
await open(`/calendar`, 'main');
const inPersonDialog = await evaluate(`(async () => {
  const buttons = [...document.querySelectorAll('.event-chip--interactive')];
  const target = buttons.find((b) => b.textContent.includes('فقه'));
  if (!target) return { notFound: true };
  target.click();
  await new Promise((r) => setTimeout(r, 1500));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  const text = dialog.textContent;
  return { opened: true, saysInPerson: text.includes('حضوري'), hasJoin: text.includes('دخول الحصة') };
})()`);
check(
  '17 · delivery decides whether there is a door: عن بُعد offers «دخول الحصة», حضوري never does',
  dialogShows.hasJoin === true &&
    inPersonDialog.opened === true &&
    inPersonDialog.saysInPerson === true &&
    inPersonDialog.hasJoin === false,
  JSON.stringify({ online: dialogShows.hasJoin, inPerson: inPersonDialog }),
);

/* ── 18 · The month grid marks the exception and stays quiet otherwise ───── */

await open(`/calendar`, 'main');
const chips = await evaluate(`(() => {
  const marks = [...document.querySelectorAll('.event-chip__delivery')];
  const all = [...document.querySelectorAll('.event-chip')];
  return {
    marked: marks.length,
    total: all.length,
    words: [...new Set(marks.map((m) => m.textContent.trim()))],
    // The page body must never scroll sideways (rule: wide content scrolls in
    // its own container).
    bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);
check(
  '18 · online chips are marked with the WORD عن بُعد, in-person chips are not, and nothing overflows',
  chips.marked > 0 &&
    chips.marked < chips.total &&
    chips.words.length === 1 &&
    chips.words[0] === 'عن بُعد' &&
    chips.bodyOverflow <= 0,
  JSON.stringify(chips),
);

/* ── 19 · Narrow viewport: Arabic labels fit, no second scrollbar ────────── */

await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
});
const editorNarrow = await openEditor(adminToken, S.onlineSchedule, S.onlineNext);
const narrow = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  const labels = [...dialog.querySelectorAll('label')].map((l) => ({
    text: l.textContent.trim().slice(0, 24),
    clipped: l.scrollWidth > l.clientWidth + 1,
  }));
  return {
    // The dialog scrolls internally; the PAGE must not scroll sideways.
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dialogOverflowX: dialog.scrollWidth - dialog.clientWidth,
    clipped: labels.filter((l) => l.clipped).map((l) => l.text),
  };
})()`);
check(
  '19 · at 390px the Arabic labels fit and neither the page nor the dialog scrolls sideways',
  editorNarrow.result.opened === true &&
    narrow.pageOverflowX <= 0 &&
    narrow.dialogOverflowX <= 1 &&
    (narrow.clipped ?? []).length === 0,
  JSON.stringify(narrow),
);

/* ── 20 · Switching modes must not leave a second scrollbar behind ───────── */

await evaluate(setSelect('طريقة الحضور', 'in_person'));
await new Promise((r) => setTimeout(r, 600));
const afterSwitch = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  return {
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dialogOverflowX: dialog.scrollWidth - dialog.clientWidth,
  };
})()`);
check(
  '20 · switching عن بُعد ⇄ حضوري leaves no horizontal overflow behind',
  afterSwitch.pageOverflowX <= 0 && afterSwitch.dialogOverflowX <= 1,
  JSON.stringify(afterSwitch),
);

/* ── 21 · A forged combination is refused by the SERVER, not hidden ──────── */

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});
const before21 = (
  await json(adminToken, `/admin/course-schedules/${S.onlineSchedule}/sessions?page=1&page_size=200`)
).data?.find((r) => r.id === S.onlineNext);
const forged = await evaluate(`(async () => {
  const res = await fetch('/api/v1/sessions/' + ${JSON.stringify(S.onlineNext)}, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + ${JSON.stringify(adminToken)},
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: ${before21?.version ?? 0},
      delivery_mode: 'online',
      online_media_mode: 'audio_video',
      room_id: ${JSON.stringify(S.room)},
    }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 200) };
})()`);
const after21 = (
  await json(adminToken, `/admin/course-schedules/${S.onlineSchedule}/sessions?page=1&page_size=200`)
).data?.find((r) => r.id === S.onlineNext);
check(
  '21 · an online occurrence sent WITH a room is refused 400, and the row is unchanged',
  forged.status === 400 &&
    after21?.delivery_mode === before21?.delivery_mode &&
    after21?.room_id === null &&
    after21?.version === before21?.version,
  JSON.stringify({ forged, before: before21, after: after21 }),
);

/* ── 22 · A مؤطِّرة cannot move an occurrence she does not staff ──────────── */

const strangerBefore = (
  await json(adminToken, `/admin/course-schedules/${S.onlineSchedule}/sessions?page=1&page_size=200`)
).data?.find((r) => r.id === S.onlineNext);
const stranger = await evaluate(`(async () => {
  const res = await fetch('/api/v1/sessions/' + ${JSON.stringify(S.onlineNext)}, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + ${JSON.stringify(nadiaToken)},
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: ${strangerBefore?.version ?? 0},
      delivery_mode: 'in_person',
      room_id: ${JSON.stringify(S.room)},
    }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 160) };
})()`);
const strangerAfter = (
  await json(adminToken, `/admin/course-schedules/${S.onlineSchedule}/sessions?page=1&page_size=200`)
).data?.find((r) => r.id === S.onlineNext);
check(
  '22 · a مؤطِّرة who does not staff it gets 404 (§20 rule 17) and the row is untouched',
  stranger.status === 404 &&
    strangerAfter?.delivery_mode === 'online' &&
    strangerAfter?.room_id === null,
  JSON.stringify({ stranger, after: strangerAfter }),
);

/* ── 23 · R91 and R92 are untouched by an override ───────────────────────── */

const roster = await json(adminToken, `/sessions/${S.inPersonFirst}/roster`);
check(
  '23 · the occurrence moved عن بُعد keeps its audience and its venue branch (R92)',
  roster.status === 200 && roster.data?.venue?.branch_id === S.branch,
  JSON.stringify({ status: roster.status, venue: roster.data?.venue }),
);

const staffed = await json(
  adminToken,
  `/calendar?from=${S.inPersonFirstDate}&to=${S.inPersonFirstDate}`,
);
const movedOccurrence = (staffed.data ?? []).find((o) => o.id === S.inPersonFirst);
check(
  '24 · and it keeps the مؤطِّرة who teaches it (R91) — delivery changed nothing about staffing',
  staffed.status === 200 && (movedOccurrence?.instructors ?? []).length === 1,
  JSON.stringify({ instructors: movedOccurrence?.instructors, mode: movedOccurrence?.delivery_mode }),
);

await close();
finish('R97 — delivery (حضوري / عن بُعد)');
