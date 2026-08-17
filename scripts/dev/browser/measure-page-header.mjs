/**
 * **Measures the shared page header in a real browser.**
 *
 * ## Why this exists as a script and not as a test
 *
 * The invariant — *the primary action does not move when the description grows* —
 * is a **layout** fact. It cannot be observed from source, and it was asserted
 * from source once and was wrong: `align-items: start` was present and correct
 * while `flex-wrap: wrap` put the action on its own line, so the button moved
 * **94px → 475px** at 1440px and every declaration-level check passed.
 *
 * Vitest here renders with `renderToStaticMarkup` and has no layout engine, and
 * the project has no Playwright (§3.1a forbids adding a dependency casually). So
 * this drives the **installed Chrome** over CDP using Node 24's built-in
 * `WebSocket` — no install, no lockfile change.
 *
 * ## Usage
 *
 *   npm --prefix frontend run build          # the CSS this measures
 *   bash scripts/dev/browser/measure-page-header.sh
 *
 * ## What it asserts
 *
 * The header is two columns at and above 44rem and one column below it, so the
 * expectation differs by breakpoint — asserting the wide rule on a narrow
 * viewport would assert a layout the stylesheet deliberately does not have.
 */
const PORT = process.env.PORT ?? '9222';
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

async function measureAt(width) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url: URL_TO_OPEN });
  // Wait for layout to settle: poll until the stylesheet has applied.
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(
      `document.readyState === 'complete' && getComputedStyle(document.querySelector('.admin__head')).display === 'flex'`,
    ).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return evaluate(`(() => {
    const r = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect();
      return { top: Math.round(b.top), height: Math.round(b.height) }; };
    const shortHead = document.getElementById('head-short').getBoundingClientRect();
    const longHead = document.getElementById('head-long').getBoundingClientRect();
    const shortBtn = document.getElementById('btn-short').getBoundingClientRect();
    const longBtn = document.getElementById('btn-long').getBoundingClientRect();
    const shortTitle = document.querySelector('#head-short .admin__title').getBoundingClientRect();
    const longTitle = document.querySelector('#head-long .admin__title').getBoundingClientRect();
    const shortLede = document.querySelector('#head-short .lede').getBoundingClientRect();
    const longLede = document.querySelector('#head-long .lede').getBoundingClientRect();
    return {
      shortLedeLines: Math.round(longLede.height / parseFloat(getComputedStyle(document.querySelector('#head-long .lede')).lineHeight)),
      shortLedeHeight: Math.round(shortLede.height),
      longLedeHeight: Math.round(longLede.height),
      // The measurement that matters: the button's offset from the TOP OF ITS
      // OWN HEADER, in each case. If the invariant holds these are equal.
      shortBtnOffset: Math.round(shortBtn.top - shortHead.top),
      longBtnOffset: Math.round(longBtn.top - longHead.top),
      // And relative to the title, which is what the rule claims it tracks.
      shortBtnVsTitle: Math.round(shortBtn.top - shortTitle.top),
      longBtnVsTitle: Math.round(longBtn.top - longTitle.top),
      ledeWidthShort: Math.round(shortLede.width),
      viewport: window.innerWidth,
    };
  })()`);
}

/**
 * The header is two columns at and above 44rem (704px) and ONE column below it,
 * where the action belongs under the text because there is no room beside it. So
 * the expectation differs by breakpoint, and asserting the wide rule on a narrow
 * viewport would be asserting a layout the stylesheet deliberately does not have.
 */
const TWO_COLUMN_MIN = 704;
const out = [];
for (const width of [1440, 1280, 1200, 1024, 900, 800, 720, 600, 420]) {
  const m = await measureAt(width);
  const wrapped = m.longLedeHeight > m.shortLedeHeight * 1.8;
  let ok, note;
  if (width >= TWO_COLUMN_MIN) {
    // The invariant: the action's offset from the top of its header is the same
    // whether the description is one line or five.
    ok = m.shortBtnOffset === m.longBtnOffset && m.shortBtnVsTitle === m.longBtnVsTitle && wrapped;
    note = `offset ${m.shortBtnOffset} vs ${m.longBtnOffset} · from title ${m.shortBtnVsTitle} vs ${m.longBtnVsTitle}`;
  } else {
    // Stacked, by design: the action follows the text. What is asserted is that
    // it IS stacked — i.e. below the description — rather than that it is pinned.
    ok = m.longBtnOffset > m.longLedeHeight && wrapped;
    note = `stacked by design — action at ${m.longBtnOffset}, below a ${m.longLedeHeight}px description`;
  }
  out.push(
    `${ok ? 'PASS' : 'FAIL'}  ${String(width).padStart(4)}px  ` +
      `lede ${m.shortLedeHeight}→${m.longLedeHeight}px  ${note}`,
  );
}
console.log(out.join('\n'));
console.log(`\n${out.filter((l) => l.startsWith('PASS')).length}/${out.length} widths passed`);
ws.close();
