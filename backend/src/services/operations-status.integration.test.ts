import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { actorFor } from '../test-support/actor.js';
import { readOperationsStatus } from './operations-status.service.js';

/**
 * SRS Revision 169 §11 — the administrator's operational alert read. Against the
 * real database: the point is that its numbers ARE the tables', by the host
 * monitor's own definitions, and that nobody but a Super Admin is shown them.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[ops-status-test]';
const DEDUP = `ops-status-test-${randomUUID().slice(0, 8)}`;

async function person(label: string, role: 'admin' | 'super_admin'): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: 'female', nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  const row = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId: user.id, roleId: row.id, branchId: null } });
  return user.id;
}

async function clear(): Promise<void> {
  await prisma.storageRetirement.deleteMany({ where: { dedupKey: { startsWith: 'ops-status-test-' } } });
  const ids = (
    await prisma.user.findMany({ where: { nameArabic: { startsWith: TAG } }, select: { id: true } })
  ).map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('who is shown it', () => {
  it('a Super Admin — and nobody else: the counts span every branch', async () => {
    const boss = await person('مشرفة عامة', 'super_admin');
    const admin = await person('مسؤولة', 'admin');
    await expect(readOperationsStatus(prisma, await actorFor(prisma, boss))).resolves.toBeDefined();
    await expect(readOperationsStatus(prisma, await actorFor(prisma, admin))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('what it says', () => {
  it('counts only — by the host monitor’s own definitions — and says what it cannot see', async () => {
    const boss = await actorFor(prisma, await person('مشرفة عامة', 'super_admin'));
    const before = await readOperationsStatus(prisma, boss);
    expect(Object.keys(before).sort()).toEqual(['checked_at', 'host_checks', 'jobs', 'storage_retirement']);
    expect(Object.keys(before.jobs).sort()).toEqual(['failed', 'late', 'queues']);
    expect(Object.keys(before.storage_retirement).sort()).toEqual(['copy_unknown', 'failed', 'late', 'pending']);
    // Backup freshness and the certificate live on the HOST: said, never blank.
    expect(before.host_checks).toBe('not_visible_from_here');
    for (const queue of before.jobs.queues) {
      expect(Object.keys(queue).sort()).toEqual(['failed', 'late', 'name']);
    }

    // One unfinished retirement that failed once, is overdue, and whose copy is
    // of unknown outcome: each of the four numbers moves by exactly one.
    // The table's own CHECKs shape the row: an unknown copy outcome belongs to a
    // `placement_attempt`, and a live key is `content/<content id>/…`.
    const contentId = randomUUID();
    await prisma.storageRetirement.create({
      data: {
        dedupKey: DEDUP,
        contentId,
        operation: 'placement_attempt',
        bucket: 'private',
        storageKey: `content/${contentId}/ops-status-test/object`,
        copySettled: false,
        lastErrorCode: 'STORAGE_UNAVAILABLE',
        nextAttemptAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const after = await readOperationsStatus(prisma, boss);
    expect(after.storage_retirement).toEqual({
      pending: before.storage_retirement.pending + 1,
      failed: before.storage_retirement.failed + 1,
      late: before.storage_retirement.late + 1,
      copy_unknown: before.storage_retirement.copy_unknown + 1,
    });
    // …and nothing about WHICH object: no key, no code, no id anywhere in it.
    expect(JSON.stringify(after)).not.toContain('ops-status-test/object');
    expect(JSON.stringify(after)).not.toContain('STORAGE_UNAVAILABLE');
  });
});
