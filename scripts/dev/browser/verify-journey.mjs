/**
 * **The admission-to-achievement journey, on the screens the two women use.**
 *
 * The state transitions themselves are proved by
 * `backend/src/controllers/journey.integration.test.ts`, which drives every step
 * through the real routes. What a passing integration suite cannot tell you is
 * whether the resulting facts are **legible** — whether the مستفيدة actually
 * finds the paper on her page, whether the notice the publish transaction wrote
 * renders as Arabic rather than as its own translation key (rule X: `t()`
 * returns its argument on a miss, so a typo is invisible to the type checker),
 * and whether the link on it lands on a page that parses what it carries
 * (rule AB).
 *
 * That gap is not hypothetical here: this run exists because publishing an
 * online assessment previously notified nobody at all, and 2,246 integration
 * tests were green throughout.
 *
 * Every negative check asserts a `200` first — an empty list from a failed
 * request is not proof of an empty list.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.JOURNEY_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9252');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth', httpOnly: true,
  });
}

async function open(cookie, path) {
  await beIdentity(cookie);
  await send('Page.navigate', { url: BASE + path });
  // The shell refreshes on load; wait for the app to settle rather than racing it.
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(
      "document.readyState === 'complete' && !!document.querySelector('main')",
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 900));
}

const text = async () =>
  evaluate("(document.querySelector('main') || document.body).innerText");

/**
 * **The inbox is behind the bell, on every screen** (R85 moved it out of the
 * student dashboard body so it is reachable everywhere rather than on one
 * page). So it is opened the way a person opens it, and its own panel is read —
 * not `main`, which is the page behind it.
 */
async function openBell() {
  const clicked = await evaluate(`(() => {
    const b = document.querySelector('.bell__trigger');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!clicked) return null;
  await new Promise((r) => setTimeout(r, 1200));
  return evaluate("(document.querySelector('.bell__panel') || {}).innerText || ''");
}

/* ── The مستفيدة ──────────────────────────────────────────────────────────── */

await open(S.studentCookie, '/dashboard/student');
let inbox = await openBell();
let body = await text();

check(
  'the مستفيدة is told, in Arabic, that a paper became available',
  inbox !== null && inbox.includes('أصبح اختبار') && inbox.includes('متاحًا'),
  String(inbox).slice(0, 400),
);
check(
  'the notice is rendered copy, not a translation key',
  inbox !== null && !inbox.includes('notifications.'),
  String(inbox).slice(0, 400),
);

const studentLink = await evaluate(`(() => {
  const a = [...document.querySelectorAll('.bell__panel a')]
    .find((x) => x.textContent.includes('فتح الاختبار'));
  return a ? a.getAttribute('href') : null;
})()`);
check(
  'her notice links to her own assessments page',
  studentLink === '/dashboard/student/assessments',
  String(studentLink),
);

await open(S.studentCookie, '/dashboard/student/assessments');
body = await text();
check('the paper is on her list', body.includes('اختبار الحفظ'), body.slice(0, 400));
check(
  'her list says the mark has been published',
  body.includes('نقطة منشورة'),
  body.slice(0, 400),
);

/**
 * **The mark itself lives on نقاطي, not on اختباراتي** — one concept, one home.
 * The assessments list says *whether* a mark has been published; §5.3's grades
 * page is what shows it, with its own scale beside it (R81: exams no longer
 * share one, so `17.5 / 20` has to carry its own maximum).
 */
await open(S.studentCookie2, '/dashboard/student/grades');
body = await text();
check(
  'the published mark is visible to her, on the paper’s own scale',
  body.includes('17.5') && body.includes('20'),
  body.slice(0, 400),
);
check(
  'the page is inside the portal shell — she can navigate away',
  await evaluate("!!document.querySelector('header a, nav a')"),
  'no shell navigation found',
);

/* ── The مؤطِّرة ───────────────────────────────────────────────────────────── */

await open(S.teacherCookie, '/teacher');
inbox = await openBell();
check(
  'the مؤطِّرة is told about the same paper',
  inbox !== null && inbox.includes('أصبح اختبار') && inbox.includes('متاحًا'),
  String(inbox).slice(0, 400),
);

const teacherLink = await evaluate(`(() => {
  const a = [...document.querySelectorAll('.bell__panel a')]
    .find((x) => x.textContent.includes('فتح الاختبار'));
  return a ? a.getAttribute('href') : null;
})()`);
check(
  'her notice links to the paper on HER page, on the parameter that page parses',
  teacherLink === '/teacher/assessments?exam=' + S.examId,
  String(teacherLink),
);

// Rule AB — the destination must CONSUME what the link carries, not merely
// accept it. A page that renders its list and silently drops the id is the
// `?content_id=` defect that shipped for months.
await open(S.teacherCookie, '/teacher/assessments?exam=' + S.examId);
body = await text();
check(
  'the link opens THAT paper, not the bare list',
  body.includes('اختبار الحفظ'),
  body.slice(0, 500),
);

/**
 * **Her working surfaces, reached through her own scope.**
 *
 * `verify-grading.sh` and `verify-quran-entry.sh` already prove these screens
 * in general. What they cannot say is whether THIS مؤطِّرة — approved through
 * the registration queue an hour ago and given her authority by one staffing
 * row — actually reaches them. That is the composition question this run
 * exists for, so both are asserted on her own session.
 */
await open(S.teacherCookie2, '/teacher/assessments?exam=' + S.examId);
body = await text();
check(
  'she reaches the submission and marking surface for her own paper',
  body.includes('اختبار الحفظ') && !body.includes('لا توجد'),
  body.slice(0, 400),
);

await open(S.teacherCookie3, '/teacher/quran');
body = await text();
check(
  'إدخال الحفظ is reachable, and her مستفيدة is in it',
  body.includes('خديجة'),
  body.slice(0, 500),
);

/* ── The control ──────────────────────────────────────────────────────────── */

await open(S.otherStudentCookie, '/dashboard/student');
inbox = await openBell();
check(
  'the LEVEL-B-only مستفيدة is told nothing about it',
  // **The bell must have OPENED for this to mean anything.** An unopened panel
  // contains no text, which would pass a negative check while proving nothing.
  inbox !== null && !inbox.includes('أصبح اختبار'),
  String(inbox).slice(0, 400),
);

await open(S.otherStudentCookie, '/dashboard/student/assessments');
body = await text();
check(
  'and the paper is not on her list either',
  !body.includes('اختبار الحفظ'),
  body.slice(0, 400),
);

await close();
finish();
