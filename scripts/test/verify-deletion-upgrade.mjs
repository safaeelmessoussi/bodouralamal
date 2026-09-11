// B2/B3/B7's representative upgrade. Creates its OWN PostgreSQL 18.4 container;
// never accepts a connection URL, operator env file, existing DB or volume.
// Run from backend: node --import tsx ../scripts/test/verify-deletion-upgrade.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '../../backend/src/lib/prisma.ts';
import { lockNormalizedEmail, emailClaimingUserIds } from '../../backend/src/repositories/user.repository.ts';
import { emailLockDigest } from '../../backend/src/lib/email-lock.ts';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const root = fileURLToPath(new URL('../../backend/prisma/migrations/', import.meta.url));
const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
const baseline = 'a4174b1102fb38e7aa889287700d7201099accb8';
const migration = '20260911100000_deletion_generation_identity_minimization';
const container = `bodour-b237-upgrade-${process.pid}`;
const docker = (...args) => execFileSync('docker', args, { timeout: 30_000, encoding: 'utf8' }).trim();
const password = 'disposable-upgrade-password';
process.env.EMAIL_LOCK_KEY = 'b237-upgrade-fixture-key-at-least-32-bytes';
let started = false;
let db;
let prisma;
let schemaFixture;
try {
  docker('run', '--rm', '-d', '--name', container,
    '--label', 'bodour.disposable=b237-upgrade', '--tmpfs', '/var/lib/postgresql',
    '-e', 'POSTGRES_USER=app', '-e', 'POSTGRES_DB=b237_upgrade',
    '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432',
    'postgres:18.4', '-c', 'statement_timeout=60s', '-c', 'lock_timeout=5s');
  started = true;
  const port = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', container))['5432/tcp'][0].HostPort;
  const url = `postgresql://app:${password}@127.0.0.1:${port}/b237_upgrade`;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    // The image's temporary initialization server accepts Unix sockets before
    // restarting. Require TCP, which is enabled only on the final server.
    try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'app', '-d', 'b237_upgrade'); ready = true; break; }
    catch { await delay(250); }
  }
  assert(ready, 'disposable PostgreSQL readiness deadline');
  db = new Client({ connectionString: url, connectionTimeoutMillis: 5_000, query_timeout: 65_000 });
  await db.connect();
  const migrations = readdirSync(root).filter((name) => /^\d+_/.test(name)).sort();
  assert.equal(migrations.at(-1), migration, 'review rehearsal when migration head changes');
  for (const name of migrations.slice(0, -1)) {
    await db.query(readFileSync(`${root}/${name}/migration.sql`, 'utf8'));
  }
  console.log(`Pre-batch schema replay: ${migrations.length - 1} migrations passed`);
  // Compare against the actual committed pre-batch schema, not a hand-edited
  // approximation. This temporary file is test-owned, never a worktree edit.
  schemaFixture = mkdtempSync(join(tmpdir(), 'bodour-b237-schema-'));
  const previousSchema = join(schemaFixture, 'schema.prisma');
  writeFileSync(previousSchema, execFileSync('git', ['show', `${baseline}:backend/prisma/schema.prisma`],
    { cwd: backend, timeout: 10_000, encoding: 'utf8' }));
  const compareSchema = (schema) => execFileSync(`${backend}/node_modules/.bin/prisma`, [
    'migrate', 'diff', '--from-config-datasource', '--to-schema', schema,
  ], { cwd: backend, timeout: 60_000, encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, DOTENV_CONFIG_PATH: '/dev/null' } }).trim();
  const beforeSchemaDiff = compareSchema(previousSchema);

  const cases = [
    ['live-pending', 'pending', false, false],
    ['live-approved', 'approved', false, false],
    ['live-rejected', 'rejected', false, false],
    ['recoverable', 'approved', true, false],
    ['expired-recoverable', 'pending', true, false],
    ['unproven-deleted', 'pending', true, false],
    ['old-audit-deleted', 'pending', true, false],
    ['erased-approved', 'approved', true, true],
    ['erased-pending', 'pending', true, true],
    ['erased-rejected', 'rejected', true, true],
  ];
  const records = [];
  for (const [label, status, deleted, erased] of cases) {
    const userId = randomUUID(), claimId = randomUUID();
    const email = `${label}@example.test`, subject = `synthetic-${label}`;
    await db.query(`INSERT INTO "user" (id, sex, name_arabic, account_status, is_beneficiary, updated_at, deleted_at)
      VALUES ($1, 'female', $2, 'active', true, now(), CASE WHEN $3 THEN now() - interval '8 days' END)`,
    [userId, `[b237-upgrade] ${label}`, deleted]);
    if (status === 'approved' && !erased) {
      await db.query(`INSERT INTO user_identity (id,user_id,provider,provider_subject_id,email) VALUES ($1,$2,'google',$3,$4)`,
        [randomUUID(), userId, subject, email]);
      await db.query('UPDATE "user" SET pre_provisioned_email=$2 WHERE id=$1', [userId, email]);
    }
    await db.query(`INSERT INTO self_managed_claim (id,beneficiary_id,provider,provider_subject_id,email,status,decision_reason,deleted_at)
      VALUES ($1,$2,'google',$3,$4,$5::self_managed_claim_status,$6,CASE WHEN $5::self_managed_claim_status='rejected' THEN now() END)`,
    [claimId, userId, subject, email, status, `fixture ${email}`]);
    await db.query(`INSERT INTO normalized_email_lock (email) VALUES ($1)`, [email]);
    if (label.includes('recoverable')) {
      await db.query(`INSERT INTO trash (id,target_entity,target_id,snapshot,purge_after)
        VALUES ($1,'User',$2,$3,now() + $4::interval)`,
      [randomUUID(), userId, JSON.stringify({ email }), label.startsWith('expired') ? '-1 day' : '6 days']);
    }
    if (erased || label === 'old-audit-deleted') {
      await db.query(`INSERT INTO audit_log (id,action_type,target_entity,target_id,detail,created_at)
        VALUES ($1,'user.deidentify','User',$2,'{}',now() - $3::interval)`,
      [randomUUID(), userId, erased ? '1 day' : '9 days']);
    }
    await db.query(`INSERT INTO trash (id,target_entity,target_id,snapshot,purge_after)
      VALUES ($1,'SelfManagedClaim',$2,$3,now() + interval '6 days')`,
    [randomUUID(), claimId, JSON.stringify({ email, provider_subject_id: subject })]);
    records.push({ label, userId, claimId, email, subject, status, erased });
  }
  const pre = randomUUID();
  await db.query(`INSERT INTO "user" (id,sex,name_arabic,pre_provisioned_email,updated_at)
    VALUES ($1,'female','[b237-upgrade] unbound','unbound@example.test',now())`, [pre]);
  await db.query(`INSERT INTO normalized_email_lock (email) VALUES ('unbound@example.test')`);
  await db.query(`INSERT INTO family_link (id,parent_id,student_id,status) VALUES ($1,$2,$3,'approved')`,
    [randomUUID(), pre, records[0].userId]);
  const snapshot = async (table, where = '') => (await db.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ${where} ORDER BY id`)).rows;
  const tables = ['user', 'user_identity', 'family_link', 'audit_log'];
  const before = new Map();
  for (const table of tables) before.set(table, await snapshot(table));
  const trashBefore = await snapshot('trash', "WHERE target_entity='User'");
  const claimsBefore = new Map((await snapshot('self_managed_claim')).map(({ row }) => [row.id, row]));

  // This is exactly the pending file, with no key substituted into migration SQL.
  await db.query(readFileSync(`${root}/${migration}/migration.sql`, 'utf8'));
  for (const table of tables) assert.deepEqual(await snapshot(table), before.get(table), `${table} unchanged`);
  assert.deepEqual(await snapshot('trash', "WHERE target_entity='User'"), trashBefore, 'both User recovery windows unchanged');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM normalized_email_lock')).rows[0].n, 0,
    'ratified truncate/rekey: no backfilled/weak-key digest and no plaintext rows');
  const columns = (await db.query(`SELECT column_name, is_nullable, data_type, character_maximum_length, column_default
    FROM information_schema.columns WHERE table_name='normalized_email_lock' ORDER BY column_name`)).rows;
  assert.deepEqual(columns.map((c) => c.column_name), ['created_at', 'email_digest']);
  assert.equal(columns[1].character_maximum_length, 64);
  assert.equal(columns[1].is_nullable, 'NO');
  assert.equal(columns[1].column_default, null);
  assert.match(columns[0].column_default, /now\(\)|CURRENT_TIMESTAMP/);
  for (const record of records) {
    const row = (await db.query('SELECT * FROM self_managed_claim WHERE id=$1', [record.claimId])).rows[0];
    if (record.erased) {
      assert.equal(row.email, null); assert.equal(row.provider_subject_id, null); assert.equal(row.decision_reason, null);
      assert.equal(row.status, record.status);
      if (record.status === 'pending') assert(row.deleted_at);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM trash WHERE target_id=$1', [record.claimId])).rows[0].n, 0);
    } else {
      const current = (await db.query('SELECT to_jsonb(c) AS row FROM self_managed_claim c WHERE id=$1', [record.claimId])).rows[0].row;
      assert.deepEqual(current, claimsBefore.get(record.claimId), `${record.label} unchanged`);
    }
  }
  const indexes = (await db.query(`SELECT indexname FROM pg_indexes WHERE tablename IN ('normalized_email_lock','self_managed_claim')`)).rows.map((r) => r.indexname);
  for (const name of ['normalized_email_lock_pkey', 'self_managed_claim_pending_subject_key', 'self_managed_claim_pending_beneficiary_key', 'self_managed_claim_beneficiary_id_status_idx']) assert(indexes.includes(name), name);
  await assert.rejects(db.query("INSERT INTO normalized_email_lock (email_digest) VALUES ('not-a-digest')"), { code: '23514' });
  await assert.rejects(db.query('UPDATE self_managed_claim SET email=NULL WHERE id=$1', [records[0].claimId]), { code: '23514' });
  await assert.rejects(db.query('UPDATE self_managed_claim SET email=NULL,provider_subject_id=NULL WHERE id=$1', [records[0].claimId]), { code: '23514' });
  console.log('Populated upgrade: 11 Users, 10 claim states, 2 recovery windows and ownership/family/audit rows checked; constraints/indexes passed');

  prisma = createPrismaClient(url, 2);
  const email = records[1].email;
  const owners = await Promise.all(['  LIVE-APPROVED@EXAMPLE.TEST ', email].map((input) => prisma.$transaction(async (tx) => {
    await lockNormalizedEmail(tx, input);
    return emailClaimingUserIds(tx, input.trim().toLowerCase());
  })));
  assert.deepEqual(owners, [[records[1].userId], [records[1].userId]]);
  assert.equal(await prisma.normalizedEmailLock.count(), 1);
  assert.equal((await prisma.normalizedEmailLock.findFirstOrThrow()).emailDigest, emailLockDigest(email));
  assert.equal(await prisma.selfManagedClaim.count({ where: { beneficiaryId: records[7].userId, status: 'approved' } }), 1);
  console.log('Post-upgrade production repository: normalized concurrent locks converge on one HMAC row and existing owner; approved authority preserved');

  const schemaDiff = compareSchema('prisma/schema.prisma');
  assert.equal(schemaDiff, beforeSchemaDiff, 'no new Prisma/SQL divergence beyond the committed baseline');
  assert(!schemaDiff.includes('`normalized_email_lock`'), 'email-lock model matches the migrated table');
  assert(!schemaDiff.includes('`self_managed_claim`'), 'claim model matches the migrated table');
  console.log(`Schema comparison: both changed models match; ${(schemaDiff.match(/Changed the/g) ?? []).length} pre-existing SQL/Prisma table differences unchanged from ${baseline}`);
} finally {
  try {
    if (prisma) await prisma.$disconnect();
    if (db) await db.end();
  } finally {
    if (schemaFixture) rmSync(schemaFixture, { recursive: true });
    if (started) docker('stop', '--time', '5', container);
  }
}
