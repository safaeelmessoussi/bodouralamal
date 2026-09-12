// B5 populated upgrade. Own tmpfs PostgreSQL only; accepts no operator URL.
// From backend: node --import tsx ../scripts/test/verify-storage-retirement-upgrade.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createPrismaClient } from '../../backend/src/lib/prisma.ts';
import { importLegacyRetirements } from '../../backend/src/repositories/storage-retirement.repository.ts';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const { PgBoss } = require('pg-boss');
const container = `bodour-storage-upgrade-${process.pid}`;
const docker = (...args) => execFileSync('docker', args, { timeout: 30_000, encoding: 'utf8' }).trim();
const root = fileURLToPath(new URL('../../backend/prisma/migrations/', import.meta.url));
let started = false, db, prisma, boss;
try {
  docker('run', '--rm', '-d', '--name', container, '--label', 'bodour.disposable=storage-upgrade',
    '--tmpfs', '/var/lib/postgresql', '-e', 'POSTGRES_USER=app', '-e', 'POSTGRES_DB=storage_upgrade',
    '-e', 'POSTGRES_PASSWORD=synthetic-upgrade-password', '-p', '127.0.0.1::5432', 'postgres:18.4',
    '-c', 'statement_timeout=60s', '-c', 'lock_timeout=5s');
  started = true;
  const port = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', container))['5432/tcp'][0].HostPort;
  const url = `postgresql://app:synthetic-upgrade-password@127.0.0.1:${port}/storage_upgrade`;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'app'); ready = true; break; }
    catch { await delay(250); }
  }
  assert(ready, 'PostgreSQL startup deadline');
  db = new Client({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 65000 });
  await db.connect();
  const migrations = readdirSync(root).filter((n) => /^\d+_/.test(n)).sort();
  assert.equal(migrations.at(-1), '20260911130000_durable_storage_retirement');
  for (const name of migrations.slice(0, -1)) await db.query(readFileSync(`${root}/${name}/migration.sql`, 'utf8'));
  const userId = randomUUID();
  await db.query('INSERT INTO "user" (id,sex,name_arabic,account_status,updated_at) VALUES ($1,\'female\',\'synthetic upgrade\',\'active\',now())', [userId]);
  const before = (await db.query('SELECT * FROM "user" WHERE id=$1', [userId])).rows;
  boss = new PgBoss({ connectionString: url, max: 2 });
  await boss.start();
  for (const queue of ['content.quarantine-purge', 'content.bucket-migrate']) await boss.createQueue(queue);
  const contentId = randomUUID(), key = `content/${contentId}/legacy/fixture.pdf`;
  const jobId = await boss.send('content.quarantine-purge', { operation: 'manual_permanent_delete', content_id: contentId, bucket: 'private', storage_key: key });
  await db.query("UPDATE pgboss.job SET state='failed', completed_on=now() WHERE id=$1", [jobId]);
  const jobsBefore = (await db.query('SELECT * FROM pgboss.job WHERE id=$1', [jobId])).rows;
  await db.query(readFileSync(`${root}/${migrations.at(-1)}/migration.sql`, 'utf8'));
  assert.deepEqual((await db.query('SELECT * FROM "user" WHERE id=$1', [userId])).rows, before);
  assert.deepEqual((await db.query('SELECT * FROM pgboss.job WHERE id=$1', [jobId])).rows, jobsBefore);
  prisma = createPrismaClient(url, 2);
  await importLegacyRetirements(prisma);
  await importLegacyRetirements(prisma);
  const records = await prisma.storageRetirement.findMany({ where: { contentId } });
  assert.equal(records.length, 1);
  assert.equal(records[0].storageKey, key);
  assert.equal(records[0].completedAt, null);
  assert.equal(records[0].copySettled, true, 'non-placement legacy work is already settled');
  await assert.rejects(db.query('UPDATE storage_retirement SET copy_settled=FALSE WHERE id=$1', [records[0].id]), /storage_retirement_copy_check/);
  await db.query('DELETE FROM pgboss.job WHERE id=$1', [jobId]);
  assert.equal(await prisma.storageRetirement.count({ where: { contentId, completedAt: null } }), 1);
  await assert.rejects(db.query('UPDATE storage_retirement SET storage_key=NULL WHERE id=$1', [records[0].id]), /storage_retirement_locator_check/);
  console.log(`PASS: populated ${migrations.length - 1}→${migrations.length} upgrade; User and old job unchanged; exact legacy import idempotent; obligation survives job removal; locator constraint enforced`);
} finally {
  if (boss) await boss.stop({ graceful: true });
  if (prisma) await prisma.$disconnect();
  if (db) await db.end();
  if (started) docker('stop', '--time', '5', container);
}
