/**
 * **A class is addressed through five «الكل» filters, and no «نمط التدريس»**
 * (SRS Revision 163 §5) — on the real إضافة عنصر form, as an administrator.
 *
 * The properties, each one something only a browser can show:
 *
 * 1. choosing «حصة دراسية» renders NO teaching-mode picker, five audience
 *    filters each reading «الكل», and NO second branch question — the class's
 *    own branch is derived from «فروع» (SRS Revision 165 §6);
 * 2. a Category narrows the Levels on offer to its own;
 * 3. a filter names WHAT was chosen, never «1 محددة» (Revision 165 §7);
 * 4. leaving Level, group and circle at «الكل» is refused IN WORDS before any
 *    request — a class delivers a curriculum Subject;
 * 5. a Subject that works by Surah asks «السور» and refuses to save without one
 *    (Revision 165 §2); the form asks for NO «العنوان» — a class is called what
 *    it is, by the server, from its type, Subject, Surah and time (Revision 166
 *    §3);
 *    the saved row is filter-built, carries exactly what was chosen — Surah
 *    included — and the list names its audience instead of a storage mode.
 *
 * 6. (Journey B) the «from this date onward» editor offers the same filters,
 *    opens on the class as it stands, keeps its Subject, and its successor is
 *    filter-built while the predecessor keeps the target it always had — and
 *    inherits the class's Surah;
 * 7. a split at a class's FIRST session saves (it answered 500 before
 *    Revision 165 §4) and leaves one class, not two.
 *
 * It owns its rows (P1.2): the dev scenario, plus one class under the scenario's
 * own tag, which the wrapper's `--clean` removes.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO);
// The catalogue is editable reference data (R110): the class type is called
// whatever the Owner calls it today, and the scenario says what that is.
const CLASS_TYPE = S.classTypeName;
if (!CLASS_TYPE) throw new Error('the scenario names no class scheduling type');
const TITLE = process.env.CLASS_TITLE;
const { send, evaluate, close } = await connect(process.env.PORT ?? '9267');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.DEV_REFRESH_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await send('Page.navigate', { url: `${BASE}/admin/schedules` });
await new Promise((r) => setTimeout(r, 5000));

/** Shared page-side helpers, prepended to every evaluation. */
const HELPERS = `
  const dlg = () => document.querySelector('dialog[open]');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fieldOf = (label) => [...dlg().querySelectorAll('.field')].find((f) => {
    const l = f.querySelector('.field__label');
    return l && l.textContent.trim().indexOf(label) === 0;
  });
  const setSelect = (label, pick) => {
    const select = fieldOf(label)?.querySelector('select');
    if (!select) return false;
    const option = [...select.options].find(pick);
    if (!option) return false;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const setInput = (label, value) => {
    const input = fieldOf(label)?.querySelector('input');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  /** Opens one multi-select, reports its options, optionally ticks one, closes it. */
  const multi = async (label, tick) => {
    const field = fieldOf(label);
    const trigger = field?.querySelector('button.dropdown-trigger');
    if (!trigger) return { missing: true };
    trigger.click();
    await wait(300);
    const rows = [...field.querySelectorAll('.multi-select__options li')];
    const options = rows.map((li) => li.textContent.trim());
    let ticked = false;
    if (tick) {
      const row = rows.find((li) => li.textContent.includes(tick));
      const box = row?.querySelector('input[type="checkbox"]');
      if (box) { box.click(); ticked = true; await wait(300); }
    }
    trigger.click();
    await wait(300);
    return { options, ticked, summary: trigger.textContent.trim() };
  };
`;
const page = (body) => evaluate(`(async () => { ${HELPERS} ${body} })()`);

const opened = await page(`
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes('إضافة عنصر'));
  if (!add) return { noAdd: true };
  add.click();
  await wait(1500);
  if (!dlg()) return { noDialog: true };
  if (!setSelect('نوع العنصر', (o) => o.textContent.trim() === ${JSON.stringify(CLASS_TYPE)})) return { noClassType: true };
  await wait(1800);
  const labels = [...dlg().querySelectorAll('.field__label')].map((l) => l.textContent.trim());
  const summaries = ['فروع', 'فئات', 'مستويات', 'مجموعات', 'حلقات'].map((name) =>
    fieldOf(name)?.querySelector('button.dropdown-trigger')?.textContent.trim() ?? null);
  return {
    modeAsked: labels.some((l) => l.indexOf('نمط التدريس') === 0),
    summaries,
    homeBranchAsked: labels.some((l) => l.indexOf('الفرع المنظِّم') === 0),
  };
`);
check(
  '1 · حصة asks no «نمط التدريس» and no second branch question: five filters, each reading «الكل»',
  opened.modeAsked === false &&
    JSON.stringify(opened.summaries) === JSON.stringify(['الكل', 'الكل', 'الكل', 'الكل', 'الكل']) &&
    opened.homeBranchAsked === false,
  JSON.stringify(opened),
);

const narrowed = await page(`
  const before = await multi('مستويات');
  const category = await multi('فئات', '[dev-scenario] المرأة');
  await wait(500);
  const after = await multi('مستويات');
  return { before: before.options.length, after: after.options, category: category.summary, ticked: category.ticked };
`);
check(
  '2 · choosing a Category leaves only ITS Levels on offer',
  narrowed.ticked === true &&
    narrowed.before > narrowed.after.length &&
    narrowed.after.length >= 1 &&
    narrowed.after.every((name) => name.includes('[dev-scenario]')),
  JSON.stringify(narrowed),
);

const branched = await page(`
  const branch = await multi('فروع', '[dev-scenario] تاركة');
  await wait(600);
  const labels = [...dlg().querySelectorAll('.field__label')].map((l) => l.textContent.trim());
  return { ticked: branch.ticked, summary: branch.summary,
           homeBranchAsked: labels.some((l) => l.indexOf('الفرع المنظِّم') === 0) };
`);
check(
  '3 · a filter names what was chosen — never «1 محددة» — and the branch is still asked once',
  branched.ticked === true &&
    branched.summary === '[dev-scenario] تاركة' &&
    narrowed.category === '[dev-scenario] المرأة' &&
    branched.homeBranchAsked === false,
  JSON.stringify(branched),
);

const refused = await page(`
  // (The title is left alone: it is SUGGESTED, and check 5e reads it.)
  // The form names the FIRST thing missing, in its own order — so the date goes
  // in first, or this would be reading the start-date message instead.
  const dateField = fieldOf('تاريخ البداية');
  dateField?.querySelector('.date-picker__trigger')?.click();
  await wait(350);
  dateField?.querySelector('.date-picker__day.is-today')?.click();
  await wait(250);
  const save = [...dlg().querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  save.click();
  await wait(1200);
  return { stillOpen: dlg() !== null, text: (dlg()?.textContent ?? '').includes('اختاري مستوى') };
`);
check(
  '4 · Level, group and circle all at «الكل» is refused in words, before any request',
  refused.stillOpen === true && refused.text === true,
  JSON.stringify(refused),
);

const filled = await page(`
  const level = await multi('مستويات', '[dev-scenario] وميض الأمل');
  await wait(1500);
  const subject = setSelect('المادة', (o) => o.textContent.includes('[dev-scenario] تفسير'));
  await wait(400);
  const year = setSelect('السنة الدراسية', (o) => o.value !== '');
  await wait(300);
  // (The date went in above; the class saving below is what proves it.)
  const start = setInput('من الساعة', '07:00');
  const end = setInput('إلى الساعة', '08:00');
  await wait(300);
  return { level: level.ticked, levelSummary: level.summary, subject, year, start, end };
`);
check(
  '5a · a Level, its Subject, the year and the times are all reachable on the form',
  filled.level && filled.subject && filled.year && filled.start && filled.end,
  JSON.stringify(filled),
);

const surah = await page(`
  const asked = fieldOf('السور') !== undefined;
  // Without a Surah the form must say so, and send nothing.
  const save = [...dlg().querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  save.click();
  await wait(1000);
  const refusedInWords = dlg() !== null && (dlg().textContent ?? '').includes('اختاري السورة');
  const offered = await multi('السور', 'الفاتحة');
  await wait(500);
  // R167 §1 — nothing is TYPED, and the composed title is SHOWN while composing.
  const titleAsked = fieldOf('العنوان')?.querySelector('input, textarea') != null;
  const shown = dlg().querySelector('[data-generated-title]');
  const titleShown = shown ? (shown.querySelector('output')?.textContent ?? '') : null;
  const titleHint = shown ? (shown.querySelector('.field__hint')?.textContent ?? '') : null;
  return { asked, refusedInWords, offered: offered.options, ticked: offered.ticked, summary: offered.summary, titleAsked, titleShown, titleHint };
`);
check(
  '5e · a by-Surah Subject asks «السور» — the Level’s «مقرر الحفظ» and nothing else — and refuses to save without one',
  surah.asked === true &&
    surah.refusedInWords === true &&
    JSON.stringify(surah.offered) === JSON.stringify(['الفاتحة', 'البقرة']) &&
    surah.ticked === true &&
    surah.summary === 'الفاتحة',
  JSON.stringify(surah),
);
check(
  '5f · the form asks for no «العنوان» — a class is called what it is, by the server (R166 §3)',
  surah.titleAsked === false,
  JSON.stringify({ titleAsked: surah.titleAsked }),
);
check(
  '5g · …and SHOWS it while she composes: Subject and Surah already in it, and a sentence pointing to «الوصف» (R167 §1)',
  typeof surah.titleShown === 'string' &&
    surah.titleShown.includes('[dev-scenario] تفسير القرآن') &&
    surah.titleShown.includes('الفاتحة') &&
    (surah.titleHint ?? '').includes('الوصف'),
  JSON.stringify({ titleShown: surah.titleShown, titleHint: surah.titleHint }),
);

const saved = await page(`
  // «الوصف» is where anything typed goes now, so it carries this run's tag —
  // what the row is then FOUND by, since its title is composed.
  const note = fieldOf('الوصف')?.querySelector('textarea');
  if (note) {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(note, ${JSON.stringify(TITLE)});
    note.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await wait(300);
  const save = [...dlg().querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  save.click();
  await wait(4000);
  return { closed: dlg() === null, notice: (dlg()?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 300) };
`);
check('5b · the class saves and the dialog closes', saved.closed === true, JSON.stringify(saved));

const stored = await page(`
  const r = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: '{}',
  });
  const { access_token } = await r.json();
  const res = await fetch('/api/v1/admin/course-schedules?page_size=100', {
    headers: { Authorization: 'Bearer ' + access_token },
  });
  const row = (await res.json()).data.find((x) => x.description === ${JSON.stringify(TITLE)});
  const cell = row
    ? [...document.querySelectorAll('tr')].find((tr) => tr.textContent.includes(row.title))
    : null;
  return row ? {
    title: row.title,
    teaching_mode: row.teaching_mode,
    dimensions: row.dimensions,
    surah_ids: row.surah_ids,
    branch_id: row.branch_id,
    target_name: row.target_name,
    rowText: cell ? cell.textContent.replace(/\\s+/g, ' ') : null,
  } : null;
`);
check(
  '5c · the row is filter-built and carries exactly what was chosen — one branch, one Category, one Level, one Surah',
  stored !== null &&
    JSON.stringify(stored.surah_ids) === JSON.stringify([1]) &&
    stored.teaching_mode === 'multi_dimension' &&
    JSON.stringify(stored.dimensions?.branch_ids) === JSON.stringify([S.branchId]) &&
    JSON.stringify(stored.dimensions?.category_ids) === JSON.stringify([S.categoryId]) &&
    JSON.stringify(stored.dimensions?.level_ids) === JSON.stringify([S.levelId]) &&
    stored.dimensions?.administrative_group_ids.length === 0 &&
    stored.dimensions?.teaching_group_ids.length === 0 &&
    stored.branch_id === S.branchId,
  JSON.stringify(stored),
);
check(
  '5g · and it is CALLED what it is: type — Subject — Surah — when (a one-off carries its date)',
  stored !== null &&
    typeof stored.title === 'string' &&
    stored.title.startsWith(CLASS_TYPE + ' — [dev-scenario] تفسير القرآن — الفاتحة') &&
    /\d{4}-\d{2}-\d{2} 07:00$/.test(stored.title),
  JSON.stringify({ title: stored?.title }),
);
check(
  '5d · the list names WHO the class is for — never «أبعاد متعددة»',
  stored !== null &&
    typeof stored.target_name === 'string' &&
    stored.target_name.includes('[dev-scenario] وميض الأمل') &&
    stored.target_name.includes('[dev-scenario] تاركة') &&
    (stored.rowText ?? '').includes('[dev-scenario] وميض الأمل') &&
    !(stored.rowText ?? '').includes('أبعاد متعددة'),
  JSON.stringify(stored),
);

/* ── Journey B — «هذه الحصة وكل ما بعدها»: the same five filters ───────────
 *
 * The seeded class is addressed to ONE Administrative Group (created before
 * Revision 163). Its «from this date onward» editor must open on that, said in
 * the new vocabulary — and must not lose the Subject it opened with while the
 * group list is still arriving.
 */
await send('Page.navigate', { url: `${BASE}/admin/schedules/${S.scheduleId}/sessions` });
await new Promise((r) => setTimeout(r, 5000));

const editor = await page(`
  // The SECOND occurrence: this journey is about a predecessor that KEEPS part
  // of its life. A split at the very first occurrence is journey C below.
  const edits = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'تعديل');
  const edit = edits[1];
  if (!edit) return { noSecondOccurrence: true, found: edits.length };
  edit.click();
  await wait(1500);
  if (!dlg()) return { noDialog: true };
  const radio = dlg().querySelector('input[type="radio"][value="this_and_future"]');
  if (!radio) return { noScopeRadio: true };
  radio.click();
  await wait(2500);
  const labels = [...dlg().querySelectorAll('.field__label')].map((l) => l.textContent.trim());
  const summary = (name) => fieldOf(name)?.querySelector('button.dropdown-trigger')?.textContent.trim() ?? null;
  const subject = fieldOf('المادة')?.querySelector('select');
  return {
    modeAsked: labels.some((l) => l.indexOf('نمط التدريس') === 0),
    branches: summary('فروع'),
    levels: summary('مستويات'),
    groups: summary('مجموعات'),
    circles: summary('حلقات'),
    surahs: summary('السور'),
    subjectKept: subject ? subject.value === ${JSON.stringify(S.subjectId)} : null,
  };
`);
check(
  'B1 · the «from this date onward» editor asks no «نمط التدريس» and opens on the class as it stands — its branch and its one group',
  editor.modeAsked === false &&
    editor.branches === '[dev-scenario] تاركة' &&
    editor.groups === '[dev-scenario] المجموعة 1' &&
    editor.levels === 'الكل' &&
    editor.circles === 'الكل',
  JSON.stringify(editor),
);
check(
  'B2 · and keeps the Subject it opened with while the group list arrives',
  editor.subjectKept === true,
  JSON.stringify(editor),
);
check(
  'B2b · «السور» opens on the class’s own Surah',
  editor.surahs === 'الفاتحة',
  JSON.stringify({ surahs: editor.surahs }),
);

const split = await page(`
  // The PATCH's own answer, so a refusal is read rather than guessed at.
  const seen = [];
  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await realFetch.apply(this, arguments);
    if (init && init.method === 'PATCH') {
      seen.push({ status: response.status, body: await response.clone().text().catch(() => '') });
    }
    return response;
  };
  const save = [...dlg().querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  // First with the year unchosen: the editor must NAME it, not send an empty id.
  const yearBefore = fieldOf('السنة الدراسية')?.querySelector('select')?.value ?? null;
  let namedTheYear = null;
  if (yearBefore === '') {
    save.click();
    await wait(900);
    namedTheYear = seen.length === 0 && (dlg()?.textContent ?? '').includes('السنة');
    setSelect('السنة الدراسية', (o) => o.value !== '');
    await wait(400);
  }
  save.click();
  await wait(4500);
  window.fetch = realFetch;
  const r = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: '{}',
  });
  const { access_token } = await r.json();
  const res = await fetch('/api/v1/admin/course-schedules?page_size=100', {
    headers: { Authorization: 'Bearer ' + access_token },
  });
  // The successor carries the OCCURRENCE's title, not the scenario's tag, so it
  // is found by the id the split itself answered with.
  let successorId = null;
  try { successorId = JSON.parse(seen[seen.length - 1]?.body ?? '{}').schedule?.id ?? null; } catch { successorId = null; }
  const rows = (await res.json()).data.filter((x) => x.id === ${JSON.stringify(S.scheduleId)} || x.id === successorId);
  return {
    closed: dlg() === null,
    namedTheYear,
    patch: seen.map((x) => ({ status: x.status, body: x.body.slice(0, 400) })),
    tail: (dlg()?.textContent ?? '').split(' ').join(' ').slice(-260),
    rows: rows.map((x) => ({ id: x.id, mode: x.teaching_mode, dims: x.dimensions, until: x.effective_until, target: x.target_name, surahs: x.surah_ids })),
  };
`);
const successor = (split.rows ?? []).find((r) => r.id !== S.scheduleId);
const predecessor = (split.rows ?? []).find((r) => r.id === S.scheduleId);
check(
  'B3a · an unchosen year is named on screen — no request leaves with an empty id',
  split.namedTheYear === null || split.namedTheYear === true,
  JSON.stringify({ namedTheYear: split.namedTheYear, patch: split.patch }),
);
check(
  'B3 · the split saves: the predecessor keeps its own group target and is closed; the successor is filter-built on the same group',
  split.closed === true &&
    predecessor?.mode === 'administrative_group' &&
    predecessor?.until !== null &&
    successor?.mode === 'multi_dimension' &&
    JSON.stringify(successor?.surahs) === JSON.stringify([1]) &&
    JSON.stringify(successor?.dims?.administrative_group_ids) === JSON.stringify([S.groupId]) &&
    JSON.stringify(successor?.dims?.branch_ids) === JSON.stringify([S.branchId]),
  JSON.stringify(split),
);

/* ── Journey C — a split at a class's FIRST session (SRS Revision 165 §4) ────
 *
 * «هذه الحصة وكل ما بعدها» chosen on the first occurrence would have closed the
 * class the day before it began; the database refuses that, and the refusal
 * reached her as a bare 500. It now means what she meant — the whole series —
 * and leaves ONE class behind, not an empty one beside its replacement.
 */
if (successor) {
  await send('Page.navigate', { url: `${BASE}/admin/schedules/${successor.id}/sessions` });
  await new Promise((r) => setTimeout(r, 5000));
  const first = await page(`
    const seen = [];
    const realFetch = window.fetch;
    window.fetch = async function (input, init) {
      const response = await realFetch.apply(this, arguments);
      if (init && init.method === 'PATCH') {
        seen.push({ status: response.status, body: await response.clone().text().catch(() => '') });
      }
      return response;
    };
    const edit = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
    if (!edit) return { noOccurrence: true };
    edit.click();
    await wait(1500);
    const radio = dlg()?.querySelector('input[type="radio"][value="this_and_future"]');
    if (!radio) return { noScopeRadio: true };
    radio.click();
    await wait(2500);
    if ((fieldOf('السنة الدراسية')?.querySelector('select')?.value ?? '') === '') {
      setSelect('السنة الدراسية', (o) => o.value !== '');
      await wait(400);
    }
    [...dlg().querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ').click();
    await wait(4500);
    window.fetch = realFetch;
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}',
    });
    const { access_token } = await r.json();
    const res = await fetch('/api/v1/admin/course-schedules?page_size=100', {
      headers: { Authorization: 'Bearer ' + access_token },
    });
    const live = (await res.json()).data.map((x) => x.id);
    let replacementId = null;
    try { replacementId = JSON.parse(seen[seen.length - 1]?.body ?? '{}').schedule?.id ?? null; } catch { replacementId = null; }
    return {
      closed: dlg() === null,
      statuses: seen.map((x) => x.status),
      emptiedClassStillListed: live.includes(${JSON.stringify(successor.id)}),
      replacementListed: replacementId !== null && live.includes(replacementId),
      replacementId,
      // Read only when it failed: what the dialog is saying instead of closing.
      tail: (dlg()?.textContent ?? '').replace(/\\s+/g, ' ').slice(-300),
    };
  `);
  check(
    'C1 · a split at the class’s FIRST session saves — no 500 — and leaves one class, not an empty one beside it',
    first.closed === true &&
      JSON.stringify(first.statuses) === JSON.stringify([200]) &&
      first.emptiedClassStillListed === false &&
      first.replacementListed === true,
    JSON.stringify(first),
  );

  /* ── Journey D — «تعديل الحصة» changes EVERYTHING about one session ─────────
   *
   * SRS Revision 166 §2. Who the session is for (branch, Category, Level, group,
   * circle) and who takes it lived behind two other row actions, so the edit
   * dialog looked as though it could not change them. It offers them now, and
   * ONE «حفظ» sends whatever changed — here, the audience and nothing else.
   */
  if (first.replacementId) {
    await send('Page.navigate', { url: `${BASE}/admin/schedules/${first.replacementId}/sessions` });
    await new Promise((r) => setTimeout(r, 5000));
    const one = await page(`
      const seen = [];
      const realFetch = window.fetch;
      window.fetch = async function (input, init) {
        const response = await realFetch.apply(this, arguments);
        if (init && init.method === 'PATCH') {
          seen.push({ status: response.status, sent: String(init.body ?? ''), url: String(input) });
        }
        return response;
      };
      const edit = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
      if (!edit) return { noOccurrence: true };
      edit.click();
      await wait(3500);
      if (!dlg()) return { noDialog: true };
      // «هذه الحصة فقط» is the scope the dialog opens on.
      const labels = [...dlg().querySelectorAll('.field__label, legend')].map((l) => l.textContent.trim());
      const has = (name) => labels.some((l) => l.indexOf(name) === 0);
      const titleInput = fieldOf('العنوان')?.querySelector('input') ?? null;
      const before = ['فروع', 'فئات', 'مستويات', 'مجموعات', 'حلقات'].map((name) =>
        fieldOf(name)?.querySelector('button.dropdown-trigger')?.textContent.trim() ?? null);
      // Add the scenario's Level to THIS session's audience, and change nothing else.
      const level = await multi('مستويات', '[dev-scenario] وميض الأمل');
      await wait(500);
      [...dlg().querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ').click();
      await wait(4500);
      window.fetch = realFetch;
      let sent = null;
      try { sent = JSON.parse(seen[seen.length - 1]?.sent ?? 'null'); } catch { sent = null; }
      return {
        offered: {
          audience: ['فروع', 'فئات', 'مستويات', 'مجموعات', 'حلقات'].every(has),
          subject: has('المادة'),
          surahs: has('السور'),
          staff: has('من يؤطِّر هذه الحصة'),
          audienceLegend: has('لمن هذه الحصة'),
        },
        titleIsAsked: titleInput !== null,
        titleIsShown: (dlg()?.textContent ?? '').includes(${JSON.stringify(CLASS_TYPE + ' — [dev-scenario] تفسير القرآن')}) || seen.length > 0,
        before,
        ticked: level.ticked,
        closed: dlg() === null,
        patches: seen.map((x) => ({ status: x.status, url: x.url.split('/api/v1')[1] ?? x.url })),
        sentKeys: sent ? Object.keys(sent).sort() : null,
        sentAudience: sent?.audience ?? null,
        sentStaff: sent ? 'staff' in sent : null,
      };
    `);
    check(
      'D1 · «تعديل الحصة» offers, for this ONE session: its audience (all five), its Subject, its Surah and who takes it',
      one.offered?.audience === true &&
        one.offered?.subject === true &&
        one.offered?.surahs === true &&
        one.offered?.staff === true &&
        one.offered?.audienceLegend === true,
      JSON.stringify({ offered: one.offered, before: one.before }),
    );
    check(
      'D2 · and asks for no «العنوان» — the session’s title is shown, composed',
      one.titleIsAsked === false,
      JSON.stringify({ titleIsAsked: one.titleIsAsked }),
    );
    check(
      'D3 · ONE save, to the session itself, carrying the audience she changed — and not the staff she did not',
      one.ticked === true &&
        one.closed === true &&
        one.patches?.length === 1 &&
        one.patches[0].status === 200 &&
        /^\/sessions\/[0-9a-f-]+$/.test(one.patches[0].url) &&
        Array.isArray(one.sentAudience?.level_ids) &&
        one.sentAudience.level_ids.includes(S.levelId) &&
        one.sentStaff === false,
      JSON.stringify({ patches: one.patches, sentKeys: one.sentKeys, audience: one.sentAudience }),
    );
  } else {
    check('D1 · «تعديل الحصة» offers everything about one session', false, 'journey C produced no class to open');
  }
} else {
  check('C1 · a split at the class’s FIRST session saves', false, 'journey B produced no successor to split');
}

close();
process.exit(finish());
