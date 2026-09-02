import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  deleteTestConsentText,
  installTestConsentText,
  removeTestConsentText,
  type InstalledConsentText,
} from '../test-support/legal-consent-text.js';
import { httpCall } from "../test-support/http-client.js";
import {
  clearPlacement,
  provisionPlacement,
  type Placement,
} from "../test-support/placement.js";

/**
 * Child applications over real HTTP, through Nginx (SRS Revision 62).
 *
 * The service suite proves the *decisions*; this proves the **wiring**, and one
 * thing no service test can reach: **that the flow terminates somewhere a
 * parent can use.** R62.9 makes the role switcher expand into a parent's
 * approved children, and the switcher is built from `GET /me` — so the last
 * case here submits, approves, and then asks `/me` whether the child is there,
 * *by name*. Until that assertion existed, every layer could be green while the
 * parent's menu still showed nothing to select.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-childapp-test]";

let consentText: InstalledConsentText | null = null;
/** R64.5 — approving a child places it (§4.1), so every approval names a group. */
let placement: Placement;
const PLACEMENT_TAG = "[http-childapp-test-place]";

interface Body {
  error?: { code?: string; details?: Record<string, unknown> };
  request_id?: string;
  application_ids?: string[];
  child_user_id?: string | null;
  parent_role_granted?: boolean;
  approved_child_links?: { id: string; display_name: string }[];
  roles?: string[];
  data?: Record<string, unknown>[];
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });

function bearer(
  userId: string,
  roles: string[],
  accountStatus = "active",
): string {
  return issueAccessToken(
    {
      userId,
      roleScopes: roles.map((role) => ({ role, branches: null })),
      accountStatus: accountStatus as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;
}

let counter = 0;
/** An active adult account — the caller R62 lets submit an application: a
 *  parent adding another child, or an adult student registering one. */
async function makeAdult(
  label: string,
): Promise<{ id: string; token: string }> {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label} ${counter}`,
      accountStatus: "active",
    },
  });
  return { id: user.id, token: bearer(user.id, ["student"]) };
}

async function makeStaff(role: string): Promise<{ id: string; token: string }> {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${role} ${counter}`,
      accountStatus: "active",
    },
  });
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow!.id, branchId: null },
  });
  return { id: user.id, token: bearer(user.id, [role]) };
}

/** One child, consents given — the shape `POST /child-applications` takes. */
function payload(firstName: string, mediaRelease = true): unknown {
  return {
    children: [
      {
        first_name_arabic: firstName,
        last_name_arabic: `${TAG}-عائلة`,
        sex: "female",
        schooling_stage: "primary",
        consent_media_release: mediaRelease,
        // R67 — required per child on this path too.
        requested_branch_id: placement.branchId,
        requested_category_id: placement.categoryId,
      },
    ],
    consent_data_processing: true,
    // R119 — the wording this form displayed; the server refuses one no longer
    // in force, so the id travels with every submission.
    consent_text_id: consentText!.id,
  };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { contains: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // `child_application` names the parent, the child and the deciding admin
  // under RESTRICT, so it goes before any of them.
  await prisma.childApplication.deleteMany({
    where: {
      OR: [
        { parentId: { in: ids } },
        { childUserId: { in: ids } },
        { decidedById: { in: ids } },
        { matchedExistingUserId: { in: ids } },
      ],
    },
  });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

let admin: { id: string; token: string };
let teacher: { id: string; token: string };

beforeAll(async () => {
    // Fail loudly rather than skipping (§19.2): a silently skipped wiring test is
  // indistinguishable from a passing one.
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: docker compose up -d --build api`,
    );
  }

  await clear();
  placement = await provisionPlacement(prisma, PLACEMENT_TAG);
  // **Installed ONCE**, not per test: a second install would take the
  // suite's own row as *what was there before* and lose the installation's,
  // leaving it superseded after the run (P1.2).
  consentText ??= await installTestConsentText(prisma, "http-childapp-v1");
  admin = await makeStaff("admin");
  teacher = await makeStaff("teacher");
});

afterAll(async () => {
  // **Restored FIRST, not last** (B10): the restore used to sit after the
  // fixture teardown, so any failure there skipped it and left this suite's
  // scratch wording in the shared database. See `test-support/legal-consent-text`.
  await removeTestConsentText(prisma, consentText);
  await clear();
  await clearPlacement(prisma, PLACEMENT_TAG);
  // **Last, after the fixture teardown**: `consent_text_id` is RESTRICT, so a
  // row is only free to go once this suite's own consent records have gone.
  await deleteTestConsentText(prisma, consentText);
  await prisma.$disconnect();
});

describe("POST /child-applications", () => {
  it("an authenticated adult submits and gets the request and its applications", async () => {
    const parent = await makeAdult("مقدِّمة");
    const res = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-سلمى`),
    );

    expect(res.status).toBe(201);
    expect(res.body.application_ids).toHaveLength(1);
    // The grouping id R62.1 requires: children submitted together stay
    // recognisable as one request even though they are decided one at a time.
    expect(typeof res.body.request_id).toBe("string");
  });

  it("is behind authentication — an anonymous POST reaches nothing", async () => {
    const res = await call(
      "POST",
      "/child-applications",
      undefined,
      payload(`${TAG}-مجهولة`),
    );
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("R67: refuses a child with no branch or no stage of its own", async () => {
    // Both moved off the request onto each child, and moving a mandatory
    // question does not make it answerable by silence.
    const parent = await makeAdult("ناقصة");
    for (const omit of [
      "requested_branch_id",
      "requested_category_id",
    ] as const) {
      const body = payload(`${TAG}-${omit}`) as {
        children: Record<string, unknown>[];
      };
      delete body.children[0]![omit];
      const res = await call("POST", "/child-applications", parent.token, body);
      expect(res.status, omit).toBe(400);
    }
  });

  it("R67: one request may carry children at DIFFERENT branches and stages", async () => {
    const other = await prisma.branch.create({
      data: { name: `${TAG} مقر آخر` },
    });
    const parent = await makeAdult("مختلفة");
    const first = payload(`${TAG}-أولى`) as {
      children: Record<string, unknown>[];
    };
    const second = payload(`${TAG}-ثانية`) as {
      children: Record<string, unknown>[];
    };
    second.children[0]!["requested_branch_id"] = other.id;

    const res = await call("POST", "/child-applications", parent.token, {
      children: [first.children[0], second.children[0]],
      consent_data_processing: true,
      consent_text_id: consentText!.id,
    });
    expect(res.status).toBe(201);

    const rows = await prisma.childApplication.findMany({
      where: { id: { in: res.body.application_ids! } },
      orderBy: { createdAt: "asc" },
      select: { requestedBranchId: true, requestId: true },
    });
    expect(rows[0]!.requestedBranchId).toBe(placement.branchId);
    expect(rows[1]!.requestedBranchId).toBe(other.id);
    // One family, one request — the children are not interchangeable, but they
    // arrived together (R62.1).
    expect(rows[0]!.requestId).toBe(rows[1]!.requestId);

    await prisma.childApplication.deleteMany({
      where: { requestedBranchId: other.id },
    });
    await prisma.branch.delete({ where: { id: other.id } });
  });

  it("refuses a body that omits the data-processing consent (§4.1a)", async () => {
    const parent = await makeAdult("بدون-موافقة");
    const res = await call("POST", "/child-applications", parent.token, {
      children: [
        {
          first_name_arabic: `${TAG}-رفض`,
          last_name_arabic: `${TAG}-عائلة`,
          consent_media_release: false,
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("GET /child-applications/mine", () => {
  it("returns the caller's own applications and never another parent's", async () => {
    const mine = await makeAdult("صاحبة");
    const other = await makeAdult("أخرى");
    await call(
      "POST",
      "/child-applications",
      mine.token,
      payload(`${TAG}-ابنتي`),
    );
    await call(
      "POST",
      "/child-applications",
      other.token,
      payload(`${TAG}-ابنتها`),
    );

    const res = await call("GET", "/child-applications/mine", mine.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data?.[0]?.first_name_arabic).toBe(`${TAG}-ابنتي`);
  });

  it("tells a parent the bounded reason and never the internal note (R62.8)", async () => {
    const parent = await makeAdult("مرفوضة");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-مرفوض`),
    );
    const applicationId = submitted.body.application_ids![0]!;

    const decided = await call(
      "POST",
      `/admin/child-applications/${applicationId}/decide`,
      admin.token,
      {
        approve: false,
        rejection_reason: "insufficient_information",
        internal_note: "staff-only text that must never leave the back office",
      },
    );
    expect(decided.status).toBe(200);
    expect(decided.body.child_user_id).toBeNull();

    const res = await call("GET", "/child-applications/mine", parent.token);
    const row = res.body.data![0]!;
    expect(row.status).toBe("rejected");
    expect(row.rejection_reason).toBe("insufficient_information");
    // The projection is where this rule holds, not the documentation of it.
    expect(JSON.stringify(res.body)).not.toContain("staff-only text");
  });
});

describe("POST /admin/child-applications/{id}/decide", () => {
  it("TD-2: a teacher is refused — deciding is an approver action", async () => {
    const parent = await makeAdult("لمعلّمة");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-ط`),
    );
    const res = await call(
      "POST",
      `/admin/child-applications/${submitted.body.application_ids![0]!}/decide`,
      teacher.token,
      { approve: true, administrative_group_id: placement.groupId },
    );
    expect(res.status).toBe(403);
  });

  it("refuses a second decision on one application (TD-15.3 first-wins)", async () => {
    const parent = await makeAdult("مكرّرة");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-م`),
    );
    const id = submitted.body.application_ids![0]!;
    const first = await call(
      "POST",
      `/admin/child-applications/${id}/decide`,
      admin.token,
      {
        approve: true,
        administrative_group_id: placement.groupId,
      },
    );
    expect(first.status).toBe(200);

    // Deliberately WITHOUT a placement: TD-15.3's already-decided check runs
    // before R64.5's placement rule, so a second decision is refused for being
    // second, not for being incomplete.
    const second = await call(
      "POST",
      `/admin/child-applications/${id}/decide`,
      admin.token,
      {
        approve: true,
      },
    );
    expect(second.status).toBe(409);
    expect(second.body.error?.details?.reason).toBe("ALREADY_DECIDED");
  });

  /**
   * **The end of the R62 flow, asserted end to end.**
   *
   * Approving is only useful if the parent can then reach the child, and the
   * route to the child is the switcher — which reads `GET /me`. So this walks
   * the whole way: submit → approve → the parent holds `parent` → `/me` names
   * the child. A green service test proves none of the last step.
   */
  it("approval gives the parent the role, and /me names the child for the switcher", async () => {
    const parent = await makeAdult("والدة");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-هدى`),
    );
    const decided = await call(
      "POST",
      `/admin/child-applications/${submitted.body.application_ids![0]!}/decide`,
      admin.token,
      { approve: true, administrative_group_id: placement.groupId },
    );
    expect(decided.status).toBe(200);
    expect(decided.body.parent_role_granted).toBe(true);
    const childId = decided.body.child_user_id!;

    const me = await call("GET", "/me", bearer(parent.id, ["parent"]));
    expect(me.status).toBe(200);
    expect(me.body.roles).toContain("parent");
    expect(me.body.approved_child_links).toEqual([
      { id: childId, display_name: `${TAG}-هدى ${TAG}-عائلة` },
    ]);
  });

  it("a revoked link removes the child from the switcher on the next request", async () => {
    const parent = await makeAdult("مسحوبة");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-ر`),
    );
    const decided = await call(
      "POST",
      `/admin/child-applications/${submitted.body.application_ids![0]!}/decide`,
      admin.token,
      { approve: true, administrative_group_id: placement.groupId },
    );
    const token = bearer(parent.id, ["parent"]);
    expect(
      (await call("GET", "/me", token)).body.approved_child_links,
    ).toHaveLength(1);

    // Resolved and asserted BEFORE the where clause: `undefined` there is
    // ignored by Prisma and would revoke every link in the database, and `!` is
    // a compile-time claim that does not exist at runtime.
    const childId = decided.body.child_user_id;
    expect(typeof childId).toBe("string");

    // §4.3 (Revision 16) — soft-deleting the link IS the revocation mechanism.
    await prisma.familyLink.updateMany({
      where: { parentId: parent.id, studentId: childId as string },
      data: { deletedAt: new Date() },
    });

    expect((await call("GET", "/me", token)).body.approved_child_links).toEqual(
      [],
    );
  });
});

describe("R66.5 — a placement is a group, OR a Level and a branch", () => {
  it("approves into a Level with NO group, using level_id + branch_id", async () => {
    const bare = await prisma.level.create({
      data: { name: `${TAG} مستوى مباشر`, categoryId: placement.categoryId },
    });
    const parent = await makeAdult("مباشرة");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-م`),
    );
    const res = await call(
      "POST",
      `/admin/child-applications/${submitted.body.application_ids![0]!}/decide`,
      admin.token,
      { approve: true, level_id: bare.id, branch_id: placement.branchId },
    );
    expect(res.status).toBe(200);

    const enrolment = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: res.body.child_user_id!, deletedAt: null },
    });
    expect(enrolment.administrativeGroupId).toBeNull();
    expect(enrolment.branchId).toBe(placement.branchId);

    await prisma.enrollment.deleteMany({ where: { levelId: bare.id } });
    await prisma.level.delete({ where: { id: bare.id } });
  });

  it("REFUSES both shapes at once — the boundary decides, not the service", async () => {
    const parent = await makeAdult("مزدوجة");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-ز`),
    );
    const res = await call(
      "POST",
      `/admin/child-applications/${submitted.body.application_ids![0]!}/decide`,
      admin.token,
      {
        approve: true,
        administrative_group_id: placement.groupId,
        level_id: placement.levelId,
        branch_id: placement.branchId,
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("REFUSES a level_id with no branch_id — half a placement is not one", async () => {
    const parent = await makeAdult("ناقصة");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-ن`),
    );
    const res = await call(
      "POST",
      `/admin/child-applications/${submitted.body.application_ids![0]!}/decide`,
      admin.token,
      { approve: true, level_id: placement.levelId },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/child-applications/{id}/matches", () => {
  it("proposes an existing same-named child, with the facts that tell two apart", async () => {
    // An approved child first — that account becomes the candidate.
    const firstParent = await makeAdult("أولى");
    const firstSubmit = await call(
      "POST",
      "/child-applications",
      firstParent.token,
      payload(`${TAG}-توأم`),
    );
    await call(
      "POST",
      `/admin/child-applications/${firstSubmit.body.application_ids![0]!}/decide`,
      admin.token,
      { approve: true, administrative_group_id: placement.groupId },
    );

    // A second parent applies for a child with the same name.
    const secondParent = await makeAdult("ثانية");
    const secondSubmit = await call(
      "POST",
      "/child-applications",
      secondParent.token,
      payload(`${TAG}-توأم`),
    );

    const res = await call(
      "GET",
      `/admin/child-applications/${secondSubmit.body.application_ids![0]!}/matches`,
      admin.token,
    );
    expect(res.status).toBe(200);
    const candidate = res.body.data?.[0];
    expect(candidate?.name_arabic).toBe(`${TAG}-توأم ${TAG}-عائلة`);
    // R62.3 — name alone can never be enough to choose, so the proposal carries
    // the reference code and the family already attached to it.
    expect(typeof candidate?.reference_code).toBe("string");
    expect(candidate?.linked_parents).toHaveLength(1);
  });

  it("TD-2: a teacher may not see other families as candidates", async () => {
    const parent = await makeAdult("غير-مصرّح");
    const submitted = await call(
      "POST",
      "/child-applications",
      parent.token,
      payload(`${TAG}-غ`),
    );
    const res = await call(
      "GET",
      `/admin/child-applications/${submitted.body.application_ids![0]!}/matches`,
      teacher.token,
    );
    expect(res.status).toBe(403);
  });
});
