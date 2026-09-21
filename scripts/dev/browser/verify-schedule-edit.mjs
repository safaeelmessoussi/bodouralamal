/**
 * **The «تعديل العنصر» edit flow, in a real browser.**
 *
 * Reported 2026-08-18: open a class, change only «نهاية التكرار», press «حفظ» —
 * and get *«اختاري الحلقة المعنية»* beside a الحلقة selector reading *«لا حلقات
 * لهذا المستوى في هذا الفرع»*, with every scope field locked so there is no way
 * to satisfy it. Editing a class was impossible.
 *
 * The unit guards pin the two mapping decisions that caused it. Only a browser
 * can show the third fact: that the form, with those decisions made correctly,
 * actually **opens populated and saves**.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9225');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 80; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      const seededRow = [...document.querySelectorAll('.admin-table tbody tr')]
        .find((tr) => tr.textContent.includes('[dev-scenario]'));
      if (seededRow) return 'ready';
      return 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

const state = await goto('/admin/schedules');
check('the scheduling screen loads with rows', state === 'ready', `state=${state}`);
if (state !== 'ready') {
  close();
  process.exit(finish());
}

/** Opens «تعديل» on the seeded class and reports what the form was seeded with. */
const opened = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')]
    .find((tr) => tr.textContent.includes('[dev-scenario]'));
  if (!row) return { found: false };
  const edit = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
  edit.click();
  // Until the form has its options, not for a fixed time: the scope read is a
  // request, and on a busy machine 2.5 s was read as an unseeded form.
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const open = document.querySelector('dialog[open], .dialog');
    const seeded = open && [...open.querySelectorAll('select')].some((sel) => {
      const label = sel.closest('.field')?.querySelector('label')?.textContent ?? '';
      return label.includes('الحلقة') && sel.options.length > 1 && sel.value !== '';
    });
    if (seeded) break;
  }
  const dialog = document.querySelector('dialog[open], .dialog');
  const selects = [...dialog.querySelectorAll('select')].map((sel) => ({
    label: sel.closest('.field')?.querySelector('label')?.textContent?.trim() ?? '',
    value: sel.value,
    selected: sel.options[sel.selectedIndex]?.textContent?.trim() ?? '',
    count: sel.options.length,
    disabled: sel.disabled,
  }));
  return { found: true, selects };
})()`);
check('the edit dialog opens on the seeded class', opened.found === true);

const byLabel = (needle) => (opened.selects ?? []).find((s) => s.label.includes(needle));
const modeSel = byLabel('نمط');
const groupSel = byLabel('الحلقة');
const levelSel = byLabel('المستوى');

// SRS Revision 163 §5 — «نمط التدريس» is asked nowhere. The row's own mode is
// still what is SENT on save (asserted at the end, against the database); on
// screen, the class's target is stated by the locked الحلقة select below.
check(
  'no «نمط التدريس» select is rendered — the mode is the row’s own and is never offered',
  modeSel === undefined,
  JSON.stringify(modeSel),
);
check(
  'the المستوى select is seeded (it is what narrows the الحلقة list)',
  levelSel !== undefined && levelSel.value === S.levelId,
  JSON.stringify(levelSel),
);
check(
  'the الحلقة select is populated and holds the class’s own group',
  groupSel !== undefined && groupSel.value === S.groupId && groupSel.count > 1,
  JSON.stringify(groupSel),
);
check(
  'no «لا حلقات لهذا المستوى في هذا الفرع» on screen',
  !(groupSel?.selected ?? '').includes('لا حلقات'),
  groupSel?.selected,
);

/** The reported action: change ONLY «نهاية التكرار», then save. */
const saved = await evaluate(`(async () => {
  const dialog = document.querySelector('dialog[open], .dialog');
  /**
   * **By its LABEL, not by position** (restated 2026-08-19).
   *
   * This took the LAST date input on the form. R91 gave a class a staffing
   * editor whose rows each carry «من تاريخ» and «إلى تاريخ», so the last date
   * input became a staffing period — the harness edited that instead, saved
   * successfully, and then correctly reported that the recurrence end had not
   * changed. A green save and a red assertion, both describing the wrong field.
   *
   * The property is unchanged and the selector is.
   */
  /**
   * **Through the date picker the form really has** (restated 2026-09-20).
   *
   * This wrote into a native date input, which the platform's own picker
   * replaced: there is no such input any more, so nothing was found and the
   * harness died reading a property of undefined before reaching a single
   * assertion about saving. (No backticks here: this is a template literal.) The field is still found by its LABEL; the
   * date is chosen the way a person chooses it — open, step month by month, and
   * press the day, whose button carries its own ISO date in its id.
   */
  const field = [...dialog.querySelectorAll('.field')].find((f) => {
    const l = f.querySelector('.field__label');
    return l && l.textContent.trim().includes('نهاية');
  });
  const label = field?.querySelector('.field__label')?.textContent?.trim() ?? '';
  const trigger = field?.querySelector('.date-picker__trigger');
  let picked = false;
  if (trigger) {
    trigger.click();
    await new Promise((r) => setTimeout(r, 350));
    for (let step = 0; step < 36 && !picked; step += 1) {
      const day = field.querySelector('button[id$="-d-2027-06-30"]');
      if (day) {
        day.click();
        picked = true;
        break;
      }
      const next = [...field.querySelectorAll('.date-picker__head button')]
        .find((b) => (b.getAttribute('aria-label') ?? '') === 'الشهر التالي');
      if (!next) break;
      next.click();
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  const save = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  save.click();
  await new Promise((r) => setTimeout(r, 3000));
  // **What "closed" means here.** The .dialog selector matches a wrapper this
  // app leaves in the tree; the honest signal is whether the form's own heading
  // is still on screen. Probing the wrapper reported an open dialog while the
  // parent was already showing its saved notice behind it.
  // (No backticks in this comment: it lives inside a template literal.)
  const heading = [...document.querySelectorAll('h2, h3, .dialog__title')]
    .map((h) => h.textContent.trim())
    .find((tx) => tx.includes('تعديل') || tx.includes('إضافة'));
  const notice = document.querySelector('.admin-notice, .field__error, [role="alert"]');
  return { label, picked, stillOpen: heading !== undefined, heading: heading ?? null,
           notice: notice ? notice.textContent.trim() : null };
})()`);

check('the field changed was «نهاية التكرار»', saved.label.includes('نهاية'), saved.label);
check('30 June 2027 was chosen in the date picker itself', saved.picked === true, JSON.stringify(saved));
check(
  'saving does NOT refuse with «اختاري الحلقة المعنية»',
  !(saved.notice ?? '').includes('اختاري الحلقة'),
  saved.notice,
);
check('the dialog closes, so the save went through', saved.stillOpen === false, JSON.stringify(saved));

/** And it persisted, with the audience untouched — the serious half. */
const after = await evaluate(`(async () => {
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
  const body = await res.json();
  const row = body.data.find((x) => x.id === ${JSON.stringify(S.scheduleId)});
  return row ? {
    effective_until: row.effective_until,
    teaching_mode: row.teaching_mode,
    target_id: row.target_id,
    level_id: row.level_id,
  } : null;
})()`);

check('the new end date persisted', after?.effective_until === '2027-06-30', JSON.stringify(after));
check(
  'the audience is UNTOUCHED — the mode and target are still the row’s own',
  after?.teaching_mode === 'administrative_group' && after?.target_id === S.groupId,
  JSON.stringify(after),
);
check('the server publishes the Level the class is for', after?.level_id === S.levelId, after?.level_id);

close();
process.exit(finish());
