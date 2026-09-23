/**
 * **R172 §13 — a plain weekly class follows its start date on edit, on the real
 * «الجدول» page.**
 *
 * The Owner: «editing تاريخ البداية from 5 أكتوبر 2026 to 6 أكتوبر 2026 should
 * reschedule the sessions to tuesdays instead of mondays, but it didn't». A
 * weekly class is created through the API on a Monday (its stored weekday
 * `[monday]`, exactly the row the edit form opens with); «تعديل» then moves
 * تاريخ البداية one day through the real date picker and saves; the server's
 * `weekdays` must now say Tuesday, and its next occurrences fall on Tuesdays.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
if (!process.env.DEV_REFRESH_COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9231');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.DEV_REFRESH_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

const HELPERS = `
  const dlg = () => document.querySelector('dialog[open]');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fieldOf = (label) => [...dlg().querySelectorAll('.field')].find((f) => {
    const l = f.querySelector('.field__label');
    return l && l.textContent.trim().indexOf(label) === 0;
  });
  const token = async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    return (await r.json()).access_token;
  };
  const api = async (method, path, body) => {
    const res = await fetch('/api/v1' + path, {
      method,
      headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
`;
const page = (body) => evaluate(`(async () => { ${HELPERS} ${body} })()`);

await send('Page.navigate', { url: `${BASE}/admin/schedules` });
await new Promise((r) => setTimeout(r, 5000));

/* ── a weekly class on a Monday, far enough ahead to be untouched by today ── */

// The first Monday at least six weeks out, so the picker's «next month» path
// is exercised and no materialised past occurrence complicates the read.
const monday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 42);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const tuesday = (() => {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const TAG = `[dev-scenario] §13 ${Date.now()}`;

const created = await page(`
  return api('POST', '/admin/course-schedules', {
    description: ${JSON.stringify(TAG)},
    subject_id: ${JSON.stringify(S.subjectId)},
    teaching_mode: 'administrative_group',
    target_id: ${JSON.stringify(S.groupId)},
    surah_ids: [1],
    branch_id: ${JSON.stringify(S.branchId)},
    room_id: ${JSON.stringify(S.roomId)},
    start_time: '09:00',
    end_time: '10:00',
    recurrence: 'weekly',
    weekdays: ['monday'],
    anchor_date: ${JSON.stringify(monday)},
    academic_year_id: ${JSON.stringify(S.academicYearId)},
  });
`);
check(
  `1 · a weekly class is created on Monday ${monday}, stored as [monday]`,
  created.status === 201 && JSON.stringify(created.body?.schedule?.weekdays) === JSON.stringify(['monday']),
  JSON.stringify({ status: created.status, weekdays: created.body?.schedule?.weekdays, error: created.body?.error }),
);
// A write answers `{ schedule, materialization }` (R55).
const id = created.body?.schedule?.id;

/* ── «تعديل» moves تاريخ البداية to the Tuesday through the real picker ─── */

await send('Page.navigate', { url: `${BASE}/admin/schedules` });
await new Promise((r) => setTimeout(r, 5000));

const edited = await page(`
  // Find the row by the description tag (the title is composed) — the row's
  // action is «تعديل». The list may be paginated: look the class up first.
  const list = await api('GET', '/admin/course-schedules?page_size=100');
  const row = list.body.data.find((x) => x.id === ${JSON.stringify(id)});
  if (!row) return { noRow: true };
  const tr = [...document.querySelectorAll('tr')].find((t) => t.textContent.includes(row.title));
  if (!tr) return { noTr: true, title: row.title };
  const edit = [...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
  if (!edit) return { noEdit: true };
  edit.click();
  await wait(1500);
  if (!dlg()) return { noDialog: true };
  const field = fieldOf('تاريخ البداية');
  if (!field) return { noDateField: true };
  const before = field.querySelector('.date-picker__trigger')?.textContent.trim();
  field.querySelector('.date-picker__trigger').click();
  await wait(400);
  // Walk «الشهر التالي» until the Tuesday's cell exists (ids end in -d-<iso>).
  let cell = null;
  for (let i = 0; i < 4 && !cell; i += 1) {
    cell = field.querySelector('[id$="-d-' + ${JSON.stringify(tuesday)} + '"]');
    if (cell) break;
    field.querySelector('button[aria-label="الشهر التالي"]')?.click();
    await wait(300);
  }
  if (!cell) return { noCell: true, before };
  cell.click();
  await wait(400);
  const after = field.querySelector('.date-picker__trigger')?.textContent.trim();
  const save = [...dlg().querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  if (!save) return { noSave: true };
  const disabled = save.disabled;
  save.click();
  await wait(4000);
  return { before, after, disabled, closed: dlg() === null, notice: (dlg()?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 200) };
`);
check(
  `2 · «تعديل» opens on the class, the picker moves تاريخ البداية to ${tuesday}, and the save closes the dialog`,
  edited.closed === true && edited.disabled === false && edited.before !== edited.after,
  JSON.stringify(edited),
);

/* ── the server now says Tuesday, and so do the occurrences ─────────────── */

const stored = await page(`
  // (There is no single-schedule GET — the list row is the read.)
  const list = await api('GET', '/admin/course-schedules?page_size=100');
  const row = list.body.data.find((x) => x.id === ${JSON.stringify(id)});
  const sessions = await api('GET', '/admin/course-schedules/' + ${JSON.stringify(id)} + '/sessions?page_size=5');
  return {
    status: list.status,
    anchor_date: row?.anchor_date,
    weekdays: row?.weekdays,
    dates: (sessions.body?.data ?? []).map((s) => s.date).slice(0, 3),
  };
`);
const weekdayOf = (iso) => ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
check(
  `3 · the class now starts ${tuesday} and meets on Tuesdays — not Mondays`,
  stored.anchor_date === tuesday && JSON.stringify(stored.weekdays) === JSON.stringify(['tuesday']),
  JSON.stringify(stored),
);
check(
  '4 · its next occurrences fall on Tuesdays',
  stored.dates.length > 0 && stored.dates.every((d) => weekdayOf(d) === 'tuesday'),
  JSON.stringify(stored.dates),
);

// Leave nothing behind: the class goes through its own door.
if (id) await page(`return api('DELETE', '/admin/course-schedules/' + ${JSON.stringify(id)});`);

close();
process.exit(finish());
