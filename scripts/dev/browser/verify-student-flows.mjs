/**
 * **The Owner's definition of done, driven through the real screens** (R86).
 *
 * The cancellation half exists because a class was cancelled and the enrolled
 * beneficiary was told nothing. Inserting a notification row would prove the
 * table accepts writes; what has to be proved is the **flow** — an administrator
 * cancelling through the UI, confirming the send, and the notice appearing in
 * her bell.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R82_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9240');
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

const shell = () =>
  evaluate(`(() => ({
    menu: [...document.querySelectorAll('.admin-nav a')].map((a) => a.textContent.trim()),
    heading: document.querySelector('.admin__title')
      ? document.querySelector('.admin__title').textContent.trim()
      : null,
    text: document.querySelector('main') ? document.querySelector('main').textContent : '',
    tables: document.querySelectorAll('.admin-table').length,
  }))()`);

/* ── the cancellation, through the UI ───────────────────────────────────── */

await as(process.env.ADMIN_COOKIE);
await open(`/admin/schedules/${S.schedule}/sessions`, '.admin-table, .state');

const cancelled = await evaluate(`(async () => {
  // **The only occurrence this schedule has.** Matching the rendered DATE was
  // the first attempt and failed: the table formats it for a reader, and
  // identifying a row by its rendered text is the trap this project has paid
  // for repeatedly.
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const row = rows[0];
  if (!row) return { noRow: true, rows: rows.length };
  const button = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('إلغاء'));
  if (!button) return { noButton: true, actions: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  button.click();
  await new Promise((r) => setTimeout(r, 900));

  // A reason is OPTIONAL since R83.2, and this proves it: none is typed.
  const confirm = [...document.querySelectorAll('dialog[open] button')].find((b) =>
    b.textContent.includes('إلغاء الحصة') || b.textContent.includes('تأكيد'),
  );
  const labels = [...document.querySelectorAll('dialog[open] button')].map((b) => b.textContent.trim());
  if (!confirm) return { noConfirm: true, labels };
  confirm.click();
  await new Promise((r) => setTimeout(r, 1800));
  return { labels, notifyAsked: document.body.textContent.includes('إشعار جميع المعنيين') };
})()`);

check(
  '1 · the cancel action is reachable on the occurrence',
  !cancelled.noRow && !cancelled.noButton,
  JSON.stringify(cancelled),
);
check(
  '2 · and cancelling ASKS whether to notify (R83.3)',
  cancelled.notifyAsked === true,
  JSON.stringify(cancelled),
);

const sent = await evaluate(`(async () => {
  const button = [...document.querySelectorAll('dialog[open] button')].find((b) =>
    b.textContent.includes('إرسال الإشعار'),
  );
  if (!button) return { missing: true, labels: [...document.querySelectorAll('dialog[open] button')].map((b) => b.textContent.trim()) };
  button.click();
  await new Promise((r) => setTimeout(r, 2000));
  // The dialog is gone and the page reports something: the DELIVERY is asserted
  // where it can be observed — in her bell, below — rather than by matching a
  // sentence, which is a check on wording rather than on behaviour.
  return { closed: document.querySelector('dialog[open]') === null };
})()`);
check(
  '3 · choosing «إرسال الإشعار» completes and closes the dialog',
  sent.closed === true,
  JSON.stringify(sent),
);

/* ── the beneficiary sees it ────────────────────────────────────────────── */

await as(process.env.STUDENT_COOKIE);
await open('/dashboard/student');
const bell = await evaluate(`(async () => {
  const trigger = document.querySelector('.bell__trigger');
  if (!trigger) return { missing: true };
  const label = trigger.getAttribute('aria-label');
  trigger.click();
  await new Promise((r) => setTimeout(r, 1500));
  const panel = document.querySelector('.bell__panel');
  return { label, text: panel ? panel.textContent : null };
})()`);
check(
  '4 · the enrolled beneficiary HAS the cancellation in her bell',
  typeof bell.text === 'string' && bell.text.includes('أُلغيت'),
  JSON.stringify({ label: bell.label, text: (bell.text ?? '').slice(0, 160) }),
);

const unrelated = await (async () => {
  await as(process.env.UNRELATED_COOKIE);
  await open('/dashboard/student');
  return evaluate(`(async () => {
    const trigger = document.querySelector('.bell__trigger');
    if (!trigger) return { missing: true };
    trigger.click();
    await new Promise((r) => setTimeout(r, 1500));
    const panel = document.querySelector('.bell__panel');
    return { text: panel ? panel.textContent : '' };
  })()`);
})();
check(
  '5 · and the unrelated beneficiary has nothing about it',
  !(unrelated.text ?? '').includes('أُلغيت'),
  JSON.stringify({ text: (unrelated.text ?? '').slice(0, 120) }),
);

/* ── her portal stays her portal ────────────────────────────────────────── */

await as(process.env.STUDENT_COOKIE);
await open('/dashboard/student');
const landing = await shell();
check(
  '6 · لوحة المستفيدة carries none of the moved details',
  !landing.text.includes('الفئة') && !landing.text.includes('المقر'),
  landing.text.slice(0, 140),
);

await open('/dashboard/student/library');
const library = await shell();
check(
  '7 · مكتبة المحتوى stays INSIDE her portal — the sidebar is still there',
  library.menu.length >= 5,
  JSON.stringify({ menu: library.menu, heading: library.heading }),
);
check(
  '8 · and it opens on her own Level, not the public index',
  library.text.includes('[r82-browser] مستوى أ') || library.tables >= 1,
  JSON.stringify({ heading: library.heading }),
);

await open('/dashboard/student/account');
const account = await shell();
check(
  '9 · حسابي stays inside her portal',
  account.menu.length >= 5,
  JSON.stringify({ menu: account.menu }),
);
check(
  '10 · and carries the enrolment details moved off the landing page',
  account.text.includes('التسجيلات التعليمية') && account.text.includes('[r82-browser] مستوى أ'),
  account.text.slice(0, 200),
);

/* ── the session popup ──────────────────────────────────────────────────── */

/* **On the PUBLIC calendar**, which is where the tier matters most and where
   there are occurrences to open: the back office's only session was cancelled
   above, and R83.1 removes a cancelled occurrence from every calendar — so
   there is nothing left there to click, correctly. */
await as(process.env.ADMIN_COOKIE);
await open('/calendar?view=calendar', '.cal-grid');
// The grid paints before its occurrences arrive, so waiting for the GRID is not
// waiting for a chip to click.
for (let i = 0; i < 40; i += 1) {
  const ready = await evaluate(`document.querySelectorAll('.cal-day').length > 0`).catch(
    () => false,
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
const popup = await evaluate(`(async () => {
  // A day that actually HAS an occurrence, rather than a day number: the grid
  // renders the month it is on, and the chip is what says something is there.
  // **A day holding a CLASS**, not merely any occurrence: only a session has
  // recordings and materials, and the first attempt opened an activity — for
  // which the section correctly renders nothing.
  const chips = [...document.querySelectorAll('.cal-day .event-chip')];
  /**
   * **A class that is still scheduled.** Checks 1–3 above CANCEL a class, so a
   * naive «first chip mentioning حصة» can land on the one this harness has just
   * cancelled — and a cancelled occurrence renders no content section, which
   * would read as the defect this check exists to catch.
   */
  const classChip =
    chips.find((c) => c.textContent.includes('حصة') && !c.textContent.includes('ملغاة')) ??
    chips.find((c) => c.textContent.includes('حصة')) ??
    chips[0];
  const day = classChip ? classChip.closest('.cal-day').querySelector('.cal-day__select') : null;
  if (!day) return { noDay: true, days: document.querySelectorAll('.cal-day').length };
  day.click();
  await new Promise((r) => setTimeout(r, 900));
  // The day dialog lists the day's occurrences; open the first CLASS, which is
  // the only kind that has recordings and materials.
  /**
   * **Open each occurrence until a CLASS opens.**
   *
   * A day holds classes, activities and exams; only a class has recordings and
   * materials, and the first two attempts opened an activity and then an exam —
   * for both of which the section correctly renders nothing. The kind is only
   * legible once the details are open, so this tries and checks rather than
   * guessing from a list row.
   */
  const openers = () =>
    [...document.querySelectorAll('dialog[open] button, dialog[open] a')].filter((el) =>
      el.textContent.includes('عرض التفاصيل'),
    );
  const total = openers().length;

  for (let i = 0; i < total; i += 1) {
    const target = openers()[i];
    if (!target) break;
    target.click();
    await new Promise((r) => setTimeout(r, 2000));
    // The DETAILS dialog alone — the whole page's text includes words from the
    // chrome, so matching against it made the kind detection lie.
    const details = [...document.querySelectorAll('dialog[open]')].pop();
    const body = details ? details.textContent : '';
    const isClass = body.includes('النوع') && body.includes('حصة');
    if (isClass) {
      return {
        opened: total,
        kind: 'session',
        hasRecordings: body.includes('التسجيلات'),
        hasMaterials: body.includes('المواد المرفقة'),
        noneMessage: body.includes('لا تسجيلات'),
        text: body.slice(0, 260),
      };
    }
    // Close the details and try the next one.
    const close = [...document.querySelectorAll('dialog[open] .dialog__close')].pop();
    if (close) close.click();
    await new Promise((r) => setTimeout(r, 700));
  }
  // Name what was on the page. «none-found» alone cannot distinguish *the
  // calendar had no class* from *the details did not say it was one*, and the
  // first is a fixture fact while the second is a defect.
  return {
    opened: total,
    kind: 'none-found',
    chips: [...document.querySelectorAll('.cal-day .event-chip')]
      .map((c) => c.textContent.trim())
      .slice(0, 8),
  };
})()`);

check(
  '11 · a Session popup renders its content section directly, not only a link',
  popup.hasRecordings === true || popup.hasMaterials === true || popup.noneMessage === true,
  JSON.stringify(popup),
);

close();
process.exit(finish());
