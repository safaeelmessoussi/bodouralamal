/**
 * **The مؤطِّرة's portal, driven as she meets it** (SRS Revision 106, §5).
 *
 * ## Two halves, deliberately
 *
 * The menu half is a browser's to answer: order, renames, and whether a screen
 * she is granted actually opens. The **authorization half is not** — the Owner's
 * standing rule is that showing or hiding a menu item is never the mechanism,
 * so this file also asks the API directly with a genuine Teacher token and
 * asserts both directions: her own work succeeds, and a representative
 * cross-scope act is refused.
 *
 * ## The session is a REAL teacher
 *
 * `issue-dev-session.ts` mints for a named user exactly as they already are.
 * Widening one here would verify a session nobody holds.
 *
 * NEVER put a backtick in page code — see cdp.mjs.
 */
import { connect, results } from './cdp.mjs';

const BASE = 'http://localhost';
const COOKIE = process.env.TEACHER_REFRESH_COOKIE;
const API_COOKIE = process.env.TEACHER_API_COOKIE;
const ADMIN_API_COOKIE = process.env.ADMIN_API_COOKIE;
if (!COOKIE || !API_COOKIE) {
  throw new Error('TEACHER_REFRESH_COOKIE and TEACHER_API_COOKIE are required');
}

/** The Owner's order, §5. Read independently of the registry on purpose. */
const MENU = [
  ['مساحة التدريس', '/teacher'],
  ['إدخال متى أنا متاحة', '/teacher/availability'],
  ['إدخال حفظ المستفيدات', '/teacher/quran'],
  ['إدخال نقاط الامتحانات', '/teacher/exams'],
  ['الجدولة', '/teacher/schedules'],
  ['مكتبة المحتوى', '/teacher/content'],
];

const { send, evaluate, close } = await connect(process.env.PORT ?? '9249');
const { check, finish } = results();

await send('Network.clearBrowserCookies');
await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

/**
 * Navigates and waits for the page to have SETTLED, not merely mounted.
 *
 * The first version waited for `.state`, which is `LoadingState`'s own class —
 * so it returned while the skeleton was on screen and every content assertion
 * read an empty page. A harness fault, and the same one that has cost this
 * project confident wrong answers before: waiting for a selector that the
 * *loading* view also satisfies is not waiting.
 */
const goto = async (path, settled = `!document.querySelector('.skeleton')`) => {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(
      `!!document.querySelector('.admin-nav a') && (${settled})`,
    );
    if (ready) return;
    await new Promise((r) => setTimeout(r, 100));
  }
};

const readMenu = () =>
  evaluate(`(() => {
    const nav = document.querySelector('.admin-nav');
    if (!nav) return null;
    return {
      items: [...nav.querySelectorAll('a')].map((a) => ({
        text: a.textContent.trim(),
        href: new URL(a.href).pathname,
      })),
      headings: [...nav.querySelectorAll('.admin-nav__group-title')].map((h) =>
        h.textContent.trim(),
      ),
    };
  })()`);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── The menu ────────────────────────────────────────────────────────────── */

await goto('/teacher');
const menu = await readMenu();

/**
 * **`إدخال حفظ المستفيدات` is conditional (R87 §M)** — a مؤطِّرة who staffs no
 * Quran-tracking Subject is not shown it, because the entry would open a screen
 * the server empties. So the expectation is the Owner's list, minus that one
 * when this particular teacher does not teach Quran. Reported either way rather
 * than silently accepting both.
 */
const shown = (menu?.items ?? []).map((i) => i.href);
const teachesQuran = shown.includes('/teacher/quran');
const expected = MENU.filter(([, href]) => teachesQuran || href !== '/teacher/quran');

check(
  `the menu is exactly the Owner's order${teachesQuran ? '' : ' (minus إدخال حفظ المستفيدات — R87 §M: this teacher teaches no Quran)'}`,
  same(
    menu?.items,
    expected.map(([text, href]) => ({ text, href })),
  ),
  JSON.stringify((menu?.items ?? []).map((i) => i.text)),
);
check(
  'no section heading renders — R106 removed all three',
  menu?.headings.length === 0,
  JSON.stringify(menu?.headings),
);
check(
  'إدخال نقاط الامتحانات carries the verb (renamed by R106)',
  (menu?.items ?? []).some((i) => i.text === 'إدخال نقاط الامتحانات'),
);
check(
  'no /admin/* path is offered anywhere in her menu',
  shown.every((h) => !h.startsWith('/admin')),
  JSON.stringify(shown.filter((h) => h.startsWith('/admin'))),
);

/* ── إدخال متى أنا متاحة, operated ───────────────────────────────────────── */

// Settled = the add-range control exists, which only the loaded form renders.
await goto(
  '/teacher/availability',
  `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('إضافة فترة'))`,
);
const page = await evaluate(`(() => {
  const body = document.body.textContent;
  const save = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.trim() === 'حفظ',
  );
  return {
    heading: document.querySelector('h1')?.textContent.trim() ?? null,
    saysPlanningOnly: body.includes('لا تمنح بذاتها'),
    showsCapabilities: body.includes('ما سجلته الإدارة') || body.includes('ما سجّلته الإدارة'),
    addButton: [...document.querySelectorAll('button')].some((b) =>
      b.textContent.includes('إضافة فترة'),
    ),
    saveDisabled: save ? save.disabled : null,
    rawKeys: /teacher\\.availability\\.|admin\\.teachingProfile\\./.test(body),
  };
})()`);

check('إدخال متى أنا متاحة opens for her', page.heading === 'إدخال متى أنا متاحة', page.heading);
check('it says plainly that this grants nothing (R88.3 on the screen)', page.saysPlanningOnly);
check('it shows what the administration recorded she teaches (context, read-only)', page.showsCapabilities);
check('it offers a way to add a range', page.addButton);
check('حفظ starts DISABLED — nothing to save until something changes (rule AY)', page.saveDisabled === true);
check('no raw translation key reaches the screen (rule X)', page.rawKeys === false);

// Add a range, and watch the save become live.
const afterAdd = await evaluate(`(async () => {
  const add = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.includes('إضافة فترة'),
  );
  add.click();
  await new Promise((r) => setTimeout(r, 150));
  const save = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.trim() === 'حفظ',
  );
  return {
    rows: document.querySelectorAll('.form__row').length,
    saveDisabled: save ? save.disabled : null,
  };
})()`);
check('adding a range enables حفظ — dirty drives the button', afterAdd.saveDisabled === false, `${afterAdd.rows} row(s)`);

/* ── The server, reached directly — the boundary a menu check cannot see ── */

const accessTokenFor = async (cookie) => {
  const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE,
      Cookie: `bodour_refresh=${cookie}`,
    },
  });
  return (await res.json())?.access_token ?? null;
};
const api = async (method, path, token, body) => {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const token = await accessTokenFor(API_COOKIE);
check('a genuine Teacher session yields a real access token', Boolean(token));

/* ── الجدولة → the occurrences she staffs ────────────────────────────────── */

await goto('/teacher/schedules', `!document.querySelector('.skeleton')`);
const sched = await evaluate(`(() => {
  const body = document.body.textContent;
  // **The SCHEDULES table specifically.** A document-wide 'tbody tr' also
  // counted the personal calendar's own rows, so the page reported six classes
  // for a مؤطِّرة who staffs none — a harness fault of exactly the kind that
  // makes an empty portal look populated.
  const table = [...document.querySelectorAll('table')].find((el) =>
    (el.querySelector('caption')?.textContent ?? '').includes('حصصي'),
  );
  return {
    hasRows: table ? table.querySelectorAll('tbody tr').length : -1,
    emptyText: table ? (table.querySelector('tbody')?.textContent ?? '').trim().slice(0, 40) : null,
    // R94 — she authors نشاط and امتحان here; حصة is TD-2's ⊘ and stays absent.
    addButton: [...document.querySelectorAll('button')].some((b) =>
      b.textContent.includes('إضافة'),
    ),
    calendar: body.includes('تقويمي') || !!document.querySelector('.calendar, .personal-calendar'),
  };
})()`);
check('…and still carries her personal calendar (R93.1)', sched.calendar);

/**
 * **How many classes she actually staffs — REPORTED, never assumed.**
 *
 * §4.4c derives her entire scope from `CourseScheduleStaff`, so a مؤطِّرة with
 * no assignment has an empty الجدولة, an empty exam list and no
 * `إدخال حفظ المستفيدات` entry — and every one of those is *correct*. A harness
 * that asserted "some rows appear" would therefore fail on a legitimate state,
 * and one that skipped quietly would hide the far more interesting fact.
 *
 * That fact is why this is printed: the Owner's development database was found
 * holding **15 course schedules and 0 staffing rows**, because the fixture seed
 * silently created none (fixed in `prisma/seed/fixtures.ts`). Anybody running
 * this and seeing `0 assignment(s)` is looking at seed data, not at a defect in
 * the portal, and this line is what tells them so.
 */
const staffed = await api('GET', '/admin/course-schedules?page_size=100', token);
const assignments = staffed.body?.data?.length ?? 0;
check(
  `she staffs ${assignments} class(es) — her §4.4c scope, printed because an empty portal is CORRECT for zero`,
  staffed.status === 200,
);
if (assignments > 0) {
  check('الجدولة lists them', sched.hasRows > 0, `${sched.hasRows} row(s)`);
} else {
  check(
    'الجدولة renders its empty state rather than an error (no assignment = no scope)',
    // `DataTable` renders its empty state as a single row carrying the message,
    // not as zero rows — so "no classes" is one row here, and asserting zero was
    // asserting the absence of the empty state itself.
    sched.hasRows <= 1 && !/خطأ|فشل/.test(sched.emptyText ?? ''),
    `${sched.hasRows} row(s): ${sched.emptyText}`,
  );
}


// ALLOWED — the capabilities §5 asks for.
check(
  'she may READ her own teaching profile',
  (await api('GET', '/me/teaching-profile', token)).status === 200,
);
const wrote = await api('PUT', '/me/teaching-profile/availability', token, {
  availability: [{ weekday: 'thursday', start_time: '15:00', end_time: '18:00' }],
});
check('she may WRITE her own availability', wrote.status === 200, `got ${wrote.status}`);
check(
  'she may list exams — the §4.4c scope the read was missing entirely',
  (await api('GET', '/exams?page_size=5', token)).status === 200,
);

// REFUSED — representative cross-scope acts.
for (const [label, method, path, body] of [
  ['another مؤطِّرة’s teaching profile', 'GET', '/admin/users/00000000-0000-4000-8000-000000000001/teaching-profile', null],
  ['the staff-wide user directory', 'GET', '/admin/users', null],
  ['the curriculum (R93.4)', 'GET', '/admin/levels', null],
]) {
  const res = await api(method, path, token, body);
  check(`server REFUSES her ${label}`, res.status === 403 || res.status === 404, `got ${res.status}`);
}

/**
 * **TD-2's `⊘` on Recurring Course Schedules, proved on a class she ACTUALLY
 * TEACHES** — which is the only version of this probe worth running.
 *
 * The first attempt posted a malformed body and got `400`: **schema validation
 * runs before authorization**, so it proved nothing about the boundary. Editing
 * one of her own schedules needs only a title and a version, so validation
 * passes and the refusal is the authorization's.
 *
 * This is the rule R71.0, R72.1 and R94.2 each record as load-bearing: §4.4c
 * derives her entire scope from the schedules she staffs, so creating or
 * editing one would let her widen her own reach. R106 leaves it untouched.
 */
const hers = await api('GET', '/admin/course-schedules?page_size=1', token);
const mine = hers.body?.data?.[0];
check('she can READ the classes she staffs (the scoped list R43.3 gives her)', hers.status === 200);
if (mine) {
  const edited = await api('PATCH', `/admin/course-schedules/${mine.id}`, token, {
    title: mine.title,
    version: mine.version,
  });
  check(
    'server REFUSES her EDITING a class she teaches — TD-2 ⊘, R71.0/R94.2 intact',
    edited.status === 403,
    `got ${edited.status}`,
  );
}

/**
 * **The narrowness of R106, proved at the boundary.** A silently ignored field
 * would leave the response echoing a profile that looked rewritten.
 */
const forged = await api('PUT', '/me/teaching-profile/availability', token, {
  availability: [],
  subject_ids: [],
});
check(
  'server REFUSES a forged body naming subject_ids (400, not a silent drop)',
  forged.status === 400,
  `got ${forged.status}`,
);

if (ADMIN_API_COOKIE) {
  const adminToken = await accessTokenFor(ADMIN_API_COOKIE);
  const adminProfile = await api('GET', '/me/teaching-profile', adminToken);
  check(
    'an Admin is refused the teacher self-service route (the probes discriminate)',
    adminProfile.status === 403,
    `got ${adminProfile.status}`,
  );
}

close();
process.exit(finish());
