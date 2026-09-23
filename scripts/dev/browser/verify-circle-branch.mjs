/**
 * **R172 §15 — a circle is created in a branch, on the real «حلقات المواد» page.**
 *
 * The Owner: «إضافة حلقة should include also branches, as a circle is created
 * in a branch, each branch has its list of circles, same as for groups». This
 * drives the actual screen: the branch column on the seeded circles, the
 * الفرع filter narrowing the table (another branch → nothing), and «إضافة حلقة»
 * with الفرع chosen creating a circle whose row carries that branch.
 *
 * Circles are identified by their **id from the seeder**, never by title.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9229');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

async function goto(path, ready) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
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
    const res = await fetch(${JSON.stringify(`/api/v1${path}`)}, {
      method: ${JSON.stringify(method)},
      headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
      ${body === undefined ? '' : `body: ${JSON.stringify(JSON.stringify(body))},`}
    });
    return { status: res.status, body: await res.text() };
  })()`);

const reached = await goto('/admin/teaching-groups', '.admin-table tbody tr, .state');
check('0 · the page opens signed in', reached === 'ready', reached);

/* ── 1 · the seeded circles carry their branch, on the wire and in the row ── */

const branches = JSON.parse((await api('GET', '/admin/branches?page_size=100')).body).data;
const branchName = branches.find((b) => b.id === S.branchId)?.name ?? '';
const other = branches.find((b) => b.id !== S.branchId);
check('1a · the scenario branch is known by name', branchName !== '', branchName);

const seeded = JSON.parse(
  (await api('GET', `/admin/teaching-groups?page_size=100&level_id=${S.levelId}&subject_id=${S.subjectId}`)).body,
).data;
check(
  '1b · every seeded circle names the scenario branch (branch_id and branch_name)',
  seeded.length === 3 && seeded.every((r) => r.branch_id === S.branchId && r.branch_name === branchName),
  seeded.map((r) => `${r.branch_id === S.branchId}/${r.branch_name}`).join(', '),
);

const rowText = await evaluate(`(async () => {
  const setSelect = async (labelText, value) => {
    const sel = [...document.querySelectorAll('select')]
      .find((s) => (s.closest('.field')?.textContent ?? '').includes(labelText));
    if (!sel) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  };
  await setSelect('تصفية بالمستوى', ${JSON.stringify(S.levelId)});
  await setSelect('تصفية بالمادة', ${JSON.stringify(S.subjectId)});
  await new Promise((r) => setTimeout(r, 1000));
  return [...document.querySelectorAll('.admin-table tbody tr')].map((tr) => tr.textContent);
})()`);
check(
  '1c · the table shows the branch on each seeded row',
  rowText.length === 3 && rowText.every((t) => t.includes(branchName)),
  rowText.join(' | ').slice(0, 200),
);

/* ── 2 · the الفرع filter narrows: this branch keeps them, another has none ── */

const countUnder = async (branchId) =>
  JSON.parse(
    (await api('GET', `/admin/teaching-groups?page_size=100&level_id=${S.levelId}&subject_id=${S.subjectId}&branch_id=${branchId}`)).body,
  ).meta.total;
check('2a · ?branch_id= of the scenario branch keeps all three', (await countUnder(S.branchId)) === 3);
if (other) {
  check(`2b · ?branch_id= of another branch («${other.name}») lists none`, (await countUnder(other.id)) === 0);
  const filtered = await evaluate(`(async () => {
    const sel = [...document.querySelectorAll('select')]
      .find((s) => (s.closest('.field')?.textContent ?? '').includes('تصفية بالفرع'));
    if (!sel) return 'no-filter';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, ${JSON.stringify(other.id)});
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
    // The empty state is itself a row spanning every column (§14.4) — data
    // rows are the ones without a spanning cell.
    return [...document.querySelectorAll('.admin-table tbody tr')].filter((tr) => !tr.querySelector('td[colspan]')).length;
  })()`);
  check('2c · the screen\'s الفرع filter empties the table for another branch', filtered === 0, String(filtered));
} else {
  check('2b · (one branch only on this machine — the "another branch" case is not exercised)', true);
}

/* ── 3 · «إضافة حلقة» asks for الفرع and the new circle carries it ─────── */

await goto('/admin/teaching-groups', '.admin-table tbody tr, .state');
const created = await evaluate(`(async () => {
  const setSelect = async (labelText, value) => {
    const sel = [...document.querySelectorAll('.dialog select, [role="dialog"] select')]
      .find((s) => (s.closest('.field')?.textContent ?? '').includes(labelText));
    if (!sel) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    return true;
  };
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة حلقة'));
  if (!add) return { error: 'no add button' };
  add.click();
  await new Promise((r) => setTimeout(r, 800));
  const okLevel = await setSelect('المستوى', ${JSON.stringify(S.levelId)});
  const okSubject = await setSelect('المواد', ${JSON.stringify(S.subjectId)});
  const name = [...document.querySelectorAll('.dialog input, [role="dialog"] input')].find((i) => i.type === 'text');
  if (!name) return { error: 'no name field', okLevel, okSubject };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(name, '[تجريبي] حلقة الفرع');
  name.dispatchEvent(new Event('input', { bubbles: true }));
  const hasBranch = [...document.querySelectorAll('.dialog select, [role="dialog"] select')]
    .some((s) => (s.closest('.field')?.textContent ?? '').includes('الفرع'));
  const okBranch = await setSelect('الفرع', ${JSON.stringify(S.branchId)});
  // The dialog's primary action is a plain button (FormDialog) — found by its
  // label, because another dialog's actions are also in the document.
  const submit = [...document.querySelectorAll('.dialog .form__actions button')].find((b) => b.textContent.trim() === 'حفظ');
  const disabledBefore = submit ? submit.disabled : null;
  submit?.click();
  await new Promise((r) => setTimeout(r, 2000));
  return { okLevel, okSubject, hasBranch, okBranch, disabledBefore };
})()`);
check('3a · the dialog offers الفرع', created.hasBranch === true, JSON.stringify(created));
check('3b · Level, Subject and الفرع were all selectable', created.okLevel && created.okSubject && created.okBranch, JSON.stringify(created));

const after = JSON.parse(
  (await api('GET', `/admin/teaching-groups?page_size=100&level_id=${S.levelId}&subject_id=${S.subjectId}`)).body,
).data;
const mine = after.find((r) => r.name === '[تجريبي] حلقة الفرع');
check('3c · the circle exists and carries the chosen branch', mine !== undefined && mine.branch_id === S.branchId, JSON.stringify(mine ?? null));
if (mine) await api('DELETE', `/admin/teaching-groups/${mine.id}`);

close();
process.exit(finish());
