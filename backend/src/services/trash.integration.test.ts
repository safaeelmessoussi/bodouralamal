import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { listTrash, restoreEntry } from './trash.service.js';

/**
 * The Trash (§7, TD-5, BR-15, Revision 52).
 *
 * The property that matters is **not** "a list came back" — it is that the
 * screen can never offer a restore that would half-restore a person. §7:
 * *"a User restored without their links, enrollments and roles is a
 * half-restored, silently broken account."* So the tests below are mostly about
 * what the service REFUSES.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[trash-test]';

const actorOf = (roles: { role: string; branches: string[] | null }[]): Actor =>
  ({ userId: actorUserId, roleScopes: roles } as unknown as Actor);
const superAdmin = (): Actor => actorOf([{ role: 'super_admin', branches: null }]);
const admin = (): Actor => actorOf([{ role: 'admin', branches: null }]);

let actorUserId = '';

async function failure(run: () => Promise<unknown>): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; details?: Record<string, unknown> };
  }
}

/** Soft-deletes a row the way the services do: tombstone + Trash snapshot. */
async function bin(entity: string, targetId: string, snapshot: object): Promise<string> {
  const row = await prisma.trash.create({
    data: {
      targetEntity: entity,
      targetId,
      snapshot: JSON.parse(JSON.stringify(snapshot)) as object,
      deletedById: actorUserId,
      purgeAfter: new Date(Date.now() + 90 * 24 * 3600 * 1000),
    },
  });
  return row.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.trash.deleteMany({ where: { OR: [{ deletedById: { in: ids } }] } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(async () => {
  await clear();
  actorUserId = (
    await prisma.user.create({ data: { nameArabic: `${TAG} مديرة`, accountStatus: 'active' } })
  ).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('who may open the Trash (TD-2)', () => {
  it('refuses an Admin — the list spans every branch', async () => {
    // No other surface lets a branch-scoped Admin see another branch's records,
    // and a list of every deletion in the platform is the last place to start.
    const e = await failure(() => listTrash(prisma, admin(), {}));
    expect(e.code).toBe('FORBIDDEN');
  });
});

describe('what the list says about each row', () => {
  it('reads a label from the snapshot rather than joining a row that may be gone', async () => {
    const subject = await prisma.subject.create({
      data: { name: `${TAG} القرآن`, deletedAt: new Date() },
    });
    await bin('Subject', subject.id, { id: subject.id, name: `${TAG} القرآن` });

    const page = await listTrash(prisma, superAdmin(), { entity: 'Subject' });
    const row = page.data.find((r) => r.targetId === subject.id)!;
    expect(row.label).toBe(`${TAG} القرآن`);
    expect(row.deletedByName).toBe(`${TAG} مديرة`);
    expect(row.purgeAfter).toBeInstanceOf(Date);
  });

  it('marks a guarded entity RESTORABLE and a cascading one not, with a reason', async () => {
    // This is the whole design: the capability is a server decision, per entity
    // type, because a client cannot know which deletions cascade.
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة`, deletedAt: new Date() },
    });
    await bin('Subject', subject.id, { name: `${TAG} مادة` });
    await bin('User', actorUserId, { nameArabic: `${TAG} شخص` });

    const page = await listTrash(prisma, superAdmin(), {});
    const subjectRow = page.data.find((r) => r.targetEntity === 'Subject')!;
    const userRow = page.data.find((r) => r.targetEntity === 'User')!;

    expect(subjectRow.restorable).toBe(true);
    expect(subjectRow.restoreBlockedReason).toBeNull();
    expect(userRow.restorable).toBe(false);
    // §7's hazard, named: the cascade removes six relationship types.
    expect(userRow.restoreBlockedReason).toBe('CASCADE_RELATIONSHIPS');
  });

  it('filters by entity type', async () => {
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة`, deletedAt: new Date() },
    });
    await bin('Subject', subject.id, { name: `${TAG} مادة` });
    await bin('User', actorUserId, { nameArabic: `${TAG} شخص` });

    const page = await listTrash(prisma, superAdmin(), { entity: 'User' });
    expect(page.data.every((r) => r.targetEntity === 'User')).toBe(true);
  });
});

describe('restore is offered only where it is COMPLETE (§7)', () => {
  it('restores a guarded entity and removes its tombstone', async () => {
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة`, deletedAt: new Date(), deletedById: actorUserId },
    });
    const entryId = await bin('Subject', subject.id, { name: `${TAG} مادة` });

    await restoreEntry(prisma, superAdmin(), entryId);

    expect((await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } })).deletedAt).toBeNull();
    // The record is no longer deleted, so leaving it listed would make the Trash
    // disagree with the platform. The audit row keeps the event answerable.
    expect(await prisma.trash.findUnique({ where: { id: entryId } })).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { actionType: 'trash.restore', targetId: subject.id } }),
    ).toBe(1);
  });

  it('REFUSES a cascading entity loudly rather than half-restoring it', async () => {
    // Answering 200 here would be exactly the silent breakage §7 warns about.
    const entryId = await bin('User', actorUserId, { nameArabic: `${TAG} شخص` });
    const e = await failure(() => restoreEntry(prisma, superAdmin(), entryId));
    expect(e.code).toBe('STATE_CONFLICT');
    expect(e.details?.['reason']).toBe('CASCADE_RELATIONSHIPS');
  });

  it('will not restore a child into a deleted parent', async () => {
    // Technically alive, practically unreachable: a room in a branch nobody can
    // open through any screen.
    const branch = await prisma.branch.create({
      data: { name: `${TAG} فرع`, deletedAt: new Date() },
    });
    const room = await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: branch.id, deletedAt: new Date() },
    });
    const entryId = await bin('Room', room.id, { name: `${TAG} قاعة` });

    const e = await failure(() => restoreEntry(prisma, superAdmin(), entryId));
    expect(e.code).toBe('STATE_CONFLICT');
    expect(e.details?.['reason']).toBe('PARENT_DELETED');
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).deletedAt).not.toBeNull();
  });

  it('reports ALREADY_PURGED when BR-15 removed the row itself', async () => {
    // The snapshot alone cannot safely recreate it: every foreign key it names
    // may have gone too.
    const entryId = await bin('Subject', '00000000-0000-4000-8000-000000000000', { name: 'x' });
    const e = await failure(() => restoreEntry(prisma, superAdmin(), entryId));
    expect(e.details?.['reason']).toBe('ALREADY_PURGED');
  });

  it('refuses an Admin', async () => {
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة`, deletedAt: new Date() },
    });
    const entryId = await bin('Subject', subject.id, { name: `${TAG} مادة` });
    expect((await failure(() => restoreEntry(prisma, admin(), entryId))).code).toBe('FORBIDDEN');
  });
});
