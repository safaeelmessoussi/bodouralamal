/**
 * **The three portals, as the people who use them see them** (R85).
 *
 * A registry entry is what makes a capability *reachable*, and this project has
 * now paid eight times for a screen that existed and could not be found. So the
 * checks are navigational: does the menu exist, does every entry open, and are
 * the two landing pages still deliberately empty.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9239');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

async function as(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value: cookie,
    domain: 'localhost',
    path: '/api/v1/auth',
    httpOnly: true,
  });
}

async function open(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(`(() => document.querySelector('main') !== null)()`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 900));
}

/** The menu as rendered, plus the bell and the page's own content. */
const shell = () =>
  evaluate(`(() => ({
    menu: [...document.querySelectorAll('.admin-nav a')].map((a) => a.textContent.trim()),
    bell: document.querySelector('.bell__trigger') !== null,
    bellLabel: document.querySelector('.bell__trigger')
      ? document.querySelector('.bell__trigger').getAttribute('aria-label')
      : null,
    heading: document.querySelector('.admin__title')
      ? document.querySelector('.admin__title').textContent.trim()
      : null,
    calendars: document.querySelectorAll('.cal-header').length,
    tables: document.querySelectorAll('.admin-table').length,
    text: document.querySelector('main').textContent,
  }))()`);

/* ── the مؤطرة ──────────────────────────────────────────────────────────── */

await as(process.env.TEACHER_COOKIE);
await open('/teacher');
const teacherHome = await shell();

check(
  `1 · the مؤطرة has a right menu (${teacherHome.menu.join(' · ')})`,
  teacherHome.menu.length >= 5,
  JSON.stringify(teacherHome.menu),
);
/**
 * **«تقويمي» left her menu on 2026-08-20**, and the property is restated rather
 * than dropped: it and «الجدولة» were two entries onto one operational question,
 * so she had to know which of the two held what she wanted. Her calendar is now
 * the top of الجدولة — check 5 below opens it there.
 */
for (const label of ['الجدولة', 'نقاط الامتحانات', 'مكتبة المحتوى', 'إدخال الحفظ']) {
  check(
    `2 · her menu reaches «${label}»`,
    teacherHome.menu.some((m) => m.includes(label)),
    JSON.stringify(teacherHome.menu),
  );
}
check(
  '3 · مساحة التدريس stays minimal — no cards, no calendar, no table',
  teacherHome.calendars === 0 && teacherHome.tables === 0,
  JSON.stringify({ calendars: teacherHome.calendars, tables: teacherHome.tables }),
);
check(
  '4 · and the bell is in the top bar',
  teacherHome.bell === true,
  JSON.stringify({ label: teacherHome.bellLabel }),
);

await open('/teacher/schedules');
const teacherCalendar = await shell();
check(
  '5 · her الجدولة opens the shared calendar (merged)',
  teacherCalendar.calendars === 1,
  JSON.stringify({ calendars: teacherCalendar.calendars }),
);

await open('/teacher/quran');
const teacherQuran = await shell();
check(
  '6 · إدخال الحفظ opens — the page existed and had no menu entry until now',
  teacherQuran.heading !== null && !teacherQuran.text.includes('قيد الإعداد'),
  JSON.stringify({ heading: teacherQuran.heading }),
);

await open('/teacher/exams');
check(
  '7 · نقاط الامتحانات opens',
  (await shell()).heading !== null,
  'exams',
);

await open('/teacher/schedules');
const teacherSchedules = await shell();
check(
  '8 · الجدولة opens and offers her the create action',
  teacherSchedules.text.includes('نشاط') || teacherSchedules.tables >= 1,
  JSON.stringify({ tables: teacherSchedules.tables }),
);

/* ── the beneficiary ────────────────────────────────────────────────────── */

await as(process.env.STUDENT_COOKIE);
await open('/dashboard/student');
const studentHome = await shell();

check(
  `9 · the beneficiary has a right menu (${studentHome.menu.join(' · ')})`,
  studentHome.menu.length >= 5,
  JSON.stringify(studentHome.menu),
);
for (const label of ['تقويمي', 'مكتبة المحتوى', 'حفظي', 'نقاطي', 'حسابي']) {
  check(
    `10 · her menu reaches «${label}»`,
    studentHome.menu.some((m) => m.includes(label)),
    JSON.stringify(studentHome.menu),
  );
}
check(
  '11 · «حصص اليوم والقادمة» is GONE from her dashboard',
  !studentHome.text.includes('حصص اليوم') && !studentHome.text.includes('القادمة'),
  studentHome.text.slice(0, 140),
);
check(
  '12 · لوحة المستفيدة stays minimal — no calendar on it',
  studentHome.calendars === 0,
  JSON.stringify({ calendars: studentHome.calendars }),
);
check(
  '13 · and she has the bell too',
  studentHome.bell === true,
  JSON.stringify({ label: studentHome.bellLabel }),
);

await open('/dashboard/student/calendar');
check(
  '14 · her تقويمي opens the shared calendar',
  (await shell()).calendars === 1,
  'student calendar',
);

await open('/dashboard/student/quran');
check('15 · حفظي opens', (await shell()).heading !== null, 'quran');

await open('/dashboard/student/grades');
check('16 · نقاطي opens', (await shell()).heading !== null, 'grades');

/* ── the bell itself ────────────────────────────────────────────────────── */

const panel = await evaluate(`(async () => {
  const trigger = document.querySelector('.bell__trigger');
  if (!trigger) return { missing: true };
  trigger.click();
  await new Promise((r) => setTimeout(r, 1200));
  const open = document.querySelector('.bell__panel');
  return {
    opened: open !== null,
    // Arabic copy, never a raw enum name.
    text: open ? open.textContent.slice(0, 120) : null,
    hasEnum: open ? /session_|event_|grade_published/.test(open.textContent) : false,
  };
})()`);
check(
  '17 · the bell opens a panel',
  panel.opened === true,
  JSON.stringify(panel),
);
check(
  '18 · and it speaks Arabic, never a raw enum name',
  panel.hasEnum === false,
  JSON.stringify({ text: panel.text }),
);

close();
process.exit(finish());
