/**
 * **R75 in a real browser, with a real MediaRecorder.**
 *
 * Chrome is started with --use-fake-device-for-media-capture, which supplies a
 * synthetic microphone to getUserMedia. **The API is not faked** — this is
 * Chrome's own MediaRecorder, encoding a real stream into a real container,
 * and what it produces is uploaded through the ordinary
 * initiate → PUT → complete pipeline into MinIO. Stubbing MediaRecorder
 * would prove nothing about the one thing this exists to check.
 *
 * --use-fake-ui-for-media-stream auto-answers the permission prompt, the one
 * part a headless browser cannot click; the permission is still REQUESTED
 * through getUserMedia exactly as it is in a person's browser.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9226');
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

/**
 * The elapsed reading, in seconds.
 *
 * The element also carries a visually-hidden state word ("0:02 جارٍ التسجيل"),
 * which is deliberate — the state is what a screen reader is told, since a clock
 * announced every second is unusable. So the probe matches the CLOCK rather than
 * parsing the whole node, which read NaN and failed three checks that were in
 * fact passing.
 */
const secs = (t) => {
  const m = /(\d+):(\d{2})/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/* ── the browser really has the API ──────────────────────────────────────── */

const sessionsPath = `/admin/schedules/${S.scheduleId}/sessions`;
const reached = await goto(sessionsPath, '.admin-table tbody tr');
check('the session list reaches the seeded class', reached === 'ready', `state=${reached}`);

const support = await evaluate(`(() => ({
  hasMediaRecorder: typeof MediaRecorder !== 'undefined',
  hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
  supported: ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
    .filter((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)),
}))()`);
check(
  '1 · a REAL MediaRecorder and getUserMedia are present (not stubbed)',
  support.hasMediaRecorder && support.hasGetUserMedia,
  JSON.stringify(support),
);
check(
  '2 · at least one TD-9-whitelisted container is supported',
  (support.supported ?? []).length > 0,
  String(support.supported),
);

/* ── the dialog, its two sections, and the control's authorisation ───────── */

const dialog = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')][0];
  const actions = [...row.querySelectorAll('button')].map((b) => b.textContent.trim());
  // The row action is «إرفاق محتوى» — named for what it does, not for the
  // dialog it opens. Probed by its real label rather than a guess.
  const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('إرفاق'));
  if (!btn) return { found: false, actions };
  btn.click();
  await new Promise((r) => setTimeout(r, 2500));
  const text = document.body.textContent;
  return {
    found: true,
    actions,
    date: row.textContent.match(/\\d{4}-\\d{2}-\\d{2}/)?.[0] ?? '',
    headings: [...document.querySelectorAll('h3')].map((h) => h.textContent.trim()),
    // «تسجيل صوتي» opens the recorder panel; «بدء التسجيل» inside it starts.
    hasRecorderToggle: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'تسجيل صوتي'),
    unsupportedNotice: text.includes('لا يدعم التسجيل الصوتي'),
  };
})()`);
check('3 · the materials dialog opens from a session row', dialog.found === true, JSON.stringify(dialog.actions));
check(
  '4 · educational materials and recordings are DISTINCT sections',
  (dialog.headings ?? []).some((h) => h.includes('مواد')) &&
    (dialog.headings ?? []).some((h) => h.includes('تسجيلات')),
  JSON.stringify(dialog.headings),
);
check('5 · the recorder is offered to an authorised role', dialog.hasRecorderToggle === true, JSON.stringify(dialog));
check('5b · no unsupported-browser notice, since the container IS supported', dialog.unsupportedNotice === false);

/* ── start · elapsed · pause · resume · stop ─────────────────────────────── */

const flow = await evaluate(`(async () => {
  const click = (text) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
    if (!b) throw new Error('no button: ' + text);
    b.click();
  };
  const elapsed = () => document.querySelector('.recorder__elapsed')?.textContent?.trim() ?? '';
  click('تسجيل صوتي');
  await new Promise((r) => setTimeout(r, 700));
  click('بدء التسجيل');
  await new Promise((r) => setTimeout(r, 2800));
  if (![...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'إيقاف مؤقّت')) {
    return {
      diagnostic: true,
      error: document.querySelector('.field__error')?.textContent?.trim() ?? null,
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
      elapsed: elapsed(),
    };
  }
  const recording = elapsed();
  const indicator = document.querySelector('.recorder__warning') !== null;
  click('إيقاف مؤقّت');
  await new Promise((r) => setTimeout(r, 1200));
  const atPause = elapsed();
  await new Promise((r) => setTimeout(r, 1800));
  const stillPaused = elapsed();
  click('استئناف');
  await new Promise((r) => setTimeout(r, 2400));
  const afterResume = elapsed();
  click('إنهاء التسجيل');
  await new Promise((r) => setTimeout(r, 1500));
  const nameField = [...document.querySelectorAll('input')]
    .find((i) => (i.closest('.field')?.textContent ?? '').includes('اسم التسجيل'));
  return {
    recording, atPause, stillPaused, afterResume, indicator,
    placeholder: nameField ? nameField.placeholder : null,
    canSave: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'حفظ التسجيل'),
    canDiscard: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'حذف التسجيل'),
  };
})()`);
if (flow.diagnostic) {
  check('6 · START records, and the elapsed reading advances', false, JSON.stringify(flow));
  close();
  process.exit(finish());
}
check('6 · START records, and the elapsed reading advances', secs(flow.recording) >= 2, JSON.stringify(flow));
check('7 · a recording indicator is shown while active (R75.7)', flow.indicator === true);
check(
  '8 · PAUSE freezes the reading — paused time is excluded',
  secs(flow.atPause) === secs(flow.stillPaused),
  `${flow.atPause} → ${flow.stillPaused}`,
);
check('9 · RESUME advances it again', secs(flow.afterResume) > secs(flow.stillPaused), `${flow.stillPaused} → ${flow.afterResume}`);
check('10 · STOP yields one saveable recording, with discard offered', flow.canSave && flow.canDiscard, JSON.stringify(flow));
check(
  '11 · the default name is derived from title, description AND date (R75.6)',
  (flow.placeholder ?? '').includes('[dev-scenario]') && (flow.placeholder ?? '').includes(dialog.date),
  flow.placeholder,
);

/* ── save · upload · EducationalContent · SessionContent ─────────────────── */

const saved = await evaluate(`(async () => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'حفظ التسجيل');
  b.click();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (![...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'حفظ التسجيل')) break;
  }
  // The save closes the recorder panel BEFORE the dialog refetches its lists,
  // so the list is read after it has actually repopulated rather than at the
  // first moment the button disappears.
  let listed = [];
  for (let i = 0; i < 30; i += 1) {
    listed = [...document.querySelectorAll('.materials__list li span')].map((n) => n.textContent.trim());
    if (listed.length > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    error: document.querySelector('.field__error')?.textContent?.trim() ?? null,
    listed,
  };
})()`);
check('12 · saving reports no error', saved.error === null, saved.error);
check('13 · the recording appears in the session materials list', (saved.listed ?? []).length > 0, JSON.stringify(saved.listed));

const page = JSON.parse((await api('GET', `/calendar/sessions/${S.firstSessionId}`)).body || '{}');
check(
  '14 · linked through SessionContent, and classified as a RECORDING',
  Array.isArray(page.recordings) && page.recordings.length >= 1,
  JSON.stringify((page.recordings ?? []).map((r) => r.title)),
);

const lib = JSON.parse(
  (await api('GET', `/library?level_id=${S.levelId}&subject_id=${S.subjectId}&page_size=100`)).body || '{}',
);
const ours = (lib.data ?? []).filter((c) => (page.recordings ?? []).some((r) => r.id === c.id));
check('15 · it is an ordinary EducationalContent in the library', ours.length >= 1, JSON.stringify(ours.map((c) => c.title)));

/* ── the bytes really reached storage ────────────────────────────────────── */

const dl = ours[0] ? await api('GET', `/content/${ours[0].id}/download-url`) : { status: 0, body: '' };
check('16 · storage issues a presigned URL for the stored object', dl.status === 200, `status=${dl.status}`);
let url = null;
try {
  const parsed = JSON.parse(dl.body);
  url = parsed.url ?? parsed.data?.url ?? null;
} catch {
  url = null;
}
const fetched = url
  ? await evaluate(`(async () => {
      const r = await fetch(${JSON.stringify(url)});
      const b = await r.blob();
      return { status: r.status, size: b.size, type: b.type };
    })()`)
  : null;
check(
  '17 · the object is a non-empty AUDIO file — the bytes really landed in MinIO',
  fetched !== null && fetched.status === 200 && fetched.size > 0 && String(fetched.type).startsWith('audio/'),
  JSON.stringify(fetched),
);

/* ── a second recording, numbered, overwriting nothing ───────────────────── */

const second = await evaluate(`(async () => {
  const click = (text) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
    if (!b) throw new Error('no button: ' + text);
    b.click();
  };
  // Read what the dialog believes is already linked, which is what the suffix
  // rule is computed from.
  const before = [...document.querySelectorAll('.materials__list li span')].map((n) => n.textContent.trim());
  click('تسجيل صوتي');
  await new Promise((r) => setTimeout(r, 700));
  click('بدء التسجيل');
  await new Promise((r) => setTimeout(r, 2400));
  click('إنهاء التسجيل');
  await new Promise((r) => setTimeout(r, 1500));
  const nameField = [...document.querySelectorAll('input')]
    .find((i) => (i.closest('.field')?.textContent ?? '').includes('اسم التسجيل'));
  const placeholder = nameField ? nameField.placeholder : null;
  click('حفظ التسجيل');
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (![...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'حفظ التسجيل')) break;
  }
  let listed = [];
  for (let i = 0; i < 30; i += 1) {
    listed = [...document.querySelectorAll('.materials__list li span')].map((n) => n.textContent.trim());
    if (listed.length > 1) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { before, placeholder, listed };
})()`);
check('18 · another recording can be made immediately after the first', (second.listed ?? []).length >= 2, JSON.stringify(second.listed));
check(
  '19 · its default name is suffixed « 2», so the first can never be overwritten',
  (second.placeholder ?? '').trim().endsWith(' 2'),
  second.placeholder,
);

const after = JSON.parse((await api('GET', `/calendar/sessions/${S.firstSessionId}`)).body || '{}');
check(
  '20 · BOTH recordings survive on the session, with distinct names',
  (after.recordings ?? []).length >= 2 &&
    new Set((after.recordings ?? []).map((r) => r.title)).size === (after.recordings ?? []).length,
  JSON.stringify((after.recordings ?? []).map((r) => r.title)),
);

close();
process.exit(finish());
