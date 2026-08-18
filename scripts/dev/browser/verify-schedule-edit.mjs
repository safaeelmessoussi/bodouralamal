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
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 80; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      if (document.querySelector('.admin-table tbody tr')) return 'ready';
      if (document.querySelector('.state')) return 'state';
      return 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login' || state === 'state') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

const state = await goto('/admin/schedules');
check('the scheduling screen loads with rows', state === 'ready', `state=${state}`);

/** Opens «تعديل» on the seeded class and reports what the form was seeded with. */
const opened = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')]
    .find((tr) => tr.textContent.includes('[dev-scenario]'));
  if (!row) return { found: false };
  const edit = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
  edit.click();
  await new Promise((r) => setTimeout(r, 2500));
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

check(
  'the MODE select shows the row’s own mode, not a default',
  modeSel !== undefined && modeSel.value === 'administrative_group',
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
  const dates = [...dialog.querySelectorAll('input[type="date"]')];
  const field = dates[dates.length - 1];
  const label = field.closest('.field')?.querySelector('label')?.textContent?.trim() ?? '';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(field, '2027-06-30');
  field.dispatchEvent(new Event('input', { bubbles: true }));
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
  return { label, stillOpen: heading !== undefined, heading: heading ?? null,
           notice: notice ? notice.textContent.trim() : null };
})()`);

check('the field changed was «نهاية التكرار»', saved.label.includes('نهاية'), saved.label);
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
