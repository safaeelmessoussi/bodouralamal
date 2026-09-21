/**
 * **A recorder killed mid-class loses nothing recorded** — on the real stack
 * (SRS Revision 168 §2). See verify-recorder-crash.sh for what it does and why
 * it waits the platform's real quiet rule.
 */
import { execSync } from 'node:child_process';

import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9257');
const { check, finish } = results();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DC = 'docker compose -f docker-compose.yml -f docker-compose.dev.yml';
const sh = (cmd, input) =>
  execSync(cmd, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
// The statement travels on stdin: it carries quotes of its own.
const psql = (sql) => sh(DC + " exec -T db sh -c 'psql -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -At'", sql);
const ops = (script, args = '') => JSON.parse(sh(DC + ' exec -T api npm run --silent ' + script + (args ? ' -- ' + args : '')));

const sessionId = process.env.SESSION_ID;

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.TEACHER_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await send('Page.navigate', { url: BASE + '/classroom/' + sessionId });

let joined = 'waiting';
for (let i = 0; i < 100 && joined === 'waiting'; i += 1) {
  await wait(400);
  joined = await evaluate(`(() => {
    const stage = document.querySelector('.classroom__stage');
    if (stage && stage.getAttribute('data-connection') === 'connected') return 'in';
    if (document.body.innerText.includes('لا يمكنك دخول هذه الحصة')) return 'refused';
    return 'waiting';
  })()`).catch(() => 'waiting');
}
check('the مؤطِّرة enters the real online class', joined === 'in', joined);
if (joined !== 'in') {
  close();
  process.exit(finish());
}

const pressed = await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'بدء التسجيل');
  if (!b) return false;
  b.click();
  return true;
})()`);
check('she presses «بدء التسجيل»', pressed === true);

let recordingId = '';
for (let i = 0; i < 40 && recordingId === ''; i += 1) {
  await wait(1000);
  recordingId = psql(
    "select id from session_recording where session_id = '" + sessionId + "' and status = 'recording' and deleted_at is null order by started_at desc limit 1",
  );
}
check('a real recording is running', recordingId !== '', 'recording=' + recordingId);
if (recordingId === '') {
  close();
  process.exit(finish());
}

// Watched, not assumed: how soon the recorder's segments reach storage is the
// whole question, so the inventory is read every ten seconds while it records.
let before = null;
for (let waited = 0; waited < Number(process.env.RECORD_SECONDS); waited += 10) {
  await wait(10_000);
  before = ops('ops:recording-segments', recordingId);
  process.stdout.write('      +' + (waited + 10) + 's: ' + before.segments + ' segment(s) in storage\n');
}
check(
  'WHILE it records, safety segments are already in Bodour storage — and no final file yet',
  before.segments >= 2 && before.final_file === false,
  JSON.stringify(before),
);

process.stdout.write('      killing the recorder container (SIGKILL)…\n');
sh('docker kill $(' + DC + ' ps -q livekit-egress)');
await wait(3000);
sh(DC + ' up -d livekit-egress');

const after = ops('ops:recording-segments', recordingId);
check('the final file never arrived — this recording WOULD have been lost', after.final_file === false, JSON.stringify(after));
check(
  'and the provider STILL calls the dead job active — its word cannot be what decides',
  after.provider_state === 'recording' || after.provider_state === 'unknown' || after.provider_state === 'unreachable',
  'provider_state=' + after.provider_state,
);

/* ── She is told, and the rest of the class is recorded too ──────────────── */

let notice = false;
for (let i = 0; i < 40 && !notice; i += 1) {
  await wait(2000);
  notice = await evaluate(`(() => document.querySelector('[data-recorder-stalled]') !== null)()`).catch(() => false);
}
check('the classroom SAYS the recorder stopped, and that what was recorded is safe', notice === true);

// The server believes her only once storage agrees: ninety silent seconds.
await wait(75_000);
const pressedAgain = await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'بدء التسجيل');
  if (!b) return false;
  b.click();
  return true;
})()`);
check('«بدء التسجيل» is offered again, and she presses it', pressedAgain === true);

let secondId = '';
for (let i = 0; i < 40 && secondId === ''; i += 1) {
  await wait(1000);
  secondId = psql(
    "select id from session_recording where session_id = '" + sessionId + "' and id <> '" + recordingId +
      "' and status in ('starting','recording') and deleted_at is null order by started_at desc limit 1",
  );
}
const firstNow = psql("select status from session_recording where id = '" + recordingId + "'");
check(
  'a NEW recording runs, and the dead one left the live states with its segments kept',
  secondId !== '' && firstNow === 'processing',
  'second=' + secondId + ' first=' + firstNow,
);

await wait(25_000);
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'إيقاف التسجيل');
  if (b) b.click();
  return Boolean(b);
})()`);
let secondContent = '';
for (let i = 0; i < 45 && secondContent === ''; i += 1) {
  await wait(4000);
  secondContent = psql("select coalesce(educational_content_id::text, '') from session_recording where id = '" + secondId + "'");
}
check('the second part of the class reaches the library the ordinary way', secondContent !== '', 'content=' + secondContent);

/* ── …and the first part is assembled from its segments ──────────────────── */

// The real reconciler, under its real rule (ten silent minutes), every 45 s.
let outcome = null;
let recovered = false;
for (let attempt = 0; attempt < 20 && !recovered; attempt += 1) {
  await wait(45_000);
  outcome = ops('ops:reconcile-recordings');
  const state = psql("select status from session_recording where id = '" + recordingId + "'");
  process.stdout.write('      pass ' + (attempt + 1) + ' (' + state + '): ' + JSON.stringify(outcome) + '\n');
  recovered = state === 'completed';
}
check('the reconciler assembled the first part from its segments', recovered, JSON.stringify(outcome));

let contentId = '';
for (let i = 0; i < 30 && contentId === ''; i += 1) {
  await wait(4000);
  contentId = psql("select coalesce(educational_content_id::text, '') from session_recording where id = '" + recordingId + "'");
}
check('…and it reached the library', contentId !== '', 'content=' + contentId);
const facts = psql(
  "select r.status || '|' || r.recovered_from_segments || '|' || c.mime_type || '|' || c.size_bytes || '|' || (c.description is not null) " +
    "from session_recording r join educational_content c on c.id = r.educational_content_id where r.id = '" + recordingId + "'",
);
check(
  'completed, marked as recovered, a real audio file, and the library item says so',
  /^completed\|(t|true)\|audio\/mp4\|\d{5,}\|(t|true)$/.test(facts),
  facts,
);
const swept = ops('ops:recording-segments', recordingId);
check('staging is swept: no file and no segment left behind', swept.segments === 0 && swept.final_file === false, JSON.stringify(swept));

close();
process.exit(finish());
