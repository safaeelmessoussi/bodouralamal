/**
 * **The teaching profile, through the real screens** (R88, and its correction).
 *
 * The point being verified is not that a form saves. It is *whose screen owns
 * the question*: المستخدمون administers accounts and must no longer offer a
 * teaching profile to guardians, minors and administrators; المؤطِّرات
 * manages the people who teach, and is where the profile lives.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9241');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});
await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.ADMIN_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
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

const TEACHER = process.env.TEACHER_NAME ?? '';
const TEACHING_STUDENT = process.env.TEACHING_STUDENT_NAME ?? '';
const BENEFICIARY = process.env.BENEFICIARY_NAME ?? '';

/* ── 1–2 · the generic account screen no longer owns the question ───────── */

await open('/admin/users', '.admin-table, .state');

const onUsers = await evaluate(`(() => {
  // \`DataTable\` renders row actions as INLINE buttons — there is no menu to
  // open — so every action on the screen is already in the document text. The
  // first harness clicked each row's last button to "open the menu", which on
  // this screen is «إيقاف الحساب».
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  return {
    rows: rows.length,
    actions: [...new Set(
      [...document.querySelectorAll('.admin-table__actions button')].map((b) => b.textContent.trim()),
    )],
  };
})()`);

check(
  '1 · المستخدمون still lists accounts',
  onUsers.rows > 0,
  JSON.stringify(onUsers),
);
check(
  '2 · and offers NO teaching profile on any row',
  !onUsers.actions.includes('الملف التدريسي'),
  JSON.stringify(onUsers),
);

/* ── 3–4 · الشؤون التعليمية carries the new node ────────────────────────── */

const inMenu = await evaluate(`(() => {
  const link = [...document.querySelectorAll('nav a')].find(
    // R105 renamed this from «إدارة المؤطِّرات»: no sibling names its own verb.
    // The harness kept the old label and reported the nav as missing — a stale
    // expectation, not a defect, and it had been failing quietly since.
    (a) => a.textContent.trim() === 'المؤطِّرات',
  );
  return {
    present: link !== undefined,
    href: link ? link.getAttribute('href') : null,
    // Its section heading, to prove it landed under the teaching group rather
    // than wherever the registry happened to put it.
    section: link
      ? (link.closest('[class*=nav__group], li, section, div')?.parentElement?.textContent ?? '').slice(0, 60)
      : null,
  };
})()`);

check(
  '3 · المؤطِّرات appears in the navigation',
  inMenu.present === true,
  JSON.stringify(inMenu),
);
check(
  '4 · pointing at its own route',
  inMenu.href === '/admin/teachers',
  JSON.stringify(inMenu),
);

/* ── 5–8 · the population ───────────────────────────────────────────────── */

await open('/admin/teachers', '.admin-table, .state');

const listed = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const text = rows.map((tr) => tr.textContent);
  return {
    count: rows.length,
    teacher: text.some((t) => t.includes(${JSON.stringify(TEACHER)})),
    teachingStudent: text.some((t) => t.includes(${JSON.stringify(TEACHING_STUDENT)})),
    beneficiary: text.some((t) => t.includes(${JSON.stringify(BENEFICIARY)})),
    // Data first (rule A): the table is populated on arrival, with no filter
    // touched. A gated screen would show the empty state here instead.
    headings: [...document.querySelectorAll('.admin-table thead th')].map((th) => th.textContent.trim()),
    lede: (document.querySelector('main')?.textContent ?? '').includes('بيانات تخطيط'),
  };
})()`);

check(
  '5 · the page lists مؤطِّرات on arrival, with no filter touched',
  listed.count > 0 && listed.teacher === true,
  JSON.stringify(listed),
);
check(
  '6 · a مؤطِّرة who is ALSO a beneficiary is listed',
  listed.teachingStudent === true,
  JSON.stringify(listed),
);
check(
  '7 · a beneficiary who does not teach is NOT listed',
  listed.beneficiary === false,
  JSON.stringify(listed),
);
check(
  '8 · showing المواد · الفئات · الأوقات المتاحة',
  listed.headings.includes('المواد') &&
    listed.headings.includes('الفئات') &&
    listed.headings.includes('الأوقات المتاحة'),
  JSON.stringify(listed.headings),
);

/* ── 9–11 · the same dialog, opened from the page that owns it ──────────── */

const openProfile = () =>
  evaluate(`(async () => {
    const row = [...document.querySelectorAll('.admin-table tbody tr')].find((tr) =>
      tr.textContent.includes(${JSON.stringify(TEACHER)}),
    );
    if (!row) return { noRow: true };
    /**
     * **Her OWN row's button.** By label, because the order of row actions is
     * DataTable's to decide (rule AC) — but scoped to the row, because the
     * first harness searched the whole document and opened the profile of
     * whichever مؤطِّرة happened to sort first. Every check downstream then
     * described the wrong person, and read her stale data as persistence.
     */
    const trigger = [...row.querySelectorAll('button')].find((b) =>
      b.textContent.trim() === 'الملف التدريسي',
    );
    if (!trigger) return { noAction: true };
    trigger.click();
    await new Promise((r) => setTimeout(r, 1600));
    const dialog = document.querySelector('dialog[open]');
    // A مؤطِّرة with no availability yet has no day selector to read, so the
    // range is added first. The seven raw keys shipped in exactly this control,
    // and only the browser could show that they had.
    const stored = dialog ? dialog.querySelectorAll('select').length : 0;
    if (dialog && stored === 0) {
      const add = [...dialog.querySelectorAll('button')].find((b) =>
        b.textContent.includes('إضافة فترة'),
      );
      if (add) {
        add.click();
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    return {
      opened: dialog !== null,
      // Whose profile this is. The check that was missing when the harness
      // opened the wrong row.
      about: dialog ? (dialog.querySelector('h2, h3, .dialog__title')?.textContent ?? '') : '',
      text: dialog ? dialog.textContent : null,
      // Ranges the SERVER sent, counted before the harness added one. This is
      // what "persisted" means; the row this function may have just added is
      // not evidence of anything.
      storedRanges: stored,
      weekdays: dialog
        ? [...dialog.querySelectorAll('select')].map((s) =>
            [...s.options].map((o) => o.textContent.trim()),
          )
        : [],
    };
  })()`);

const opened = await openProfile();

check(
  '9 · الملف التدريسي opens from المؤطِّرات, for the row it was clicked on',
  opened.opened === true && opened.about.includes(TEACHER),
  JSON.stringify({ ...opened, text: (opened.text ?? '').slice(0, 160) }),
);
check(
  '10 · and the screen SAYS it grants no permission',
  (opened.text ?? '').includes('لا تمنح بذاتها'),
  JSON.stringify({ text: (opened.text ?? '').slice(0, 200) }),
);

const ARABIC_DAYS = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
const dayOptions = (opened.weekdays ?? []).find((opts) =>
  opts.some((o) => ARABIC_DAYS.includes(o)),
);
check(
  '11 · the weekday selector is in Arabic, and leaks no translation key',
  dayOptions !== undefined &&
    ARABIC_DAYS.every((d) => dayOptions.includes(d)) &&
    !(opened.text ?? '').includes('calendar.weekday') &&
    !(opened.text ?? '').includes('scheduling.weekday'),
  JSON.stringify({ dayOptions, selects: (opened.weekdays ?? []).length }),
);

/* ── 12–13 · record availability, and prove it persisted ────────────────── */

const filled = await evaluate(`(async () => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };

  // The shared multi-select offers each option as a «＋ label» button — there is
  // no checkbox. Matching on one silently selected nothing and the harness
  // reported a save that recorded no Subject.
  const offer = [...dialog.querySelectorAll('button')].find((b) =>
    b.textContent.trim().startsWith('＋'),
  );
  if (offer) offer.click();
  await new Promise((r) => setTimeout(r, 400));

  // The range \`openProfile\` opened is FILLED, not joined by a second one: two
  // untouched rows carry the same default hours, and the server refuses the
  // overlap — correctly, which the first run mistook for a save defect.
  const set = (el, value) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const day = dialog.querySelector('select');
  if (day) set(day, 'wednesday');
  const times = [...dialog.querySelectorAll('input[type=time]')];
  if (times[0]) set(times[0], '14:00');
  if (times[1]) set(times[1], '16:30');
  await new Promise((r) => setTimeout(r, 300));

  return {
    ranges: dialog.querySelectorAll('select').length,
    chosen: [...dialog.querySelectorAll('button')].filter((b) =>
      b.textContent.trim().endsWith('✕'),
    ).length,
    times: times.map((i) => i.value),
    day: day ? day.value : null,
    // No raw key anywhere in the dialog, not only in the day selector.
    leaks: /[a-z]+\\.[a-z]+\\.[a-z]+/.test(dialog.textContent),
  };
})()`);

const saved = await evaluate(`(async () => {
  const dialog = document.querySelector('dialog[open]');
  /**
   * **By its LABEL, not by the type attribute.** A button with no explicit type
   * reports submit, and every control in this dialog is one — so matching on
   * type clicked a multi-select's remove chip, and the harness reported a save
   * that never happened.
   */
  const submit = [...dialog.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'حفظ',
  );
  if (!submit) return { noSubmit: true };
  submit.click();
  await new Promise((r) => setTimeout(r, 2500));
  const still = document.querySelector('dialog[open]');
  return {
    closed: still === null,
    notice: document.body.textContent.includes('حُفظ الملف التدريسي'),
    stillSays: still ? still.textContent.slice(0, 200) : null,
  };
})()`);

check(
  '12 · a Subject and an availability range can be recorded and saved',
  filled.ranges >= 1 &&
    filled.chosen >= 1 &&
    filled.day === 'wednesday' &&
    filled.leaks === false &&
    saved.closed === true &&
    saved.notice === true,
  JSON.stringify({ filled, saved }),
);

await open('/admin/teachers', '.admin-table, .state');
const reopened = await openProfile();
const persisted = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  const day = dialog.querySelector('select');
  return {
    chosen: [...dialog.querySelectorAll('button')].filter((b) =>
      b.textContent.trim().endsWith('✕'),
    ).length,
    day: day ? day.value : null,
    times: [...dialog.querySelectorAll('input[type=time]')].map((i) => i.value),
  };
})()`);

check(
  '13 · and it is still there after a reload',
  reopened.opened === true &&
    reopened.storedRanges >= 1 &&
    persisted.day === 'wednesday' &&
    persisted.chosen >= 1,
  JSON.stringify({ storedRanges: reopened.storedRanges, ...persisted }),
);

/**
 * **14 · NEW E — a profile that already has content is not «dirty».**
 *
 * This is the only state the defect fires in, and check 13 has just produced
 * it: the dialog is open on a مؤطِّرة with a saved Subject and a saved Wednesday
 * range. The dialog reported `dirty` from *has any content* rather than *has
 * changed*, so closing it without touching a field asked her to confirm
 * discarding work she had not done (rule AY).
 *
 * Deliberately placed after check 13 rather than at the start: on an EMPTY
 * profile the old computation and the correct one agree, so a check run there
 * would have passed against the defect.
 */
const pristineClose = await evaluate(`(async () => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  // The form's own cancel — the same button a person reaches for. Nothing has
  // been typed since it opened.
  const cancel = [...dialog.querySelectorAll('button')].find((b) =>
    b.textContent.trim() === 'إلغاء' || b.textContent.trim() === 'إغلاق');
  if (!cancel) return { noCancel: true };
  cancel.click();
  await new Promise((r) => setTimeout(r, 400));
  return {
    // The discard prompt must NOT have appeared.
    prompted: document.body.textContent.includes('إغلاق النموذج؟'),
    // And the dialog must actually be gone, not held open by the guard.
    stillOpen: Boolean(document.querySelector('dialog[open]')),
  };
})()`);

check(
  '14 · an untouched profile with saved content closes without asking to discard (NEW E)',
  pristineClose.prompted === false && pristineClose.stillOpen === false,
  JSON.stringify(pristineClose),
);

close();
process.exit(finish());
