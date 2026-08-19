/**
 * **The teaching profile, through the real screens** (R88 §19).
 *
 * The point being verified is not that a form saves. It is that the
 * administration can record what a مؤطِّرة says she can teach — and that the
 * screen says, in Arabic, that recording it grants nothing.
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
  await new Promise((r) => setTimeout(r, 900));
}

const TEACHER = process.env.TEACHER_NAME ?? '';

/** Opens the profile dialog for the seeded مؤطِّرة, by NAME rather than row. */
const openProfile = () =>
  evaluate(`(async () => {
    const row = [...document.querySelectorAll('.admin-table tbody tr')].find((tr) =>
      tr.textContent.includes(${JSON.stringify(TEACHER)}),
    );
    if (!row) return { noRow: true };
    // The row's action menu, then the profile entry — found by label, because
    // the order of row actions is DataTable's to decide (rule AC).
    const trigger = [...row.querySelectorAll('button')].find((b) =>
      b.textContent.includes('الملف التدريسي'),
    ) ?? [...row.querySelectorAll('button')].pop();
    if (!trigger) return { noAction: true };
    trigger.click();
    await new Promise((r) => setTimeout(r, 700));
    let entry = [...document.querySelectorAll('button, a')].find((b) =>
      b.textContent.trim() === 'الملف التدريسي',
    );
    if (entry) {
      entry.click();
      await new Promise((r) => setTimeout(r, 1400));
    }
    const dialog = document.querySelector('dialog[open]');
    return {
      opened: dialog !== null,
      // The whole dialog: the first 400 characters stopped before «الأوقات
      // المتاحة» and reported a section that was on screen as missing.
      text: dialog ? dialog.textContent : null,
    };
  })()`);

await open('/admin/users', '.admin-table, .state');
const opened = await openProfile();

check(
  '1 · الملف التدريسي opens from the person it is about',
  opened.opened === true,
  JSON.stringify(opened),
);
check(
  '2 · and the screen SAYS it grants no permission',
  (opened.text ?? '').includes('لا تمنح بذاتها'),
  JSON.stringify({ text: (opened.text ?? '').slice(0, 200) }),
);
check(
  '3 · offering Subjects, Categories and availability',
  (opened.text ?? '').includes('المواد') &&
    (opened.text ?? '').includes('الفئات') &&
    (opened.text ?? '').includes('الأوقات المتاحة'),
  JSON.stringify({ length: (opened.text ?? '').length }),
);

/* ── record a profile ───────────────────────────────────────────────────── */

const filled = await evaluate(`(async () => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };

  // One Subject and one Category through the shared multi-select.
  const boxes = [...dialog.querySelectorAll('input[type=checkbox]')];
  if (boxes[0]) boxes[0].click();
  await new Promise((r) => setTimeout(r, 300));

  const add = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة فترة'));
  if (!add) return { noAdd: true, buttons: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  add.click();
  await new Promise((r) => setTimeout(r, 500));

  const rows = dialog.querySelectorAll('.form__row').length;
  return { rows, checked: boxes.filter((b) => b.checked).length };
})()`);
check(
  '4 · «إضافة فترة» adds an availability row',
  filled.rows >= 1,
  JSON.stringify(filled),
);

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
  if (!submit) return { noSubmit: true, labels: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  submit.click();
  await new Promise((r) => setTimeout(r, 2500));
  const open = document.querySelector('dialog[open]');
  return {
    closed: open === null,
    notice: document.body.textContent.includes('حُفظ الملف التدريسي'),
    // What the dialog says when it did NOT close — a refusal a harness swallows
    // is a defect it reports as a mystery.
    stillSays: open ? open.textContent.slice(0, 200) : null,
  };
})()`);
check(
  '5 · saving persists and reports it',
  saved.closed === true && saved.notice === true,
  JSON.stringify(saved),
);

/* ── it survives a reload, which is what «persisted» means ──────────────── */

await open('/admin/users', '.admin-table, .state');
const reopened = await openProfile();
const persisted = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  return {
    checked: [...dialog.querySelectorAll('input[type=checkbox]')].filter((b) => b.checked).length,
    ranges: dialog.querySelectorAll('.form__row').length,
  };
})()`);
check(
  '6 · and it is still there after a reload',
  reopened.opened === true && (persisted.checked >= 1 || persisted.ranges >= 1),
  JSON.stringify(persisted),
);

close();
process.exit(finish());
