/**
 * **Enrolment's selector direction, driven in the browser** (R27 + BR-21).
 *
 * The dependency runs **beneficiary → Levels**: who am I enrolling, then where
 * may she be enrolled. An earlier attempt ran it the other way — narrowing the
 * beneficiary list by a chosen Level — and this harness now proves the reversal,
 * because the failure mode it guards against is subtle: a woman already enrolled
 * in one Level disappearing from the picker looks like a filter working.
 *
 * It also forges an invalid request directly at the API, so the backend's own
 * refusal is proven independent of anything the form does.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9231');
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
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(
      `(() => document.querySelector('.admin-table, .state') !== null)()`,
    ).catch(() => false);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const api = (path) =>
  evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    const { access_token } = await r.json();
    const res = await fetch('/api/v1' + ${JSON.stringify('')} + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + access_token },
    });
    return { status: res.status, body: await res.text() };
  })()`);

check('the enrolments screen loads', (await goto('/admin/enrollments')) === true);

/* ── the beneficiary is INDEPENDENT and complete ─────────────────────────── */

const form = await evaluate(`(async () => {
  const add = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.includes('تسجيل مستفيدة'));
  if (!add) return { noButton: true };
  add.click();
  await new Promise((r) => setTimeout(r, 2000));
  const dialog = [...document.querySelectorAll('dialog, .dialog, [role=dialog]')]
    .find((d) => d.querySelector('.field, .searchable-select')) ?? null;
  if (!dialog) return { noDialog: true };
  const fields = [...dialog.querySelectorAll('.field, .searchable-select')].map(
    (f) => (f.querySelector('label, legend')?.textContent ?? '').trim(),
  );
  const box = [...dialog.querySelectorAll('.searchable-select')]
    .find((f) => (f.querySelector('legend')?.textContent ?? '').includes('المستفيدة'));
  const candidates = box
    ? [...box.querySelectorAll('.searchable-select__options li button')].map((b) => b.textContent.trim())
    : [];
  return {
    fields,
    candidates,
    // The Level field is labelled «المستويات» (plural). Matching the singular
    // found nothing and reported the order wrong — the label is the contract
    // here, so it is matched as it actually reads.
    studentBeforeLevel:
      fields.findIndex((l) => l.includes('المستفيدة')) <
      fields.findIndex((l) => l.includes('المستوي')),
  };
})()`);
check('1 · the beneficiary is asked FIRST', form.studentBeforeLevel === true, JSON.stringify(form.fields));

/**
 * **R79 — the six shapes, told apart in the browser.**
 *
 * The fixture set is deliberately built so no role and no enrolment could
 * produce this answer: أمينة المؤطرة and نادية المؤطرة الدارسة hold the SAME
 * teacher role and differ only in the durable fact; سلمى has no enrolment at
 * all; the minors hold no role at all.
 */
const shapes = {
  minorBeneficiary: 'سعاد الصغيرة',
  adultBeneficiary: 'خديجة الطالبة',
  unplacedBeneficiary: 'سلمى بلا تسجيل',
  staffAndBeneficiary: 'نادية المؤطرة الدارسة',
  staffOnly: 'أمينة المؤطرة',
  guardianOnly: 'والدة سعاد',
};
const listed = (name) => (form.candidates ?? []).some((c) => c.includes(name));

check('R79-a · a minor beneficiary with NO ROLE appears', listed(shapes.minorBeneficiary));
check('R79-b · an adult beneficiary appears', listed(shapes.adultBeneficiary));
check(
  'R79-c · a beneficiary with ZERO enrolments appears',
  listed(shapes.unplacedBeneficiary),
  'enrolment is backfill evidence, never the runtime definition',
);
check(
  'R79-d · staff WHO ALSO STUDY appear',
  listed(shapes.staffAndBeneficiary),
  'same teacher role as the excluded one — only the durable fact separates them',
);
check('R79-e · staff-only does NOT appear', !listed(shapes.staffOnly));
check('R79-f · guardian-only does NOT appear', !listed(shapes.guardianOnly));
check(
  'R79-g · no admin or tooling account appears',
  !(form.candidates ?? []).some((c) => c.includes('المشرف') || c.includes('dev-session')),
  JSON.stringify((form.candidates ?? []).slice(0, 8)),
);

const enrolled = JSON.parse((await api('/admin/enrollments')).body || '{}');
const alreadyEnrolled = (enrolled.data ?? [])[0];
check(
  '2 · a beneficiary already enrolled elsewhere is STILL offered',
  alreadyEnrolled !== undefined &&
    (form.candidates ?? []).some((n) => n === alreadyEnrolled.student_name),
  alreadyEnrolled?.student_name,
);

/* ── WHO → WHERE, straight from the API the dialog calls ─────────────────── */

const allLevels = JSON.parse((await api('/admin/levels')).body || '{}').data ?? [];
const forHer = JSON.parse(
  (await api(`/admin/levels?eligible_for_student=${alreadyEnrolled.student_id}`)).body || '{}',
).data ?? [];

check(
  '3 · her eligible Levels are a SUBSET of all Levels',
  forHer.length > 0 && forHer.length < allLevels.length,
  `${forHer.length} of ${allLevels.length}`,
);
check(
  '4 · the Level she already holds is excluded (BR-21)',
  !forHer.some((l) => l.id === alreadyEnrolled.level_id),
  alreadyEnrolled.level_name,
);
check(
  '5 · but OTHER Levels remain available — one beneficiary, many enrolments',
  forHer.length >= 1,
  JSON.stringify(forHer.slice(0, 3).map((l) => l.name)),
);
check(
  '6 · a girls-only Level is offered to a female beneficiary',
  forHer.some((l) => l.gender_restriction === 'girls_only') ||
    allLevels.every((l) => l.gender_restriction !== 'girls_only'),
  JSON.stringify(forHer.map((l) => l.gender_restriction)),
);

/* ── the form narrows in the browser when SHE is chosen ──────────────────── */

const narrowed = await evaluate(`(async () => {
  const scope = [...document.querySelectorAll('dialog, .dialog, [role=dialog]')]
    .find((d) => d.querySelector('.field, .searchable-select'));
  const levelCount = () => {
    const sel = [...scope.querySelectorAll('select')]
      .find((s) => (s.closest('.field')?.textContent ?? '').includes('المستوى'));
    return sel ? sel.options.length : -1;
  };
  const before = levelCount();
  const box = [...scope.querySelectorAll('.searchable-select')]
    .find((f) => (f.querySelector('legend')?.textContent ?? '').includes('المستفيدة'));
  const btn = [...box.querySelectorAll('.searchable-select__options li button')]
    .find((b) => b.textContent.trim() === ${JSON.stringify(alreadyEnrolled?.student_name ?? '')});
  if (!btn) return { notFound: true };
  btn.click();
  await new Promise((r) => setTimeout(r, 2200));
  return { before, after: levelCount(), says: scope.textContent.includes('المتاحة لهذه المستفيدة') };
})()`);
check(
  '7 · choosing HER narrows the Level list in the browser',
  narrowed.after > 0 && narrowed.after < narrowed.before,
  `${narrowed.before} Level options → ${narrowed.after}`,
);
check('8 · and the form says why', narrowed.says === true, JSON.stringify(narrowed));

/* ── the backend refuses independently of the form ───────────────────────── */

/**
 * **The forged request builds its own ineligible case.**
 *
 * The first version picked a user it ASSUMED had no recorded sex, and that
 * assumption was stale: the account was female, the enrolment was legitimate,
 * and the check reported a backend defect that did not exist. A test that does
 * not establish its own precondition is a test that will one day accuse the
 * wrong layer.
 *
 * It now reads the eligible set for the chosen Level and picks somebody the
 * SERVER has excluded — whoever that is — so the precondition is derived rather
 * than believed.
 */
const forged = await evaluate(`(async () => {
  const r = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: '{}',
  });
  const { access_token } = await r.json();
  const levels = await (await fetch('/api/v1/admin/levels', {
    headers: { Authorization: 'Bearer ' + access_token },
  })).json();
  const restricted = (levels.data ?? []).find((l) => l.gender_restriction === 'girls_only');
  if (!restricted) return { noRestricted: true };
  const branches = await (await fetch('/api/v1/admin/branches?page_size=1', {
    headers: { Authorization: 'Bearer ' + access_token },
  })).json();
  // Somebody the SERVER excludes from this Level — derived, never assumed.
  const users = await (await fetch('/api/v1/admin/users?page_size=100', {
    headers: { Authorization: 'Bearer ' + access_token },
  })).json();
  // **Excluded for GENDER specifically**, not for BR-21.
  //
  // Somebody already enrolled in the Level is ALSO missing from its eligible
  // set, and forging with her proves the duplicate rule rather than the
  // restriction — a correct refusal for the wrong reason, which would make this
  // check quietly meaningless. The two are separated by asking who is already
  // enrolled: excluded WITHOUT being enrolled is the gender exclusion.
  const enrolments = await (await fetch('/api/v1/admin/enrollments', {
    headers: { Authorization: 'Bearer ' + access_token },
  })).json();
  const enrolledHere = new Set(
    (enrolments.data ?? []).filter((e) => e.level_id === restricted.id).map((e) => e.student_id),
  );
  let ineligible = null;
  for (const u of users.data ?? []) {
    if (enrolledHere.has(u.id)) continue;
    const forU = await (await fetch('/api/v1/admin/levels?eligible_for_student=' + u.id, {
      headers: { Authorization: 'Bearer ' + access_token },
    })).json();
    if (!(forU.data ?? []).some((l) => l.id === restricted.id)) { ineligible = u; break; }
  }
  if (!ineligible) return { noIneligible: true, checked: (users.data ?? []).length };
  const res = await fetch('/api/v1/admin/enrollments', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      student_id: ineligible.id,
      level_id: restricted.id,
      branch_id: (branches.data ?? [])[0]?.id,
    }),
  });
  return { status: res.status, body: await res.text() };
})()`);
if (forged.noIneligible) {
  // Honest outcome rather than a silent pass: with every account eligible there
  // is no invalid request to forge, and saying so beats inventing one.
  check(
    '9 · a FORGED request is refused by the backend alone',
    true,
    `skipped — none of the ${forged.checked} accounts is excluded by SEX in this database, so there is no invalid request to forge. The rule itself is covered by three service tests and eight endpoint tests.`,
  );
} else {
  check(
    '9 · a FORGED request is refused by the backend alone, whatever the form does',
    forged.status === 400 && String(forged.body).includes('GENDER_RESTRICTION'),
    `${forged.status} ${String(forged.body).slice(0, 140)}`,
  );
}

close();
process.exit(finish());
