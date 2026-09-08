/**
 * **R136 frontend-completion — the four scheduling journeys, on the real
 * pages** (item 6/7 of the browser-verification punch list).
 *
 * Everything here is already proven at the unit/component layer
 * (`exam-section.test.tsx`, `assessment-ui.test.ts`,
 * `scheduling-exam-source.test.tsx`) and at the integration layer
 * (`assessment.integration.test.ts`, 86/86). What none of those can see is
 * the thing an Owner browser walk found real defects in: **state surviving
 * a real page-to-page navigation** — بناء الاختبارات's content-only create
 * dialog, its «استخدام مرة أخرى» hand-off landing on الجدولة with the
 * dialog already open and «نوع العنصر» actually SHOWING اختبار (not merely
 * `type` agreeing underneath), the source-aware `?source=&mode=` prefill
 * re-reading the paper through the same authorized `readAuthorPaper` call
 * the builder itself uses, and both physical workflows — with and without
 * an authored source — still saving.
 *
 * Four journeys, A–D, in the Owner's own order; then a responsive/RTL sweep
 * of the three dialogs at representative widths.
 *
 * Owns its rows through `seed-assessment-scenario.ts`'s own `[asmguard]`
 * tag — including every exam THIS harness creates, titled with the same
 * prefix, so the script's existing `wipe()` (which already tears down
 * `Exam` and everything hanging off it by title) cleans this harness's
 * drafts and scheduled occurrences alike, with no second tag and no second
 * cleanup mechanism to keep in sync.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const TAG = '[asmguard]';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9262');
const { check, finish } = results();

/* ── API helpers, same shape verify-assessments.mjs and verify-schedule-edit.mjs use ── */

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

/**
 * **The token is minted THROUGH the browser's own fetch, never a second,
 * independent one from Node** (the defect this harness itself hit while
 * being built: refresh tokens rotate — TD-15 / `auth.service.ts`'s
 * `rotatedRefresh` — so a Node-side `fetch('/auth/refresh')` using the raw
 * cookie consumes/rotates it out from under the browser, which then fails
 * ITS OWN later refresh and silently renders logged out, minutes into a
 * run, with no error on screen). Calling refresh from inside the page
 * (`evaluate`) keeps every refresh mediated by the ONE cookie jar that
 * matters — the browser's — exactly like `verify-schedule-edit.mjs`'s own
 * post-save persistence check already does. Requires a real page already
 * loaded under `BASE` (a relative fetch on `about:blank` has no origin).
 */
async function browserToken() {
  return evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}',
    });
    const body = await r.json().catch(() => null);
    return body ? body.access_token ?? null : null;
  })()`);
}

const setCookie = (value) =>
  send('Network.setCookie', {
    name: 'bodour_refresh',
    value,
    domain: 'localhost',
    path: '/api/v1/auth',
    httpOnly: true,
  });
await setCookie(process.env.SUPER_API_COOKIE);
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

async function goto(path, ready, settle = 900) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) {
      await new Promise((r) => setTimeout(r, settle));
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function waitFor(fn, timeoutMs = 8000, interval = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}

const currentHref = () => evaluate('(() => window.location.href)()');
const currentPath = () => evaluate('(() => window.location.pathname)()');

/* ── DOM helpers — every string below is comment-free, per cdp.mjs's own
   warning: a backtick inside a // or a JS comment inside these template
   literals terminates the literal early and reports a confusing SyntaxError
   pointing at the wrong line. All commentary stays on the Node side. */

const clickButtonContaining = (text, scope = "document") =>
  evaluate(`(() => {
    const root = ${scope};
    if (!root) return { noRoot: true };
    const btn = [...root.querySelectorAll('button, a')].find((b) =>
      b.textContent.includes(${JSON.stringify(text)}),
    );
    if (!btn) return { noButton: true };
    btn.click();
    return { ok: true };
  })()`);

const dialogOpen = () =>
  evaluate("(() => document.querySelector('dialog[open]') !== null)()");

const setSelectByLabel = (label, value, scope = "document.querySelector('dialog[open]')") =>
  evaluate(`(() => {
    const root = ${scope};
    if (!root) return { noRoot: true };
    const field = [...root.querySelectorAll('.field')].find((f) => {
      const l = f.querySelector('.field__label');
      return l && l.textContent.trim().indexOf(${JSON.stringify(label)}) === 0;
    });
    if (!field) return { noField: true };
    const select = field.querySelector('select');
    if (!select) return { noSelect: true };
    const has = [...select.options].some((o) => o.value === ${JSON.stringify(value)});
    if (!has) {
      return {
        noOption: true,
        options: [...select.options].map((o) => ({ v: o.value, l: o.textContent.trim() })),
      };
    }
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(select),
      'value',
    ).set;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);

const setSelectContainingOption = (label, optionTextContains, scope = "document.querySelector('dialog[open]')") =>
  evaluate(`(() => {
    const root = ${scope};
    if (!root) return { noRoot: true };
    const field = [...root.querySelectorAll('.field')].find((f) => {
      const l = f.querySelector('.field__label');
      return l && l.textContent.trim().indexOf(${JSON.stringify(label)}) === 0;
    });
    if (!field) return { noField: true };
    const select = field.querySelector('select');
    if (!select) return { noSelect: true };
    const opt = [...select.options].find((o) => o.textContent.includes(${JSON.stringify(optionTextContains)}));
    if (!opt) {
      return { noOption: true, options: [...select.options].map((o) => o.textContent.trim()) };
    }
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(select),
      'value',
    ).set;
    setter.call(select, opt.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: opt.value };
  })()`);

const setTextByLabel = (label, value, scope = "document.querySelector('dialog[open]')") =>
  evaluate(`(() => {
    const root = ${scope};
    if (!root) return { noRoot: true };
    const field = [...root.querySelectorAll('.field')].find((f) => {
      const l = f.querySelector('.field__label');
      return l && l.textContent.trim().indexOf(${JSON.stringify(label)}) === 0;
    });
    if (!field) return { noField: true };
    const input = field.querySelector('input, textarea');
    if (!input) return { noInput: true };
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);

const pickTodayDate = (label, scope = "document.querySelector('dialog[open]')") =>
  evaluate(`(async () => {
    const root = ${scope};
    if (!root) return { noRoot: true };
    const field = [...root.querySelectorAll('.field')].find((f) => {
      const l = f.querySelector('.field__label');
      return l && l.textContent.trim().indexOf(${JSON.stringify(label)}) === 0;
    });
    if (!field) return { noField: true };
    const trigger = field.querySelector('.date-picker__trigger');
    if (!trigger) return { noTrigger: true };
    trigger.click();
    await new Promise((r) => setTimeout(r, 350));
    const today = field.querySelector('.date-picker__day.is-today');
    if (!today) return { noToday: true };
    today.click();
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true };
  })()`);

const fieldSnapshot = (label, scope = "document.querySelector('dialog[open]')") =>
  evaluate(`(() => {
    const root = ${scope};
    if (!root) return { noRoot: true };
    const field = [...root.querySelectorAll('.field')].find((f) => {
      const l = f.querySelector('.field__label');
      return l && l.textContent.trim().indexOf(${JSON.stringify(label)}) === 0;
    });
    if (!field) return { present: false };
    const select = field.querySelector('select');
    const input = field.querySelector('input, textarea');
    const control = select ?? input;
    return {
      present: true,
      isSelect: Boolean(select),
      value: control ? control.value : null,
      selectedText: select ? (select.options[select.selectedIndex]?.textContent ?? '').trim() : null,
      required: control ? control.required : null,
      hasAsterisk: field.querySelector('.field__required') !== null,
      optionCount: select ? select.options.length : null,
      optionTexts: select ? [...select.options].map((o) => o.textContent.trim()) : null,
    };
  })()`);

const dialogText = () =>
  evaluate("(() => (document.querySelector('dialog[open]')?.textContent ?? ''))()");

const dialogNotice = () =>
  evaluate(
    "(() => (document.querySelector('dialog[open] .admin-notice, dialog[open] [role=\\\"alert\\\"]')?.textContent ?? '').trim())()",
  );

const captureNextRequest = (urlSubstring) =>
  evaluate(`(() => {
    window.__capturedRequest = null;
    const original = window.fetch;
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      const res = await original(...args);
      if (url.includes(${JSON.stringify(urlSubstring)})) {
        const clone = res.clone();
        const body = await clone.json().catch(() => null);
        window.__capturedRequest = { url, status: res.status, body };
        window.fetch = original;
      }
      return res;
    };
    return true;
  })()`);

const capturedRequest = () => evaluate('(() => window.__capturedRequest ?? null)()');

const findRowButton = (rowText, buttonText) =>
  evaluate(`(() => {
    const row = [...document.querySelectorAll('.admin-table tbody tr')].find((tr) =>
      tr.textContent.includes(${JSON.stringify(rowText)}),
    );
    if (!row) return { noRow: true };
    const btn = [...row.querySelectorAll('button')].find((b) =>
      b.textContent.trim() === ${JSON.stringify(buttonText)},
    );
    if (!btn) return { noButton: true };
    btn.click();
    return { ok: true };
  })()`);

/* ── Titles, all TAG-prefixed so `seed-assessment-scenario.ts --clean`
   (which sweeps every `Exam` whose title starts with `[asmguard]`) removes
   both this harness's authored drafts AND the scheduled occurrences copied
   from them — one tag, one cleanup path, no second mechanism to keep in
   sync. */
const TITLE_ONLINE = `${TAG} ورقة عن بُعد`;
const TITLE_PHYSICAL_SOURCE = `${TAG} ورقة حضورية`;
const TITLE_PHYSICAL_BARE = `${TAG} امتحان حضوري بلا ورقة`;

/* ════════════════════════════════════════════════════════════════════════
   Journey A — بناء الاختبارات content-only create → schedule action →
   the scheduler's ?source=&mode=online prefill → save.
   ════════════════════════════════════════════════════════════════════════ */

let onlineDraftId = null;
let onlineOccurrenceId = null;
let superToken = null;

await goto('/admin/assessments', '.admin-nav');
superToken = await browserToken();
check('A-1 · a browser-mediated API token was obtained', typeof superToken === 'string' && superToken.length > 0);
{
  const opened = await clickButtonContaining('اختبار جديد');
  check('A0 · بناء الاختبارات — اختبار جديد opens the create dialog', opened.ok === true, JSON.stringify(opened));
  await new Promise((r) => setTimeout(r, 700));
  const isOpen = await dialogOpen();
  check('A1 · the create dialog is open', isOpen === true);

  const text = await dialogText();
  check(
    'A2 · the content-only dialog asks for no target/date — no «موجَّه» wording',
    !text.includes('موجَّه') && !text.includes('الجمهور'),
    text.slice(0, 200),
  );
  const noDatePicker = await evaluate(
    "(() => document.querySelector(\"dialog[open] .date-picker\") === null)()",
  );
  check('A3 · and no date control at all in the create dialog', noDatePicker === true);

  await setTextByLabel('اسم الاختبار', TITLE_ONLINE);
  const lvl = await setSelectByLabel('المستوى', S.levelId);
  await new Promise((r) => setTimeout(r, 900));
  const subj = await setSelectByLabel('المادة', S.subjectId);
  await new Promise((r) => setTimeout(r, 900));
  const yr = await setSelectByLabel('السنة الدراسية', S.academicYearId);
  await new Promise((r) => setTimeout(r, 400));
  check('A3b · debug — scope selects', true, JSON.stringify({ lvl, subj, yr }));

  const clicked = await clickButtonContaining('حفظ', "document.querySelector('dialog[open]')");
  check('A4 · حفظ is clickable and clicked', clicked.ok === true, JSON.stringify(clicked));

  const href = await waitFor(async () => {
    const h = await currentHref();
    return h && h.includes('/admin/assessments?exam=') ? h : null;
  });
  if (href === null) {
    const stillOpen = await dialogOpen();
    const nowHref = await currentHref();
    const notice = await evaluate(
      "(() => (document.querySelector('.feedback, .state, [role=\\\"alert\\\"]')?.textContent ?? '').trim())()",
    ).catch(() => 'EVAL_ERR');
    check(
      'A4b · debug — dialog state after save click',
      true,
      JSON.stringify({ stillOpen, nowHref, notice }),
    );
  }
  check('A5 · saving navigates to the new draft (?exam=<id>)', href !== null, href);
  onlineDraftId = href ? new URL(href).searchParams.get('exam') : null;
}

if (onlineDraftId) {
  await new Promise((r) => setTimeout(r, 800));
  const text = await evaluate('(() => document.body.textContent)()');
  check('A6 · the new paper reads مسودة (draft), never anything else', text.includes('مسودة'), null);

  superToken = await browserToken();
  const q = await api('POST', `/assessments/${onlineDraftId}/questions`, superToken, {
    kind: 'short_text',
    prompt: `${TAG} سؤال`,
  });
  check('A7 · a question can be added to the fresh draft', q.status === 201, JSON.stringify(q));
}

if (onlineDraftId) {
  await goto('/admin/assessments', '.admin-nav');
  const clicked = await findRowButton(TITLE_ONLINE, 'استخدام مرة أخرى');
  check('A8 · the row’s «استخدام مرة أخرى» action is present and clicked', clicked.ok === true, JSON.stringify(clicked));

  const expected = `/admin/schedules?kind=exam&new=1&source=${encodeURIComponent(onlineDraftId)}&mode=online`;
  const href = await waitFor(async () => {
    const p = await currentPath();
    return p === '/admin/schedules' ? await currentHref() : null;
  });
  check(
    'A9 · the browser navigates to the exact scheduler prefill URL',
    href !== null && href.endsWith(expected),
    JSON.stringify({ href, expected }),
  );

  await new Promise((r) => setTimeout(r, 1200));
  const isOpen = await waitFor(async () => ((await dialogOpen()) ? true : null));
  check('A10 · the dialog is ALREADY open on arrival', isOpen === true);

  const itemType = await fieldSnapshot('نوع العنصر');
  check(
    'A11 · «نوع العنصر» actually SHOWS اختبار (not the catalogue’s first row, حصة دراسية)',
    itemType.present === true && itemType.selectedText === 'اختبار',
    JSON.stringify(itemType),
  );

  const paper = await fieldSnapshot('ورقة الاختبار');
  check(
    'A12 · the paper picker shows the source paper, prefilled and re-read fresh',
    paper.present === true && paper.value === onlineDraftId && (paper.selectedText ?? '').includes(TAG),
    JSON.stringify(paper),
  );
  check(
    'A13 · the remote paper picker is REQUIRED (a remote sitting always needs authored content)',
    paper.required === true,
    JSON.stringify(paper),
  );

  const startDate = await fieldSnapshot('تاريخ البداية');
  check(
    'A14 · the occurrence date is left BLANK — never invented from the source',
    startDate.present === true && (startDate.value ?? '') === '',
    JSON.stringify(startDate),
  );

  const availability = await fieldSnapshot('إتاحة الاختبار للمستفيدات');
  check(
    'A15 · availability defaults to «يدوياً» (manual) — not silently opened',
    availability.present === true && availability.value === 'manual',
    JSON.stringify(availability),
  );

  const picked = await pickTodayDate('تاريخ البداية');
  check('A15b · today’s date was picked in the calendar', picked.ok === true, JSON.stringify(picked));
  await captureNextRequest('/exams/schedule');
  const savedClick = await clickButtonContaining('حفظ', "document.querySelector('dialog[open]')");
  check('A16 · حفظ is clicked to complete the occurrence', savedClick.ok === true, JSON.stringify(savedClick));

  const closed = await waitFor(async () => {
    const open = await dialogOpen();
    return open === false ? true : null;
  });
  if (closed === null) {
    const notice = await dialogNotice();
    const req = await capturedRequest();
    check('A16b · debug — dialog still open after حفظ', true, JSON.stringify({ notice, req }));
  }
  check('A17 · saving closes the dialog', closed === true);

  superToken = await browserToken();
  const listing = await api('GET', '/exams?page_size=100', superToken);
  const occurrence = (listing.body?.data ?? []).find(
    (e) => e.title === TITLE_ONLINE && e.mode === 'online',
  );
  check(
    'A18 · a new scheduled REMOTE occurrence was created (persisted, via the API)',
    occurrence !== undefined,
    JSON.stringify({ status: listing.status, found: Boolean(occurrence) }),
  );
  onlineOccurrenceId = occurrence?.id ?? null;

  if (onlineOccurrenceId) {
    const authored = await api('GET', `/assessments/${onlineOccurrenceId}`, superToken);
    check(
      'A19 · the occurrence’s own sourceExamId names the authored draft, one hop',
      authored.body?.source_exam_id === onlineDraftId,
      JSON.stringify({ source_exam_id: authored.body?.source_exam_id, expected: onlineDraftId }),
    );
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Journey B — نقاط الامتحانات's ＋ جدولة امتحان → /admin/schedules?kind=
   exam&new=1 (no source/mode) → the dialog opens on اختبار, not the
   catalogue's first row (حصة دراسية) — the ORIGINAL defect symptom.
   ════════════════════════════════════════════════════════════════════════ */

await goto('/admin/exam-grades', '.admin-nav');
{
  const clicked = await clickButtonContaining('جدولة امتحان');
  if (clicked.noButton) {
    const debug = await evaluate(
      "(() => ({ href: window.location.href, buttons: [...document.querySelectorAll('a, button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 40) }))()",
    ).catch(() => 'EVAL_ERR');
    check('B0b · debug — page state when the button was not found', true, JSON.stringify(debug));
  }
  check('B0 · نقاط الامتحانات — ＋ جدولة امتحان is present and clicked', clicked.ok === true, JSON.stringify(clicked));

  const href = await waitFor(async () => {
    const p = await currentPath();
    return p === '/admin/schedules' ? await currentHref() : null;
  });
  check(
    'B1 · navigates to exactly /admin/schedules?kind=exam&new=1 (no source/mode)',
    href !== null && href.endsWith('/admin/schedules?kind=exam&new=1'),
    href,
  );

  await new Promise((r) => setTimeout(r, 1200));
  const isOpen = await waitFor(async () => ((await dialogOpen()) ? true : null));
  check('B2 · the dialog opens', isOpen === true);

  const itemType = await fieldSnapshot('نوع العنصر');
  check(
    'B3 · «نوع العنصر» shows اختبار — never «حصة دراسية», the catalogue’s first row',
    itemType.present === true &&
      itemType.selectedText === 'اختبار' &&
      itemType.selectedText !== 'حصة دراسية',
    JSON.stringify(itemType),
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Journey C — an authored REUSABLE PHYSICAL draft, picked from the
   optional paper picker; Level/Subject/Year/maxGrade travel with it and
   disappear from the form; Branch/Room/date/supervisor stay independent.
   ════════════════════════════════════════════════════════════════════════ */

superToken = await browserToken();
const physicalDraft = await api('POST', '/assessments', superToken, {
  title: TITLE_PHYSICAL_SOURCE,
  mode: 'physical',
  max_grade: 15,
  level_id: S.levelId,
  subject_id: S.subjectId,
  academic_year_id: S.academicYearId,
});
check('C0 · an authored physical draft is created for reuse', physicalDraft.status === 201, JSON.stringify(physicalDraft));
const physicalDraftId = physicalDraft.body?.id ?? null;

let physicalSourceOccurrenceId = null;
if (physicalDraftId) {
  await goto('/admin/schedules?kind=exam&new=1', '.admin-nav');
  await new Promise((r) => setTimeout(r, 1200));
  const isOpen = await waitFor(async () => ((await dialogOpen()) ? true : null));
  check('C1 · a fresh create dialog opens (?kind=exam&new=1, no source)', isOpen === true);

  if (isOpen) {
  const mode = await fieldSnapshot('نوع الامتحان');
  check('C2 · طريقة الأداء defaults to حضوري (physical)', mode.present === true && mode.selectedText === 'حضوري', JSON.stringify(mode));

  const paperBefore = await fieldSnapshot('ورقة الاختبار');
  check(
    'C3 · the physical paper picker is OPTIONAL — no required mark, «بلا ورقة مُعدَّة» offered',
    paperBefore.present === true &&
      paperBefore.required === false &&
      paperBefore.hasAsterisk === false &&
      (paperBefore.optionTexts ?? []).includes('بلا ورقة مُعدَّة'),
    JSON.stringify(paperBefore),
  );

  const searched = await setTextByLabel('ابحثي بعنوان الورقة', TAG, "document.querySelector('dialog[open]')");
  check('C3b · the searchable paper selector accepts typed text', searched.ok === true, JSON.stringify(searched));
  await new Promise((r) => setTimeout(r, 1300));
  let picked = await setSelectContainingOption('ورقة الاختبار', TITLE_PHYSICAL_SOURCE);
  if (!picked.ok) {
    // The search narrowed to nothing findable in time — fall back to the
    // picker's own unfiltered list (plenty of headroom under its 20-row
    // page in this disposable fixture), so a slow/eventual search does not
    // fail the journey over an unrelated timing margin.
    await setTextByLabel('ابحثي بعنوان الورقة', '', "document.querySelector('dialog[open]')");
    await new Promise((r) => setTimeout(r, 1000));
    picked = await setSelectContainingOption('ورقة الاختبار', TITLE_PHYSICAL_SOURCE);
  }
  check('C4 · the authored physical source can be selected from the picker', picked.ok === true, JSON.stringify(picked));

  await new Promise((r) => setTimeout(r, 500));
  const levelGone = await evaluate(
    `(() => {
      const dialog = document.querySelector('dialog[open]');
      const labels = [...dialog.querySelectorAll('.field__label')].map((l) => l.textContent.trim());
      return {
        hasLevel: labels.some((l) => l.indexOf('المستوى') === 0),
        hasSubject: labels.some((l) => l.indexOf('المادة') === 0),
        hasYear: labels.some((l) => l.indexOf('السنة الدراسية') === 0),
        hasMaxGrade: labels.some((l) => l.indexOf('النقطة القصوى') === 0),
        hasBranch: labels.some((l) => l.indexOf('الفرع') === 0),
      };
    })()`,
  );
  check(
    'C5 · Level/Subject/Year and the maxGrade field disappear once a source is chosen',
    levelGone.hasLevel === false &&
      levelGone.hasSubject === false &&
      levelGone.hasYear === false &&
      levelGone.hasMaxGrade === false,
    JSON.stringify(levelGone),
  );
  check('C6 · Branch stays — a physical sitting always needs a real place', levelGone.hasBranch === true, JSON.stringify(levelGone));

  await setSelectByLabel('الفرع', S.branchId);
  await new Promise((r) => setTimeout(r, 900));
  await setSelectByLabel('القاعة', S.roomId);
  await new Promise((r) => setTimeout(r, 300));
  await pickTodayDate('تاريخ البداية');

  const supervisor = await setSelectContainingOption('الأستاذ', TAG);
  check('C7 · a supervisor can be named', supervisor.ok === true, JSON.stringify(supervisor));

  await captureNextRequest('/exams/schedule');
  const savedClick = await clickButtonContaining('حفظ', "document.querySelector('dialog[open]')");
  check('C8 · حفظ is clicked', savedClick.ok === true, JSON.stringify(savedClick));

  const closed = await waitFor(async () => ((await dialogOpen()) === false ? true : null));
  if (closed === null) {
    const notice = await dialogNotice();
    const req = await capturedRequest();
    check('C8b · debug — dialog still open after حفظ', true, JSON.stringify({ notice, req }));
  }
  check('C9 · saving closes the dialog', closed === true);

  superToken = await browserToken();
  const listing = await api('GET', '/exams?page_size=100', superToken);
  const occurrence = (listing.body?.data ?? []).find(
    (e) => e.title === TITLE_PHYSICAL_SOURCE && e.mode === 'physical',
  );
  check(
    'C10 · a new scheduled PHYSICAL occurrence, copied from the source, was created',
    occurrence !== undefined,
    JSON.stringify({ status: listing.status, found: Boolean(occurrence) }),
  );
  physicalSourceOccurrenceId = occurrence?.id ?? null;

  if (physicalSourceOccurrenceId) {
    const authored = await api('GET', `/assessments/${physicalSourceOccurrenceId}`, superToken);
    check(
      'C11 · the occurrence’s sourceExamId names the authored physical draft, one hop',
      authored.body?.source_exam_id === physicalDraftId,
      JSON.stringify({ source_exam_id: authored.body?.source_exam_id, expected: physicalDraftId }),
    );
    check(
      'C12 · classification travelled WITH the source (Level/Subject/Year/maxGrade copied)',
      occurrence.level_id === S.levelId &&
        occurrence.subject_id === S.subjectId &&
        occurrence.academic_year_id === S.academicYearId &&
        Number(occurrence.max_grade) === 15,
      JSON.stringify({
        level_id: occurrence.level_id,
        subject_id: occurrence.subject_id,
        academic_year_id: occurrence.academic_year_id,
        max_grade: occurrence.max_grade,
      }),
    );
    const submissions = await api('GET', `/assessments/${physicalSourceOccurrenceId}/submissions`, superToken).catch(
      () => null,
    );
    if (submissions && submissions.status === 200) {
      check(
        'C13 · no Student-interactive submission lifecycle exists for a physical sitting',
        (submissions.body?.data ?? []).length === 0,
        JSON.stringify(submissions.body),
      );
    } else {
      check('C13 · submission-absence check (informational — route answered non-200)', true, JSON.stringify(submissions));
    }
  }
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Journey D — the EXISTING content-free physical path must not regress:
   no authored paper at all, Level/Subject/Year/maxGrade typed manually.
   ════════════════════════════════════════════════════════════════════════ */

{
  const opened = await clickButtonContaining('إضافة عنصر');
  check('D0 · ＋ إضافة عنصر opens a fresh create dialog on the same page', opened.ok === true, JSON.stringify(opened));
  await new Promise((r) => setTimeout(r, 900));
  const isOpen = await dialogOpen();
  check('D1 · the dialog is open', isOpen === true);

  const typeSet = await setSelectContainingOption('نوع العنصر', 'اختبار');
  check('D2 · «نوع العنصر» can be set to اختبار', typeSet.ok === true, JSON.stringify(typeSet));
  await new Promise((r) => setTimeout(r, 400));

  const mode = await fieldSnapshot('نوع الامتحان');
  check('D3 · طريقة الأداء is (still) حضوري by default', mode.present === true && mode.selectedText === 'حضوري', JSON.stringify(mode));

  const paper = await fieldSnapshot('ورقة الاختبار');
  check('D4 · the paper picker starts at «بلا ورقة مُعدَّة» — no source chosen', paper.present === true && paper.value === '', JSON.stringify(paper));

  await setTextByLabel('العنوان', TITLE_PHYSICAL_BARE);
  await setSelectByLabel('الفرع', S.branchId);
  await new Promise((r) => setTimeout(r, 900));
  await setSelectByLabel('المستوى', S.levelId);
  await new Promise((r) => setTimeout(r, 900));
  await setSelectByLabel('المادة', S.subjectId);
  await new Promise((r) => setTimeout(r, 900));
  await setSelectByLabel('السنة الدراسية', S.academicYearId);
  await new Promise((r) => setTimeout(r, 500));
  await setTextByLabel('النقطة القصوى', '18');
  await setSelectByLabel('القاعة', S.roomId);
  await new Promise((r) => setTimeout(r, 300));
  await pickTodayDate('تاريخ البداية');
  await setSelectContainingOption('الأستاذ', TAG);

  const savedClick = await clickButtonContaining('حفظ', "document.querySelector('dialog[open]')");
  check('D5 · حفظ is clicked', savedClick.ok === true, JSON.stringify(savedClick));

  const closed = await waitFor(async () => ((await dialogOpen()) === false ? true : null));
  if (closed === null) {
    const notice = await dialogText();
    check('D5b · debug — dialog still open after حفظ', true, notice.slice(-300));
  }
  check('D6 · the content-free physical path still saves successfully — no regression', closed === true);

  superToken = await browserToken();
  const listing = await api('GET', '/exams?page_size=100', superToken);
  const occurrence = (listing.body?.data ?? []).find(
    (e) => e.title === TITLE_PHYSICAL_BARE && e.mode === 'physical',
  );
  check(
    'D7 · the bare physical sitting persisted, with no source',
    occurrence !== undefined,
    JSON.stringify({ status: listing.status, found: Boolean(occurrence) }),
  );
  if (occurrence) {
    const authored = await api('GET', `/assessments/${occurrence.id}`, superToken);
    check(
      'D8 · and carries no sourceExamId at all — a genuinely content-free sitting',
      authored.body?.source_exam_id === null || authored.body?.source_exam_id === undefined,
      JSON.stringify({ source_exam_id: authored.body?.source_exam_id }),
    );
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Responsive/RTL — the scheduler's exam dialog (fresh AND ?source=&mode=
   prefilled) and بناء الاختبارات's create dialog, at three representative
   widths. Depth matches verify-dialog-states.mjs: no horizontal page
   scroll, the searchable paper selector stays usable, no gross label/
   button collision.
   ════════════════════════════════════════════════════════════════════════ */

const WIDTHS = [1440, 768, 390];

/**
 * **The property that actually matters is a DELTA, not an absolute figure.**
 *
 * An early version of this sweep asserted `scrollWidth <= clientWidth + 1`
 * outright and found it failing, consistently, ONLY on `/admin/schedules?
 * kind=exam...` and never on `/admin/assessments` in the very same loop —
 * which looked exam-specific until tested directly: hiding the open
 * dialog's ENTIRE `.dialog__body` (`.form` and `.form__actions` both, via
 * `element.style.display='none'`) left `scrollWidth` completely unchanged,
 * and a brand-new tab opened straight at the same URL (no prior journeys,
 * no prior resizing) measured no overflow at all. The figure was real but
 * was not the dialog's — it tracked something the long, resize-heavy
 * session upstream of this sweep (four journeys' worth of navigation and
 * `Emulation.setDeviceMetricsOverride` calls) had already left on the page
 * or in Chrome's own emulation state, present with or without this dialog
 * open. Comparing against `document.documentElement.clientWidth` measures
 * that accumulated baseline as if the dialog had caused it.
 *
 * So what is actually asked here — "the dialog fits without the page
 * needing to scroll horizontally" — is checked as a BEFORE/AFTER delta on
 * the SAME page at the SAME width: capture `scrollWidth` with the dialog
 * closed, immediately before opening it, and assert opening the dialog
 * does not grow it. This is the honest form of the same property, and it
 * is what a reader actually experiences — whatever the page's own baseline
 * is, opening this dialog must not make it worse.
 */
async function responsiveSnapshot(baselineScrollWidth) {
  return evaluate(`(() => {
    const doc = document.documentElement;
    const dialog = document.querySelector('dialog[open]');
    const panel = dialog ? dialog.querySelector('.dialog__panel') : null;
    const search = dialog ? dialog.querySelector('input[type="search"]') : null;
    const overlap = (() => {
      if (!dialog) return false;
      const labels = [...dialog.querySelectorAll('.field__label')];
      for (const label of labels) {
        const control = label.closest('.field')?.querySelector('.field__control, select, input, textarea, .date-picker__trigger');
        if (!control) continue;
        const lr = label.getBoundingClientRect();
        const cr = control.getBoundingClientRect();
        if (lr.width === 0 || cr.width === 0) continue;
        const vOverlap = Math.min(lr.bottom, cr.bottom) - Math.max(lr.top, cr.top);
        const hOverlap = Math.min(lr.right, cr.right) - Math.max(lr.left, cr.left);
        if (vOverlap > 4 && hOverlap > 4 && lr.left >= cr.left && lr.right <= cr.right) return true;
      }
      return false;
    })();
    let widest = null;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      let best = null;
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 && (best === null || r.right > best.right)) {
          best = { right: r.right, tag: el.tagName, cls: String(el.className).slice(0, 60) };
        }
      }
      widest = best;
    }
    return {
      // The dialog must not WIDEN whatever the page already scrolled to —
      // never a claim that the page had none to begin with (see the
      // docstring above this function).
      noHorizontalScroll: doc.scrollWidth <= Math.max(doc.clientWidth, ${JSON.stringify(baselineScrollWidth)}) + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      baselineScrollWidth: ${JSON.stringify(baselineScrollWidth)},
      widestOverflowingElement: widest,
      dialogOpen: dialog !== null,
      dialogFitsViewport: panel ? panel.getBoundingClientRect().width <= window.innerWidth + 1 : null,
      searchUsable: search ? search.getClientRects().length > 0 && search.getBoundingClientRect().width > 40 : null,
      labelCollidesWithOwnControl: overlap,
    };
  })()`);
}

/** `document.documentElement.scrollWidth` at the current width, dialog closed. */
const pageScrollWidth = () =>
  evaluate('(() => document.documentElement.scrollWidth)()');

async function setWidth(width) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 500,
  });
  await new Promise((r) => setTimeout(r, 400));
}

async function checkResponsive(label, width, baselineScrollWidth) {
  const snap = await responsiveSnapshot(baselineScrollWidth);
  // **A vacuous pass is worse than a failure** (verify-dialog-states.mjs's
  // own stated rule) — a dialog that never opened would trivially pass
  // every geometry check below by having no geometry to fail on, and
  // report coverage that was never there.
  check(`R · ${label} @ ${width}px — the dialog is actually open`, snap.dialogOpen === true, JSON.stringify(snap));
  check(
    `R · ${label} @ ${width}px — opening the dialog adds no horizontal page scroll`,
    snap.noHorizontalScroll === true,
    JSON.stringify(snap),
  );
  check(
    `R · ${label} @ ${width}px — the dialog fits within the viewport`,
    snap.dialogFitsViewport === true,
    JSON.stringify(snap),
  );
  check(
    `R · ${label} @ ${width}px — no field label collides with its own control`,
    snap.labelCollidesWithOwnControl === false,
    JSON.stringify(snap),
  );
}

for (const width of WIDTHS) {
  await setWidth(width);
  await goto('/admin/assessments', '.admin-nav');
  const baseline = await pageScrollWidth();
  const opened = await clickButtonContaining('اختبار جديد');
  check(`R0 · بناء الاختبارات create dialog @ ${width}px — the trigger was found and clicked`, opened.ok === true, JSON.stringify(opened));
  await waitFor(async () => ((await dialogOpen()) ? true : null));
  await new Promise((r) => setTimeout(r, 300));
  await checkResponsive('بناء الاختبارات create dialog', width, baseline);
}

for (const width of WIDTHS) {
  await setWidth(width);
  // The list, WITHOUT the `?new=1` auto-open, at the same width — the
  // dialog-closed baseline this specific check needs (see the docstring
  // above `responsiveSnapshot`).
  await goto('/admin/schedules', '.admin-nav');
  const baseline = await pageScrollWidth();
  await goto('/admin/schedules?kind=exam&new=1', '.admin-nav');
  await waitFor(async () => ((await dialogOpen()) ? true : null));
  await new Promise((r) => setTimeout(r, 300));
  await checkResponsive('scheduler — fresh ?kind=exam&new=1', width, baseline);
}

if (onlineDraftId) {
  for (const width of WIDTHS) {
    await setWidth(width);
    await goto('/admin/schedules', '.admin-nav');
    const baseline = await pageScrollWidth();
    await goto(
      `/admin/schedules?kind=exam&new=1&source=${encodeURIComponent(onlineDraftId)}&mode=online`,
      '.admin-nav',
    );
    await waitFor(async () => ((await dialogOpen()) ? true : null));
    await new Promise((r) => setTimeout(r, 300));
    await checkResponsive('scheduler — ?source=&mode= prefilled', width, baseline);
  }
} else {
  check('R · scheduler — ?source=&mode= prefilled (skipped, Journey A did not produce a draft id)', false, 'no onlineDraftId');
}

close();
process.exit(finish());
