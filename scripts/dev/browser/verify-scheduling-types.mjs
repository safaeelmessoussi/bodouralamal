/**
 * **R110 (NEW H) — the scheduling-type catalogue, on the real pages.**
 *
 * Three claims, and none of them can be checked from source:
 *
 * 1. **أنواع الجدولة renders the seeded catalogue** — the Owner's five rows, in
 *    her order, with `حضور إجباري` read from the column rather than from the
 *    Arabic name.
 * 2. **The الجدولة type picker offers those rows**, not the three entities it
 *    used to offer. That is the whole of *"it must not remain duplicated as an
 *    independent frontend registry"*, and only the rendered `<select>` can say
 *    whether it is true.
 * 3. **The attendance notice follows the flag** — present for a type that takes
 *    attendance, absent for one that does not. The negative half is the half
 *    that matters: a notice that always rendered would pass a check for its
 *    presence and prove nothing.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9228');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

/**
 * **The path is checked as well as the selector, and that is not belt-and-braces.**
 *
 * With only a selector, `goto('/admin/schedules', 'button, .btn')` returns
 * `ready` against the page it is navigating AWAY from — every back-office screen
 * has a button. The first run of this harness did exactly that, clicked
 * «إضافة نوع» on the أنواع الجدولة page it had not left yet, and read the
 * structural-kind selector while believing it was reading the الجدولة picker.
 * It left a stray `نشاط` row behind, which is how it was noticed at all.
 */
async function goto(path, ready) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      if (document.location.pathname !== ${JSON.stringify(path)}) return 'navigating';
      return document.querySelector(${JSON.stringify(ready)}) ? 'ready' : 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

/* ── 1. The management screen renders the catalogue ─────────────────────── */

const state = await goto('/admin/scheduling-types', 'table tbody tr');
check('أنواع الجدولة opens for a Super Admin', state === 'ready', { state });

/**
 * **The drag handle is a cell too.** Reordering is enabled for a Super Admin, so
 * `DataTable` renders a handle column before the name — reading `cells[0]` as
 * the name gave five rows all called `⠿`. Cells are therefore taken from the
 * END, which is stable whether or not the handle is present.
 */
const rows = await evaluate(`(() => {
  const trs = [...document.querySelectorAll('table tbody tr')];
  return JSON.stringify(trs.map((tr) => {
    const cells = [...tr.querySelectorAll('th,td')]
      .map((c) => c.textContent.trim())
      .filter((v) => v !== '' && v !== '⠿');
    return { name: cells[0], kind: cells[1], attendance: cells[2], inUse: cells[3] };
  }));
})()`);
const table = JSON.parse(rows ?? '[]');

// The Owner's table, verbatim — order included, because she calls it canonical.
const EXPECTED = [
  { name: 'حصة دراسية', attendance: 'نعم' },
  { name: 'اختبار', attendance: 'نعم' },
  { name: 'محاضرة', attendance: 'لا' },
  { name: 'حفل', attendance: 'لا' },
  { name: 'عطلة', attendance: 'لا' },
];
const seeded = table.filter((r) => EXPECTED.some((e) => e.name === r.name));
check(
  "the five seeded types render in the Owner's order",
  seeded.length === 5 && seeded.every((r, i) => r.name === EXPECTED[i].name),
  // Reported as POSITIONS, not as the Arabic names: a terminal applies bidi to a
  // comma-separated Arabic list and prints it mirrored, which made a correct
  // order look reversed while this harness was being written.
  seeded.map((r) => EXPECTED.findIndex((e) => e.name === r.name) + 1).join(' → '),
);
check(
  'حضور إجباري is read from the COLUMN — نعم for حصة دراسية and اختبار, لا for the rest',
  seeded.every((r, i) => r.attendance === EXPECTED[i].attendance),
  seeded.map((r) => `${r.name}:${r.attendance}`),
);
// The routing R56 settled, rendered: five rows, three entities.
check(
  'three of the five are delivered as the same entity',
  new Set(seeded.map((r) => r.kind)).size === 3,
  [...new Set(seeded.map((r) => r.kind))],
);

/* ── 2. The الجدولة picker offers the catalogue, not the entities ───────── */

const sched = await goto('/admin/schedules', 'button, .btn');
check('الجدولة opens', sched === 'ready', { state: sched });

const opened = await evaluate(`(() => {
  const add = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.includes('إضافة'));
  if (!add) return 'no-add-button';
  add.click();
  return 'clicked';
})()`);
check('the add dialog opens', opened === 'clicked', { opened });

// Give the catalogue read time to land — the picker falls back to entity labels
// until it does, which is a real state and not the one under test here.
let options = [];
for (let i = 0; i < 40; i += 1) {
  const raw = await evaluate(`(() => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return '[]';
    const select = dialog.querySelector('select');
    if (!select) return '[]';
    return JSON.stringify([...select.options].map((o) => o.textContent.trim()));
  })()`);
  options = JSON.parse(raw ?? '[]');
  if (options.includes('حفل')) break;
  await new Promise((r) => setTimeout(r, 250));
}

check(
  'the picker offers the CATALOGUE rows, not the three entities',
  ['حصة دراسية', 'اختبار', 'محاضرة', 'حفل', 'عطلة'].every((n) => options.includes(n)),
  options,
);
// The negative half: `نشاط` was the old entity-level label. Its absence is what
// says the registry stopped being the source.
check(
  'and no longer offers the bare entity label «نشاط»',
  !options.includes('نشاط'),
  options,
);

/* ── 3. The attendance notice follows the FLAG ──────────────────────────── */

const noticeFor = async (typeName) => {
  await evaluate(`(() => {
    const dialog = document.querySelector('dialog[open]');
    const select = dialog && dialog.querySelector('select');
    if (!select) return 'no-select';
    const option = [...select.options]
      .find((o) => o.textContent.trim() === ${JSON.stringify(typeName)});
    if (!option) return 'no-option';
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  return evaluate(`(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog ? dialog.textContent.includes('يُسجَّل الحضور') : false;
  })()`);
};

const withAttendance = await noticeFor('اختبار');
const withoutAttendance = await noticeFor('عطلة');
check('اختبار (حضور إجباري = نعم) states that attendance is taken', withAttendance === true, {
  withAttendance,
});
check('عطلة (حضور إجباري = لا) states nothing about attendance', withoutAttendance === false, {
  withoutAttendance,
});

await close();
finish();
