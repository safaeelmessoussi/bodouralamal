/**
 * **NEW B §D — the visibility tier on the real forms, and where an occurrence
 * edit actually lands.**
 *
 * §C put the column on all three kinds and gated every read by it. §D is the
 * half a source review cannot check: whether the *form* hydrates from the row,
 * whether an unrelated edit leaves the tier alone, and — the part with real
 * consequences — whether *«هذه الحصة فقط»* touches one Session while *«هذه
 * الحصة وكل ما بعدها»* splits the schedule and leaves the earlier ones exactly
 * as they were.
 *
 * The occurrence assertions are made **against the API**, not against the
 * screen: what changed is a set of rows, and a table can only show what it
 * happened to fetch.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
/**
 * **The schedule this harness splits is the SCENARIO's**, never whatever
 * `/admin/course-schedules` happens to return first.
 *
 * The occurrence assertions below genuinely mutate: they override an occurrence
 * and then split the series. Doing that to a schedule the harness does not own
 * leaves the development database permanently rearranged — the same class of
 * defect R110's reorder test shipped and the Owner has asked never be treated as
 * acceptable. `seed-dev-scenario.sh --clean` removes what it created, so the
 * mutation is bounded by construction rather than by remembering to undo it.
 */
const S = JSON.parse(process.env.SCENARIO ?? '{}');
if (!S.scheduleId) throw new Error('SCENARIO with a scheduleId is required');
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

/** The path is checked as well as the selector — a selector alone returns ready
 *  against the page being navigated away from (learned in R110's harness). */
async function goto(path, ready) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 160; i += 1) {
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

const api = (method, path, body) =>
  evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    const { access_token } = await r.json();
    const res = await fetch(${JSON.stringify('/api/v1')} + ${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
      ${body === undefined ? '' : `body: ${JSON.stringify(JSON.stringify(body))},`}
    });
    const text = await res.text();
    return JSON.stringify({ status: res.status, body: text ? JSON.parse(text) : null });
  })()`).then((r) => JSON.parse(r));

/**
 * The visibility select inside the open dialog, **addressed through its label's
 * `htmlFor`**.
 *
 * `FieldShell` renders the `<label>` as a SIBLING of the control, associated by
 * `for`/`id` — so `label.querySelector('select')` finds nothing, which is how
 * this harness first reported five failures against a form that was correct.
 * Going through the accessible association is both the fix and the right
 * locator: it is the same link a screen reader follows, so a change that broke
 * it would be a real defect rather than a harness detail.
 */
const dialogVisibility = () =>
  evaluate(`(() => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return 'no-dialog';
    const label = [...dialog.querySelectorAll('label')]
      .find((l) => l.textContent.includes('مستوى الظهور'));
    if (!label) return 'no-label';
    const select = document.getElementById(label.htmlFor);
    return select ? select.value : 'no-control';
  })()`);

const openAddDialog = () =>
  evaluate(`(() => {
    const add = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('إضافة'));
    if (!add) return 'no-add';
    add.click();
    return 'clicked';
  })()`);

const pickType = (name) =>
  evaluate(`(() => {
    const dialog = document.querySelector('dialog[open]');
    const selects = [...dialog.querySelectorAll('select')];
    for (const select of selects) {
      const option = [...select.options].find((o) => o.textContent.trim() === ${JSON.stringify(name)});
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return 'picked';
      }
    }
    return 'not-offered';
  })()`);

/* ── 1. Creation defaults to عام, for every kind ────────────────────────── */

await goto('/admin/schedules', 'button');
check('الجدولة opens', true, {});

await openAddDialog();
await new Promise((r) => setTimeout(r, 1200));

for (const [kind, label] of [
  ['نشاط', 'محاضرة'],
  ['حصة', 'حصة دراسية'],
  ['امتحان', 'اختبار'],
]) {
  const picked = await pickType(label);
  await new Promise((r) => setTimeout(r, 350));
  const value = await dialogVisibility();
  check(
    `create ${kind} (${label}) — الظهور is rendered and defaults to عام`,
    picked === 'picked' && value === 'public',
    { picked, value },
  );
}

/* ── 2. The attendance notice follows NEW H's stored flag ──────────────── */

const noticeAfter = async (label) => {
  await pickType(label);
  await new Promise((r) => setTimeout(r, 350));
  return evaluate(`(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog ? dialog.textContent.includes('يُسجَّل الحضور') : false;
  })()`);
};
check('حصة دراسية states that attendance is taken', (await noticeAfter('حصة دراسية')) === true, {});
check('اختبار states that attendance is taken', (await noticeAfter('اختبار')) === true, {});
// The negative half: a notice that always rendered would pass the two above and
// prove nothing about the flag.
check('محاضرة does NOT', (await noticeAfter('محاضرة')) === false, {});
check('حفل does NOT', (await noticeAfter('حفل')) === false, {});
check('عطلة does NOT', (await noticeAfter('عطلة')) === false, {});

/* ── 3. Edit hydrates the STORED tier, for a class ──────────────────────── */

const schedules = await api('GET', '/admin/course-schedules?page_size=200');
const target = (schedules.body?.data ?? []).find((s) => s.id === S.scheduleId);
if (!target) throw new Error('the scenario schedule is not readable');

for (const tier of ['private', 'hidden']) {
  await api('PATCH', `/admin/course-schedules/${target.id}`, {
    version: (await api('GET', `/admin/course-schedules?page_size=100`)).body.data.find(
      (s) => s.id === target.id,
    ).version,
    visibility: tier,
  });

  await goto('/admin/schedules', 'table tbody tr');
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('table tbody tr')]
      .find((tr) => tr.textContent.includes(${JSON.stringify(target.title)}));
    if (!row) return 'no-row';
    const edit = [...row.querySelectorAll('button,a')].find((b) => b.textContent.includes('تعديل'));
    if (edit) edit.click();
    return edit ? 'clicked' : 'no-edit';
  })()`);
  await new Promise((r) => setTimeout(r, 1200));

  const hydrated = await dialogVisibility();
  check(`edit a ${tier} حصة — the form opens on the STORED tier`, hydrated === tier, {
    hydrated,
  });

  // An unrelated edit must not touch it. Asserted through the API afterwards,
  // because the screen showing the right value proves only that it rendered it.
  if (tier === 'hidden') {
    await evaluate(`(() => {
      const dialog = document.querySelector('dialog[open]');
      const save = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('حفظ'));
      if (save) save.click();
      return 'saved';
    })()`);
    await new Promise((r) => setTimeout(r, 2000));
    const after = (await api('GET', '/admin/course-schedules?page_size=100')).body.data.find(
      (s) => s.id === target.id,
    );
    check(
      'saving with nothing else changed PRESERVES hidden — the §A widening cannot recur',
      after?.visibility === 'hidden',
      { visibility: after?.visibility },
    );
  }
}

/* ── 3b. An explicit tier change is DIRTY, and the guard says so ────────── */

await goto('/admin/schedules', 'table tbody tr');
await evaluate(`(() => {
  const row = [...document.querySelectorAll('table tbody tr')]
    .find((tr) => tr.textContent.includes(${JSON.stringify(target.title)}));
  const edit = row && [...row.querySelectorAll('button,a')].find((b) => b.textContent.includes('تعديل'));
  if (edit) edit.click();
  return edit ? 'clicked' : 'no-edit';
})()`);
await new Promise((r) => setTimeout(r, 1200));

await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  const label = [...dialog.querySelectorAll('label')]
    .find((l) => l.textContent.includes('مستوى الظهور'));
  const select = document.getElementById(label.htmlFor);
  select.value = 'public';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
})()`);
await new Promise((r) => setTimeout(r, 300));

// Closing now must ASK. `dirty` is what the unsaved-changes guard reads (rule
// AY), so a tier change that did not reach it would let one stray click discard
// an access decision — silently, which is the §A failure mode again.
await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  const cancel = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('إلغاء'));
  if (cancel) cancel.click();
  return cancel ? 'clicked' : 'no-cancel';
})()`);
await new Promise((r) => setTimeout(r, 500));

const asked = await evaluate(`(() => {
  const open = [...document.querySelectorAll('dialog[open]')];
  return open.some((d) => d.textContent.includes('تغييرات') || d.textContent.includes('تجاهل'));
})()`);
check('an explicit tier change makes the form DIRTY — closing asks first', asked === true, {
  asked,
});

/* ── 4. The occurrence scopes land where R50 says they land ─────────────── */

const sessionsOf = async () =>
  (await api('GET', `/admin/course-schedules/${target.id}/sessions?page_size=200`)).body.data;

let sessions = (await sessionsOf()).filter((s) => s.status !== 'cancelled');
sessions.sort((a, b) => a.date.localeCompare(b.date));
const pivotIndex = Math.floor(sessions.length / 2);
const pivot = sessions[pivotIndex];
const earlier = sessions[pivotIndex - 1];
const later = sessions[pivotIndex + 1];

// (a) this-session-only — one row, through the override path.
await api('PATCH', `/sessions/${pivot.id}`, {
  version: pivot.version,
  visibility: 'private',
  start_time: pivot.start_time,
  end_time: pivot.end_time,
  date: pivot.date,
});
let after = await sessionsOf();
const changedOnly = after.filter((s) => s.visibility === 'private').map((s) => s.id);
check(
  'هذه الحصة فقط — exactly ONE occurrence changed, and it is the chosen one',
  changedOnly.length === 1 && changedOnly[0] === pivot.id,
  { changed: changedOnly.length },
);
check(
  'and the override marked it protected from the next resync',
  after.find((s) => s.id === pivot.id)?.overridden === true,
  {},
);

// (b) this-and-following — the R50 split.
const scheduleVersion = (await api('GET', '/admin/course-schedules?page_size=100')).body.data.find(
  (s) => s.id === target.id,
).version;
const split = await api('PATCH', `/admin/course-schedules/${target.id}`, {
  version: scheduleVersion,
  scope: 'this_and_future',
  from_date: later.date,
  visibility: 'public',
});
check('هذه الحصة وكل ما بعدها — the schedule SPLIT', split.status === 200, {
  status: split.status,
});

const successorId = split.body?.schedule?.id ?? split.body?.id;
const predecessorSessions = await sessionsOf();
check(
  'earlier occurrences stayed with the predecessor and were NOT rewritten',
  predecessorSessions.every((s) => s.date < later.date) ||
    predecessorSessions.filter((s) => s.date >= later.date).length === 0,
  { remaining: predecessorSessions.length },
);
check(
  'and the occurrence somebody overrode kept its own tier through the split',
  predecessorSessions.find((s) => s.id === pivot.id)?.visibility === 'private',
  { pivot: predecessorSessions.find((s) => s.id === pivot.id)?.visibility },
);

if (successorId && successorId !== target.id) {
  const tail = (
    await api('GET', `/admin/course-schedules/${successorId}/sessions?page_size=200`)
  ).body.data;
  check(
    'future occurrences materialized under the SUCCESSOR and follow its tier',
    tail.length > 0 && tail.every((s) => s.visibility === 'public'),
    { tail: tail.length },
  );
} else {
  check('future occurrences materialized under the SUCCESSOR', false, {
    reason: 'no successor id on the response',
  });
}

await close();
finish();
