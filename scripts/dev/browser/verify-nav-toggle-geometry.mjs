/**
 * **R138 item 8 correction — the sidebar toggle measured in a real browser.**
 *
 * ## Why this exists as a script and not as a test
 *
 * "Opening the sidebar must not shift, resize, reflow or push the page
 * content" is a **layout** fact, exactly the kind `measure-page-header.mjs`'s
 * own doc comment explains this project's DOM-free component tests cannot
 * see. This drives the installed Chrome over CDP the same way, against a
 * static harness (`nav-toggle-harness.html`) that replicates `PortalShell`'s
 * own toggle state machine and class names — no backend, no auth, no
 * database required, since the property under test is CSS geometry, not
 * application behaviour.
 *
 * ## Usage
 *
 *   npm --prefix frontend run build
 *   bash scripts/dev/browser/verify-nav-toggle-geometry.sh
 *
 * ## What it asserts, and why each one is the Owner's own reported defect
 *
 * - **Mobile (< 60rem): collapsed by default**, opens as an overlay that
 *   does not push `.admin__main`, closes on a nav-link click, Escape and the
 *   backdrop. This is the behaviour the Owner already confirmed is good —
 *   asserted here as a regression guard, not a new requirement.
 * - **Desktop/tablet (>= 60rem): expanded by default** (unchanged), and —
 *   the correction — pressing the toggle a SECOND time (from the collapsed
 *   state) shows the sidebar as a bounded-width overlay that leaves
 *   `.admin__main` at EXACTLY the position/width it already had once
 *   collapsed. The first cut restored the sidebar as the ordinary grid
 *   column, which is measurably the same failure `measure-page-header.mjs`
 *   was built for: a layout shift no source-level check could see.
 */
const PORT = process.env.PORT ?? '9223';
const URL_TO_OPEN = process.argv[2];

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

const pages = (await targets()).filter((t) => t.type === 'page');
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

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function setWidth(width) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 900, deviceScaleFactor: 1, mobile: false,
  });
}

async function navigate() {
  await send('Page.navigate', { url: URL_TO_OPEN });
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(
      `document.readyState === 'complete' && typeof window.__setNavState === 'function'`,
    ).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const rect = (sel) => `(() => {
  const e = document.querySelector('${sel}');
  if (!e) return null;
  const b = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  return { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height), position: cs.position, display: cs.display };
})()`;

const results = [];
function check(label, ok, note) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${note ? '  — ' + note : ''}`);
}

/* ── Mobile — collapsed by default, opens as an overlay, closes three ways ── */
await setWidth(390);
await navigate();

const mobileDefault = await evaluate(rect('.admin-nav'));
check(
  'mobile: collapsed by default',
  mobileDefault.display === 'none',
  `display=${mobileDefault.display}`,
);

const mainBeforeOpen = await evaluate(rect('.admin__main'));
await evaluate(`document.getElementById('toggle').click()`);
const navOpenMobile = await evaluate(rect('.admin-nav'));
const mainAfterOpenMobile = await evaluate(rect('.admin__main'));
check(
  'mobile: opening does not move .admin__main',
  mainBeforeOpen.left === mainAfterOpenMobile.left && mainBeforeOpen.width === mainAfterOpenMobile.width,
  `before ${mainBeforeOpen.left}/${mainBeforeOpen.width} after ${mainAfterOpenMobile.left}/${mainAfterOpenMobile.width}`,
);
check(
  'mobile: overlay is position:fixed, bounded width (not the whole viewport)',
  navOpenMobile.position === 'fixed' && navOpenMobile.width > 0 && navOpenMobile.width <= 340,
  `position=${navOpenMobile.position} width=${navOpenMobile.width}`,
);

// Escape closes it.
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
let state = await evaluate(`window.__navState()`);
check('mobile: Escape closes the overlay', state === 'collapsed', `state=${state}`);

// Backdrop click closes it.
await evaluate(`window.__setNavState('overlay')`);
await evaluate(`document.getElementById('backdrop').click()`);
state = await evaluate(`window.__navState()`);
check('mobile: backdrop click closes the overlay', state === 'collapsed', `state=${state}`);

// Following a nav link closes it (full-page navigation in the real app).
await evaluate(`window.__setNavState('overlay')`);
await evaluate(`document.getElementById('link1').click()`);
state = await evaluate(`window.__navState()`);
check('mobile: clicking a nav link closes the overlay', state === 'collapsed', `state=${state}`);

/* ── Desktop — expanded by default; the correction itself ──────────────── */
for (const width of [1280, 1440]) {
  await setWidth(width);
  await evaluate(`window.__setNavState(null)`); // back to the untouched default
  await navigate();

  const desktopDefault = await evaluate(rect('.admin-nav'));
  check(
    `desktop ${width}px: expanded (inline) by default, unchanged from before this correction`,
    desktopDefault.display !== 'none' && desktopDefault.position !== 'fixed',
    `display=${desktopDefault.display} position=${desktopDefault.position}`,
  );

  // Collapse it (first press) — main is expected to widen; that direction was
  // never the complaint.
  await evaluate(`document.getElementById('toggle').click()`);
  const mainCollapsed = await evaluate(rect('.admin__main'));
  const navCollapsed = await evaluate(rect('.admin-nav'));
  check(
    `desktop ${width}px: first press collapses (hides) the sidebar`,
    navCollapsed.display === 'none',
    `display=${navCollapsed.display}`,
  );

  // The correction's own invariant: the SECOND press — bringing the sidebar
  // back — must be the overlay, and must leave .admin__main EXACTLY where it
  // already was once collapsed, not shift it back toward the sidebar.
  await evaluate(`document.getElementById('toggle').click()`);
  const navOverlay = await evaluate(rect('.admin-nav'));
  const mainOverlay = await evaluate(rect('.admin__main'));
  check(
    `desktop ${width}px: second press opens the OVERLAY (position:fixed), never the grid column`,
    navOverlay.position === 'fixed',
    `position=${navOverlay.position}`,
  );
  check(
    `desktop ${width}px: overlay width is bounded, not the whole viewport`,
    navOverlay.width > 0 && navOverlay.width <= 400,
    `width=${navOverlay.width} of viewport ${width}`,
  );
  check(
    `desktop ${width}px: opening the overlay does not move or resize .admin__main`,
    mainCollapsed.left === mainOverlay.left && mainCollapsed.width === mainOverlay.width,
    `collapsed ${mainCollapsed.left}/${mainCollapsed.width} vs overlay ${mainOverlay.left}/${mainOverlay.width}`,
  );

  // Escape closes it here too.
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  state = await evaluate(`window.__navState()`);
  check(`desktop ${width}px: Escape closes the overlay`, state === 'collapsed', `state=${state}`);
}

console.log(results.join('\n'));
const passed = results.filter((l) => l.startsWith('PASS')).length;
console.log(`\n${passed}/${results.length} checks passed`);
ws.close();
if (passed !== results.length) process.exitCode = 1;
