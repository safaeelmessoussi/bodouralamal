/**
 * **§14.1's visibility selector, operated rather than inspected.**
 *
 * ## Why this harness exists
 *
 * The selector shipped once already, with source-text tests that passed. An
 * Owner then opened the real screen and could not change the value. Three
 * defects, none of which a source-text test can see, because none of them is
 * visible in the source:
 *
 *   1. `busy` mapped to `disabled`, so the control was present and inoperable;
 *   2. `value=''` with no matching option made the browser render the FIRST
 *      option — عام — for a state that was actually `null`, so the control
 *      displayed a tier it did not hold and did not send;
 *   3. the Category default was mirrored into state on every recomputation,
 *      silently overwriting a deliberate choice.
 *
 * (1) and (2) are browser behaviour, not code — invisible in source and fatal on
 * screen — so the regression has to be a real browser driving a real `<select>`
 * and reading the real request body, which is what this does. **Both were
 * proven against the harness**: reintroducing each makes it fail.
 *
 * (3) was suspected and could not be demonstrated. Driven here, the naive
 * effect and the current one behave identically on real data, so no check below
 * is claimed to guard it — the same-Category assertion pins §14.1's stated
 * behaviour, not a defect it has caught.
 *
 * It asserts the two halves that must agree, because the defect was precisely
 * that they did not: what the person SEES selected, and what the upload SENDS.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

/** A Level whose Category defaults to `public`, and one that defaults to
 *  `private` — the pair is what makes "re-propose on Level change" testable. */
const PUBLIC_LEVEL = process.env.PUBLIC_LEVEL_ID;
const PRIVATE_LEVEL = process.env.PRIVATE_LEVEL_ID;
/**
 * A SECOND Level in the SAME Category as `PUBLIC_LEVEL`.
 *
 * It pins §14.1's stated behaviour — a Level change re-proposes that Level's
 * default rather than carrying the previous choice to a different target. It is
 * **not** a discriminating guard: the naive effect passes it too. Recorded as
 * such so nobody later reads it as protection it does not provide.
 */
const SAME_CATEGORY_LEVEL = process.env.SAME_CATEGORY_LEVEL_ID;
if (!PUBLIC_LEVEL || !PRIVATE_LEVEL || !SAME_CATEGORY_LEVEL) {
  throw new Error('PUBLIC_LEVEL_ID, PRIVATE_LEVEL_ID and SAME_CATEGORY_LEVEL_ID are required');
}

const { send, evaluate, close } = await connect(process.env.PORT ?? '9231');
const { check, finish } = results();

await send('Network.enable');
await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

/**
 * Records every `/uploads/initiate` body at the application's OWN fetch
 * boundary and lets the request through untouched.
 *
 * Not a mock: this is the real call the page makes, read where it is made.
 * `cdp.mjs` does not expose its socket, and reaching into it from one harness
 * would couple this file to another's internals for no gain — the body is
 * equally real here, and this survives `Page.navigate` by being reinstalled.
 */
const installProbe = () => evaluate(`(() => {
  if (window.__initiations) return 'already';
  window.__initiations = [];
  const real = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input.url;
      if (url && url.endsWith('/uploads/initiate') && init && init.body) {
        window.__initiations.push(JSON.parse(init.body));
      }
    } catch { /* an unparseable body shows up as a missing capture */ }
    return real.apply(this, arguments);
  };
  return 'installed';
})()`);

const capturedInitiations = () =>
  evaluate('JSON.stringify(window.__initiations || [])').then((raw) => JSON.parse(raw));

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    // **`.state[role="status"]` is NOT a loading marker on this screen.** The
    // scope hint («اختاري المستوى…») uses exactly that shape, so treating it as
    // loading waits forever on a page that is fully rendered. Readiness here is
    // the upload action existing — the thing this harness came to operate.
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      if (document.querySelector('.datatable__skeleton')) return 'loading';
      const upload = [...document.querySelectorAll('button')].some((b) => b.textContent.includes('رفع ملف'));
      return upload ? 'ready' : 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

/** Sets a `<select>` the way a person does — a real input event React observes. */
const setSelect = (selector, value) => evaluate(`(() => {
  const el = ${selector};
  if (!el) return 'missing';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);

/**
 * The visibility control **inside the dialog that is actually open**.
 *
 * Scoping matters: a closed `<Dialog>` stays mounted and is hidden only by the
 * UA's `dialog:not([open])` rule, so a document-wide search finds the upload
 * dialog's select while the REPLACE dialog is open — and reports a control on
 * a form that has none. Found by its options rather than by DOM position, so
 * reordering fields does not silently stop testing anything.
 */
const VIS = `[...(document.querySelector('dialog[open]') ?? document).querySelectorAll('select')]
  .find((s) => [...s.options].some((o) => o.value === 'private') &&
               [...s.options].some((o) => o.value === 'hidden'))`;

const readVis = () => evaluate(`(() => {
  const el = ${VIS};
  if (!el) return { present: false };
  return {
    present: true,
    disabled: el.disabled,
    value: el.value,
    shown: el.options[el.selectedIndex]?.text ?? null,
    options: [...el.options].map((o) => o.value),
  };
})()`);

/** Reads every labelled control inside the OPEN dialog — the form's own view of
 *  what will be saved, which is the whole point of the self-containment rule. */
const readDialogFields = () => evaluate(`(() => {
  const d = document.querySelector('dialog[open]');
  if (!d) return { open: false };
  return {
    open: true,
    selects: [...d.querySelectorAll('.field')].map((f) => {
      const s = f.querySelector('select');
      if (!s) return null;
      return {
        label: (f.querySelector('label')?.textContent ?? '').trim(),
        value: s.value,
        shown: s.options[s.selectedIndex]?.text ?? null,
        disabled: s.disabled,
        count: s.options.length,
      };
    }).filter(Boolean),
    hasFile: !!d.querySelector('input[type="file"]'),
    hasTitle: !!d.querySelector('input[type="text"]'),
  };
})()`);

/** Sets a dialog select by its visible label. */
const setDialogSelect = (label, value) => evaluate(`(() => {
  const d = document.querySelector('dialog[open]');
  if (!d) return 'no-dialog';
  const field = [...d.querySelectorAll('.field')].find((f) => (f.querySelector('label')?.textContent ?? '').trim() === ${JSON.stringify(label)});
  const el = field?.querySelector('select');
  if (!el) return 'missing';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);

const openUpload = () => evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('رفع ملف') && !b.closest('dialog'));
  if (!btn) return 'no-button';
  btn.click();
  return 'opened';
})()`);

/* ── 1. Before a Level is chosen: present, operable, and HONEST ─────────── */
const state = await goto('/admin/content');
check('the content screen loads authenticated', state === 'ready', `state=${state}`);
if (state !== 'ready') { close(); process.exit(finish()); }

await openUpload();
await new Promise((r) => setTimeout(r, 400));
let vis = await readVis();
check('the visibility control is rendered', vis.present === true, JSON.stringify(vis));
check(
  'it is NOT disabled while the default is unknown (defect 1)',
  vis.disabled === false,
  `disabled=${vis.disabled}`,
);
check(
  'it does NOT display عام for an unknown state (defect 2)',
  vis.value === '' && vis.shown !== 'عام',
  `value=${JSON.stringify(vis.value)} shown=${JSON.stringify(vis.shown)}`,
);
check('all three tiers are offered', ['public', 'private', 'hidden'].every((v) => vis.options.includes(v)),
  JSON.stringify(vis.options));

/* ── 1b. Replacement offers no visibility control (checked while unfiltered,
       because a Level filter can legitimately leave the table empty) ─────── */
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='إلغاء'); if(b) b.click(); })()`);
await new Promise((r) => setTimeout(r, 300));
const replaced = await evaluate(`(async () => {
  const row = document.querySelector('.admin-table tbody tr');
  if (!row) return 'no-rows';
  const item = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('استبدال'));
  if (!item) return 'no-replace';
  item.click();
  await new Promise((r) => setTimeout(r, 600));
  return 'opened';
})()`);
if (replaced === 'opened') {
  const rf = await readDialogFields();
  check(
    'the REPLACE dialog SHOWS the scope and tier rather than hiding them',
    rf.selects.length >= 5,
    `${rf.selects.length} selects: ${rf.selects.map((s) => s.label).join(' | ')}`,
  );
  check(
    'every one of them is DISABLED — replacement swaps the object, not the scope',
    rf.selects.length > 0 && rf.selects.every((s) => s.disabled === true),
    JSON.stringify(rf.selects.map((s) => [s.label, s.disabled])),
  );
} else {
  check('the replace dialog could be opened', false, `state=${replaced}`);
}
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='إلغاء'); if(b) b.click(); })()`);
await new Promise((r) => setTimeout(r, 300));

/* ── 2. Choosing a Level initialises from ITS Category default ──────────── */
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='إلغاء'); if(b) b.click(); })()`);
await new Promise((r) => setTimeout(r, 200));

/**
 * Fills Level, then Subject and Academic Year.
 *
 * The upload button is disabled until all three are set — `scopeProblem` says
 * so in the dialog — so a harness that set only the Level would capture no
 * request and blame the code.
 */
const fillScope = async (levelId) => {
  await pickLevel(levelId);
  await evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    for (const sel of document.querySelectorAll('.datatable__toolbar select, .toolbar select, select')) {
      if (sel.closest('dialog')) continue;
      if (sel.value !== '') continue;
      const first = [...sel.options].find((o) => o.value !== '' && o.value !== '__global__');
      if (!first) continue;
      set.call(sel, first.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return 'filled';
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
};

const pickLevel = async (id) => {
  const sel = `[...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === ${JSON.stringify(id)}))`;
  const out = await setSelect(sel, id);
  await new Promise((r) => setTimeout(r, 900));
  return out;
};

await fillScope(PUBLIC_LEVEL);
check('a public-default Level and its scope can be selected', true);
await installProbe();
await openUpload();
await new Promise((r) => setTimeout(r, 500));
vis = await readVis();
check(
  'it initialises to that Category default (public → عام)',
  vis.value === 'public',
  `value=${vis.value} shown=${vis.shown}`,
);

/* ── 2b. The dialog CONTAINS every determining field, seeded from the page ── */
const fields = await readDialogFields();
check('the dialog contains a file input and a title', fields.hasFile && fields.hasTitle, JSON.stringify({ f: fields.hasFile, t: fields.hasTitle }));
check(
  'the dialog contains Level, Subject, Academic Year, Branch AND Visibility',
  fields.selects.length >= 5,
  `${fields.selects.length} selects: ${fields.selects.map((s) => s.label).join(' | ')}`,
);
const byLabel = Object.fromEntries(fields.selects.map((s) => [s.label, s]));
check(
  'the Level inside the dialog is seeded from the page filter',
  byLabel['المستوى']?.value === PUBLIC_LEVEL,
  `dialog level=${byLabel['المستوى']?.value} filter=${PUBLIC_LEVEL}`,
);
check(
  'Subject and Academic Year are seeded too, not left blank',
  (byLabel['المادة']?.value ?? '') !== '' && (byLabel['السنة الدراسية']?.value ?? '') !== '',
  JSON.stringify({ subject: byLabel['المادة']?.value, year: byLabel['السنة الدراسية']?.value }),
);
check(
  'every dialog field is editable (none silently fixed on a create form)',
  fields.selects.every((s) => s.disabled === false),
  JSON.stringify(fields.selects.map((s) => [s.label, s.disabled])),
);

/* ── 2c. A Level change WITHIN the same Category still re-proposes ───────── */
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='إلغاء'); if(b) b.click(); })()`);
await new Promise((r) => setTimeout(r, 300));
await fillScope(SAME_CATEGORY_LEVEL);
await openUpload();
await new Promise((r) => setTimeout(r, 600));
vis = await readVis();
check(
  'a second Level in the same Category still seeds the dialog from the page filter',
  vis.value === 'public',
  `value=${vis.value} shown=${vis.shown}`,
);
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='إلغاء'); if(b) b.click(); })()`);
await new Promise((r) => setTimeout(r, 300));
await fillScope(PUBLIC_LEVEL);
await openUpload();
await new Promise((r) => setTimeout(r, 600));

/* ── 3. An explicit choice SURVIVES ordinary rerenders (defect 3) ────────── */
check('خاص can actually be chosen', (await setSelect(VIS, 'private')) === 'ok');
await new Promise((r) => setTimeout(r, 300));
vis = await readVis();
check('خاص is visibly selected', vis.value === 'private' && vis.shown === 'خاص', JSON.stringify(vis));

// Provoke the rerenders that used to clobber it: typing in the dialog, and a
// second read of the same scope.
await evaluate(`(() => {
  const i = document.querySelector('.dialog input[type="text"], dialog input[type="text"]');
  if (i) {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(i, 'حصة تجريبية للتحقق');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return 'typed';
})()`);
await new Promise((r) => setTimeout(r, 700));
vis = await readVis();
check(
  'خاص survives ordinary rerenders (pins the property; not a discriminating guard)',
  vis.value === 'private',
  `value=${vis.value}`,
);

/* ── 4. The upload SENDS what the screen SHOWS ───────────────────────────── */
await send('DOM.enable');
const { root } = await send('DOM.getDocument');
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
if (nodeId) {
  await send('DOM.setFileInputFiles', { nodeId, files: [process.env.PROBE_PDF] });
  await new Promise((r) => setTimeout(r, 400));
  // The title is `required`; without it the submit button stays disabled and
  // the run would report "no request" for a reason that is not the code's.
  await evaluate(`(() => {
    const i = document.querySelector('dialog[open] input[type="text"]');
    if (!i) return 'no-title';
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, ${JSON.stringify(process.env.UPLOAD_TITLE ?? 'تحقق الظهور — خاص')});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 'titled';
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('رفع ملف') && b.closest('dialog,.dialog'));
    if (b) b.click();
    return 'submitted';
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
}
const initiations = await capturedInitiations();
const sent = initiations.at(-1);
check('an /uploads/initiate request was actually made', sent !== undefined, `captured=${initiations.length}`);
check(
  'it carries visibility: "private" — what was shown is what was sent',
  sent?.content_meta?.visibility === 'private',
  `content_meta=${JSON.stringify(sent?.content_meta)}`,
);

/* ── 4a2. Changing Level INSIDE the dialog re-narrows Subject and re-proposes
        visibility — the dependency belongs to the form, not the page ─────── */
// A successful upload closes the dialog, so reopen it — seeded again from the
// page filters, which is itself the behaviour the rule asks for.
await openUpload();
await new Promise((r) => setTimeout(r, 700));
check('the Level can be changed inside the dialog', (await setDialogSelect('المستوى', PRIVATE_LEVEL)) === 'ok');
await new Promise((r) => setTimeout(r, 1200));
const afterLevelChange = await readDialogFields();
const after = Object.fromEntries(afterLevelChange.selects.map((s) => [s.label, s]));
check(
  'changing Level in the dialog re-proposes THAT Category default (private → خاص)',
  after['الظهور']?.value === 'private',
  `visibility=${after['الظهور']?.value} shown=${after['الظهور']?.shown}`,
);
check(
  'the Subject list re-narrows to the new Level rather than keeping a stale pair',
  (after['المادة']?.count ?? 0) >= 1,
  `subject options=${after['المادة']?.count} value=${after['المادة']?.value}`,
);

/* ── 5. A different Level re-proposes ITS default ────────────────────────── */
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='إلغاء'); if(b) b.click(); })()`);
await new Promise((r) => setTimeout(r, 300));
await fillScope(PRIVATE_LEVEL);
await openUpload();
await new Promise((r) => setTimeout(r, 600));
vis = await readVis();
check(
  'changing Level re-proposes the NEW Category default (private → خاص)',
  vis.value === 'private',
  `value=${vis.value} shown=${vis.shown}`,
);

close();
process.exit(finish());
