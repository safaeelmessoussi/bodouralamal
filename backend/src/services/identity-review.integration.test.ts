import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { actorFor } from "../test-support/actor.js";
import { decide, listApprovals } from "./approval.service.js";

/**
 * **The identity-binding review item** (SRS §4.3 R62.9, mechanism by R68).
 *
 * The property under test is the one the clause exists for and the one easiest
 * to get wrong: **the review must never block anything.** A minor who gains
 * their own login keeps it, their parents keep working, and an administrator
 * decides afterwards — so every assertion here about the stamp is paired with
 * one about the links still functioning.
 *
 * The binding itself is exercised through the auth service in the HTTP suite;
 * this drives the state directly, because what needs proving is the queue and
 * the two outcomes rather than OAuth.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[identity-review-test]";

let adminId = "";
let studentId = "";
let parentAId = "";
let parentBId = "";

async function makeUser(label: string, role?: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  if (role) {
    const roleRow = await prisma.role.findUnique({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: roleRow!.id, branchId: null },
    });
  }
  return user.id;
}

/** The state R62.9 describes: approved links, and the student has just bound. */
async function raise(): Promise<void> {
  await prisma.familyLink.updateMany({
    where: { studentId, status: "approved", deletedAt: null },
    data: { identityReviewRaisedAt: new Date() },
  });
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  // The Trash snapshot from a revocation names its actor under RESTRICT (TD-5).
  await prisma.trash.deleteMany({
    where: { OR: [{ deletedById: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(async () => {
  await clear();
  adminId = await makeUser("مسؤولة", "admin");
  studentId = await makeUser("طالبة");
  parentAId = await makeUser("والدة");
  parentBId = await makeUser("والد");
  for (const parentId of [parentAId, parentBId]) {
    await prisma.familyLink.create({
      data: { parentId, studentId, status: "approved" },
    });
  }
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("the item appears, and is about the ARRANGEMENT", () => {
  it("groups every stamped link of one student into ONE item", async () => {
    // Two parents, one decision: an administrator asked about each separately
    // would be asked the same question twice.
    await raise();
    const page = await listApprovals(prisma, await actorFor(prisma, adminId), {
      type: "identity-review",
    });
    expect(page.data).toHaveLength(1);
    const item = page.data[0]!;
    expect(item.id).toBe(studentId);
    expect(item.bundle.linkCount).toBe(2);
    // The student first, then the adults who hold links to them.
    expect(item.applicants.map((a) => a.role)).toEqual([
      "applicant",
      "parent",
      "parent",
    ]);
  });

  it("does not appear before a login is bound", async () => {
    const page = await listApprovals(prisma, await actorFor(prisma, adminId), {
      type: "identity-review",
    });
    expect(page.data).toHaveLength(0);
  });

  it("is DERIVED — revoking the links removes it with no second write", async () => {
    await raise();
    await prisma.familyLink.updateMany({
      where: { studentId },
      data: { deletedAt: new Date() },
    });
    const page = await listApprovals(prisma, await actorFor(prisma, adminId), {
      type: "identity-review",
    });
    expect(page.data).toHaveLength(0);
  });
});

describe("it is NON-BLOCKING, which is the whole point", () => {
  it("leaves the links approved and usable while it is outstanding", async () => {
    await raise();
    const links = await prisma.familyLink.findMany({
      where: { studentId, deletedAt: null },
      select: { status: true, deletedAt: true },
    });
    expect(links).toHaveLength(2);
    // Still approved, still live: a parent can still act, and the child-context
    // middleware — which reads exactly these two columns — is unchanged.
    for (const link of links) {
      expect(link.status).toBe("approved");
      expect(link.deletedAt).toBeNull();
    }
  });
});

describe("an administrator decides", () => {
  it("APPROVE means the links stand — the stamp clears, nothing else moves", async () => {
    await raise();
    const result = await decide(
      prisma,
      await actorFor(prisma, adminId),
      studentId,
      {
        approve: true,
      },
    );
    expect(result.type).toBe("identity-review");
    expect(result.activated).toBe(2);

    const links = await prisma.familyLink.findMany({ where: { studentId } });
    for (const link of links) {
      expect(link.identityReviewRaisedAt).toBeNull();
      expect(link.deletedAt).toBeNull();
      expect(link.status).toBe("approved");
    }
    expect(
      (
        await listApprovals(prisma, await actorFor(prisma, adminId), {
          type: "identity-review",
        })
      ).data,
    ).toHaveLength(0);
  });

  it("REJECT revokes the links — §4.3 soft delete IS the revocation", async () => {
    await raise();
    await decide(prisma, await actorFor(prisma, adminId), studentId, {
      approve: false,
      reason: "بلغت سنّ الرشد وتدير حسابها بنفسها",
    });

    const links = await prisma.familyLink.findMany({ where: { studentId } });
    for (const link of links) {
      expect(link.deletedAt).not.toBeNull();
      expect(link.identityReviewRaisedAt).toBeNull();
    }
  });

  it("records WHAT WAS DECIDED and, on revocation, what it did", async () => {
    // Two facts, two rows. One row would have had to mean both (TD-8, R68).
    await raise();
    await decide(prisma, await actorFor(prisma, adminId), studentId, {
      approve: false,
      reason: "قرار الإدارة",
    });

    const decided = await prisma.auditLog.findFirst({
      where: { actionType: "familylink.identity_review", targetId: studentId },
    });
    expect((decided?.detail as Record<string, unknown>)["outcome"]).toBe(
      "links_revoked",
    );

    const revoked = await prisma.auditLog.count({
      where: { actionType: "familylink.revoke", actorUserId: adminId },
    });
    expect(revoked).toBe(2);
  });

  it("refuses a rejection with no reason (§5.6)", async () => {
    await raise();
    await expect(
      decide(prisma, await actorFor(prisma, adminId), studentId, {
        approve: false,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
