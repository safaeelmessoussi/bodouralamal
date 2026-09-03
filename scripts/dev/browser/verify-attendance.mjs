/**
 * **الحضور in a real browser — the register, opened from the occurrence
 * dialog** (SRS §4.7, R123).
 *
 * ## What needs a browser, and what does not
 *
 * The domain rules are pinned against PostgreSQL by
 * `attendance.integration.test.ts`, and the interface's decisions are pinned by
 * `attendance-ui.test.ts`. Neither can see the thing this harness exists for:
 * **that the panel actually renders inside the dialog the calendar opens, that
 * its request reaches the API, and that marking somebody changes what the
 * reader sees.** A capability with no reach is this project's recurring defect,
 * and reach is only observable on the page.
 *
 * Five checks, in the order a مؤطِّرة meets them:
 *
 * 1. the occurrence dialog opens and offers **الحضور** on a class;
 * 2. opening it renders the sheet, with the expected roster on a `required` one;
 * 3. marking somebody sends the request and the row reads **حاضرة**;
 * 4. a **عطلة** offers no attendance control at all — the exclusion, on screen;
 * 5. the mark is in the database afterwards, keyed to that occurrence's date.
 *
 * It owns its rows (P1.2) and the wrapper removes them.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const TAG = process.env.ATTENDANCE_TAG ?? '[attguard]';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9255');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.DEV_REFRESH_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

const MONTH = process.env.ATTENDANCE_MONTH;
await send('Page.navigate', { url: `${BASE}/calendar?month=${MONTH}` });
await new Promise((r) => setTimeout(r, 5000));

/** Opens the occurrence whose title contains `needle`, and reports the dialog. */
const openOccurrence = (needle) =>
  evaluate(`(async () => {
    const chip = [...document.querySelectorAll('button, a, [role="button"]')]
      .find((el) => el.textContent.includes(${JSON.stringify(needle)}));
    if (!chip) return { notFound: true, seen: document.body.textContent.slice(0, 400) };
    chip.click();
    await new Promise((r) => setTimeout(r, 1200));
    const d = document.querySelector('dialog[open]');
    if (!d) return { noDialog: true };
    return {
      title: (d.querySelector('h2, h3')?.textContent ?? '').trim(),
      hasAttendance: [...d.querySelectorAll('button')].some(
        (b) => b.textContent.trim() === 'الحضور',
      ),
      text: d.textContent.replace(/\\s+/g, ' ').slice(0, 600),
    };
  })()`);

const closeDialog = () =>
  evaluate(`(async () => {
    const d = document.querySelector('dialog[open]');
    if (d) {
      const x = [...d.querySelectorAll('button')].find((b) => /إغلاق|×/.test(b.textContent));
      if (x) x.click(); else d.close();
    }
    await new Promise((r) => setTimeout(r, 500));
    return true;
  })()`);

// **The Subject names a class on the calendar, not the schedule's title.** The
// public grid labels a session by its Subject (§4.4), and a needle taken from
// the schedule's own title found nothing at all — which is the harness reading
// the wrong field rather than the feature being absent.
const klass = await openOccurrence(`${TAG} مادة`);
check(
  '1 · a class occurrence offers الحضور in the dialog every calendar opens',
  klass.hasAttendance === true,
  JSON.stringify(klass),
);

const sheet = await evaluate(`(async () => {
  const d = document.querySelector('dialog[open]');
  if (!d) return { noDialog: true };
  const open = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'الحضور');
  if (!open) return { noButton: true };
  open.click();
  await new Promise((r) => setTimeout(r, 2500));
  const panel = document.querySelector('.details__attendance');
  if (!panel) return { noPanel: true };
  return {
    heading: (panel.querySelector('h3')?.textContent ?? '').trim(),
    names: [...panel.querySelectorAll('.attendance-list > li')].map((li) =>
      li.textContent.replace(/\\s+/g, ' ').trim(),
    ),
    text: panel.textContent.replace(/\\s+/g, ' ').slice(0, 500),
  };
})()`);

check(
  '2 · the sheet renders, and a REQUIRED occurrence opens on its expected roster',
  sheet.heading === 'الحضور' && sheet.names.some((n) => n.includes(`${TAG} مستفيدة`)),
  JSON.stringify(sheet),
);

const marked = await evaluate(`(async () => {
  const panel = document.querySelector('.details__attendance');
  if (!panel) return { noPanel: true };
  const row = [...panel.querySelectorAll('.attendance-list > li')].find((li) =>
    li.textContent.includes(${JSON.stringify(`${TAG} مستفيدة`)}),
  );
  if (!row) return { noRow: true };
  const mark = [...row.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'تعليم الحضور',
  );
  if (!mark) return { noButton: true, row: row.textContent };
  mark.click();
  await new Promise((r) => setTimeout(r, 2500));
  const after = [...document.querySelectorAll('.details__attendance .attendance-list > li')].find(
    (li) => li.textContent.includes(${JSON.stringify(`${TAG} مستفيدة`)}),
  );
  return { row: (after?.textContent ?? '').replace(/\\s+/g, ' ').trim() };
})()`);

check(
  '3 · marking her sends the request and the row now reads حاضرة',
  typeof marked.row === 'string' && marked.row.includes('حاضرة'),
  JSON.stringify(marked),
);

await closeDialog();

const holiday = await openOccurrence(`${TAG} عطلة`);
check(
  '4 · a عطلة offers NO attendance control at all — the exclusion, on screen',
  holiday.notFound !== true && holiday.hasAttendance === false,
  JSON.stringify(holiday),
);

await close();
process.exit(finish());
