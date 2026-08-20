/**
 * **The calendar contract, measured on every surface** (R84, rule AO).
 *
 * The Owner's key requirement is geometric: *the filter section must never
 * disappear when switching قائمة ↔ تقويم*, on any surface, for any role. A
 * control that exists in the source but is rendered inside one branch of a
 * ternary satisfies every static check and fails this one — which is exactly
 * what the back office did.
 *
 * Each surface is asked as somebody who legitimately reads it, because the
 * filter matrix is a statement about roles and only the right session can
 * observe it.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9238');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

async function as(cookie) {
  await send('Network.clearBrowserCookies');
  if (cookie) {
    await send('Network.setCookie', {
      name: 'bodour_refresh',
      value: cookie,
      domain: 'localhost',
      path: '/api/v1/auth/refresh',
      httpOnly: true,
    });
  }
}

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 900));
}

/** The chrome as a reader sees it: which filters, which month controls. */
const chrome = () =>
  evaluate(`(() => {
    const labels = [...document.querySelectorAll('.cal-header__filters label')].map((l) =>
      l.textContent.trim(),
    );
    const disabled = [...document.querySelectorAll('.cal-header__filters select')]
      .filter((s) => s.disabled)
      .map((s) => {
        const field = s.closest('.field');
        const l = field ? field.querySelector('label') : null;
        return l ? l.textContent.trim() : '?';
      });
    return {
      filters: labels,
      disabled,
      hasTitle: document.querySelector('.cal-header__centre .cal-title') !== null,
      hasStepping: document.querySelector('.cal-header__end .cal-segmented') !== null,
      table: document.querySelectorAll('.admin-table').length,
      grid: document.querySelectorAll('.cal-grid').length,
      actionColumns: [...document.querySelectorAll('.admin-table th')].filter((th) =>
        th.textContent.includes('إجراءات'),
      ).length,
      url: window.location.search,
    };
  })()`);

const switchTo = (label) =>
  evaluate(`(async () => {
    const tab = [...document.querySelectorAll('.cal-segmented button')].find(
      (b) => b.textContent.trim() === ${JSON.stringify(label)},
    );
    if (!tab) return false;
    tab.click();
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  })()`);

const pick = (label) =>
  evaluate(`(async () => {
    const field = [...document.querySelectorAll('.cal-header__filters .field')].find((f) => {
      const l = f.querySelector('label');
      return l && l.textContent.includes(${JSON.stringify(label)});
    });
    if (!field) return { missing: true };
    const select = field.querySelector('select');
    if (select.disabled) return { disabled: true };
    const option = [...select.options].find((o) => o.value !== '');
    if (!option) return { noOptions: true };
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value').set;
    set.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1400));
    return { value: option.value, label: option.textContent.trim() };
  })()`);

/**
 * The one property, asked the same way on every surface: choose a filter in one
 * view, switch, and find it still on screen with its value intact.
 */
async function surviveSwitch(name, filterLabel) {
  const chosen = await pick(filterLabel);
  if (chosen.missing || chosen.noOptions) {
    check(`${name} · «${filterLabel}» offers something to choose`, false, JSON.stringify(chosen));
    return;
  }
  check(
    `${name} · «${filterLabel}» is usable (not disabled)`,
    chosen.disabled !== true,
    JSON.stringify(chosen),
  );

  const before = await chrome();
  await switchTo('تقويم');
  const inCalendar = await chrome();
  check(
    `${name} · the FILTER SECTION survives the switch to تقويم`,
    inCalendar.filters.length === before.filters.length && inCalendar.filters.length > 0,
    JSON.stringify({ before: before.filters, after: inCalendar.filters }),
  );
  check(
    `${name} · and the chosen value survives it`,
    inCalendar.url.includes(chosen.value),
    inCalendar.url,
  );

  await switchTo('قائمة');
  const back = await chrome();
  check(
    `${name} · and switching back keeps both`,
    back.filters.length === before.filters.length && back.url.includes(chosen.value),
    JSON.stringify({ filters: back.filters, url: back.url }),
  );
}

/* ── the back office ────────────────────────────────────────────────────── */

await as(process.env.ADMIN_COOKIE);
await open('/admin/schedules?view=list', '.admin-table, .state');
const adminList = await chrome();

check(
  `1 · admin قائمة shows the filter section (${adminList.filters.join(' · ')})`,
  adminList.filters.length >= 5,
  JSON.stringify(adminList.filters),
);
check(
  '2 · المستوى is USABLE without choosing a Category first',
  !adminList.disabled.some((d) => d.includes('المستوى')),
  JSON.stringify({ disabled: adminList.disabled }),
);
check(
  '3 · no السنة الدراسية anywhere in the calendar filters',
  !adminList.filters.some((f) => f.includes('السنة')),
  JSON.stringify(adminList.filters),
);
check(
  '4 · the list carries NO month title and NO stepping — it is not month-scoped',
  adminList.hasTitle === false && adminList.hasStepping === false,
  JSON.stringify({ title: adminList.hasTitle, stepping: adminList.hasStepping }),
);
check(
  '5 · and it keeps its actions column, being an operational view',
  adminList.actionColumns >= 1,
  JSON.stringify({ actionColumns: adminList.actionColumns }),
);

await surviveSwitch('6 · admin', 'المستوى');

await open('/admin/schedules?view=calendar', '.cal-header');
const adminCalendar = await chrome();
check(
  '7 · admin تقويم DOES carry the month title and the stepping',
  adminCalendar.hasTitle && adminCalendar.hasStepping,
  JSON.stringify({ title: adminCalendar.hasTitle, stepping: adminCalendar.hasStepping }),
);
check(
  '8 · and the same filter section as its list',
  adminCalendar.filters.length === adminList.filters.length,
  JSON.stringify({ list: adminList.filters, calendar: adminCalendar.filters }),
);

/* ── public ─────────────────────────────────────────────────────────────── */

await as(null);
await open('/calendar?view=list', '.cal-header');
const publicList = await chrome();
check(
  `9 · public قائمة is a DataTable (${publicList.table} table)`,
  publicList.table === 1,
  JSON.stringify({ tables: publicList.table }),
);
check(
  '10 · with NO actions column',
  publicList.actionColumns === 0,
  JSON.stringify({ actionColumns: publicList.actionColumns }),
);
check(
  '11 · public keeps the month title and stepping in the LIST too',
  publicList.hasTitle && publicList.hasStepping,
  JSON.stringify({ title: publicList.hasTitle, stepping: publicList.hasStepping }),
);
/* **Widened by the Owner (R85 §2), not by drift.** The public set gained الفرع,
   الفئة and المادة — every option from data that is already public (the §5.1
   branch directory and the calendar bootstrap's anonymous lists), so nothing
   internal is exposed to populate a control. What is still guarded is that the
   page is not personalised. */
check(
  `12 · public offers the public scopes (${publicList.filters.join(' · ')})`,
  ['الفرع', 'الفئة', 'المستوى', 'المادة', 'النوع'].every((f) =>
    publicList.filters.some((label) => label.includes(f)),
  ),
  JSON.stringify(publicList.filters),
);
await surviveSwitch('13 · public', 'المستوى');

/* ── the beneficiary ────────────────────────────────────────────────────── */

await as(process.env.STUDENT_COOKIE);
// **Her calendar moved to its own node** (R85): the dashboard stays minimal,
// and a calendar somebody opens daily belongs one click from the menu.
await open('/dashboard/student/calendar', '.cal-header');
const student = await chrome();
check(
  `14 · the beneficiary is offered المستوى and never الفرع/الفئة (${student.filters.join(' · ')})`,
  student.filters.some((f) => f.includes('المستوى')) &&
    !student.filters.some((f) => f.includes('الفرع') || f.includes('الفئة')),
  JSON.stringify(student.filters),
);
check(
  '15 · her list and grid share one month header',
  student.hasTitle && student.hasStepping,
  JSON.stringify({ title: student.hasTitle, stepping: student.hasStepping }),
);

/* ── the مؤطرة ──────────────────────────────────────────────────────────── */

await as(process.env.TEACHER_COOKIE);
// The merged surface (2026-08-20): her calendar is the top of الجدولة, and the
// filter matrix asserted below is unchanged by the move.
await open('/teacher/schedules', '.cal-header');
const teacher = await chrome();
check(
  `16 · the مؤطرة IS offered الفرع and الفئة (${teacher.filters.join(' · ')})`,
  teacher.filters.some((f) => f.includes('الفرع')) &&
    teacher.filters.some((f) => f.includes('الفئة')),
  JSON.stringify(teacher.filters),
);
check(
  '17 · and no السنة الدراسية on any personal surface either',
  !teacher.filters.some((f) => f.includes('السنة')) &&
    !student.filters.some((f) => f.includes('السنة')),
  JSON.stringify({ teacher: teacher.filters, student: student.filters }),
);

close();
process.exit(finish());
