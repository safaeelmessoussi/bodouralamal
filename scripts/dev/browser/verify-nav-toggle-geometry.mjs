/**
 * **R138 item 8, and two corrections since — the sidebar toggle measured in
 * a real browser.**
 *
 * ## Why this exists as a script and not as a test
 *
 * "Opening the sidebar must not shift, resize, reflow or push the page
 * content" is a **layout** fact, exactly the kind `measure-page-header.mjs`'s
 * own doc comment explains this project's DOM-free component tests cannot
 * see. This drives the installed Chrome over CDP the same way, against a
 * static harness (`nav-toggle-harness.html`) that replicates `PortalShell`'s
 * own toggle state machine, its DOM surgery and class names — no backend, no
 * auth, no database required, since the property under test is CSS geometry,
 * not application behaviour (exact Arabic wording is a source-pinning
 * concern, covered instead by `portal-shell.test.tsx`).
 *
 * ## Usage
 *
 *   npm --prefix frontend run build
 *   bash scripts/dev/browser/verify-nav-toggle-geometry.sh
 *
 * ## What it asserts, and why each one is the Owner's own reported defect
 *
 * - **Mobile (< 60rem): collapsed by default**, opens as an overlay that
 *   does not push `.admin__main`, closes on a nav-link click, Escape, the
 *   backdrop and — since R138 correction #2 — the drawer's OWN internal
 *   close button. This is the behaviour the Owner already confirmed is
 *   good — asserted here as a regression guard, not a new requirement.
 * - **Desktop/tablet (>= 60rem): expanded by default** (unchanged), and
 *   pressing the toggle a SECOND time (from the collapsed state) shows the
 *   sidebar as a bounded-width overlay that leaves `.admin__main` at
 *   EXACTLY the position/width it already had once collapsed — restoring
 *   the ordinary grid column instead is the same layout-shift failure
 *   `measure-page-header.mjs` was built for.
 * - **R138 correction #2 (Owner, 2026-09-10) — the toggle moved from a
 *   floating, `position: fixed`, icon-only corner button into
 *   `.admin__head`'s own `.admin__actions` row.** The Owner's own report
 *   named what the floating version broke: disconnected from the layout it
 *   operates, and — icon-only beside `ApplicationHeader`'s own icon-only
 *   burger — indistinguishable from it at a glance. What is checked here is
 *   the geometric HALF of that correction (the wording/icon-identity half is
 *   `portal-shell.test.tsx`'s): the toggle's own rect never intersects the
 *   page's own action button, the opened drawer (now `.admin-nav-panel`,
 *   with its own header and close button) at any width or state — closing
 *   the exact blind spot that let the ORIGINAL toggle-overlaps-drawer defect
 *   ship unnoticed in the first place.
 *
 * **Mobile is checked at both 320px (the narrowest width §14 names — the
 * worst case for clearance) and 390px (a representative phone)**; desktop at
 * 1280px and 1440px — the full width list the correction named.
 *
 * - **R138 correction #3 (Owner, 2026-09-10) — `أقسامي` opened an entirely
 *   empty drawer on the Student dashboard.** A layout that always built its
 *   own `<nav>`, even for a session whose final module list for that portal
 *   was empty, gave this harness (and `PortalShell`) nothing to check but
 *   "does a nav element exist" — never "is there anything real inside it."
 *   A SECOND static harness (`nav-toggle-harness-empty.html`) replicates the
 *   OTHER shape `PortalShell` can now render — no toggle, no `.admin-nav`,
 *   no drawer, no reserved grid column, `admin--no-nav` — alongside a stand-in
 *   for `ApplicationHeader`'s own burger, proving that control stays
 *   untouched by a portal having nothing of its own to toggle. Checked at
 *   every width this script already covers, not only mobile — the property
 *   ("nothing renders for an empty nav slot") has no width dependency, so
 *   there is no narrower or wider case to single out.
 */
const PORT = process.env.PORT ?? '9223';
const URL_TO_OPEN = process.argv[2];
const EMPTY_URL_TO_OPEN = process.argv[3];

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

/**
 * `requireStateMachine` is `false` for the empty-nav harness: it has no
 * toggle to drive, so no `__setNavState` script ever runs — waiting for one
 * would only burn the full timeout on every navigation.
 */
async function navigate(url, requireStateMachine = true) {
  await send('Page.navigate', { url });
  const readyExpr = requireStateMachine
    ? `document.readyState === 'complete' && typeof window.__setNavState === 'function'`
    : `document.readyState === 'complete'`;
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(readyExpr).catch(() => false);
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

/** Two DOM rects overlap iff their projections intersect on both axes. */
function intersects(a, b) {
  if (!a || !b) return false;
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * **The toggle is `position: static` now — it can legitimately sit BEHIND
 * the open drawer**, the same as any ordinary page content a modal covers.
 * That is not the Owner's original defect (the toggle rendering ON TOP OF
 * the drawer's own text) and asserting plain rect non-intersection here
 * would fail on a coincidence this correction never promised to avoid: a
 * narrow phone's `.admin__actions` row can sit underneath the panel's own
 * bounds once it opens.
 *
 * The actual property is paint order: wherever the two rects genuinely
 * overlap, `elementFromPoint` at that point must resolve INTO the panel,
 * never into the toggle — i.e. the drawer visually wins, exactly as any
 * correctly-layered overlay must. `.admin-nav-panel`'s `z-index: 56` against
 * the toggle's un-positioned, no-`z-index` default is what the CSS painting
 * order already guarantees; this proves it rather than trusting the rule.
 */
function overlapCenter(a, b) {
  if (!intersects(a, b)) return null;
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

async function topElementAt(x, y) {
  return evaluate(`(() => {
    const el = document.elementFromPoint(${x}, ${y});
    if (!el) return null;
    return { insideToggle: !!el.closest('.admin-nav-toggle'), insidePanel: !!el.closest('.admin-nav-panel') };
  })()`);
}

async function checkDrawerWinsPaintOrder(label, toggleRect, panelRect) {
  const point = overlapCenter(toggleRect, panelRect);
  if (!point) {
    check(label, true, 'toggle and open drawer do not occupy the same screen region here');
    return;
  }
  const top = await topElementAt(point.x, point.y);
  check(
    label,
    top?.insidePanel === true && top?.insideToggle !== true,
    `overlap point (${point.x},${point.y}) resolves to ${JSON.stringify(top)} — toggle=${JSON.stringify(toggleRect)} panel=${JSON.stringify(panelRect)}`,
  );
}

/* ── Mobile — collapsed by default, opens as an overlay, closes four ways ──
 * Checked at BOTH 320px (the narrowest width §14 names — the worst case for
 * clearance) and 390px (a representative phone), per the correction's own
 * width list. */
for (const width of [320, 390]) {
  await setWidth(width);
  await navigate(URL_TO_OPEN);

  const mobileDefault = await evaluate(rect('.admin-nav'));
  check(
    `mobile ${width}px: collapsed by default`,
    mobileDefault.display === 'none',
    `display=${mobileDefault.display}`,
  );
  const toggleDefaultMobile = await evaluate(rect('.admin-nav-toggle'));
  const actionDefaultMobile = await evaluate(rect('#page-action'));
  check(
    `mobile ${width}px: toggle does not overlap the page's own action button by default — the SAME .admin__actions row`,
    !intersects(toggleDefaultMobile, actionDefaultMobile),
    `toggle=${JSON.stringify(toggleDefaultMobile)} action=${JSON.stringify(actionDefaultMobile)}`,
  );
  const headingDefaultMobile = await evaluate(rect('.admin__title'));
  check(
    `mobile ${width}px: toggle does not overlap the page heading by default`,
    !intersects(toggleDefaultMobile, headingDefaultMobile),
    `toggle=${JSON.stringify(toggleDefaultMobile)} heading=${JSON.stringify(headingDefaultMobile)}`,
  );

  const mainBeforeOpen = await evaluate(rect('.admin__main'));
  await evaluate(`document.getElementById('toggle').click()`);
  const navOpenMobile = await evaluate(rect('.admin-nav-panel'));
  const mainAfterOpenMobile = await evaluate(rect('.admin__main'));
  const toggleOpenMobile = await evaluate(rect('.admin-nav-toggle'));
  check(
    `mobile ${width}px: opening does not move .admin__main`,
    mainBeforeOpen.left === mainAfterOpenMobile.left && mainBeforeOpen.width === mainAfterOpenMobile.width,
    `before ${mainBeforeOpen.left}/${mainBeforeOpen.width} after ${mainAfterOpenMobile.left}/${mainAfterOpenMobile.width}`,
  );
  check(
    `mobile ${width}px: overlay is a position:fixed panel, bounded width (not the whole viewport)`,
    navOpenMobile.position === 'fixed' && navOpenMobile.width > 0 && navOpenMobile.width <= 340,
    `position=${navOpenMobile.position} width=${navOpenMobile.width}`,
  );
  await checkDrawerWinsPaintOrder(
    `mobile ${width}px: where the open drawer covers the (now in-flow) toggle, the DRAWER paints on top — never the toggle over the drawer's own content, the original Owner-reported defect`,
    toggleOpenMobile,
    navOpenMobile,
  );
  const panelCloseMobile = await evaluate(rect('#panel-close'));
  check(
    `mobile ${width}px: the drawer carries its own close button, inside the panel's own bounds`,
    panelCloseMobile !== null &&
      panelCloseMobile.left >= navOpenMobile.left &&
      panelCloseMobile.left + panelCloseMobile.width <= navOpenMobile.left + navOpenMobile.width,
    `close=${JSON.stringify(panelCloseMobile)} panel=${JSON.stringify(navOpenMobile)}`,
  );

  // The panel's own close button closes it.
  await evaluate(`document.getElementById('panel-close').click()`);
  let state = await evaluate(`window.__navState()`);
  check(`mobile ${width}px: the drawer's own close button closes the overlay`, state === 'collapsed', `state=${state}`);

  // Escape closes it.
  await evaluate(`window.__setNavState('overlay')`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  state = await evaluate(`window.__navState()`);
  check(`mobile ${width}px: Escape closes the overlay`, state === 'collapsed', `state=${state}`);

  // Backdrop click closes it.
  await evaluate(`window.__setNavState('overlay')`);
  await evaluate(`document.getElementById('backdrop').click()`);
  state = await evaluate(`window.__navState()`);
  check(`mobile ${width}px: backdrop click closes the overlay`, state === 'collapsed', `state=${state}`);

  // Following a nav link closes it (full-page navigation in the real app).
  await evaluate(`window.__setNavState('overlay')`);
  await evaluate(`document.getElementById('link1').click()`);
  state = await evaluate(`window.__navState()`);
  check(`mobile ${width}px: clicking a nav link closes the overlay`, state === 'collapsed', `state=${state}`);
}

/* ── Desktop — expanded by default; the correction itself ──────────────── */
for (const width of [1280, 1440]) {
  await setWidth(width);
  await evaluate(`window.__setNavState(null)`); // back to the untouched default
  await navigate(URL_TO_OPEN);

  const desktopDefault = await evaluate(rect('.admin-nav'));
  check(
    `desktop ${width}px: expanded (inline) by default, unchanged from before this correction`,
    desktopDefault.display !== 'none' && desktopDefault.position !== 'fixed',
    `display=${desktopDefault.display} position=${desktopDefault.position}`,
  );
  // Closes a blind spot an earlier version of this harness had: it checked
  // `.admin-nav`'s display/position in the untouched default, but never
  // that `.admin-nav` and `.admin__main` actually land in SEPARATE grid
  // columns rather than overlapping.
  const mainDefault = await evaluate(rect('.admin__main'));
  check(
    // RTL: the first grid column (nav, 16rem) renders on the RIGHT, so nav's
    // `left` is the LARGER of the two — main sits to its left, at a smaller
    // `left`.
    `desktop ${width}px: nav and main occupy separate, non-overlapping columns by default`,
    !intersects(desktopDefault, mainDefault) && mainDefault.left < desktopDefault.left,
    `nav=${JSON.stringify(desktopDefault)} main=${JSON.stringify(mainDefault)}`,
  );
  const toggleDefaultDesktop = await evaluate(rect('.admin-nav-toggle'));
  const actionDefaultDesktop = await evaluate(rect('#page-action'));
  check(
    `desktop ${width}px: toggle does not overlap the page's own action button by default`,
    !intersects(toggleDefaultDesktop, actionDefaultDesktop),
    `toggle=${JSON.stringify(toggleDefaultDesktop)} action=${JSON.stringify(actionDefaultDesktop)}`,
  );
  const headingDefaultDesktop = await evaluate(rect('.admin__title'));
  check(
    `desktop ${width}px: toggle does not overlap the page heading by default`,
    !intersects(toggleDefaultDesktop, headingDefaultDesktop),
    `toggle=${JSON.stringify(toggleDefaultDesktop)} heading=${JSON.stringify(headingDefaultDesktop)}`,
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
  // back — must be the overlay panel, and must leave .admin__main EXACTLY
  // where it already was once collapsed, not shift it back toward the
  // sidebar.
  await evaluate(`document.getElementById('toggle').click()`);
  const navOverlay = await evaluate(rect('.admin-nav-panel'));
  const mainOverlay = await evaluate(rect('.admin__main'));
  const toggleOverlay = await evaluate(rect('.admin-nav-toggle'));
  check(
    `desktop ${width}px: second press opens the OVERLAY PANEL (position:fixed), never the grid column`,
    navOverlay.position === 'fixed',
    `position=${navOverlay.position}`,
  );
  await checkDrawerWinsPaintOrder(
    `desktop ${width}px: wherever the open drawer covers the toggle, the DRAWER paints on top`,
    toggleOverlay,
    navOverlay,
  );
  check(
    `desktop ${width}px: overlay panel width is bounded, not the whole viewport`,
    navOverlay.width > 0 && navOverlay.width <= 400,
    `width=${navOverlay.width} of viewport ${width}`,
  );
  check(
    `desktop ${width}px: opening the overlay does not move or resize .admin__main`,
    mainCollapsed.left === mainOverlay.left && mainCollapsed.width === mainOverlay.width,
    `collapsed ${mainCollapsed.left}/${mainCollapsed.width} vs overlay ${mainOverlay.left}/${mainOverlay.width}`,
  );
  const panelCloseDesktop = await evaluate(rect('#panel-close'));
  check(
    `desktop ${width}px: the drawer carries its own close button too, inside the panel's own bounds`,
    panelCloseDesktop !== null &&
      panelCloseDesktop.left >= navOverlay.left &&
      panelCloseDesktop.left + panelCloseDesktop.width <= navOverlay.left + navOverlay.width,
    `close=${JSON.stringify(panelCloseDesktop)} panel=${JSON.stringify(navOverlay)}`,
  );

  // The panel's own close button closes it here too.
  await evaluate(`document.getElementById('panel-close').click()`);
  let state = await evaluate(`window.__navState()`);
  check(
    `desktop ${width}px: the drawer's own close button closes the overlay`,
    state === 'collapsed',
    `state=${state}`,
  );

  // Escape closes it as well.
  await evaluate(`window.__setNavState('overlay')`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  state = await evaluate(`window.__navState()`);
  check(`desktop ${width}px: Escape closes the overlay`, state === 'collapsed', `state=${state}`);
}

/* ── R138 correction #3 — the OTHER shape: no contextual nav at all ─────────
 * `أقسامي` opened empty on the Student dashboard because every layout built
 * its own `<nav>` unconditionally. `nav-toggle-harness-empty.html`
 * replicates a portal whose final module list came back empty — checked at
 * every width, since "nothing renders for an empty nav slot" has no width
 * dependency, and explicitly including a mobile pass because that is where
 * the Owner's own screenshot was taken. */
if (EMPTY_URL_TO_OPEN) {
  for (const width of [320, 390, 1280, 1440]) {
    await setWidth(width);
    await navigate(EMPTY_URL_TO_OPEN, false);

    const toggle = await evaluate(rect('.admin-nav-toggle'));
    check(`empty nav ${width}px: no toggle renders at all`, toggle === null, `toggle=${JSON.stringify(toggle)}`);

    const nav = await evaluate(rect('.admin-nav'));
    check(`empty nav ${width}px: no .admin-nav renders`, nav === null, `nav=${JSON.stringify(nav)}`);

    const panel = await evaluate(rect('.admin-nav-panel'));
    check(`empty nav ${width}px: no drawer panel renders`, panel === null, `panel=${JSON.stringify(panel)}`);

    const backdrop = await evaluate(rect('.admin-nav-backdrop'));
    check(
      `empty nav ${width}px: no backdrop renders`,
      backdrop === null,
      `backdrop=${JSON.stringify(backdrop)}`,
    );

    const gridColumns = await evaluate(
      `getComputedStyle(document.getElementById('shell')).gridTemplateColumns`,
    );
    const trackCount = gridColumns.trim().split(/\s+/).filter(Boolean).length;
    check(
      `empty nav ${width}px: the grid reclaims the column — a single track, not two`,
      trackCount === 1,
      `grid-template-columns=${gridColumns}`,
    );

    // The burger is only ever VISIBLE below 60rem — `check-header-nav-exclusive.sh`
    // already guards that switch, and duplicating it here would only risk
    // disagreeing with it. What this harness proves is narrower and its own:
    // on mobile, where the Owner's own screenshot was taken, the burger is
    // there and untouched by the portal beneath it having no nav of its own.
    if (width < 60 * 16) {
      const burger = await evaluate(rect('#header-burger'));
      check(
        `empty nav ${width}px: ApplicationHeader's own burger stays present and untouched`,
        burger !== null && burger.display !== 'none' && burger.width > 0 && burger.height > 0,
        `burger=${JSON.stringify(burger)}`,
      );
    }
  }
} else {
  check('empty-nav harness checks (R138 correction #3)', false, 'no second URL passed to this script');
}

console.log(results.join('\n'));
const passed = results.filter((l) => l.startsWith('PASS')).length;
console.log(`\n${passed}/${results.length} checks passed`);
ws.close();
if (passed !== results.length) process.exitCode = 1;
