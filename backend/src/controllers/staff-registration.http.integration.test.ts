import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from "../test-support/consumed-tokens.js";
import { httpCall } from "../test-support/http-client.js";
import {
  clearPlacement,
  provisionPlacement,
  type Placement,
} from "../test-support/placement.js";
import {
  captureConsentVersion,
  restoreConsentVersion,
  type SavedConsentVersion,
} from "../test-support/consent-setting.js";

/**
 * The staff registration workflow, end to end (Revision 49, proposed).
 *
 * **A teacher applies → the queue shows what they asked for → a Super Admin
 * approves and grants the role and its branch scope in one act.** Every route
 * involved already existed; what is new is one optional field on the
 * registration payload and one optional field on the approval.
 *
 * The properties worth pinning are the ones that keep a *self-declared* value
 * from ever becoming authority: a request grants nothing, an administrator role
 * cannot be self-nominated, an Admin cannot use approval as a back door to
 * creating administrators, and a rejection grants nothing whatever the caller
 * sends.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const suiteTokens = ownedOnboardingTokens();
const issueOnboardingToken = suiteTokens.issue;
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-staffreg-test]";
/**
 * **Deliberately not a prefix-extension of `TAG`.** `clear()` deletes by
 * `startsWith(TAG)`, so a placement tagged `${TAG}p` would be swept by the
 * suite's own branch delete — before its Administrative Group was gone, and the
 * `Restrict` FK would refuse. The separating `-` before the bracket is what
 * keeps the two namespaces disjoint.
 */
const PLACEMENT_TAG = "[http-staffreg-test-place]";

let savedConsentVersion: SavedConsentVersion | null = null;

interface Res {
  status: number;
  body: {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>[];
    applicant_id?: string;
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

const bearer = (userId: string, roles: string[]): string =>
  issueAccessToken(
    {
      userId,
      roleScopes: roles.map((role) => ({ role, branches: null })) as never,
      accountStatus: "active" as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;

let superAdmin: string;
let branchAdmin: string;
let branchId: string;
/** §4.1 (R43): approving a student requires a placement, so the fixture has one. */
let placement: Placement;

async function makeStaff(role: string, branch: string | null): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${role}`,
      accountStatus: "active",
    },
  });
  const roleRow = await prisma.role.findUniqueOrThrow({
    where: { name: role },
  });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow.id, branchId: branch },
  });
  return user.id;
}

let counter = 0;

/** Submits the adult self-registration form over real HTTP, exactly as the
 *  public form does — with the onboarding token as the only identity. */
type Framing =
  | { mode: "online" }
  | {
      mode: "in_person" | "both";
      willingness:
        | { all_branches: true }
        | { all_branches: false; branch_ids: string[] };
    };

async function apply(
  requestedRole?: "teacher",
  framing: Framing = {
    mode: "both",
    willingness: { all_branches: false, branch_ids: [branchId] },
  },
): Promise<string> {
  counter += 1;
  const stamp = `${Date.now()}-${counter}`;
  const { token } = issueOnboardingToken(
    {
      email: `staffreg-${stamp}@example.com`,
      providerSubjectId: `staffregsub-${stamp}`,
    },
    config.ONBOARDING_TOKEN_KEY,
  );
  const res = await httpCall<{
    applicant_id?: string;
    error?: { code?: string };
  }>(BASE, "POST", "/registrations", {
    headers: { "X-Onboarding-Token": token },
    body: {
      kind: "adult",
      applicant: {
        first_name_arabic: `${TAG}`,
        last_name_arabic: `أستاذة${counter}`,
        phone: '+212600000040',
        sex: "female",
      },
      // R49: a student states a stage; a staff request must NOT — a teacher
      // is admitted to no Level, and the schema refuses the pair together.
      ...(requestedRole
        ? { requested_role: requestedRole, framing }
        : { branch_id: branchId, category_id: placement.categoryId }),
      consents: { data_processing: true },
    },
  });
  if (res.status !== 201)
    throw new Error(`registration failed: ${JSON.stringify(res.body)}`);
  return res.body.applicant_id!;
}

async function clear(): Promise<void> {
  // A consumed onboarding token is the replay boundary, not anonymous scratch
  // state. Delete only the exact random JTIs this suite issued; a production
  // registration can legitimately complete during the full sweep.
  await clearOwnedConsumedTokens(prisma, suiteTokens);
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.notification.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
    });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
    });
    await prisma.consentRecord.deleteMany({
      where: { studentId: { in: ids } },
    });
    await prisma.$transaction([
      prisma.framingPreferenceBranch.deleteMany({ where: { userId: { in: ids } } }),
      prisma.framingPreference.deleteMany({ where: { userId: { in: ids } } }),
    ]);
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    // §4.1 (R43): approving now CREATES enrolments, and `enrollment.student_id`
    // is ON DELETE RESTRICT — so they go before the people they belong to. This
    // line did not exist before approval placed anybody, which is why adding the
    // placement turned an unrelated dozen tests red.
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.normalizedEmailLock.deleteMany({ where: { email: { startsWith: "staffreg-" } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  // **Last, not first.** `intended_branch_id` and `intended_category_id` are
  // both ON DELETE RESTRICT (R39, R49), so a Category or Branch still named by
  // a user refuses to go — which is the constraint doing its job, and the
  // reason this ordering is a requirement rather than a preference.
  await clearPlacement(prisma, PLACEMENT_TAG);
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
  savedConsentVersion = await captureConsentVersion(prisma);
  await clear();

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  placement = await provisionPlacement(prisma, PLACEMENT_TAG);
  superAdmin = bearer(await makeStaff("super_admin", null), ["super_admin"]);
  branchAdmin = bearer(await makeStaff("admin", branchId), ["admin"]);
});

afterAll(async () => {
  await clear();
  if (savedConsentVersion)
    await restoreConsentVersion(prisma, savedConsentVersion);
  await prisma.$disconnect();
});

describe("a teacher asks for a teacher account", () => {
  it("records the request and grants absolutely nothing", async () => {
    const id = await apply("teacher");
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });

    expect(row.requestedRole).toBe("teacher");
    expect(row.intendedBranchId).toBeNull();
    expect(
      await prisma.framingPreference.findUnique({
        where: { userId: id },
        include: { branches: true },
      }),
    ).toMatchObject({
      mode: "both",
      allBranches: false,
      branches: [{ branchId }],
    });
    // The whole point: a self-declared role is a HINT. Authority lives in
    // `user_branch_role`, and a value that granted access by form submission
    // would be privilege escalation.
    expect(row.accountStatus).toBe("pending");
    expect(
      await prisma.userBranchRole.count({
        where: { userId: id, deletedAt: null },
      }),
    ).toBe(0);
  });

  it("appears in the queue, distinguishable from a family registration", async () => {
    // Before this field the approver could not tell a teacher applicant from a
    // student applicant — the queue showed names and a branch, and nothing else.
    const teacher = await apply("teacher");
    const ordinary = await apply();

    const res = await call(
      "GET",
      "/admin/approvals?type=registration&page_size=100",
      superAdmin,
    );
    expect(res.status).toBe(200);
    const rows = res.body.data!;
    expect(rows.find((r) => r["id"] === teacher)?.["requested_role"]).toBe(
      "teacher",
    );
    expect(rows.find((r) => r["id"] === teacher)?.["framing"]).toMatchObject({
      mode: "both",
      all_branches: false,
      branches: [{ id: branchId }],
    });
    expect(
      rows.find((r) => r["id"] === ordinary)?.["requested_role"],
    ).toBeNull();
  });

  it("refuses an administrator role being self-nominated", async () => {
    // Administrator accounts arrive through staff pre-provisioning (§4.1b step
    // 4b) — an authenticated path with a named actor. A public form is not that,
    // and the schema refuses the value rather than dropping it.
    counter += 1;
    const stamp = `${Date.now()}-${counter}`;
    const { token } = issueOnboardingToken(
      {
        email: `staffregx-${stamp}@example.com`,
        providerSubjectId: `staffregxsub-${stamp}`,
      },
      config.ONBOARDING_TOKEN_KEY,
    );
    for (const role of ["admin", "super_admin", "student"]) {
      const res = await httpCall<{ error?: { code?: string } }>(
        BASE,
        "POST",
        "/registrations",
        {
          headers: { "X-Onboarding-Token": token },
          body: {
            kind: "adult",
            applicant: {
              first_name_arabic: `${TAG}`,
              last_name_arabic: "رفض",
              sex: "female",
            },
            branch_id: branchId,
            requested_role: role,
            consents: { data_processing: true },
          },
        },
      );
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    }
  });

  it("refuses authority scope fields and a legacy single branch beside framing willingness", async () => {
    // Willingness is planning data; `role_branch_id` would be proposed
    // authority, while `branch_id` is the obsolete one-branch teacher shape.
    // Both are refused rather than silently interpreted.
    counter += 1;
    const stamp = `${Date.now()}-${counter}`;
    const { token } = issueOnboardingToken(
      {
        email: `staffregs-${stamp}@example.com`,
        providerSubjectId: `staffregssub-${stamp}`,
      },
      config.ONBOARDING_TOKEN_KEY,
    );
    const res = await httpCall<{ error?: { code?: string } }>(
      BASE,
      "POST",
      "/registrations",
      {
        headers: { "X-Onboarding-Token": token },
        body: {
          kind: "adult",
          applicant: {
            first_name_arabic: `${TAG}`,
            last_name_arabic: "نطاق",
            sex: "female",
          },
          branch_id: branchId,
          requested_role: "teacher",
          role_branch_id: branchId,
          framing: {
            mode: "in_person",
            willingness: { all_branches: false, branch_ids: [branchId] },
          },
          consents: { data_processing: true },
        },
      },
    );
    expect(res.status).toBe(400);
  });

  it("persists online, one, multiple, and future-inclusive all-branch willingness", async () => {
    const secondBranch = await prisma.branch.create({ data: { name: `${TAG} فرع ثانٍ` } });
    const online = await apply("teacher", { mode: "online" });
    const one = await apply("teacher", {
      mode: "in_person",
      willingness: { all_branches: false, branch_ids: [branchId] },
    });
    const multiple = await apply("teacher", {
      mode: "both",
      willingness: { all_branches: false, branch_ids: [branchId, secondBranch.id] },
    });
    const all = await apply("teacher", {
      mode: "both",
      willingness: { all_branches: true },
    });

    const rows = await prisma.framingPreference.findMany({
      where: { userId: { in: [online, one, multiple, all] } },
      include: { branches: true },
    });
    const byUser = new Map(rows.map((row) => [row.userId, row]));
    expect(byUser.get(online)).toMatchObject({ mode: "online", allBranches: false, branches: [] });
    expect(byUser.get(one)?.branches.map((entry) => entry.branchId)).toEqual([branchId]);
    expect(byUser.get(multiple)?.branches.map((entry) => entry.branchId).sort()).toEqual(
      [branchId, secondBranch.id].sort(),
    );
    expect(byUser.get(all)).toMatchObject({ mode: "both", allBranches: true, branches: [] });
  });

  it("database constraint triggers reject incomplete or contradictory committed preferences", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { nameArabic: `${TAG} direct missing branch`, sex: "female" },
        });
        await tx.framingPreference.create({
          data: { userId: user.id, mode: "in_person", allBranches: false },
        });
      }),
    ).rejects.toThrow(/physical framing preference requires/);

    await expect(
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { nameArabic: `${TAG} direct contradictory`, sex: "female" },
        });
        await tx.framingPreference.create({
          data: {
            userId: user.id,
            mode: "both",
            allBranches: true,
            branches: { create: { branchId } },
          },
        });
      }),
    ).rejects.toThrow(/physical framing preference requires/);
  });

  it("refuses missing/invalid modes, stale online branches, duplicates, fake all tokens, and unknown branches", async () => {
    const invalidFramings: unknown[] = [
      undefined,
      { mode: "hybrid" },
      { mode: "in_person" },
      { mode: "both", willingness: { all_branches: false, branch_ids: [] } },
      { mode: "online", willingness: { all_branches: true } },
      {
        mode: "in_person",
        willingness: { all_branches: false, branch_ids: [branchId, branchId] },
      },
      { mode: "in_person", willingness: { all_branches: "all" } },
      {
        mode: "in_person",
        willingness: {
          all_branches: false,
          branch_ids: ["00000000-0000-4000-8000-000000000000"],
        },
      },
    ];

    for (const framing of invalidFramings) {
      counter += 1;
      const stamp = `${Date.now()}-${counter}`;
      const issued = issueOnboardingToken(
        {
          email: `staffreg-invalid-${stamp}@example.com`,
          providerSubjectId: `staffreg-invalid-sub-${stamp}`,
        },
        config.ONBOARDING_TOKEN_KEY,
      );
      const response = await httpCall<{ error?: { code?: string } }>(
        BASE,
        "POST",
        "/registrations",
        {
          headers: { "X-Onboarding-Token": issued.token },
          body: {
            kind: "adult",
            applicant: {
              first_name_arabic: `${TAG}`,
              last_name_arabic: `رفض${counter}`,
              sex: "female",
            },
            requested_role: "teacher",
            ...(framing === undefined ? {} : { framing }),
            consents: { data_processing: true },
          },
        },
      );
      expect(response.status, JSON.stringify(framing)).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_FAILED");
    }
  });
});

describe("approval grants the role and its scope in one transaction", () => {
  it("activates and assigns together, so the account is never active with no role", async () => {
    const id = await apply("teacher");

    const res = await call(
      "POST",
      `/admin/approvals/${id}/approve`,
      superAdmin,
      {
        assignments: [{ role: "teacher", branch_id: branchId }],
      },
    );
    expect(res.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: {
        branchRoles: { where: { deletedAt: null }, include: { role: true } },
      },
    });
    expect(row.accountStatus).toBe("active");
    expect(row.branchRoles).toHaveLength(1);
    expect(row.branchRoles[0]!.role.name).toBe("teacher");
    expect(row.branchRoles[0]!.branchId).toBe(branchId);
  });

  it("records what was asked and what was granted — the gap is the decision", async () => {
    const id = await apply("teacher");
    await call("POST", `/admin/approvals/${id}/approve`, superAdmin, {
      // Approved as a teacher at ONE branch, having asked for nothing in
      // particular about scope. The audit row is where that is visible.
      assignments: [{ role: "teacher", branch_id: branchId }],
    });
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { targetEntity: "User", targetId: id, actionType: "user.approve" },
    });
    const detail = entry.detail as Record<string, unknown>;
    expect(detail["requested_role"]).toBe("teacher");
    expect(detail["granted"]).toEqual([
      { role: "teacher", branch_id: branchId },
    ]);
  });

  it("approves an ordinary applicant with a placement and the structural Student role", async () => {
    // R79: a beneficiary admitted through placement is structurally a Student;
    // the role is derived inside the transaction, never chosen by the client.
    const id = await apply();
    const res = await call(
      "POST",
      `/admin/approvals/${id}/approve`,
      superAdmin,
      {
        enrollments: [
          { user_id: id, administrative_group_id: placement.groupId },
        ],
      },
    );
    expect(res.status).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id } })).accountStatus,
    ).toBe("active");
    const assignments = await prisma.userBranchRole.findMany({
      where: { userId: id, deletedAt: null },
      include: { role: { select: { name: true } } },
    });
    expect(assignments.map((assignment) => assignment.role.name)).toEqual(['student']);
    expect(
      await prisma.enrollment.count({
        where: { studentId: id, deletedAt: null },
      }),
    ).toBe(1);
  });

  it("refuses to approve a student with NO placement (§4.1, R43)", async () => {
    // "An approved account with no enrollment is a person the platform admitted
    // and then lost." The refusal names WHO is missing, because on a family
    // bundle that is the only way to know which of them.
    const id = await apply();
    const res = await call(
      "POST",
      `/admin/approvals/${id}/approve`,
      superAdmin,
      {},
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("ENROLLMENT_REQUIRED");
    expect(res.body.error?.details?.["missing_user_ids"]).toEqual([id]);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id } })).accountStatus,
    ).toBe("pending");
  });

  it("enrols NOBODY for a staff request — a teacher is not admitted to a Level", async () => {
    const id = await apply("teacher");
    const res = await call(
      "POST",
      `/admin/approvals/${id}/approve`,
      superAdmin,
      {
        assignments: [{ role: "teacher", branch_id: branchId }],
      },
    );
    expect(res.status).toBe(200);
    expect(await prisma.enrollment.count({ where: { studentId: id } })).toBe(0);
  });

  it("refuses a placement for somebody outside the bundle", async () => {
    // Otherwise approval would be an unscoped enrolment endpoint: naming any
    // student's id would place them.
    const mine = await apply("teacher");
    const stranger = await apply("teacher");
    const res = await call(
      "POST",
      `/admin/approvals/${mine}/approve`,
      superAdmin,
      {
        enrollments: [
          { user_id: stranger, administrative_group_id: placement.groupId },
        ],
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("NOT_IN_BUNDLE");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: stranger } }))
        .accountStatus,
    ).toBe("pending");
  });

  it("grants NOTHING on rejection, whatever the caller sends", async () => {
    // The single worst outcome this endpoint could produce. The service
    // discards assignments on the reject path rather than relying on a client
    // not to send them.
    const id = await apply("teacher");
    const res = await call(
      "POST",
      `/admin/approvals/${id}/reject`,
      superAdmin,
      {
        reason: "اختبار",
        assignments: [{ role: "teacher", branch_id: branchId }],
      },
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.accountStatus).toBe("rejected");
    expect(
      await prisma.userBranchRole.count({
        where: { userId: id, deletedAt: null },
      }),
    ).toBe(0);
  });

  it("refuses an Admin granting an administrator role through approval", async () => {
    // Approval must not become a second, weaker way to hand out authority than
    // `PUT /admin/users/{id}/roles`. The guard is the SAME function, which is
    // why there is one rule rather than two that drift.
    const id = await apply("teacher");
    const res = await call(
      "POST",
      `/admin/approvals/${id}/approve`,
      branchAdmin,
      {
        assignments: [{ role: "admin", branch_id: branchId }],
      },
    );
    expect(res.status).toBe(403);

    // And the refusal took the ACTIVATION with it: the transaction is atomic,
    // so a rejected privilege grant cannot leave an approved account behind.
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id } })).accountStatus,
    ).toBe("pending");
  });

  it("lets an Admin approve and grant a teacher role", async () => {
    // The privilege guard is about ADMINISTRATOR roles; ordinary approval work
    // stays with the Admins who do it (TD-2).
    const id = await apply("teacher");
    const res = await call(
      "POST",
      `/admin/approvals/${id}/approve`,
      branchAdmin,
      {
        assignments: [{ role: "teacher", branch_id: branchId }],
      },
    );
    expect(res.status).toBe(200);
    expect(
      await prisma.userBranchRole.count({
        where: { userId: id, deletedAt: null, role: { name: "teacher" } },
      }),
    ).toBe(1);
  });

  it("refuses an unknown branch, and approves nothing in the attempt", async () => {
    const id = await apply("teacher");
    const res = await call(
      "POST",
      `/admin/approvals/${id}/approve`,
      superAdmin,
      {
        assignments: [
          {
            role: "teacher",
            branch_id: "00000000-0000-4000-8000-000000000000",
          },
        ],
      },
    );
    expect(res.status).toBe(404);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id } })).accountStatus,
    ).toBe("pending");
  });
});
