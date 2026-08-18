/**
 * **Verifies the R76 surfaces in a real browser, on the real screens.**
 *
 * ## Why this is not a unit test
 *
 * Vitest here renders with renderToStaticMarkup: no layout engine, no events,
 * no fetches. Everything this script asks is something that markup cannot
 * answer — *does the column appear on the live screen*, *does the sort request
 * actually leave the browser*, *does the row move when dropped*, *does the
 * handle disable itself when the sort changes*.
 *
 * ## Authentication
 *
 * The session is a **real** one, minted through the production issueNewSession
 * path by scripts/dev/issue-dev-session.sh and presented as the ordinary
 * bodour_refresh cookie. Nothing about authorisation is bypassed: every request
 * below is checked by the same TD-2 rules as any other, and a screen this user
 * may not write simply renders read-only.
 */
const PORT = process.env.PORT ?? '9223';
const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const pages = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(
  (t) => t.type === 'page',
);
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

// The refresh cookie is confined to its one route (TD-12), exactly as the server
// sets it — the harness must not widen it, or it would be testing a cookie the
// application never issues.
await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  // Wait for the table to have rendered rows, or for the screen to say it is
  // empty — a fixed sleep would be a flake generator.
  for (let i = 0; i < 60; i += 1) {
    const state = await evaluate(`(() => {
      const t = document.querySelector('.admin-table');
      if (t && t.querySelectorAll('tbody tr').length > 0) return 'rows';
      if (document.querySelector('.datatable__skeleton')) return 'loading';
      if (document.querySelector('.state')) return 'state';
      return document.location.pathname;
    })()`).catch(() => null);
    if (state === 'rows' || state === 'state') return state;
    if (typeof state === 'string' && state.startsWith('/login')) return 'login';
    await new Promise((r) => setTimeout(r, 300));
  }
  return 'timeout';
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}

/** The screens R76 touches, with the column the header should sort by. */
const SCREENS = [
  { path: '/admin/branches', label: 'الفروع' },
  { path: '/admin/levels', label: 'المستويات' },
  { path: '/admin/groups', label: 'المجموعات الإدارية' },
  { path: '/admin/categories', label: 'الفئات' },
  { path: '/admin/subjects', label: 'المواد' },
];

for (const screen of SCREENS) {
  const state = await goto(screen.path);
  if (state !== 'rows') {
    check(`${screen.label}: reached with rows`, false, `state=${state}`);
    continue;
  }
  check(`${screen.label}: reached with rows`, true);

  // 1. «الترتيب» is gone from the table (R76.8).
  const headers = await evaluate(
    `[...document.querySelectorAll('.admin-table thead th')].map((h) => h.textContent.trim())`,
  );
  check(
    `${screen.label}: no «الترتيب» column`,
    !headers.some((h) => h.includes('الترتيب') && !h.includes('تغيير')),
    headers.join(' | '),
  );

  // 2. The first column's header is a real, focusable button.
  const sortable = await evaluate(`(() => {
    const b = document.querySelector('.admin-table thead .datatable__sort');
    if (!b) return null;
    b.focus();
    return { tag: b.tagName, focused: document.activeElement === b,
             ariaSort: b.closest('th').getAttribute('aria-sort') };
  })()`);
  check(
    `${screen.label}: sortable header is a focusable button`,
    sortable !== null && sortable.tag === 'BUTTON' && sortable.focused,
    JSON.stringify(sortable),
  );

  // 3. Pressing it issues a REQUEST carrying sort_by — the sort is the server's.
  const sortRequest = await evaluate(`(async () => {
    const seen = [];
    const original = window.fetch;
    window.fetch = (...args) => { seen.push(String(args[0])); return original(...args); };
    document.querySelector('.admin-table thead .datatable__sort').click();
    await new Promise((r) => setTimeout(r, 900));
    window.fetch = original;
    return seen.filter((u) => u.includes('sort_by='));
  })()`);
  check(
    `${screen.label}: the header asks the SERVER to sort`,
    Array.isArray(sortRequest) && sortRequest.length > 0,
    (sortRequest ?? []).join(' '),
  );

  // 4. Under that sort the handle is disabled and the table says why (R76.8).
  const blocked = await evaluate(`(() => {
    const grip = document.querySelector('.admin-table__grip-btn');
    const status = document.querySelector('.datatable__reorder');
    return { hasGrip: grip !== null, disabled: grip ? grip.disabled : null,
             draggable: document.querySelector('.admin-table tbody tr').draggable,
             says: status ? status.textContent.trim() : null };
  })()`);
  check(
    `${screen.label}: sorted → handle disabled, and the table says why`,
    blocked.hasGrip === false ||
      (blocked.disabled === true && blocked.draggable === false && Boolean(blocked.says)),
    JSON.stringify(blocked),
  );
}

/**
 * The drop itself, on الفئات — unpaginated, so the visible rows are the whole
 * live set and the gesture is available with no filter to choose first.
 */
{
  await goto('/admin/categories');
  const before = await evaluate(
    `[...document.querySelectorAll('.admin-table tbody tr th')].map((c) => c.textContent.trim())`,
  );
  const canDrag = await evaluate(
    `document.querySelector('.admin-table tbody tr')?.draggable === true`,
  );
  check('الفئات: canonical order offers the drag', canDrag === true, JSON.stringify(before));

  if (canDrag && before.length > 1) {
    // A real HTML5 drag sequence: dragstart on the first row, dragover the last,
    // drop. DataTransfer is constructed because CDP cannot synthesise one.
    const after = await evaluate(`(async () => {
      const rows = [...document.querySelectorAll('.admin-table tbody tr')];
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(rows[0], 'dragstart');
      fire(rows[rows.length - 1], 'dragover');
      fire(rows[rows.length - 1], 'drop');
      fire(rows[0], 'dragend');
      await new Promise((r) => setTimeout(r, 1500));
      return [...document.querySelectorAll('.admin-table tbody tr th')].map((c) => c.textContent.trim());
    })()`);
    check(
      'الفئات: dropping a row onto the last position moves it there',
      Array.isArray(after) && after[after.length - 1] === before[0] && after.length === before.length,
      `${before.join(' > ')}   →   ${(after ?? []).join(' > ')}`,
    );

    // And it PERSISTED: a reload is the only honest proof the server took it.
    await goto('/admin/categories');
    const reloaded = await evaluate(
      `[...document.querySelectorAll('.admin-table tbody tr th')].map((c) => c.textContent.trim())`,
    );
    check(
      'الفئات: the new order survives a reload',
      Array.isArray(reloaded) && reloaded[reloaded.length - 1] === before[0],
      (reloaded ?? []).join(' > '),
    );

    // Restore, so the run leaves the dev database as it found it.
    await evaluate(`(async () => {
      const rows = [...document.querySelectorAll('.admin-table tbody tr')];
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(rows[rows.length - 1], 'dragstart');
      fire(rows[0], 'dragover');
      fire(rows[0], 'drop');
      fire(rows[rows.length - 1], 'dragend');
      await new Promise((r) => setTimeout(r, 1500));
    })()`);
  }
}

/** The keyboard path, which is the one a drag cannot serve. */
{
  await goto('/admin/categories');
  const moved = await evaluate(`(async () => {
    const before = [...document.querySelectorAll('.admin-table tbody tr th')].map((c) => c.textContent.trim());
    const grip = document.querySelector('.admin-table tbody tr .admin-table__grip-btn');
    if (!grip || grip.disabled) return { skipped: true };
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
    const after = [...document.querySelectorAll('.admin-table tbody tr th')].map((c) => c.textContent.trim());
    return { before, after };
  })()`);
  check(
    'الفئات: ArrowDown on the handle moves the row (keyboard parity)',
    moved && !moved.skipped && moved.after[1] === moved.before[0],
    JSON.stringify(moved),
  );
  // Put it back.
  await evaluate(`(async () => {
    const grips = [...document.querySelectorAll('.admin-table tbody tr .admin-table__grip-btn')];
    if (grips[1] && !grips[1].disabled) {
      grips[1].focus();
      grips[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await new Promise((r) => setTimeout(r, 1500));
    }
  })()`);
}

/** The parent-scoped case: no Level selected, so the handle explains itself. */
{
  const state = await goto('/admin/groups');
  if (state === 'rows') {
    const scoped = await evaluate(`(() => {
      const grip = document.querySelector('.admin-table__grip-btn');
      const status = document.querySelector('.datatable__reorder');
      return { disabled: grip ? grip.disabled : null, says: status ? status.textContent.trim() : null };
    })()`);
    check(
      'المجموعات الإدارية: with no Level chosen the handle is disabled and explained',
      scoped.disabled === true && Boolean(scoped.says),
      JSON.stringify(scoped),
    );
  }
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
ws.close();
process.exit(failed.length === 0 ? 0 : 1);
