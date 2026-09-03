/**
 * **The assessment builder, on the real pages** (SRS §4.6, R124).
 *
 * ## What needs a browser
 *
 * The domain rules are pinned against PostgreSQL by
 * `assessment.integration.test.ts`, and the interface's decisions by
 * `assessment-ui.test.ts`. Neither can see the thing this exists for: **that a
 * مؤطِّرة can reach the builder at all**, and that a beneficiary's حفظ and إرسال
 * actually reach the API from the page she is given. R124 shipped without a
 * harness, and the مؤطِّرة route was missing entirely until it was looked for —
 * a complete capability with no reach is what a browser check catches and a
 * unit test cannot.
 *
 * Four checks, in the order the three people meet them:
 *
 * 1. **the مؤطِّرة reaches بناء الاختبارات** — the node this session added,
 *    rendering the same component the back office does;
 * 2. the beneficiary's list shows the published paper;
 * 3. **حفظ saves a draft** and the answer survives a reload;
 * 4. **إرسال asks first, then locks** — the controls are disabled afterwards.
 *
 * It owns its rows (P1.2) through `seed-assessment-scenario.ts`, which the
 * wrapper cleans by its own tag.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const TAG = '[asmguard]';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9257');
const { check, finish } = results();

/**
 * `POST /auth/refresh` needs the CSRF headers every browser sends and answers
 * with the token at the TOP level — it is not wrapped in the `{ data }` envelope
 * the resource routes use. Same helper `verify-admin-navigation` uses, for the
 * same reason: a synthetic token would assert a synthetic rule.
 */
const accessTokenFor = async (cookie) => {
  const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE,
      Cookie: `bodour_refresh=${cookie}`,
    },
  });
  return (await res.json())?.access_token ?? null;
};

const api = async (method, path, token, body) => {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const superToken = await accessTokenFor(process.env.SUPER_API_COOKIE);
const created = await api('POST', '/assessments', superToken, {
  title: `${TAG} ورقة تجريبية`,
  max_grade: 20,
  level_id: process.env.LEVEL_ID,
  subject_id: process.env.SUBJECT_ID,
  academic_year_id: process.env.YEAR_ID,
  target: { kind: 'level' },
  date: process.env.WHEN,
});
const examId = created.body?.id;
check(
  '0 · the builder creates a paper and publishes it through its own API',
  created.status === 201 && Boolean(examId),
  JSON.stringify(created),
);
await api('POST', `/assessments/${examId}/questions`, superToken, {
  kind: 'long_text',
  prompt: 'اشرحي ما تعلمتِه.',
});
await api('POST', `/assessments/${examId}/publish`, superToken, {});

const setCookie = (value) =>
  send('Network.setCookie', {
    name: 'bodour_refresh',
    value,
    domain: 'localhost',
    path: '/api/v1/auth',
    httpOnly: true,
  });

const goto = async (path, settle = 4000) => {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await new Promise((r) => setTimeout(r, settle));
};

/* ── 1 · the مؤطِّرة reaches the builder ─────────────────────────────────── */

await setCookie(process.env.TEACHER_COOKIE);
await goto('/teacher/assessments');

const teacherView = await evaluate(`(() => {
  const body = document.body.textContent;
  return {
    heading: (document.querySelector('h1')?.textContent ?? '').trim(),
    // The page's own action, not a menu label — a node that renders the pending
    // placeholder would still show the label in the sidebar.
    hasCreate: [...document.querySelectorAll('button')].some((b) =>
      b.textContent.includes('اختبار جديد'),
    ),
    pending: body.includes('قيد الإعداد') || body.includes('قيد التحضير'),
    inMenu: body.includes('بناء الاختبارات'),
  };
})()`);

check(
  '1 · a مؤطِّرة reaches بناء الاختبارات, and gets the builder rather than a pending placeholder',
  teacherView.hasCreate === true && teacherView.pending === false && teacherView.inMenu === true,
  JSON.stringify(teacherView),
);

/* ── 1b · the picker offers people, not UUIDs ────────────────────────────── */

const picker = await evaluate(`(async () => {
  const add = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.includes('اختبار جديد'),
  );
  if (!add) return { noAdd: true };
  add.click();
  await new Promise((r) => setTimeout(r, 1200));
  const d = document.querySelector('dialog[open]');
  if (!d) return { noDialog: true };

  const setSelect = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Choose the individual-beneficiary target, which is the arm that used to ask
  // for a pasted UUID and the one R125's teaching rule governs.
  const selects = [...d.querySelectorAll('select')];
  const targetSelect = selects.find((sel) =>
    [...sel.options].some((o) => o.textContent.includes('مستفيدة واحدة')),
  );
  if (!targetSelect) return { noTargetSelect: true, labels: selects.map((x) => x.options.length) };
  const opt = [...targetSelect.options].find((o) => o.textContent.includes('مستفيدة واحدة'));
  setSelect(targetSelect, opt.value);
  await new Promise((r) => setTimeout(r, 2500));

  const after = [...d.querySelectorAll('select')];
  const candidates = after
    .flatMap((sel) => [...sel.options].map((o) => o.textContent.trim()))
    .filter((label) => label.includes(${JSON.stringify(TAG)}));

  return {
    // **Named people, not identifiers.** The whole point of the picker.
    candidates,
    // A UUID would look like one; none must.
    anyUuidShaped: candidates.some((c) => /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(c)),
    hasTextIdBox: [...d.querySelectorAll('input[type="text"]')].some((i) =>
      /^[0-9a-f-]{20,}$/i.test(i.value),
    ),
  };
})()`);

check(
  '1b · the target picker offers her OWN student by name, never a UUID box',
  Array.isArray(picker.candidates) &&
    picker.candidates.some((c) => c.includes('مستفيدة')) &&
    picker.anyUuidShaped === false &&
    picker.hasTextIdBox === false,
  JSON.stringify(picker),
);

/* ── 2–4 · the beneficiary answers ───────────────────────────────────────── */

await setCookie(process.env.STUDENT_COOKIE);
await goto('/dashboard/student/assessments');

const listed = await evaluate(`(() => {
  const items = [...document.querySelectorAll('.assessment-list > li')].map((li) =>
    li.textContent.replace(/\\s+/g, ' ').trim(),
  );
  return { items, mine: items.filter((t) => t.includes(${JSON.stringify(TAG)})) };
})()`);

check(
  '2 · the published paper is on her list, and reads as not yet started',
  listed.mine.length === 1 && listed.mine[0].includes('لم تبدئي بعد'),
  JSON.stringify(listed),
);

const saved = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.assessment-list > li')].find((li) =>
    li.textContent.includes(${JSON.stringify(TAG)}),
  );
  if (!row) return { noRow: true };
  const open = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'فتح');
  if (!open) return { noOpen: true };
  open.click();
  await new Promise((r) => setTimeout(r, 2000));

  const field = document.querySelector('.assessment-questions textarea, .assessment-questions input[type="text"]');
  if (!field) return { noField: true, text: document.body.textContent.slice(0, 300) };
  const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(field, 'جوابي المحفوظ');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));

  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  if (!save) return { noSave: true };
  save.click();
  await new Promise((r) => setTimeout(r, 2500));
  return { notice: document.body.textContent.includes('محفوظ') };
})()`);

check(
  '3 · حفظ saves a draft — and it is a DRAFT, not a submission',
  saved.notice === true,
  JSON.stringify(saved),
);

const reloaded = await evaluate(`(async () => {
  const res = await fetch('/api/v1/me/assessments', { headers: { accept: 'application/json' } });
  return { ok: res.ok };
})()`);

const submitted = await evaluate(`(async () => {
  // **The confirmation is part of the contract**, not decoration: إرسال cannot
  // be undone, so the page asks before it happens.
  const submit = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'إرسال الإجابات',
  );
  if (!submit) return { noSubmit: true };
  submit.click();
  await new Promise((r) => setTimeout(r, 1000));
  const dialog = document.querySelector('dialog[open]');
  const asked = Boolean(dialog) && dialog.textContent.includes('لا يمكنك تعديل');
  if (!dialog) return { notAsked: true };
  const confirm = [...dialog.querySelectorAll('button')].find((b) =>
    b.textContent.includes('إرسال'),
  );
  confirm.click();
  await new Promise((r) => setTimeout(r, 2500));

  const fields = [...document.querySelectorAll('.assessment-questions textarea, .assessment-questions input')];
  return {
    asked,
    done: document.body.textContent.includes('تم') || document.body.textContent.includes('أُرسلت'),
    allDisabled: fields.length > 0 && fields.every((f) => f.disabled),
    // **Outside any dialog.** The confirmation's own confirm button carries the
    // same label, so an unscoped query finds it and reports the page as still
    // offering a submit it no longer offers.
    stillOffersSubmit: [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'إرسال الإجابات' && b.closest('dialog') === null,
    ),
  };
})()`);

check(
  '4 · إرسال asks first, then locks every control and stops offering itself',
  submitted.asked === true &&
    submitted.allDisabled === true &&
    submitted.stillOffersSubmit === false,
  JSON.stringify({ ...submitted, meReadable: reloaded.ok }),
);

await close();
process.exit(finish());
