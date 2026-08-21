/**
 * **R78.1 — dragging حلقات المواد, on the real page.**
 *
 * R76.7 had excluded TeachingGroup from manual ordering because no interface
 * had ever set the column. R78 records that the reason expired. This drives the
 * actual الحلقات screen — not the shared component in isolation — because the
 * question is whether the *page* wires the parent scope, the authority and the
 * sequence correctly, and none of that lives in DataTable.
 *
 * Circles are identified by their **id from the seeder**, never by title.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
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

const api = (method, path) =>
  evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    const { access_token } = await r.json();
    const res = await fetch(${JSON.stringify(`/api/v1${path}`)}, {
      method: ${JSON.stringify(method)},
      headers: { Authorization: 'Bearer ' + access_token },
    });
    return { status: res.status, body: await res.text() };
  })()`);

/** The seeded circles, in the order the server currently returns them. */
const serverOrder = async () => {
  const res = await api(
    'GET',
    `/admin/teaching-groups?page_size=100&level_id=${S.levelId}&subject_id=${S.subjectId}`,
  );
  return JSON.parse(res.body).data.map((r) => r.id);
};

const reached = await goto('/admin/teaching-groups', '.admin-table tbody tr, .state');
check('the حلقات المواد screen loads', reached === 'ready', `state=${reached}`);

/* ── with no pairing chosen, the gesture is withheld and EXPLAINED ────────── */

// **Waited for, not sampled.** The table renders a skeleton while loading, so a
// read taken at a fixed moment measures the skeleton and reports a missing grip
// the page does have.
const unscoped = await evaluate(`(async () => {
  for (let i = 0; i < 40; i += 1) {
    const grip = document.querySelector('.admin-table tbody .admin-table__grip-btn');
    const status = document.querySelector('.datatable__reorder');
    if (grip && status) {
      return { hasGrip: true, disabled: grip.disabled, says: status.textContent.trim() };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const status = document.querySelector('.datatable__reorder');
  return { hasGrip: false, disabled: null, says: status ? status.textContent.trim() : null };
})()`);
check(
  '1 · with no (Level, Subject) chosen the handle is disabled and explained',
  unscoped.hasGrip === true && unscoped.disabled === true && Boolean(unscoped.says),
  JSON.stringify(unscoped),
);

/* ── choose the pairing the seeder built ─────────────────────────────────── */

const scoped = await evaluate(`(async () => {
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
  const level = await setSelect('المستوى', ${JSON.stringify(S.levelId)});
  const subject = await setSelect('المادة', ${JSON.stringify(S.subjectId)});
  // Wait for the gesture to become AVAILABLE rather than sampling once: the
  // second filter change triggers another load, and a read landing inside it
  // sees a disabled handle that is about to enable.
  for (let i = 0; i < 40; i += 1) {
    const g = document.querySelector('.admin-table tbody .admin-table__grip-btn');
    if (g && !g.disabled) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const grip = document.querySelector('.admin-table tbody .admin-table__grip-btn');
  return {
    level, subject,
    rows: [...document.querySelectorAll('.admin-table tbody tr')].length,
    enabled: grip ? !grip.disabled : null,
    draggable: document.querySelector('.admin-table tbody tr')?.draggable ?? null,
  };
})()`);
check('2 · choosing the pairing narrows the table to its circles', scoped.rows === 3, JSON.stringify(scoped));
check('3 · the drag becomes available once the parent is known', scoped.enabled === true && scoped.draggable === true, JSON.stringify(scoped));

/* ── drag the first row to the end, and verify against the SERVER ────────── */

const before = await serverOrder();
check('4 · the server returns the three seeded circles', before.length === 3, JSON.stringify(before));

await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const dt = new DataTransfer();
  const fire = (el, type) => el.dispatchEvent(
    new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  fire(rows[0], 'dragstart');
  fire(rows[rows.length - 1], 'dragover');
  fire(rows[rows.length - 1], 'drop');
  fire(rows[0], 'dragend');
  // The submit is a request; wait for it to settle rather than for a fixed
  // interval that happens to be long enough on this machine.
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    const busy = document.querySelector('.datatable__reorder')?.textContent ?? '';
    if (!busy.includes('جارٍ')) break;
  }
  await new Promise((r) => setTimeout(r, 800));
})()`);

const afterDrag = await serverOrder();
check(
  '5 · dropping the first circle last PERSISTS that order on the server',
  afterDrag.length === 3 && afterDrag[2] === before[0] && afterDrag[0] === before[1],
  `${before.join(' > ')}   →   ${afterDrag.join(' > ')}`,
);

const positions = JSON.parse(
  (await api('GET', `/admin/teaching-groups?page_size=100&level_id=${S.levelId}&subject_id=${S.subjectId}`)).body,
);
check(
  '6 · the order survives a RELOAD of the page',
  (await (async () => {
    await goto('/admin/teaching-groups', '.admin-table tbody tr, .state');
    return serverOrder();
  })()).join(',') === afterDrag.join(','),
  afterDrag.join(' > '),
);
check('7 · the collection is still exactly three circles — none lost or duplicated', positions.data.length === 3);

/* ── the keyboard path, which a drag cannot serve ────────────────────────── */

await evaluate(`(async () => {
  const setSelect = async (labelText, value) => {
    const sel = [...document.querySelectorAll('select')]
      .find((s) => (s.closest('.field')?.textContent ?? '').includes(labelText));
    if (!sel) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
  };
  await setSelect('المستوى', ${JSON.stringify(S.levelId)});
  await setSelect('المادة', ${JSON.stringify(S.subjectId)});
  await new Promise((r) => setTimeout(r, 1200));
  const grip = document.querySelector('.admin-table tbody tr .admin-table__grip-btn');
  grip.focus();
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await new Promise((r) => setTimeout(r, 2500));
})()`);
const afterKey = await serverOrder();
check(
  '8 · ArrowDown on the handle reorders too, and persists',
  afterKey[0] === afterDrag[1] && afterKey[1] === afterDrag[0],
  `${afterDrag.join(' > ')}   →   ${afterKey.join(' > ')}`,
);

close();
process.exit(finish());
