import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import { listTrash, purgeEntry, restoreEntry } from "./trash.service.js";

/**
 * The Trash (§7, TD-5, BR-15, Revision 52).
 *
 * The property that matters is **not** "a list came back" — it is that the
 * screen can never offer a restore that would lose relationship state. R111's
 * account soft delete is the deliberate safe exception: it removes none of the
 * links, enrolments, roles or identities during its three-day window.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[trash-test]";

const actorOf = (roles: { role: string; branches: string[] | null }[]): Actor =>
  ({ userId: actorUserId, roleScopes: roles }) as unknown as Actor;
const superAdmin = (): Actor =>
  actorOf([{ role: "super_admin", branches: null }]);
const admin = (): Actor => actorOf([{ role: "admin", branches: null }]);

let actorUserId = "";

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; details?: Record<string, unknown> };
  }
}

/** Soft-deletes a row the way the services do: tombstone + Trash snapshot. */
async function bin(
  entity: string,
  targetId: string,
  snapshot: object,
): Promise<string> {
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
  await prisma.trash.deleteMany({
    where: { OR: [{ deletedById: { in: ids } }] },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(async () => {
  await clear();
  actorUserId = (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} مديرة`, accountStatus: "active" },
    })
  ).id;
  // **A LIVE role assignment, not just a claim in a synthetic actor.** Restore
  // and permanent delete are TD-12 high-risk: they re-read the caller's roles
  // from the database and ignore what the token said, so an actor that exists
  // only in memory is correctly refused. That is the guard working, and this
  // fixture has to satisfy it the way a real Super Admin does.
  const role = await prisma.role.findUnique({ where: { name: "super_admin" } });
  await prisma.userBranchRole.create({
    data: { userId: actorUserId, roleId: role!.id, branchId: null },
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("who may open the Trash (TD-2)", () => {
  it("refuses an Admin — the list spans every branch", async () => {
    // No other surface lets a branch-scoped Admin see another branch's records,
    // and a list of every deletion in the platform is the last place to start.
    const e = await failure(() => listTrash(prisma, admin(), {}));
    expect(e.code).toBe("FORBIDDEN");
  });
});

describe("what the list says about each row", () => {
  it("reads a label from the snapshot rather than joining a row that may be gone", async () => {
    const subject = await prisma.subject.create({
      data: { name: `${TAG} حفظ القرآن`, deletedAt: new Date() },
    });
    await bin("Subject", subject.id, { id: subject.id, name: `${TAG} حفظ القرآن` });

    const page = await listTrash(prisma, superAdmin(), { entity: "Subject" });
    const row = page.data.find((r) => r.targetId === subject.id)!;
    expect(row.label).toBe(`${TAG} حفظ القرآن`);
    expect(row.deletedByName).toBe(`${TAG} مديرة`);
    expect(row.purgeAfter).toBeInstanceOf(Date);
  });

  it("marks R111 accounts RESTORABLE and a cascading entity not, with a reason", async () => {
    // This is the whole design: the capability is a server decision, per entity
    // type, because a client cannot know which deletions cascade.
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة`, deletedAt: new Date() },
    });
    await bin("Subject", subject.id, { name: `${TAG} مادة` });
    await bin("User", actorUserId, { nameArabic: `${TAG} شخص` });

    const page = await listTrash(prisma, superAdmin(), {});
    const subjectRow = page.data.find((r) => r.targetEntity === "Subject")!;
    const userRow = page.data.find((r) => r.targetEntity === "User")!;

    expect(subjectRow.restorable).toBe(true);
    expect(subjectRow.restoreBlockedReason).toBeNull();
    expect(userRow.label).toContain("شخص");
    expect(userRow.restorable).toBe(true);
    expect(userRow.restoreBlockedReason).toBeNull();
  });

  it("filters by entity type", async () => {
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة`, deletedAt: new Date() },
    });
    await bin("Subject", subject.id, { name: `${TAG} مادة` });
    await bin("User", actorUserId, { nameArabic: `${TAG} شخص` });

    const page = await listTrash(prisma, superAdmin(), { entity: "User" });
    expect(page.data.every((r) => r.targetEntity === "User")).toBe(true);
  });
});

describe("restore is offered only where it is COMPLETE (§7)", () => {
  it("restores a guarded entity and removes its tombstone", async () => {
    const subject = await prisma.subject.create({
      data: {
        name: `${TAG} مادة`,
        deletedAt: new Date(),
        deletedById: actorUserId,
      },
    });
    const entryId = await bin("Subject", subject.id, { name: `${TAG} مادة` });

    await restoreEntry(prisma, superAdmin(), entryId);

    expect(
      (await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } }))
        .deletedAt,
    ).toBeNull();
    // The record is no longer deleted, so leaving it listed would make the Trash
    // disagree with the platform. The audit row keeps the event answerable.
    expect(
      await prisma.trash.findUnique({ where: { id: entryId } }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { actionType: "trash.restore", targetId: subject.id },
      }),
    ).toBe(1);
  });

  it("REFUSES a genuinely cascading entity loudly rather than half-restoring it", async () => {
    const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
    const level = await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id, deletedAt: new Date() },
    });
    const entryId = await bin("Level", level.id, { name: level.name });
    const e = await failure(() => restoreEntry(prisma, superAdmin(), entryId));
    expect(e.code).toBe("STATE_CONFLICT");
    expect(e.details?.["reason"]).toBe("CASCADE_CHILDREN");
  });

  it("will not restore a child into a deleted parent", async () => {
    // Technically alive, practically unreachable: a room in a branch nobody can
    // open through any screen.
    const branch = await prisma.branch.create({
      data: { name: `${TAG} فرع`, deletedAt: new Date() },
    });
    const room = await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: branch.id, deletedAt: new Date() },
    });
    const entryId = await bin("Room", room.id, { name: `${TAG} قاعة` });

    const e = await failure(() => restoreEntry(prisma, superAdmin(), entryId));
    expect(e.code).toBe("STATE_CONFLICT");
    expect(e.details?.["reason"]).toBe("PARENT_DELETED");
    expect(
      (await prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
        .deletedAt,
    ).not.toBeNull();
  });

  it("reports ALREADY_PURGED when BR-15 removed the row itself", async () => {
    // The snapshot alone cannot safely recreate it: every foreign key it names
    // may have gone too.
    const entryId = await bin(
      "Subject",
      "00000000-0000-4000-8000-000000000000",
      { name: "x" },
    );
    const e = await failure(() => restoreEntry(prisma, superAdmin(), entryId));
    expect(e.details?.["reason"]).toBe("ALREADY_PURGED");
  });

  it("refuses an Admin", async () => {
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة`, deletedAt: new Date() },
    });
    const entryId = await bin("Subject", subject.id, { name: `${TAG} مادة` });
    expect(
      (await failure(() => restoreEntry(prisma, admin(), entryId))).code,
    ).toBe("FORBIDDEN");
  });
});

/**
 * **Permanent deletion** (SRS Revision 59.1).
 *
 * The property under test is authority and irreversibility, not "a row went
 * away": nothing below trusts a status code, because the whole point of a purge
 * is that the record is gone — so every assertion reads the database afterwards.
 */
describe("permanent deletion is Super Admin only and irreversible (R59.1)", () => {
  it("REFUSES an Admin, a Teacher and a Student — server-side, not by a hidden button", async () => {
    const branch = await prisma.branch.create({
      data: { name: `${TAG} فرع`, deletedAt: new Date() },
    });
    const entry = await bin("Branch", branch.id, branch);

    for (const role of ["admin", "teacher", "student", "parent"]) {
      const err = await failure(() =>
        purgeEntry(prisma, actorOf([{ role, branches: null }]), entry),
      );
      expect(err.code, `${role} must not be able to purge`).toBe("FORBIDDEN");
    }

    // The refusal is real: the row and its tombstone are both still there.
    expect(await prisma.branch.count({ where: { id: branch.id } })).toBe(1);
    expect(await prisma.trash.count({ where: { id: entry } })).toBe(1);
  });

  it("destroys the record AND its tombstone, and writes an audit row that outlives both", async () => {
    const branch = await prisma.branch.create({
      data: { name: `${TAG} فرع`, deletedAt: new Date() },
    });
    const entry = await bin("Branch", branch.id, branch);

    const result = await purgeEntry(prisma, superAdmin(), entry);
    expect(result.alreadyPurged).toBe(false);

    expect(await prisma.branch.count({ where: { id: branch.id } })).toBe(0);
    expect(await prisma.trash.count({ where: { id: entry } })).toBe(0);

    // `trash.permanent_delete` is deliberately absent from the audit-purge
    // allowlist, so the record of an irreversible act is retained indefinitely.
    const log = await prisma.auditLog.findFirst({
      where: { actionType: "trash.permanent_delete", targetId: branch.id },
    });
    expect(log).not.toBeNull();
    expect(log?.detail).not.toHaveProperty("label");
    expect(JSON.stringify(log?.detail)).not.toContain(`${TAG} فرع`);
  });

  it("refuses while a live row still references it, and names the constraint", async () => {
    const branch = await prisma.branch.create({
      data: { name: `${TAG} فرع`, deletedAt: new Date() },
    });
    // A room at that branch, NOT deleted: the branch's tombstone does not
    // describe it, so destroying the branch would orphan a live record.
    await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: branch.id },
    });
    const entry = await bin("Branch", branch.id, branch);

    const err = await failure(() => purgeEntry(prisma, superAdmin(), entry));
    expect(err.code).toBe("STATE_CONFLICT");
    expect(err.details?.["reason"]).toBe("DEPENDENTS_EXIST");
    // Named, so an administrator learns WHICH relationship is in the way. A
    // `RESTRICT` violation arrives as P2039/23001, not P2003 — matching only
    // P2003 let the raw Prisma error escape as a 500 for this exact case.
    expect(err.details?.["constraint"]).toBe("room_branch_id_fkey");

    // Nothing partial: the branch survives intact rather than half-destroyed.
    expect(await prisma.branch.count({ where: { id: branch.id } })).toBe(1);
    expect(await prisma.trash.count({ where: { id: entry } })).toBe(1);
  });

  it("refuses a type with no destruction plan, with the reason", async () => {
    const entry = await bin("User", actorUserId, { nameArabic: `${TAG} شخص` });
    const err = await failure(() => purgeEntry(prisma, superAdmin(), entry));
    expect(err.code).toBe("STATE_CONFLICT");
    // Destroying a person takes the audit trail that says what they did.
    expect(err.details?.["reason"]).toBe("ACCOUNTABILITY_RECORD");
  });

  it("will not destroy a record somebody restored since — the tombstone is stale", async () => {
    // Live row, stale entry: the record is in active use and no deletion stands
    // behind the tombstone.
    const branch = await prisma.branch.create({
      data: { name: `${TAG} فرع حي` },
    });
    const entry = await bin("Branch", branch.id, branch);
    const err = await failure(() => purgeEntry(prisma, superAdmin(), entry));

    expect(err.details?.["reason"]).toBe("NOT_DELETED");
    expect(await prisma.branch.count({ where: { id: branch.id } })).toBe(1);
  });

  it("removes a tombstone whose record BR-15 already took, and says which happened", async () => {
    const entry = await bin("Branch", "00000000-0000-4000-8000-0000000000ff", {
      name: "gone",
    });

    const result = await purgeEntry(prisma, superAdmin(), entry);

    // Not an error: removing the entry is exactly what was asked for.
    expect(result.alreadyPurged).toBe(true);
    expect(await prisma.trash.count({ where: { id: entry } })).toBe(0);
  });
});

describe("restore reinstates the children it declares (R59.3)", () => {
  it("publishes purgeability per row, decided by the server", async () => {
    const branch = await prisma.branch.create({
      data: { name: `${TAG} فرع`, deletedAt: new Date() },
    });
    await bin("Branch", branch.id, branch);
    await bin("User", actorUserId, { nameArabic: `${TAG} شخص` });

    const rows = await listTrash(prisma, superAdmin(), { pageSize: 100 });
    const branchRow = rows.data.find((r) => r.targetEntity === "Branch");
    const userRow = rows.data.find((r) => r.targetEntity === "User");

    expect(branchRow?.purgeable).toBe(true);
    expect(branchRow?.purgeBlockedReason).toBeNull();
    // A client cannot know this, which is why the server says it.
    expect(userRow?.purgeable).toBe(false);
    expect(userRow?.purgeBlockedReason).toBe("ACCOUNTABILITY_RECORD");
  });
});
