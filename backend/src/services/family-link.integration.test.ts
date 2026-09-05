import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { actorFor } from "../test-support/actor.js";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { resolveActingStudent } from "../middleware/child-context.js";
import { readFile } from "node:fs/promises";

import { decide } from "./approval.service.js";
import { createLink, revokeLink } from "./family-link.service.js";
import { restoreEntry } from "./trash.service.js";

/**
 * FamilyLink revocation (§4.3 Revision 16) against the real database.
 *
 * The property that matters is not "the row got a `deleted_at`" — it is that the
 * parent's access is gone on the very NEXT request. So these tests assert the
 * revocation through the same resolver the child-scoped endpoints will use,
 * rather than trusting the column.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[fam-link-test]";

async function makeUser(label: string, status = "active"): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: status as never,
    },
  });
  return user.id;
}

async function makeStaff(role: string): Promise<string> {
  const id = await makeUser(role);
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: id, roleId: roleRow!.id, branchId: null },
  });
  return id;
}

async function approvedLink(
  parentId: string,
  studentId: string,
): Promise<string> {
  const row = await prisma.familyLink.create({
    data: { parentId, studentId, status: "approved", decidedAt: new Date() },
  });
  return row.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const links = await prisma.familyLink.findMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
    select: { id: true },
  });
  const linkIds = links.map((l) => l.id);
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { targetId: { in: [...ids, ...linkIds] } },
        { actorUserId: { in: ids } },
      ],
    },
  });
  await prisma.trash.deleteMany({
    where: {
      OR: [{ targetId: { in: linkIds } }, { deletedById: { in: ids } }],
    },
  });
  await prisma.familyLink.deleteMany({ where: { id: { in: linkIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("§4.3 Revision 16 — revoking an approved link", () => {
  it("cuts the parent off on the very NEXT request, with no token change", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const linkId = await approvedLink(p, c);

    // Access works before revocation.
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c),
    ).resolves.toMatchObject({ studentId: c });

    await revokeLink(
      prisma,
      await actorFor(prisma, admin),
      linkId,
      "انتقال الحضانة",
    );

    // Nothing about the parent's session changed — only the link row.
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("TD-4.8: soft-delete + Trash snapshot + audit, all present", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const linkId = await approvedLink(p, c);

    await revokeLink(
      prisma,
      await actorFor(prisma, admin),
      linkId,
      "بناء على طلب الأسرة",
    );

    const link = await prisma.familyLink.findUnique({ where: { id: linkId } });
    expect(link?.deletedAt).toBeInstanceOf(Date);
    expect(link?.deletedById).toBe(admin);
    // TD-1: Approved stays terminal — revocation is the delete, not a new status.
    expect(link?.status).toBe("approved");

    const trash = await prisma.trash.findFirst({ where: { targetId: linkId } });
    expect(trash?.targetEntity).toBe("FamilyLink");
    /**
     * **BR-15 promises a SEVEN-day permanent-delete window** (Revision 133), and
     * the number is the promise — `toBeInstanceOf(Date)` alone would pass with a
     * one-day window, at which point records somebody expects to restore are
     * already gone.
     */
    const days = (trash!.purgeAfter.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    // The snapshot must be substantive, not an empty object: it IS the recovery
    // story, since there is no restoration UI in the MVP (§4.10).
    expect(
      (trash!.snapshot as Record<string, unknown>)["parentId"],
    ).toBeDefined();

    const row = await prisma.auditLog.findFirst({
      where: { targetId: linkId, actionType: "familylink.revoke" },
    });
    expect(row).not.toBeNull();
    expect(row!.actorUserId).toBe(admin);
    // §7 attribution invariant: who/when/why reconstructable from the audit row
    // alone, without reading the soft-deleted link.
    const detail = row!.detail as Record<string, unknown>;
    expect(detail["parent_id"]).toBe(p);
    expect(detail["student_id"]).toBe(c);
    expect(detail["reason"]).toBe("بناء على طلب الأسرة");
  });

  it("TD-6: the same pair can be linked again afterwards as a fresh Pending row", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const linkId = await approvedLink(p, c);
    await revokeLink(
      prisma,
      await actorFor(prisma, admin),
      linkId,
      "خطأ إداري",
    );

    // The partial unique index covers non-deleted rows only, so this must not
    // collide with the revoked row.
    const fresh = await prisma.familyLink.create({
      data: { parentId: p, studentId: c, status: "pending" },
    });
    expect(fresh.status).toBe("pending");
    // And a fresh Pending link grants nothing until approved (BR-4).
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a reason is required", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const linkId = await approvedLink(p, c);

    await expect(
      revokeLink(prisma, await actorFor(prisma, admin), linkId, "   "),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    // Nothing revoked — the parent still has access.
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c),
    ).resolves.toMatchObject({ studentId: c });
  });

  it("revoking twice is NOT_FOUND the second time, and writes one audit row", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const linkId = await approvedLink(p, c);

    await revokeLink(
      prisma,
      await actorFor(prisma, admin),
      linkId,
      "مرة واحدة",
    );
    await expect(
      revokeLink(prisma, await actorFor(prisma, admin), linkId, "مرة ثانية"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      await prisma.auditLog.count({
        where: { targetId: linkId, actionType: "familylink.revoke" },
      }),
    ).toBe(1);
  });

  it("a PENDING link cannot be revoked — it is decided in the approval queue", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const pending = await prisma.familyLink.create({
      data: { parentId: p, studentId: c, status: "pending" },
    });

    await expect(
      revokeLink(prisma, await actorFor(prisma, admin), pending.id, "خطأ"),
    ).rejects.toMatchObject({
      code: "STATE_CONFLICT",
    });
    expect(
      (await prisma.familyLink.findUnique({ where: { id: pending.id } }))
        ?.deletedAt,
    ).toBeNull();
  });

  it("TD-2: a teacher cannot revoke, and a parent cannot revoke their own link", async () => {
    const teacher = await makeStaff("teacher");
    const p = await makeStaff("parent");
    const c = await makeUser("طفلة");
    const linkId = await approvedLink(p, c);

    await expect(
      revokeLink(prisma, await actorFor(prisma, teacher), linkId, "محاولة"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      revokeLink(prisma, await actorFor(prisma, p), linkId, "محاولة"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      (await prisma.familyLink.findUnique({ where: { id: linkId } }))
        ?.deletedAt,
    ).toBeNull();
  });

  it("TD-12: an admin suspended mid-session cannot revoke on a valid token", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const linkId = await approvedLink(p, c);

    await prisma.user.update({
      where: { id: admin },
      data: { accountStatus: "suspended" },
    });

    await expect(
      revokeLink(prisma, await actorFor(prisma, admin), linkId, "محاولة"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      (await prisma.familyLink.findUnique({ where: { id: linkId } }))
        ?.deletedAt,
    ).toBeNull();
  });

  it("revoking one child's link leaves the parent's OTHER children untouched", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c1 = await makeUser("طفلة أ");
    const c2 = await makeUser("طفلة ب");
    const link1 = await approvedLink(p, c1);
    await approvedLink(p, c2);

    await revokeLink(
      prisma,
      await actorFor(prisma, admin),
      link1,
      "حالة واحدة فقط",
    );

    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c1),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c2),
    ).resolves.toMatchObject({ studentId: c2 });
  });

  it("revoking one parent's link leaves the OTHER parent of the same child untouched", async () => {
    const admin = await makeStaff("admin");
    const p1 = await makeUser("والدة");
    const p2 = await makeUser("والد");
    const c = await makeUser("طفلة");
    const link1 = await approvedLink(p1, c);
    await approvedLink(p2, c);

    await revokeLink(
      prisma,
      await actorFor(prisma, admin),
      link1,
      "أحد الوالدين فقط",
    );

    await expect(
      resolveActingStudent(prisma, { userId: p1, roles: ["parent"] }, c),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      resolveActingStudent(prisma, { userId: p2, roles: ["parent"] }, c),
    ).resolves.toMatchObject({ studentId: c });
  });
});

describe("a REJECTION is recorded and then soft-deleted (Owner decision, 2026-09-03)", () => {
  /**
   * **The weaker outcome used to be the more permanent one.**
   *
   * A `rejected` link granted no authority and was never soft-deleted, so it
   * stayed **live** — and the TD-6 partial unique index on
   * `(student_id, parent_id) WHERE deleted_at IS NULL` therefore blocked the
   * same adult from ever making a **corrected** request for the same child. A
   * **revoked** link, the stronger outcome, freed the pair immediately. That
   * inversion is what this decision removes: rejection and revocation now have
   * one shape — a decided, recorded, soft-deleted row that grants nothing and
   * blocks nothing.
   *
   * The special-case route `DELETE /admin/family-links/{id}/rejected` (R118.3)
   * existed **only** because such rows stayed live and never reached Trash.
   * With rejection soft-deleting, the ordinary Trash lifecycle owns them —
   * `PURGEABLE` already carries `FamilyLink` — so the second deletion lifecycle
   * is withdrawn rather than kept beside the first.
   */
  async function pendingLink(parentId: string, studentId: string): Promise<string> {
    const row = await prisma.familyLink.create({
      data: { parentId, studentId, status: "pending" },
    });
    return row.id;
  }

  it("records the decision, its reason and its decider — and leaves no live row", async () => {
    const parent = await makeUser("ولي مرفوض");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const linkId = await pendingLink(parent, student);

    await decide(prisma, await actorFor(prisma, admin), linkId, {
      approve: false,
      reason: "صلة القرابة غير صحيحة",
    });

    const row = await prisma.familyLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(row.status).toBe("rejected");
    expect(row.decisionReason).toBe("صلة القرابة غير صحيحة");
    expect(row.decidedById).toBe(admin);
    expect(row.decidedAt).not.toBeNull();
    // The tombstone, stamped with the SAME instant as the decision: they are one
    // act, and a restore identifies rows by comparing tombstones.
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(admin);
    expect(row.deletedAt!.getTime()).toBe(row.decidedAt!.getTime());
  });

  it("grants no authority — the child context refuses it on the very next request", async () => {
    const parent = await makeUser("ولي");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const linkId = await pendingLink(parent, student);
    await decide(prisma, await actorFor(prisma, admin), linkId, {
      approve: false,
      reason: "سبب",
    });

    // The same resolver every child-scoped endpoint uses. A rejected link is
    // refused twice over: by status and by the tombstone.
    await expect(
      resolveActingStudent(prisma, { userId: parent, roles: ["parent"] }, student),
    ).rejects.toBeTruthy();
  });

  it("TD-5/BR-15: writes a Trash snapshot carrying the decision itself", async () => {
    const parent = await makeUser("ولي");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const linkId = await pendingLink(parent, student);
    await decide(prisma, await actorFor(prisma, admin), linkId, {
      approve: false,
      reason: "معلومات ناقصة",
    });

    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: "FamilyLink", targetId: linkId },
    });
    expect(entry.deletedById).toBe(admin);
    // The pair alone says nothing about WHY; the snapshot carries the decision.
    expect(entry.snapshot).toMatchObject({
      parentId: parent,
      studentId: student,
      status: "rejected",
      decisionReason: "معلومات ناقصة",
    });
  });

  it("writes an attributable audit row, with ids and a reason and NO name", async () => {
    const parent = await makeUser("ولي");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const linkId = await pendingLink(parent, student);
    await decide(prisma, await actorFor(prisma, admin), linkId, {
      approve: false,
      reason: "غير مطابق",
    });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { targetEntity: "FamilyLink", targetId: linkId, actionType: "familylink.reject" },
    });
    expect(row.actorUserId).toBe(admin);
    expect(row.detail).toMatchObject({ parent_id: parent, student_id: student, reason: "غير مطابق" });
    // TD-14 — ids and a reason, never a person's name.
    expect(JSON.stringify(row.detail)).not.toContain(TAG);
  });

  it("THE POINT: the same adult may make a corrected request afterwards", async () => {
    const parent = await makeUser("ولي يصحّح");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const rejectedId = await pendingLink(parent, student);
    await decide(prisma, await actorFor(prisma, admin), rejectedId, {
      approve: false,
      reason: "صلة خاطئة",
    });

    const fresh = await createLink(prisma, await actorFor(prisma, admin), parent, student);

    // A NEW row with its own history — never the old decision reopened.
    expect(fresh.id).not.toBe(rejectedId);
    expect(fresh.status).toBe("pending");
    const old = await prisma.familyLink.findUniqueOrThrow({ where: { id: rejectedId } });
    expect(old.status).toBe("rejected");
    expect(old.deletedAt).not.toBeNull();
    expect(old.decisionReason).toBe("صلة خاطئة");
  });

  it("live uniqueness still refuses a second PENDING request for the same pair", async () => {
    const parent = await makeUser("ولي");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    await pendingLink(parent, student);

    await expect(
      createLink(prisma, await actorFor(prisma, admin), parent, student),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("live uniqueness still refuses a request while an APPROVED link exists", async () => {
    const parent = await makeUser("ولي");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    await approvedLink(parent, student);

    await expect(
      createLink(prisma, await actorFor(prisma, admin), parent, student),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("a rejected link cannot be revoked — there is no live authority to withdraw", async () => {
    const parent = await makeUser("ولي");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const linkId = await pendingLink(parent, student);
    await decide(prisma, await actorFor(prisma, admin), linkId, { approve: false, reason: "سبب" });

    // NOT_FOUND rather than STATE_CONFLICT: revoke reads live rows only, and the
    // row is already soft-deleted. §20 rule 17 — gone and out of reach answer alike.
    await expect(
      revokeLink(prisma, await actorFor(prisma, admin), linkId, "محاولة"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("first-wins: a second decision on the same link is STATE_CONFLICT", async () => {
    const parent = await makeUser("ولي");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const linkId = await pendingLink(parent, student);
    await decide(prisma, await actorFor(prisma, admin), linkId, { approve: false, reason: "أولاً" });

    await expect(
      decide(prisma, await actorFor(prisma, admin), linkId, { approve: true }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("TRASH RESTORE CANNOT RESURRECT IT into a live relationship", async () => {
    const parent = await makeUser("ولي");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const superAdmin = await makeStaff("super_admin");
    const linkId = await pendingLink(parent, student);
    await decide(prisma, await actorFor(prisma, admin), linkId, { approve: false, reason: "سبب" });

    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: "FamilyLink", targetId: linkId },
      select: { id: true },
    });

    /**
     * **The safeguarding property, proved rather than assumed.** `FamilyLink` is
     * absent from `RESTORABLE` and carries `CASCADE_RELATIONSHIPS` in
     * `BLOCKED_REASON`, so a generic restore is refused by name — a rejected
     * link can never come back as a live row, whatever a Super Admin clicks.
     */
    await expect(
      restoreEntry(prisma, await actorFor(prisma, superAdmin), entry.id),
    ).rejects.toMatchObject({
      code: "STATE_CONFLICT",
      details: expect.objectContaining({ reason: "CASCADE_RELATIONSHIPS" }),
    });
    const still = await prisma.familyLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(still.deletedAt).not.toBeNull();
    expect(still.status).toBe("rejected");
  });

  it("an APPROVAL still leaves a live, authority-bearing row", async () => {
    const parent = await makeUser("ولي معتمد");
    const student = await makeUser("طفلة");
    const admin = await makeStaff("admin");
    const linkId = await pendingLink(parent, student);

    await decide(prisma, await actorFor(prisma, admin), linkId, { approve: true });

    const row = await prisma.familyLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(row.status).toBe("approved");
    expect(row.deletedAt).toBeNull();
    await expect(
      resolveActingStudent(prisma, { userId: parent, roles: ["parent"] }, student),
    ).resolves.toBeTruthy();
    // And the approval writes its own audit row, from the same shared helper.
    expect(
      await prisma.auditLog.count({
        where: { targetId: linkId, actionType: "familylink.approve" },
      }),
    ).toBe(1);
  });

  it("the obsolete rejected-purge route is gone from the registry and the router", async () => {
    /**
     * It existed only because rejected rows stayed live and never reached Trash.
     * Two competing deletion lifecycles for one entity is how a destructive verb
     * reaches the wrong row, so the special case is withdrawn, not kept.
     */
    const registry = await readFile(
      new URL("../../../scripts/ci/td3-routes.txt", import.meta.url),
      "utf8",
    );
    expect(registry).not.toContain("/rejected");
    const router = await readFile(new URL("../app.ts", import.meta.url), "utf8");
    expect(router).not.toContain("purgeRejected");
  });
});


describe("§4.3 Revision 23 — POST /family-links is staff-mediated", () => {
  it("creates a PENDING link that lands in the approval queue", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");

    const link = await createLink(prisma, await actorFor(prisma, admin), p, c);

    // Pending even though STAFF created it: §4.3 retains that rule without
    // exception, which is also what keeps the queue's family-link type reachable.
    expect(link.status).toBe("pending");
    // And it grants nothing yet (BR-4).
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes an attributable audit row for the staff member who created it", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");

    const link = await createLink(prisma, await actorFor(prisma, admin), p, c);

    const row = await prisma.auditLog.findFirst({
      where: { targetId: link.id, actionType: "familylink.create" },
    });
    expect(row?.actorUserId).toBe(admin);
    const detail = row!.detail as Record<string, unknown>;
    expect(detail["parent_id"]).toBe(p);
    expect(detail["student_id"]).toBe(c);
  });

  it("TD-2: a parent cannot create a link — there is no parent self-service path", async () => {
    const parentCaller = await makeStaff("parent");
    const c = await makeUser("طفلة");

    // This is the whole point of Revision 23: a parent has no route to link
    // themselves to an existing child.
    await expect(
      createLink(prisma, await actorFor(prisma, parentCaller), parentCaller, c),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      createLink(prisma, await actorFor(prisma, parentCaller), parentCaller, c),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await prisma.familyLink.count({ where: { studentId: c } })).toBe(0);
  });

  it("TD-2: a teacher cannot create a link either", async () => {
    const teacher = await makeStaff("teacher");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    await expect(
      createLink(prisma, await actorFor(prisma, teacher), p, c),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("TD-12: an admin suspended mid-session cannot create a link", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    await prisma.user.update({
      where: { id: admin },
      data: { accountStatus: "suspended" },
    });

    await expect(
      createLink(prisma, await actorFor(prisma, admin), p, c),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.familyLink.count({ where: { studentId: c } })).toBe(0);
  });

  it("a duplicate live link is DUPLICATE, never FAMILY_LINK_PENDING", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    await createLink(prisma, await actorFor(prisma, admin), p, c);

    // TD-3.8 restricts FAMILY_LINK_PENDING to own-resource contexts; this caller
    // is staff acting on someone else's relationship, so the review state of the
    // existing link must not be disclosed through the error code.
    await expect(
      createLink(prisma, await actorFor(prisma, admin), p, c),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    expect(
      await prisma.familyLink.count({ where: { parentId: p, studentId: c } }),
    ).toBe(1);
  });

  it("a REVOKED link does not block a fresh staff-created one (TD-6 partial index)", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const first = await approvedLink(p, c);
    await revokeLink(
      prisma,
      await actorFor(prisma, admin),
      first,
      "انتقال الحضانة",
    );

    const again = await createLink(prisma, await actorFor(prisma, admin), p, c);
    expect(again.status).toBe("pending");
  });

  it("refuses a nonexistent or soft-deleted party with 404", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const gone = await makeUser("محذوفة");
    await prisma.user.update({
      where: { id: gone },
      data: { deletedAt: new Date() },
    });

    await expect(
      createLink(
        prisma,
        await actorFor(prisma, admin),
        p,
        "11111111-2222-4333-8444-555555555555",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createLink(prisma, await actorFor(prisma, admin), p, gone),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a user as their own parent", async () => {
    const admin = await makeStaff("admin");
    const self = await makeUser("نفسها");
    await expect(
      createLink(prisma, await actorFor(prisma, admin), self, self),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("the created link becomes usable only after approval, then revocable", async () => {
    const admin = await makeStaff("admin");
    const p = await makeUser("والدة");
    const c = await makeUser("طفلة");
    const link = await createLink(prisma, await actorFor(prisma, admin), p, c);

    // Approve it the way the §5.6 queue does.
    await prisma.familyLink.update({
      where: { id: link.id },
      data: { status: "approved", decidedAt: new Date(), decidedById: admin },
    });
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c),
    ).resolves.toMatchObject({ studentId: c });

    await revokeLink(
      prisma,
      await actorFor(prisma, admin),
      link.id,
      "انتهت الحاجة",
    );
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ["parent"] }, c),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
