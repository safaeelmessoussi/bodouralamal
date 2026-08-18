import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * User management over HTTP — §5.6 *"edit, deactivate, role/branch-scope
 * assignment"*, §14.2, TD-1, TD-4.15, TD-12, TD-15.
 *
 * The properties worth pinning are the ones that make this surface *safe* rather
 * than merely present: that a suspension actually revokes credentials, that the
 * refused keys are refused rather than dropped, that privilege cannot propagate
 * sideways, and that the platform cannot be locked out of its own back office
 * with one click.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-usermgmt-test]";

interface Res {
  status: number;
  body: {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>;
  };
}

const call = (
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> =>
  httpCall<Res["body"]>(BASE, method, path, {
    ...(token !== undefined ? { token } : {}),
    ...(body !== undefined ? { body } : {}),
  });

const bearer = (
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
): string =>
  issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superAdminId: string;
let superAdmin: string;
let branchAdmin: string;
let branchId: string;
let otherBranchId: string;
/** A second live Super Admin, so the last-administrator guard is not the thing
 *  under test in every other case. */
let spareSuperAdminId: string;

async function makeUser(
  label: string,
  status = "active",
  sex: "female" | "male" | null = null,
  beneficiary = false,
): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: status as never,
      ...(sex === null ? {} : { sex }),
      isBeneficiary: beneficiary,
    },
  });
  return u.id;
}

async function grant(
  userId: string,
  role: string,
  branch: string | null,
): Promise<void> {
  const roleRow = await prisma.role.findUniqueOrThrow({
    where: { name: role },
  });
  await prisma.userBranchRole.create({
    data: { userId, roleId: roleRow.id, branchId: branch },
  });
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
    });
    // Enrolments are RESTRICT against `user` (TD-5) — a placement is part of
    // the record of what happened, so it never vanishes beneath a person. The
    // R79 suite creates one, so the teardown unwinds it first.
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.enrollment.deleteMany({
    where: { level: { name: { startsWith: TAG } } },
  });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  // The R79 suite creates a Level and its Category; Levels are
  // RESTRICT-referenced by their Category, so they unwind in that order.
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  otherBranchId = (
    await prisma.branch.create({ data: { name: `${TAG} فرع آخر` } })
  ).id;

  superAdminId = await makeUser("مدير عام");
  await grant(superAdminId, "super_admin", null);
  superAdmin = bearer(superAdminId, [{ role: "super_admin", branches: null }]);

  // Exists so the LAST_SUPER_ADMIN guard is not accidentally the reason an
  // unrelated assertion fails. The guard has its own test, which removes it.
  spareSuperAdminId = await makeUser("مدير عام احتياطي");
  await grant(spareSuperAdminId, "super_admin", null);

  const adminId = await makeUser("مسؤولة الفرع");
  await grant(adminId, "admin", branchId);
  branchAdmin = bearer(adminId, [{ role: "admin", branches: [branchId] }]);
});

afterAll(async () => {
  await clear();

  // **The cheap approximation of "this suite borrowed nothing it did not
  // return".** The `LAST_SUPER_ADMIN` test has to make its target the last
  // administrator in the whole database to prove the guard fires, and an
  // earlier version of it left the development database with none at all —
  // green tests, a back office nobody could enter, and no signal anywhere.
  // Asserting the platform is still administrable is what turns that from a
  // silent outcome into a failing run.
  const administrable = await prisma.user.count({
    where: {
      accountStatus: "active",
      deletedAt: null,
      branchRoles: { some: { deletedAt: null, role: { name: "super_admin" } } },
    },
  });
  await prisma.$disconnect();
  expect(administrable).toBeGreaterThan(0);
});

describe("PATCH /admin/users/{id} — the person's own fields", () => {
  it("edits, and answers with the shape the list already renders", async () => {
    const id = await makeUser("طالبة");
    await grant(id, "student", branchId);

    const list = await call(
      "GET",
      `/admin/users?q=${encodeURIComponent(TAG)}`,
      superAdmin,
    );
    expect(list.status).toBe(200);
    const row = (
      list.body as unknown as { data: Record<string, unknown>[] }
    ).data.find((r) => r["id"] === id)!;
    // The version travels on the LIST, which is why there is no separate
    // single-user read for the edit dialog to call.
    expect(typeof row["version"]).toBe("number");

    const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: row["version"],
      nickname: "أم عبد الله",
      phone: "0600000000",
    });
    expect(res.status).toBe(200);
    expect(res.body.data!["nickname"]).toBe("أم عبد الله");
    expect(res.body.data!["version"]).toBe((row["version"] as number) + 1);
  });

  it("refuses account_status rather than dropping it", async () => {
    // The whole reason suspension is its own verb: TD-4.15 requires session
    // revocation in the same transaction, and a client that set this field and
    // received 200 would believe access had been withdrawn while a 30-day
    // credential was still live.
    const id = await makeUser("طالبة أخرى");
    await grant(id, "student", branchId);
    const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: 0,
      account_status: "suspended",
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id } })).accountStatus,
    ).toBe("active");
  });

  it("refuses pre_provisioned_email and public_display_name", async () => {
    // The first authorises CLAIMING an account (§7 R15); the second is resolved
    // server-side (§20 rule 21), and a back-office form is exactly where a
    // second answer to "which name did this person publish" would appear.
    const id = await makeUser("طالبة ثالثة");
    await grant(id, "student", branchId);
    for (const key of ["pre_provisioned_email", "public_display_name"]) {
      const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
        version: 0,
        [key]: "x@example.com",
      });
      expect(res.status).toBe(400);
    }
  });

  it("refuses a stale version with 409 rather than overwriting", async () => {
    const id = await makeUser("طالبة رابعة");
    await grant(id, "student", branchId);
    const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: 99,
      nickname: "x",
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("VERSION_CONFLICT");
  });

  it("answers 404 — never 403 — for a user outside a branch Admin's visibility", async () => {
    // §20 rule 17: saying "exists, but not yours" is itself the disclosure the
    // §4.2 R25 visibility rule prevents.
    const id = await makeUser("طالبة في فرع آخر");
    await grant(id, "student", otherBranchId);
    const res = await call("PATCH", `/admin/users/${id}`, branchAdmin, {
      version: 0,
      nickname: "x",
    });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("NOT_FOUND");
  });

  it("records which fields changed, never their values", async () => {
    // A name and a phone number are personal data; TD-8's record must not
    // become a second copy of them.
    const id = await makeUser("طالبة خامسة");
    await grant(id, "student", branchId);
    await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: 0,
      nickname: "سرّي",
    });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { targetEntity: "User", targetId: id, actionType: "user.update" },
    });
    expect(row.detail).toEqual({ fields: ["nickname"] });
    expect(JSON.stringify(row.detail)).not.toContain("سرّي");
  });
});

describe("POST /admin/users/{id}/suspend — TD-1 Active → Suspended", () => {
  it("revokes every live session in the same transaction (TD-4.15)", async () => {
    const id = await makeUser("أستاذة موقوفة");
    await grant(id, "teacher", branchId);
    // A live credential, which the suspension must invalidate immediately —
    // otherwise a 30-day refresh token outlives the decision.
    await prisma.refreshToken.create({
      data: {
        userId: id,
        tokenHash: `${TAG}-hash-${Date.now()}`,
        sessionId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    const res = await call("POST", `/admin/users/${id}/suspend`, superAdmin, {
      version: 0,
      reason: "اختبار",
    });
    expect(res.status).toBe(200);
    expect(res.body.data!["account_status"]).toBe("suspended");

    const live = await prisma.refreshToken.count({
      where: { userId: id, revokedAt: null },
    });
    expect(live).toBe(0);
    // The revocation is attributable, not merely counted (§7).
    const revocation = await prisma.auditLog.findFirst({
      where: {
        targetEntity: "User",
        targetId: id,
        actionType: "auth.token_revoked",
      },
    });
    expect(revocation).not.toBeNull();
  });

  it("demands a reason, and refuses a blank one", async () => {
    const id = await makeUser("أستاذة ثانية");
    await grant(id, "teacher", branchId);
    for (const reason of [undefined, "", "   "]) {
      const res = await call("POST", `/admin/users/${id}/suspend`, superAdmin, {
        version: 0,
        ...(reason === undefined ? {} : { reason }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("refuses any starting status but Active (TD-1)", async () => {
    const id = await makeUser("حساب معلّق", "pending");
    await grant(id, "student", branchId);
    const res = await call("POST", `/admin/users/${id}/suspend`, superAdmin, {
      version: 0,
      reason: "اختبار",
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("INVALID_TRANSITION");
  });

  it("refuses self-suspension", async () => {
    // Not paternalism: the administrator is locked out by their own next
    // request, and the recovery path is a VPS shell.
    const res = await call(
      "POST",
      `/admin/users/${superAdminId}/suspend`,
      superAdmin,
      {
        version: 0,
        reason: "اختبار",
      },
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("SELF_SUSPENSION");
  });

  it("reactivates, and leaves the sessions revoked", async () => {
    const id = await makeUser("أستاذة معادة");
    await grant(id, "teacher", branchId);
    await call("POST", `/admin/users/${id}/suspend`, superAdmin, {
      version: 0,
      reason: "اختبار",
    });

    const res = await call(
      "POST",
      `/admin/users/${id}/reactivate`,
      superAdmin,
      { version: 1 },
    );
    expect(res.status).toBe(200);
    expect(res.body.data!["account_status"]).toBe("active");
    // Signing in again is the only way the new state is proven rather than
    // assumed, so nothing un-revokes.
    expect(
      await prisma.refreshToken.count({
        where: { userId: id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it("will not reactivate a Rejected account — that status is terminal", async () => {
    // Re-admitting a rejected applicant is a fresh registration decision, not
    // the undo of a suspension (TD-1, §4.1b step 4a).
    const id = await makeUser("حساب مرفوض", "rejected");
    await grant(id, "student", branchId);
    const res = await call(
      "POST",
      `/admin/users/${id}/reactivate`,
      superAdmin,
      { version: 0 },
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("INVALID_TRANSITION");
  });
});

describe("PUT /admin/users/{id}/roles — the complete assignment set", () => {
  it("replaces the set, tombstoning what it removes (TD-5)", async () => {
    const id = await makeUser("أستاذة تنتقل");
    await grant(id, "teacher", branchId);

    const res = await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [{ role: "teacher", branch_id: otherBranchId }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data!["roles"]).toEqual([
      {
        role: "teacher",
        branch_id: otherBranchId,
        branch_name: `${TAG} فرع آخر`,
      },
    ]);

    // The revoked assignment is soft-deleted, not erased: "who taught at this
    // branch in March" stays answerable.
    const removed = await prisma.userBranchRole.findFirst({
      where: { userId: id, branchId, deletedAt: { not: null } },
    });
    expect(removed).not.toBeNull();
  });

  it("revives a tombstoned assignment rather than colliding with the unique index", async () => {
    // `(user_id, role_id, branch_id)` is unique across deleted rows too, so an
    // insert here would fail outright.
    const id = await makeUser("أستاذة تعود");
    await grant(id, "teacher", branchId);
    await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [],
    });
    const res = await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [{ role: "teacher", branch_id: branchId }],
    });
    expect(res.status).toBe(200);
    expect(
      await prisma.userBranchRole.count({
        where: { userId: id, branchId, deletedAt: null },
      }),
    ).toBe(1);
  });

  it("refuses an Admin granting an administrator role — privilege propagation", async () => {
    const id = await makeUser("مرشحة للإدارة");
    await grant(id, "teacher", branchId);
    const res = await call("PUT", `/admin/users/${id}/roles`, branchAdmin, {
      assignments: [
        { role: "teacher", branch_id: branchId },
        { role: "admin", branch_id: branchId },
      ],
    });
    expect(res.status).toBe(403);
    expect(
      await prisma.userBranchRole.count({
        where: { userId: id, deletedAt: null, role: { name: "admin" } },
      }),
    ).toBe(0);
  });

  it("lets a Super Admin grant super_admin (Revision 22)", async () => {
    // Revision 22: after bootstrap, every change of administrators happens
    // EXCLUSIVELY through the application. Refusing the role here would leave a
    // VPS shell as the only route to a second Super Admin.
    const id = await makeUser("مديرة عامة جديدة");
    await grant(id, "admin", branchId);
    const res = await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [{ role: "super_admin", branch_id: null }],
    });
    expect(res.status).toBe(200);
    expect((res.body.data!["roles"] as { role: string }[])[0]!.role).toBe(
      "super_admin",
    );
  });

  it("will not strip the last active Super Admin of the role", async () => {
    // Revision 22 documents that lockout as a RECOVERY path needing
    // DATABASE_URL and a manual seed run — not an outcome one click may produce.
    //
    // **The guard counts GLOBALLY, so proving it means being the last Super
    // Admin in the whole database** — which is why this test suspends every
    // other one first, and why getting that wrong is expensive. A first version
    // revoked the `super_admin` ASSIGNMENT of every other holder, including
    // real seeded accounts outside this file's `TAG` namespace, and restored
    // only its own spare: it left the development database with **zero active
    // Super Admins**, locked out of its own back office, and nothing failed.
    //
    // Two changes make that impossible now. It touches `account_status`
    // instead of the assignment, so nobody's ROLE GRANT is ever rewritten; and
    // every id it changes is captured first and restored in a `finally`, so an
    // assertion failure mid-test cannot leave the platform administrator-less.
    const others = await prisma.user.findMany({
      where: {
        id: { not: superAdminId },
        accountStatus: "active",
        deletedAt: null,
        branchRoles: {
          some: { deletedAt: null, role: { name: "super_admin" } },
        },
      },
      select: { id: true },
    });
    const parked = others.map((o) => o.id);

    try {
      await prisma.user.updateMany({
        where: { id: { in: parked } },
        data: { accountStatus: "suspended" },
      });

      const res = await call(
        "PUT",
        `/admin/users/${superAdminId}/roles`,
        superAdmin,
        {
          assignments: [],
        },
      );
      expect(res.status).toBe(409);
      expect(res.body.error?.details?.["reason"]).toBe("LAST_SUPER_ADMIN");
      // Refused means refused: the assignment is still live, not half-removed.
      expect(
        await prisma.userBranchRole.count({
          where: {
            userId: superAdminId,
            deletedAt: null,
            role: { name: "super_admin" },
          },
        }),
      ).toBe(1);

      // The same guard protects suspension, which is the other way to reach
      // zero administrators.
      const suspendRes = await call(
        "POST",
        `/admin/users/${superAdminId}/suspend`,
        superAdmin,
        {
          version: 0,
          reason: "اختبار",
        },
      );
      // Self-suspension is refused first — a different reason, and the one that
      // actually applies when an administrator targets their own account.
      expect(suspendRes.status).toBe(409);
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: parked } },
        data: { accountStatus: "active" },
      });
    }

    // The spare is restored to active by the block above; assert it, because
    // "the fixture cleaned up after itself" is the property that failed once.
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: spareSuperAdminId },
        })
      ).accountStatus,
    ).toBe("active");
  });

  it("refuses an unknown role and an unknown branch", async () => {
    const id = await makeUser("حالة خاطئة");
    await grant(id, "student", branchId);
    const unknownRole = await call(
      "PUT",
      `/admin/users/${id}/roles`,
      superAdmin,
      {
        assignments: [{ role: "headmistress", branch_id: null }],
      },
    );
    expect(unknownRole.status).toBe(400);

    const unknownBranch = await call(
      "PUT",
      `/admin/users/${id}/roles`,
      superAdmin,
      {
        assignments: [
          {
            role: "student",
            branch_id: "00000000-0000-4000-8000-000000000000",
          },
        ],
      },
    );
    expect(unknownBranch.status).toBe(404);
  });
});

describe("who may manage users at all", () => {
  it("refuses a Teacher every verb", async () => {
    const teacherId = await makeUser("أستاذة بلا صلاحية");
    await grant(teacherId, "teacher", branchId);
    const teacher = bearer(teacherId, [
      { role: "teacher", branches: [branchId] },
    ]);
    const target = await makeUser("هدف");
    await grant(target, "student", branchId);

    expect(
      (await call("PATCH", `/admin/users/${target}`, teacher, { version: 0 }))
        .status,
    ).toBe(403);
    expect(
      (
        await call("POST", `/admin/users/${target}/suspend`, teacher, {
          version: 0,
          reason: "x",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("PUT", `/admin/users/${target}/roles`, teacher, {
          assignments: [],
        })
      ).status,
    ).toBe(403);
  });

  it("refuses an anonymous caller with the TD-3.8 envelope", async () => {
    const res = await call("PATCH", `/admin/users/${superAdminId}`, undefined, {
      version: 0,
    });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
  });
});

/**
 * **R79 — beneficiary status is a durable fact, independent of every role.**
 *
 * ## What these prove that nothing else could
 *
 * Before R79 the enrolment selector offered every active account, because the
 * platform had no way to answer *is this person a beneficiary*. Each substitute
 * fails on one of the rows below, and that is why they are all here:
 *
 * * the **student role** fails on the minor, who holds none at all (§4.3), and
 *   on the مؤطرة who studies;
 * * an existing **enrolment** fails on the accepted-but-unplaced beneficiary,
 *   and would make enrolment the precondition for being enrollable;
 * * a **staff role** fails as an exclusion, because staff may be beneficiaries.
 */
describe("R79 — who the enrolment selector offers", () => {
  let beneficiaryNoRole: string;
  let staffOnly: string;
  let adminOnly: string;
  let guardianOnly: string;
  let staffAndBeneficiary: string;
  let unplacedBeneficiary: string;
  let levelId: string;
  let branchId: string;

  const offered = async (): Promise<string[]> => {
    const res = await call(
      "GET",
      "/admin/users?page_size=100&beneficiaries_only=true",
      superAdmin,
    );
    expect(res.status).toBe(200);
    return (res.body.data as unknown as Record<string, unknown>[]).map((u) =>
      String(u["id"]),
    );
  };

  beforeAll(async () => {
    beneficiaryNoRole = await makeUser(
      "قاصر مستفيدة",
      "active",
      "female",
      true,
    );
    staffOnly = await makeUser("مؤطرة فقط", "active", "female", false);
    adminOnly = await makeUser("مسؤولة فقط", "active", "female", false);
    guardianOnly = await makeUser("ولية أمر فقط", "active", "female", false);
    staffAndBeneficiary = await makeUser(
      "مؤطرة ودارسة",
      "active",
      "female",
      true,
    );
    unplacedBeneficiary = await makeUser(
      "مستفيدة بلا تسجيل",
      "active",
      "female",
      true,
    );
    await grant(staffOnly, "teacher", null);
    await grant(adminOnly, "admin", null);
    // The decisive pair: the SAME role, opposite beneficiary status.
    await grant(staffAndBeneficiary, "teacher", null);

    // Test J needs a placement to end. Created here rather than assumed from
    // another suite's fixtures: a test that borrows somebody else's rows fails
    // for reasons that have nothing to do with what it asserts.
    const category = await prisma.category.create({
      data: { name: `${TAG} فئة R79` },
    });
    levelId = (
      await prisma.level.create({
        data: {
          name: `${TAG} مستوى R79`,
          categoryId: category.id,
          genderRestriction: "any",
        },
      })
    ).id;
    branchId = (
      await prisma.branch.create({ data: { name: `${TAG} فرع R79` } })
    ).id;
  });

  it("A · a beneficiary with NO ROLE appears", async () => {
    expect(await offered()).toContain(beneficiaryNoRole);
  });

  it("B/C/D · staff-only, admin-only and guardian-only do NOT appear", async () => {
    const list = await offered();
    expect(list).not.toContain(staffOnly);
    expect(list).not.toContain(adminOnly);
    expect(list).not.toContain(guardianOnly);
  });

  it("E · staff WHO ARE ALSO beneficiaries DO appear", async () => {
    // She holds the same `teacher` role as the excluded one. No role
    // distinguishes them — only the durable fact does, which is the whole point.
    expect(await offered()).toContain(staffAndBeneficiary);
  });

  it("F · a beneficiary with ZERO enrolments appears", async () => {
    // The case that makes enrolment unusable as the definition: she has been
    // accepted and not yet placed.
    expect(
      await prisma.enrollment.count({
        where: { studentId: unplacedBeneficiary },
      }),
    ).toBe(0);
    expect(await offered()).toContain(unplacedBeneficiary);
  });

  it("J · ending every enrolment does NOT erase the fact", async () => {
    const enrolment = await prisma.enrollment.create({
      data: { studentId: beneficiaryNoRole, levelId, branchId },
    });
    await prisma.enrollment.update({
      where: { id: enrolment.id },
      data: { deletedAt: new Date() },
    });
    // R79.4 — durable. A beneficiary between placements is still a beneficiary.
    expect(await offered()).toContain(beneficiaryNoRole);
  });

  it("L · a StudentSocialProfile is NOT required for beneficiary identity", async () => {
    // §4.10's case file is created by staff later, and most beneficiaries never
    // have one. Requiring it would have hidden nearly everybody.
    const withProfile = await prisma.studentSocialProfile.count({
      where: { studentId: { in: [beneficiaryNoRole, unplacedBeneficiary] } },
    });
    expect(withProfile).toBe(0);
    const list = await offered();
    expect(list).toContain(beneficiaryNoRole);
    expect(list).toContain(unplacedBeneficiary);
  });

  it("offers everybody when the parameter is absent, so it narrows nothing by default", async () => {
    const res = await call(
      "GET",
      `/admin/users?page_size=100&q=${encodeURIComponent(TAG)}`,
      superAdmin,
    );
    const all = (res.body.data as unknown as Record<string, unknown>[]).map(
      (u) => String(u["id"]),
    );
    expect(all).toContain(staffOnly);
    expect(all).toContain(beneficiaryNoRole);
  });

  it("never publishes the flag on the contract", async () => {
    // R79.8 — it is a fact about a person's relationship with the institute, and
    // the screens that need it read it server-side.
    const res = await call(
      "GET",
      `/admin/users?q=${encodeURIComponent(TAG)}`,
      superAdmin,
    );
    for (const row of res.body.data as unknown as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty("is_beneficiary");
      expect(row).not.toHaveProperty("sex");
    }
  });
});
