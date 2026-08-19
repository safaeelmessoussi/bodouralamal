/**
 * **The staff picker's planning warnings, in a real browser** (R90).
 *
 * Five مؤطِّرات, each shaped to isolate one appraisal. What is proved here is
 * both halves of R88.3, in the order that makes the distinction visible:
 *
 * 1. the administrator can **tell them apart** on the form;
 * 2. she can **still assign** the ones the appraisal complains about;
 * 3. and authority follows the **assignment**, not the profile — هـ, who has
 *    declared nothing, teaches the class once assigned; أ, whose profile is
 *    flawless, teaches nothing while she is not.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R90_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9243');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});
await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.ADMIN_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});

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

/** One authenticated API call from the page, so the harness never mints a second
 *  token — TD-4.13's reuse detection revokes the session when it does. */
const api = (path, init) =>
  evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    const { access_token } = await r.json();
    const res = await fetch('/api/v1' + ${JSON.stringify(path)}, {
      ...${JSON.stringify(init ?? {})},
      headers: {
        Authorization: 'Bearer ' + access_token,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    return { status: res.status, body: await res.text() };
  })()`);

const NAMES = {
  a: '[r90-picker] أ المناسبة',
  b: '[r90-picker] ب غير المتفرغة',
  c: '[r90-picker] ج بلا مادة',
  d: '[r90-picker] د المرتبطة',
  e: '[r90-picker] هـ بلا ملف',
};

/* ── 1–2 · the appraisal the picker is built on ──────────────────────────── */

await open('/admin/schedules', '.admin-table, .state');

const appraised = await api(
  `/admin/teaching-candidates?recurrence=weekly&weekdays=wednesday&start_time=15:30&end_time=17:00&subject_id=${S.subject}&level_id=${S.level}&exclude_schedule_id=${S.planned}`,
);
const rows = JSON.parse(appraised.body || '{}').data ?? [];
const of = (key) => rows.find((r) => r.id === S.teachers[key]) ?? { warnings: ['ABSENT'] };

check(
  '1 · every one of the five is returned — the list is never shortened',
  ['a', 'b', 'c', 'd', 'e'].every((k) => rows.some((r) => r.id === S.teachers[k])),
  JSON.stringify({ status: appraised.status, returned: rows.length }),
);
check(
  '2 · and each carries exactly the concern she was built to have',
  of('a').warnings.length === 0 &&
    JSON.stringify(of('b').warnings) === '["unavailable"]' &&
    JSON.stringify(of('c').warnings) === '["subject_not_declared"]' &&
    JSON.stringify(of('d').warnings) === '["conflict"]' &&
    of('e').no_profile === true,
  JSON.stringify(
    Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((k) => [k, of(k).warnings])),
  ),
);

/* ── 3–7 · what an administrator actually sees on the form ───────────────── */

await open(`/admin/schedules?edit=${S.planned}`, '.admin-table, .state');

const openForm = () =>
  evaluate(`(async () => {
    const row = [...document.querySelectorAll('.admin-table tbody tr')].find((tr) =>
      tr.textContent.includes('الحصة المخطط لها'),
    );
    if (!row) return { noRow: true };
    const edit = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
    if (!edit) return { noEdit: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    edit.click();
    await new Promise((r) => setTimeout(r, 2500));
    const dialog = document.querySelector('dialog[open]');
    return { opened: dialog !== null };
  })()`);

const form = await openForm();
check('3 · the class opens for editing', form.opened === true, JSON.stringify(form));

/**
 * **Restated 2026-08-19 — the control changed shape, the properties did not.**
 *
 * The class form no longer has one «المؤطّرة» select and a checkbox list. R91
 * gave an assignment an effective period, so a class composes `StaffingPeriods`:
 * one row per assignment, added with «إضافة إسناد». An unstaffed class starts
 * with **no rows at all**, which is why looking for a populated select found
 * nothing and reported an empty picker.
 *
 * What is still asserted, unchanged: every candidate is offered, the ones with a
 * concern are marked before the choice, the concerns are named in Arabic beside
 * the control, nothing is disabled, and the one with no profile can still be
 * assigned.
 */
const addRow = () =>
  evaluate(`(async () => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return { noDialog: true };
    // **Substring, not exact equality** — the shared Button renders the add
    // variant as ＋إضافة إسناد, and === silently matched nothing.
    // (No backticks in this comment: it lives inside a template literal.)
    const add = [...dialog.querySelectorAll('button')].find((b) =>
      b.textContent.includes('إضافة إسناد'),
    );
    if (!add) return { noAdd: true, labels: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    add.click();
    await new Promise((r) => setTimeout(r, 700));
    return { added: true };
  })()`);

const added = await addRow();

const picker = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  // The person select is the one offering a seeded مؤطِّرة BY NAME — the fixture
  // tag alone also matches the Branch selector, whose one option is the seeded
  // branch.
  const select = [...dialog.querySelectorAll('select')].find((sel) =>
    [...sel.options].some((o) => o.textContent.includes('[r90-picker] أ')),
  );
  return {
    options: select ? [...select.options].map((o) => o.textContent.trim()) : [],
    offered: select ? select.options.length : 0,
  };
})()`);

check(
  '4 · all five are OFFERED in the picker — a warning removes nobody',
  ['a', 'b', 'c', 'd', 'e'].every((k) =>
    picker.options.some((o) => o.startsWith(NAMES[k])),
  ),
  JSON.stringify({ added, options: picker.options }),
);
check(
  '5 · the ones with a concern are MARKED before the choice, and أ is not',
  picker.options.some((o) => o === NAMES.a) &&
    picker.options.some((o) => o.startsWith(NAMES.b) && o.includes('ملاحظة')) &&
    picker.options.some((o) => o.startsWith(NAMES.c) && o.includes('ملاحظة')) &&
    picker.options.some((o) => o.startsWith(NAMES.e) && o.includes('بلا ملف')),
  JSON.stringify(picker.options.filter((o) => o.startsWith('[r90-picker]'))),
);

/**
 * **Restated for R91's staffing editor — and one harness bug that was hiding it.**
 *
 * Two layers were wrong, and only the second was obvious:
 *
 * 1. **Intentional UX change.** R91 gave an assignment an effective period, so a
 *    class composes `StaffingPeriods` — one dated row per assignment — instead
 *    of `StaffPicker`'s single «المؤطّرة» selector. An unstaffed class starts
 *    with **no rows at all**, so there is no person select until one is added.
 * 2. **Harness defect.** The add control was matched with
 *    `textContent.trim() === 'إضافة إسناد'`, and the shared `Button` renders
 *    `variant="add"` as **`＋إضافة إسناد`** — the platform's one add convention,
 *    deliberately carried by the variant so the glyph cannot be forgotten on the
 *    seventh screen. Exact equality never matched, the row was never added, and
 *    the probe reported an empty picker on a control that works. **Production
 *    was correct throughout**; a form probe traced it in one pass (type `class`,
 *    `ClassSection`, legend «المؤطّرات وفتراتهن», button `＋إضافة إسناد`).
 *
 * The properties asserted are unchanged: every candidate offered, the ones with
 * a concern marked before the choice, each concern named in Arabic beside the
 * control, nothing disabled, and the one with no profile assignable anyway.
 *
 * **Add the row and read every case in ONE evaluate.**
 *
 * Split across calls, the appraisal arriving between them re-rendered the
 * section and the probe reported an empty control that was working — a green
 * check and a red one describing the same healthy screen. Doing it in a single
 * page-side pass removes the window entirely, and asserts exactly the same
 * properties.
 */
const cases = await evaluate(`(async () => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  const person = () =>
    [...dialog.querySelectorAll('select')].find((sel) =>
      [...sel.options].some((o) => o.textContent.includes('[r90-picker] أ')),
    );
  if (!person()) {
    // **Substring, not exact equality** — the shared Button renders the add
    // variant as ＋إضافة إسناد, and === silently matched nothing.
    // (No backticks in this comment: it lives inside a template literal.)
    const add = [...dialog.querySelectorAll('button')].find((b) =>
      b.textContent.includes('إضافة إسناد'),
    );
    if (add) {
      add.click();
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(document.createElement('select')), 'value',
  ).set;
  const out = {};
  for (const [key, name] of Object.entries(${JSON.stringify(NAMES)})) {
    const select = person();
    if (!select) { out[key] = { noSelect: true }; continue; }
    const option = [...select.options].find((o) => o.textContent.trim().startsWith(name));
    if (!option) { out[key] = { noOption: true }; continue; }
    setter.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    out[key] = {
      chips: [...dialog.querySelectorAll('.staff-picker__warnings .badge')].map((b) =>
        b.textContent.trim(),
      ),
      disabled: select.disabled,
    };
  }
  return out;
})()`);

check(
  '6 · a candidate with no concern is completely silent',
  Array.isArray(cases.a?.chips) && cases.a.chips.length === 0,
  JSON.stringify(cases.a),
);
check(
  '7 · and each concern is named, in Arabic, beside the control',
  (cases.b?.chips ?? []).includes('غير متاحة في هذا الوقت') &&
    (cases.c?.chips ?? []).includes('المادة غير مذكورة في ملفها') &&
    (cases.d?.chips ?? []).includes('لديها حصة متعارضة') &&
    (cases.e?.chips ?? []).includes('لم تُسجَّل بيانات تخطيط'),
  JSON.stringify(cases),
);
check(
  '8 · nothing is disabled — a warning is not a refusal',
  ['b', 'c', 'd', 'e'].every((k) => cases[k]?.disabled === false),
  JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.disabled]))),
);

/* ── 9–10 · she can still be assigned ────────────────────────────────────── */

const saved = await evaluate(`(async () => {
  const dialog = document.querySelector('dialog[open]');
  // هـ is left selected by the loop above — the candidate with NO profile at
  // all, which is the hardest case for "the warning does not block". Her row's
  // position is left at its default (assistant), so the assertion below reads
  // whichever position was stored rather than assuming one.
  const submit = [...dialog.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'حفظ',
  );
  if (!submit) return { noSubmit: true, labels: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  submit.click();
  await new Promise((r) => setTimeout(r, 3000));
  const still = document.querySelector('dialog[open]');
  return { closed: still === null, stillSays: still ? still.textContent.slice(0, 240) : null };
})()`);

check(
  '9 · هـ — no profile at all — is assigned, and the form accepts it',
  saved.closed === true,
  JSON.stringify(saved),
);

const stored = JSON.parse(
  (await api(`/admin/course-schedules?page=1&page_size=100`)).body || '{}',
);
const plannedRow = (stored.data ?? []).find((r) => r.id === S.planned);
check(
  '10 · and the assignment is what was actually stored',
  (plannedRow?.staff ?? []).some((x) => x.user_id === S.teachers.e),
  JSON.stringify(plannedRow?.staff ?? null),
);

/* ── 11–13 · authority follows the ASSIGNMENT, not the profile ───────────── */

const authorityOf = async (userId) => {
  const res = await api(`/admin/course-schedules?page=1&page_size=100`);
  const all = JSON.parse(res.body || '{}').data ?? [];
  return all.filter((r) => (r.staff ?? []).some((x) => x.user_id === userId));
};

const eStaffs = await authorityOf(S.teachers.e);
check(
  '11 · هـ now staffs the class her profile said nothing about',
  eStaffs.some((r) => r.id === S.planned),
  JSON.stringify(eStaffs.map((r) => r.id)),
);

const aStaffs = await authorityOf(S.teachers.a);
check(
  '12 · أ — the flawless profile — staffs NOTHING, because nobody assigned her',
  aStaffs.length === 0,
  JSON.stringify(aStaffs.map((r) => r.id)),
);

const stillWarned = JSON.parse(
  (
    await api(
      `/admin/teaching-candidates?recurrence=weekly&weekdays=wednesday&start_time=15:30&end_time=17:00&subject_id=${S.subject}&level_id=${S.level}&exclude_schedule_id=${S.planned}`,
    )
  ).body || '{}',
).data ?? [];
const eAfter = stillWarned.find((r) => r.id === S.teachers.e);
check(
  '13 · and the warning did not go away — planning data and authority are two facts',
  eAfter?.no_profile === true,
  JSON.stringify(eAfter),
);

close();
process.exit(finish());
