/**
 * **إدخال الحفظ — driven, not asserted** (Section C §C19–§C23, §C32).
 *
 * The Owner's definition of done for this section is explicit: record progress
 * **through the real form**, then **log in as the actual beneficiary** and see
 * the bar and the history. Nothing here inserts a `QuranProgressLog`; the DB is
 * used to build the fixture and to check what the product wrote afterwards.
 *
 * Nine identities, because the whole point is that they reach different
 * beneficiaries from one screen: the Admin, the whole-Level مؤطِّرة, her
 * assistant, the Group's, the Circle's, the Tafseer-only one who must reach
 * nobody, R91's finished and current pair, and the beneficiary herself.
 *
 * **Every negative check asserts a 200 first.** An empty roster from a failed
 * request is not proof of an empty roster — this project has shipped that
 * defect repeatedly, and §C29 is the rule it produced.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.QURAN_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9251');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth/refresh', httpOnly: true,
  });
}

/** One refresh per identity, bearer kept — TD-4.13's reuse detection. */
async function tokenFor(cookie) {
  await beIdentity(cookie);
  const res = await evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    return JSON.stringify({ status: r.status, body: await r.text() });
  })()`);
  const parsed = JSON.parse(res);
  if (parsed.status !== 200) throw new Error(`refresh failed: ${parsed.status}`);
  return JSON.parse(parsed.body).access_token;
}

const json = async (token, path) => {
  const raw = await evaluate(`(async () => {
    const res = await fetch('/api/v1' + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + ${JSON.stringify(token)} },
    });
    return { status: res.status, body: await res.text() };
  })()`);
  return { status: raw.status, ...JSON.parse(raw.body || '{}') };
};

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1400));
}

/**
 * **Fill the shared entry form and save it — the action under test.**
 *
 * Selects by the option's own text so the harness exercises what a person sees,
 * and returns what the screen said afterwards rather than reading the database.
 * React controls these inputs, so each change is dispatched through the native
 * value setter — assigning `.value` directly updates the DOM and leaves React's
 * state untouched, which makes a form look filled and submit empty.
 */
async function fillAndSave({ surah, from, to, category, level }) {
  return evaluate(`(async () => {
    const setValue = (el, value) => {
      const proto = el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const fieldByLabel = (text) => {
      const label = [...document.querySelectorAll('label')]
        .find((l) => l.textContent.trim().startsWith(text));
      if (!label) return null;
      const id = label.getAttribute('for');
      return id ? document.getElementById(id) : label.querySelector('input, select');
    };

    const levelSel = fieldByLabel('المستوى');
    const wantedLevel = ${JSON.stringify(level ?? null)};
    if (levelSel && wantedLevel) {
      const opt = [...levelSel.options].find((o) => o.textContent.includes(wantedLevel));
      if (!opt) return { noLevelOption: [...levelSel.options].map((o) => o.textContent) };
      setValue(levelSel, opt.value);
      await new Promise((r) => setTimeout(r, 700));
    }

    const surahSel = fieldByLabel('السورة');
    if (!surahSel) return { noSurahField: true };
    const surahOpt = [...surahSel.options].find((o) => o.textContent.includes(${JSON.stringify(surah)}));
    if (!surahOpt) return { noSurahOption: [...surahSel.options].map((o) => o.textContent) };
    setValue(surahSel, surahOpt.value);
    await new Promise((r) => setTimeout(r, 500));

    setValue(fieldByLabel('من الآية'), ${JSON.stringify(String(from))});
    setValue(fieldByLabel('إلى الآية'), ${JSON.stringify(String(to))});

    const cat = fieldByLabel('النوع');
    const catOpt = [...cat.options].find((o) => o.textContent.includes(${JSON.stringify(category)}));
    setValue(cat, catOpt.value);
    await new Promise((r) => setTimeout(r, 400));

    const save = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'تسجيل المقطع');
    if (!save) return { noSaveButton: true };
    if (save.disabled) return { saveDisabled: true };
    save.click();
    await new Promise((r) => setTimeout(r, 3000));

    const bars = [...document.querySelectorAll('[role="progressbar"]')].map((b) => ({
      label: b.getAttribute('aria-label'),
      now: b.getAttribute('aria-valuenow'),
    }));
    return {
      saved: true,
      feedback: document.querySelector('[role="status"], [role="alert"]')?.textContent?.trim() ?? '',
      bars,
      rows: document.querySelectorAll('.admin-table tbody tr').length,
    };
  })()`);
}

/**
 * The roster the workspace actually offers, read off the rendered table.
 *
 * **Whole rows, not `td:first-child`.** `DataTable` puts its row actions in a
 * cell too and may reorder columns, so pinning the name to a position ties this
 * harness to a layout choice rather than to what a reader sees.
 */
const rosterOnScreen = () => evaluate(`(() => {
  const rows = [...document.querySelectorAll('table tbody tr')];
  return {
    names: rows.map((r) => r.textContent.trim()),
    tables: document.querySelectorAll('table').length,
    state: document.querySelector('.state')?.textContent?.trim() ?? null,
    error: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  };
})()`);

// Park the page once and let the SPA finish its own boot refresh.
await send('Page.navigate', { url: `${BASE}/content-unavailable` });
await new Promise((r) => setTimeout(r, 2500));

/* ── 1–4 · the Admin records memorisation on the real form ───────────────── */

const adminToken = await tokenFor(process.env.ADMIN_COOKIE);
await beIdentity(process.env.ADMIN_COOKIE);
await open('/admin/quran', '.admin-table, .state');

const adminRoster = await rosterOnScreen();
check(
  '1 · the back office reaches إدخال الحفظ and lists beneficiaries',
  adminRoster.names.some((n) => n.includes('حفصة')) && adminRoster.error === null,
  JSON.stringify(adminRoster).slice(0, 260),
);

// **A beneficiary, not a User.** The staff accounts in this fixture are Users
// with roles and must never be candidates for memorisation entry.
check(
  '2 · and offers no مؤطرة or administrator as a candidate',
  !adminRoster.names.some((n) => n.includes('مؤطرة') || n.includes('مساعدة')),
  JSON.stringify(adminRoster.names).slice(0, 300),
);

await open(`/admin/quran?student=${S.hafsa}`, '.form, .state');
const adminSaved = await fillAndSave({
  surah: 'الفاتحة', from: 1, to: 4, category: 'حفظ جديد',
});
check(
  '3 · the Admin saves حفظ جديد through the form',
  adminSaved.saved === true && /سُجّل/.test(adminSaved.feedback ?? ''),
  JSON.stringify(adminSaved).slice(0, 300),
);
check(
  '4 · and the bar updates immediately — 4 of 7 ayahs is 57.14%',
  (adminSaved.bars ?? []).some((b) => b.label?.includes('الفاتحة') && b.now === '57.14'),
  JSON.stringify(adminSaved.bars ?? adminSaved).slice(0, 260),
);

/* ── 5–8 · the beneficiary sees it in حفظي, and it survives a reload ─────── */

await tokenFor(process.env.HAFSA_COOKIE);
await beIdentity(process.env.HAFSA_COOKIE);
await open('/dashboard/student/quran', 'main');

const hersFirst = await evaluate(`(() => ({
  bars: [...document.querySelectorAll('[role="progressbar"]')].map((b) => ({
    label: b.getAttribute('aria-label'),
    now: b.getAttribute('aria-valuenow'),
    min: b.getAttribute('aria-valuemin'),
    max: b.getAttribute('aria-valuemax'),
  })),
  history: [...document.querySelectorAll('.admin-table tbody tr')].map((r) => r.textContent.trim()),
  error: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
}))()`);

check(
  '5 · حفظي shows her syllabus as bars, with the full ARIA contract',
  hersFirst.error === null &&
    hersFirst.bars.some((b) => b.label?.includes('الفاتحة') && b.now === '57.14') &&
    hersFirst.bars.every((b) => b.min === '0' && b.max === '100'),
  JSON.stringify(hersFirst.bars).slice(0, 320),
);
check(
  '6 · including the syllabus Surah she has not started — البقرة at 0',
  hersFirst.bars.some((b) => b.label?.includes('البقرة') && b.now === '0'),
  JSON.stringify(hersFirst.bars).slice(0, 320),
);
check(
  '7 · and the history carries the entry the Admin just made',
  hersFirst.history.some((r) => r.includes('حفظ جديد') && r.includes('الفاتحة') && r.includes('1')),
  JSON.stringify(hersFirst.history).slice(0, 300),
);

await open('/dashboard/student/quran', 'main');
const afterReload = await evaluate(`(() =>
  [...document.querySelectorAll('[role="progressbar"]')]
    .map((b) => b.getAttribute('aria-label') + '=' + b.getAttribute('aria-valuenow'))
)()`);
check(
  '8 · a reload shows the same state — it was persisted, not held in the page',
  afterReload.some((b) => b.includes('الفاتحة') && b.includes('57.14')),
  JSON.stringify(afterReload).slice(0, 260),
);

/* ── 9–13 · the مؤطِّرة: her scope, her entry, and مراجعة ─────────────────── */

const nawalToken = await tokenFor(process.env.NAWAL_COOKIE);
await beIdentity(process.env.NAWAL_COOKIE);
await open('/teacher/quran', '.admin-table, .state');

const nawalRoster = await rosterOnScreen();
// R92 — today's occurrence is combined, so زينب (فرع ب) IS legitimately hers.
check(
  '9 · whole-Level scope: her Level at her branch, plus today’s combined branch',
  nawalRoster.error === null &&
    nawalRoster.names.some((n) => n.includes('حفصة')) &&
    nawalRoster.names.some((n) => n.includes('زينب')),
  JSON.stringify(nawalRoster.names).slice(0, 300),
);
/**
 * **Restated after it failed against correct behaviour.**
 *
 * This first asserted that the Group's and the Circle's beneficiaries were
 * absent from the whole-Level roster. They are not, and must not be: خديجة and
 * مريم are enrolled in **Level 1 at فرع أ**, which is exactly the audience
 * §C7 gives a whole-Level class. Sitting in an Administrative Group or a Circle
 * as well does not take a beneficiary out of her Level.
 *
 * The narrowness worth pinning is the one that distinguishes a مؤطِّرة from an
 * Admin: her roster is bounded by **what she teaches**, so the beneficiaries the
 * back office listed at check 1 — other Levels entirely — are not hers.
 */
check(
  '10 · and her roster is bounded by what she teaches, unlike the Admin’s',
  nawalRoster.names.every((n) => n.includes('[quran-c]')) &&
    nawalRoster.names.length < adminRoster.names.length,
  JSON.stringify({ teacher: nawalRoster.names.length, admin: adminRoster.names.length }),
);

await open(`/teacher/quran?student=${S.hafsa}`, '.form, .state');
const nawalSaved = await fillAndSave({
  surah: 'الفاتحة', from: 5, to: 7, category: 'حفظ جديد',
});
check(
  '11 · the مؤطِّرة records حفظ جديد, and the union reaches 100%',
  (nawalSaved.bars ?? []).some((b) => b.label?.includes('الفاتحة') && b.now === '100'),
  JSON.stringify(nawalSaved).slice(0, 300),
);

const beforeRevision = (nawalSaved.bars ?? []).find((b) => b.label?.includes('الفاتحة'))?.now;
const revised = await fillAndSave({
  surah: 'الفاتحة', from: 1, to: 7, category: 'مراجعة',
});
check(
  '12 · مراجعة is recorded — the history grows',
  revised.saved === true && (revised.rows ?? 0) > (nawalSaved.rows ?? 0),
  JSON.stringify({ before: nawalSaved.rows, after: revised.rows, feedback: revised.feedback }),
);
check(
  '13 · and it does NOT inflate the memorisation percentage',
  (revised.bars ?? []).some((b) => b.label?.includes('الفاتحة') && b.now === beforeRevision),
  JSON.stringify({ beforeRevision, after: revised.bars ?? revised }).slice(0, 260),
);

/* ── 14 · the assistant has the same operational reach ───────────────────── */

const houdaToken = await tokenFor(process.env.HOUDA_COOKIE);
await beIdentity(process.env.HOUDA_COOKIE);
await open(`/teacher/quran?student=${S.hafsa}`, '.form, .state');
const assistantSaved = await fillAndSave({
  surah: 'البقرة', from: 1, to: 10, category: 'حفظ جديد',
});
check(
  '14 · an assistant records progress exactly as the main مؤطِّرة does (§C6)',
  (assistantSaved.bars ?? []).some((b) => b.label?.includes('البقرة') && b.now !== '0'),
  JSON.stringify(assistantSaved).slice(0, 300),
);

/* ── 15–17 · Group, Circle and the unrelated Subject ─────────────────────── */

const samiraToken = await tokenFor(process.env.SAMIRA_COOKIE);
await beIdentity(process.env.SAMIRA_COOKIE);
await open('/teacher/quran', '.admin-table, .state');
const samiraRoster = await rosterOnScreen();
check(
  '15 · an Administrative Group class reaches its members only',
  samiraRoster.error === null &&
    samiraRoster.names.some((n) => n.includes('خديجة')) &&
    !samiraRoster.names.some((n) => n.includes('حفصة')),
  JSON.stringify(samiraRoster.names).slice(0, 300),
);

const latifaToken = await tokenFor(process.env.LATIFA_COOKIE);
await beIdentity(process.env.LATIFA_COOKIE);
await open('/teacher/quran', '.admin-table, .state');
const latifaRoster = await rosterOnScreen();
check(
  '16 · a Teaching Circle class reaches its seated members only',
  latifaRoster.error === null &&
    latifaRoster.names.some((n) => n.includes('مريم')) &&
    !latifaRoster.names.some((n) => n.includes('حفصة')),
  JSON.stringify(latifaRoster.names).slice(0, 300),
);

/**
 * **رجاء teaches Tafseer and DECLARES Quran (R88).** The menu must not offer
 * إدخال الحفظ at all, and the endpoint must answer an empty roster — asserted
 * only after confirming the read returned 200, per §C31.
 */
const rajaaToken = await tokenFor(process.env.RAJAA_COOKIE);
await beIdentity(process.env.RAJAA_COOKIE);
await open('/teacher', 'main');
const rajaaMenu = await evaluate(`(() =>
  [...document.querySelectorAll('nav a')].map((a) => a.textContent.trim())
)()`);
const rajaaScope = await json(rajaaToken, '/quran-students');
check(
  '17 · Tafseer-only + a DECLARED Quran capability grants nothing (200, empty)',
  !rajaaMenu.some((m) => m.includes('إدخال الحفظ')) &&
    rajaaScope.status === 200 &&
    (rajaaScope.data?.students ?? []).length === 0,
  JSON.stringify({ menu: rajaaMenu, status: rajaaScope.status, n: rajaaScope.data?.students?.length }).slice(0, 300),
);

/* ── 18–19 · R91: the effective مؤطِّرة acts, the finished one does not ───── */

const aminaToken = await tokenFor(process.env.AMINA_COOKIE);
await beIdentity(process.env.AMINA_COOKIE);
await open('/teacher/quran', '.admin-table, .state');
const aminaRoster = await rosterOnScreen();
check(
  '18 · R91 — the مؤطِّرة effective TODAY reaches the Level 2 beneficiary',
  aminaRoster.error === null && aminaRoster.names.some((n) => n.includes('سلمى')),
  JSON.stringify(aminaRoster.names).slice(0, 300),
);

const safaToken = await tokenFor(process.env.SAFA_COOKIE);
await beIdentity(process.env.SAFA_COOKIE);
const safaScope = await json(safaToken, '/quran-students');
const safaWrite = await evaluate(`(async () => {
  const res = await fetch('/api/v1/quran-logs', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + ${JSON.stringify(safaToken)},
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      student_id: ${JSON.stringify(S.salma)},
      level_id: ${JSON.stringify(S.levelTwo)},
      surah_id: 1, start_ayah: 1, end_ayah: 3, category: 'new_memorization',
    }),
  });
  return { status: res.status, body: await res.text() };
})()`);
check(
  '19 · R91 — whose period ENDED yesterday reaches nobody, and a forged write is refused',
  safaScope.status === 200 &&
    (safaScope.data?.students ?? []).length === 0 &&
    safaWrite.status === 404,
  JSON.stringify({ read: safaScope.status, n: safaScope.data?.students?.length, write: safaWrite.status }),
);

/* ── 20–21 · R92: the combined occurrence, and the roster that narrows ──── */

const zinebFromNawal = await json(nawalToken, '/quran-students');
check(
  '20 · R92 — the visiting branch is reachable for the combined occurrence (200)',
  zinebFromNawal.status === 200 &&
    (zinebFromNawal.data?.students ?? []).some((s) => s.id === S.zineb),
  JSON.stringify({ status: zinebFromNawal.status, n: zinebFromNawal.data?.students?.length }),
);

/**
 * **And it does not become permanent.** The combination is a fact about ONE
 * occurrence: removing today's override leaves the ordinary next-week lesson,
 * and زينب must disappear from the roster without any enrolment changing.
 */
const dropped = await evaluate(`(async () => {
  const res = await fetch('/api/v1/sessions/' + ${JSON.stringify(S.combined)} + '/audience-branches', {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + ${JSON.stringify(adminToken)},
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: ${JSON.stringify(S.combinedVersion ?? 0)}, branch_ids: [] }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 200) };
})()`);
const afterDrop = await json(nawalToken, '/quran-students');
check(
  '21 · R92 — with the combination gone, the visitor is no longer in her roster',
  afterDrop.status === 200 &&
    !(afterDrop.data?.students ?? []).some((s) => s.id === S.zineb) &&
    (afterDrop.data?.students ?? []).some((s) => s.id === S.hafsa),
  JSON.stringify({ drop: dropped.status, status: afterDrop.status, n: afterDrop.data?.students?.length }).slice(0, 260),
);

/* ── 22–24 · multiple Levels, and the curriculum as the authority ────────── */

await tokenFor(process.env.SALMA_COOKIE);
await beIdentity(process.env.SALMA_COOKIE);
await open('/dashboard/student/quran', 'main');
const salmaView = await evaluate(`(() => ({
  headings: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()),
  bars: [...document.querySelectorAll('[role="progressbar"]')].map((b) => b.getAttribute('aria-label')),
  error: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
}))()`);
check(
  '22 · حفظي groups two Levels under «{الفئة} — {المستوى}» and keeps them apart',
  salmaView.error === null &&
    salmaView.headings.filter((h) => h.includes('المستوى')).length === 2 &&
    salmaView.headings.some((h) => h.includes('—')),
  JSON.stringify(salmaView.headings).slice(0, 300),
);
check(
  '23 · and الفاتحة appears under BOTH curricula rather than once, merged',
  salmaView.bars.filter((b) => b?.includes('الفاتحة')).length === 2,
  JSON.stringify(salmaView.bars).slice(0, 300),
);

/**
 * **A forged Surah is refused by the server, not merely absent from the form.**
 * الناس belongs to Level 2's syllabus and not to Level 1's, so naming it against
 * Level 1 must be refused even though the same مؤطِّرة may write to that Level.
 */
const forged = await evaluate(`(async () => {
  const res = await fetch('/api/v1/quran-logs', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + ${JSON.stringify(adminToken)},
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      student_id: ${JSON.stringify(S.salma)},
      level_id: ${JSON.stringify(S.levelOne)},
      surah_id: 114, start_ayah: 1, end_ayah: 3, category: 'new_memorization',
    }),
  });
  return { status: res.status, body: await res.text() };
})()`);
check(
  '24 · §C24 — a Surah outside the named Level’s syllabus is refused server-side',
  forged.status === 400 && forged.body.includes('SURAH_NOT_IN_LEVEL'),
  JSON.stringify(forged).slice(0, 260),
);

await close();
finish();
