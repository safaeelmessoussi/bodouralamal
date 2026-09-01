import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * `DELETE /admin/family-links/{id}` over real HTTP (§4.3 Revision 16).
 *
 * Covers what a service test cannot see: that the route is mounted at this path,
 * inside the guarded router, and answers the TD-3.8 envelope with the right
 * status codes.
 *
 * Requires the compose stack with the api image built from current source:
 *   docker compose up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[fam-http-test]";

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  return httpCall<{
    error?: { code?: string };
    revoked?: boolean;
    id?: string;
  }>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });
}

function bearer(userId: string, roles: string[]): string {
  return issueAccessToken(
    {
      userId,
      roleScopes: roles.map((role) => ({ role, branches: null })),
      accountStatus: "active" as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;
}

async function makeUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
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
  // Trash rows point at the ACTOR too (`deleted_by`, RESTRICT), so clearing them
  // by target alone leaves rows that block deleting the admin who revoked.
  await prisma.trash.deleteMany({
    where: {
      OR: [{ targetId: { in: linkIds } }, { deletedById: { in: ids } }],
    },
  });
  await prisma.familyLink.deleteMany({ where: { id: { in: linkIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

let admin: string;
let adminToken: string;

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: docker compose up -d --build api`,
    );
  }
  await clear();
  admin = await makeStaff("admin");
  adminToken = bearer(admin, ["admin"]);
});

beforeEach(async () => {
  // Remove each link's Trash snapshot before the link itself, or the snapshot
  // outlives it and its `deleted_by` reference blocks teardown.
  const links = await prisma.familyLink.findMany({
    where: {
      OR: [
        { parent: { nameArabic: { startsWith: TAG } } },
        { student: { nameArabic: { startsWith: TAG } } },
      ],
    },
    select: { id: true },
  });
  const linkIds = links.map((l) => l.id);
  await prisma.auditLog.deleteMany({ where: { targetId: { in: linkIds } } });
  await prisma.trash.deleteMany({ where: { targetId: { in: linkIds } } });
  await prisma.familyLink.deleteMany({ where: { id: { in: linkIds } } });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

async function freshLink(): Promise<{
  id: string;
  parentId: string;
  studentId: string;
}> {
  const parentId = await makeUser("والدة");
  const studentId = await makeUser("طفلة");
  const row = await prisma.familyLink.create({
    data: { parentId, studentId, status: "approved", decidedAt: new Date() },
  });
  return { id: row.id, parentId, studentId };
}

describe("DELETE /api/v1/admin/family-links/{id}", () => {
  it("is mounted and revokes with a reason", async () => {
    const link = await freshLink();
    const res = await call(
      "DELETE",
      `/admin/family-links/${link.id}`,
      adminToken,
      {
        reason: "انتقال الحضانة",
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);
    expect(
      (await prisma.familyLink.findUnique({ where: { id: link.id } }))
        ?.deletedAt,
    ).toBeInstanceOf(Date);
  });

  it("refuses an anonymous caller with the TD-3.8 envelope", async () => {
    const link = await freshLink();
    const res = await call(
      "DELETE",
      `/admin/family-links/${link.id}`,
      undefined,
      { reason: "x" },
    );
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("refuses a missing reason with 400 rather than revoking", async () => {
    const link = await freshLink();
    const res = await call(
      "DELETE",
      `/admin/family-links/${link.id}`,
      adminToken,
      {},
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    expect(
      (await prisma.familyLink.findUnique({ where: { id: link.id } }))
        ?.deletedAt,
    ).toBeNull();
  });

  it("refuses a 501-character reason (TD-9)", async () => {
    const link = await freshLink();
    const res = await call(
      "DELETE",
      `/admin/family-links/${link.id}`,
      adminToken,
      {
        reason: "ط".repeat(501),
      },
    );
    expect(res.status).toBe(400);
  });

  it("TD-2: a teacher gets 403", async () => {
    const link = await freshLink();
    const teacher = await makeStaff("teacher");
    const res = await call(
      "DELETE",
      `/admin/family-links/${link.id}`,
      bearer(teacher, ["teacher"]),
      {
        reason: "محاولة",
      },
    );
    expect(res.status).toBe(403);
    expect(
      (await prisma.familyLink.findUnique({ where: { id: link.id } }))
        ?.deletedAt,
    ).toBeNull();
  });

  it("an unknown link is 404 and a second revoke is 404", async () => {
    const unknown = await call(
      "DELETE",
      "/admin/family-links/11111111-2222-4333-8444-555555555555",
      adminToken,
      { reason: "غير موجود" },
    );
    expect(unknown.status).toBe(404);

    const link = await freshLink();
    expect(
      (
        await call("DELETE", `/admin/family-links/${link.id}`, adminToken, {
          reason: "أولى",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("DELETE", `/admin/family-links/${link.id}`, adminToken, {
          reason: "ثانية",
        })
      ).status,
    ).toBe(404);
  });

  it("a pending link is 409, not revoked", async () => {
    const parentId = await makeUser("والدة");
    const studentId = await makeUser("طفلة");
    const pending = await prisma.familyLink.create({
      data: { parentId, studentId, status: "pending" },
    });

    const res = await call(
      "DELETE",
      `/admin/family-links/${pending.id}`,
      adminToken,
      {
        reason: "خطأ",
      },
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("STATE_CONFLICT");
  });
});

describe("POST /api/v1/family-links (staff-mediated, §4.3 R23)", () => {
  it("is mounted and creates a Pending link for staff", async () => {
    const parentId = await makeUser("والدة");
    const studentId = await makeUser("طفلة");

    const res = await call("POST", "/family-links", adminToken, {
      parent_id: parentId,
      student_id: studentId,
    });

    expect(res.status).toBe(201);
    const link = await prisma.familyLink.findFirst({
      where: { parentId, studentId },
    });
    expect(link?.status).toBe("pending");
  });

  it("is NOT parent self-service: a parent caller gets 403", async () => {
    // The core of Revision 23 — there is no parent-facing path to an existing
    // child, so this must be refused at the edge, not merely unlinked in the UI.
    const parentCaller = await makeStaff("parent");
    const studentId = await makeUser("طفلة");

    const res = await call(
      "POST",
      "/family-links",
      bearer(parentCaller, ["parent"]),
      {
        parent_id: parentCaller,
        student_id: studentId,
      },
    );

    expect(res.status).toBe(403);
    expect(await prisma.familyLink.count({ where: { studentId } })).toBe(0);
  });

  it("refuses an anonymous caller", async () => {
    const res = await call("POST", "/family-links", undefined, {
      parent_id: "11111111-2222-4333-8444-555555555555",
      student_id: "11111111-2222-4333-8444-555555555556",
    });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400", async () => {
    expect((await call("POST", "/family-links", adminToken, {})).status).toBe(
      400,
    );
    expect(
      (
        await call("POST", "/family-links", adminToken, {
          parent_id: "x",
          student_id: "y",
        })
      ).status,
    ).toBe(400);
  });

  it("a duplicate live link answers 409 DUPLICATE", async () => {
    const parentId = await makeUser("والدة");
    const studentId = await makeUser("طفلة");
    const body = { parent_id: parentId, student_id: studentId };

    expect((await call("POST", "/family-links", adminToken, body)).status).toBe(
      201,
    );
    const dup = await call("POST", "/family-links", adminToken, body);
    expect(dup.status).toBe(409);
    expect(dup.body.error?.code).toBe("DUPLICATE");
  });

  it("an unknown party is 404", async () => {
    const parentId = await makeUser("والدة");
    const res = await call("POST", "/family-links", adminToken, {
      parent_id: parentId,
      student_id: "11111111-2222-4333-8444-555555555555",
    });
    expect(res.status).toBe(404);
  });
});
