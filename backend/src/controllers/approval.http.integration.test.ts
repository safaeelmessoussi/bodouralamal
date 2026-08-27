import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { issueOnboardingToken } from "../lib/onboarding-token.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  captureConsumedTokens,
  clearConsumedTokensAddedSince,
  type SavedConsumedTokens,
} from '../test-support/consumed-tokens.js';
import { httpCall } from "../test-support/http-client.js";
import {
  clearPlacement,
  provisionPlacement,
  type Placement,
} from "../test-support/placement.js";
import {
  CONSENT_TEXT_VERSION_KEY,
  register,
} from "../services/registration.service.js";
import {
  captureConsentVersion,
  restoreConsentVersion,
  type SavedConsentVersion,
} from "../test-support/consent-setting.js";

/**
 * Approval routes over real HTTP, through Nginx (TD-3.2, §5.6).
 *
 * The service-level suite proves the decisions; this proves the *wiring* —
 * route paths, the authenticate middleware, status codes and the TD-3.8 error
 * envelope. Those are invisible to a service test: a route mounted at the wrong
 * path, or outside the guarded router, would leave every service test green.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
/**
 * Restored in `afterAll` — a fixture must not leave the app unrunnable.
 *
 * Captured ONCE. A `beforeEach` capture would re-save whatever the previous
 * test left behind, so by the end the suite would "restore" its own scratch
 * value rather than the developer's.
 */
let savedConsumedTokens: SavedConsumedTokens;
let savedConsentVersion: SavedConsentVersion | null = null;
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-appr-test]";
/**
 * **Deliberately not a prefix-extension of `TAG`.** `clear()` deletes by
 * `startsWith(TAG)`, so a placement tagged `${TAG}p` would be swept by the
 * suite's own branch delete — before its Administrative Group was gone, and the
 * `Restrict` FK would refuse. The separating `-` before the bracket is what
 * keeps the two namespaces disjoint.
 */
const PLACEMENT_TAG = "[http-appr-test-place]";

interface Res {
  status: number;
  body: {
    error?: { code?: string };
    data?: unknown[];
    meta?: { page_size?: number };
    type?: string;
  };
}

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> {
  return httpCall<Res["body"]>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });
}

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

async function makeStaff(role: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${role}`,
      accountStatus: "active",
    },
  });
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow!.id, branchId: null },
  });
  return user.id;
}

let counter = 0;
/** R62 — produces a pending parent and a `ChildApplication`; no child exists
 *  until the application is approved on its own. */
async function submitBundle(
  intoBranchId?: string,
): Promise<{ parentId: string; applicationId: string }> {
  counter += 1;
  const stamp = `${Date.now()}-${counter}`;
  const { token } = issueOnboardingToken(
    {
      email: `httpappr-${stamp}@example.com`,
      providerSubjectId: `httpapprsub-${stamp}`,
    },
    config.ONBOARDING_TOKEN_KEY,
  );
  const result = await register(
    prisma,
    token,
    {
      kind: "parent_child",
      parent: {
        first_name_arabic: `${TAG}`,
        last_name_arabic: `والدة`,
        sex: "female" as const,
      },
      children: [
        {
          first_name_arabic: `${TAG}`,
          last_name_arabic: `طفلة`,
          sex: "female" as const,
          consent_media_release: true,
          // R67 — the branch and stage belong to the child now. `intoBranchId`
          // is what the branch-filter test varies.
          requested_branch_id: intoBranchId ?? branchId,
          requested_category_id: placement.categoryId,
        },
      ],
      // R49 — the stage the parent chose for the child, which §4.1 step 1
      // preselects the first Level from. The fixture's placement Category, so
      // the preselection and the group the approval uses agree.
      consents: { data_processing: true, media_release: true },
    },
    config.ONBOARDING_TOKEN_KEY,
  );
  return {
    parentId: result.applicantId,
    applicationId: result.childApplicationIds[0]!,
  };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  // §4.1 (R43): approving now CREATES enrolments, and `enrollment.student_id`
  // is ON DELETE RESTRICT — so they go before the people they belong to. This
  // line did not exist before approval placed anybody, which is why adding the
  // placement turned an unrelated dozen tests red.
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // R62 — a parent_child registration now writes `child_application` rows, and
  // they reference the parent, the child and the deciding admin under RESTRICT.
  // A teardown that sweeps only what the previous shape wrote is blocked here.
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
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await clearConsumedTokensAddedSince(prisma, savedConsumedTokens);
  await prisma.normalizedEmailLock.deleteMany({ where: { email: { startsWith: "httpappr-" } } });
  // After the users: `intended_branch_id` is ON DELETE RESTRICT.
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  // **Last, not first.** `intended_branch_id` and `intended_category_id` are
  // both ON DELETE RESTRICT (R39, R49), so a Category or Branch still named by
  // a user refuses to go — which is the constraint doing its job, and the
  // reason this ordering is a requirement rather than a preference.
  await clearPlacement(prisma, PLACEMENT_TAG);
}

let adminId: string;
let teacherId: string;
/** Two branches — a filter never given something to exclude has not been
 *  tested (§4.1/§14.2, Revision 39). */
let branchId = "";
let otherBranchId = "";
let admin: string;
let teacher: string;
/** §4.1 (R43) makes placement part of approval, so every approval here needs a
 *  Level and a group behind it. */
let placement: Placement;

beforeAll(async () => {
  // Capture BEFORE anything is created: the teardown removes only what this
  // suite added, never a developer's own spent token (P1.2).
  savedConsumedTokens = await captureConsumedTokens(prisma);
  savedConsentVersion ??= await captureConsentVersion(prisma);
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
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: { value: "http-appr-v1" },
    create: { key: CONSENT_TEXT_VERSION_KEY, value: "http-appr-v1" },
  });
  branchId = (await prisma.branch.create({ data: { name: `${TAG} مقر أ` } }))
    .id;
  otherBranchId = (
    await prisma.branch.create({ data: { name: `${TAG} مقر ب` } })
  ).id;
  adminId = await makeStaff("admin");
  teacherId = await makeStaff("teacher");
  admin = bearer(adminId, ["admin"]);
  teacher = bearer(teacherId, ["teacher"]);
});

afterAll(async () => {
  await clear();
  // Restore, never delete: deleting left the developer's database with no
  // consent text version, and registration then failed closed for everyone
  // who used the form after a test run (see test-support/consent-setting).
  if (savedConsentVersion)
    await restoreConsentVersion(prisma, savedConsentVersion);
  await prisma.$disconnect();
});

describe("GET /api/v1/admin/approvals", () => {
  it("is mounted, guarded, and answers the TD-10 envelope to an admin", async () => {
    const { parentId } = await submitBundle();
    const res = await call("GET", "/admin/approvals", admin);

    expect(res.status).toBe(200);
    expect(res.body.meta?.page_size).toBe(25);
    // Proves the route is really mounted at this path: a 401-from-nowhere would
    // look identical to an unmatched path under the guarded router.
    expect(
      (res.body.data as { id: string }[]).some((i) => i.id === parentId),
    ).toBe(true);
  });

  it("§16.2: an item is the contract DTO — snake_case, and exactly these keys", async () => {
    // Asserting the EXACT key set, not just the presence of the ones we want,
    // is the point: the failure this guards against is a field arriving that
    // nobody chose. A `toContain`-style check passes happily through that.
    const { parentId } = await submitBundle();
    const res = await call("GET", "/admin/approvals", admin);
    const item = (res.body.data as Record<string, unknown>[]).find(
      (i) => i.id === parentId,
    )!;

    expect(Object.keys(item).sort()).toEqual([
      "applicants",
      "branch",
      "bundle",
      "category",
      // R62 — the per-child decidable blocks. `[]` on a registration item,
      // which bundles its children as pending LINKS; populated only on a
      // `child-application` item. It is argued onto this list rather than
      // arriving on it: without it the queue could show a child-application
      // request but give the approver nothing to act on, since R62.2 decides
      // a child alone and the ids live in these blocks.
      "children",
      "id",
      "requested_role",
      "submitted_at",
      "type",
    ]);
    // `requested_role` joined in Revision 49 and is deliberately argued onto
    // this list rather than arriving on it: without it the approver cannot tell
    // a teacher applicant from a family registration, which is the entire
    // reason the staff workflow needed anything at all. **A hint, never an
    // authority** — it is `null` here because this bundle asked for no role.
    expect(item["requested_role"]).toBeNull();
    // `category` joined in Revision 49, and it is what made §4.1 step 1's
    // preselection implementable at all: nothing had recorded the applicant's
    // stage, so the clause could not be honoured. Two fields, like the branch.
    expect(Object.keys(item["category"] as object).sort()).toEqual([
      "id",
      "name",
    ]);
    // R39: what the applicant ASKED FOR, projected to exactly two fields.
    expect(Object.keys(item.branch as object).sort()).toEqual(["id", "name"]);
    expect(Object.keys(item.bundle as object).sort()).toEqual([
      "child_count",
      "link_count",
    ]);
    const applicant = (item.applicants as Record<string, unknown>[])[0]!;
    expect(Object.keys(applicant).sort()).toEqual(["id", "name", "role"]);
    // `submitted_at` is an instant, correctly — a submission is a moment.
    expect(item.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("§14.2 R39: branch_id NARROWS the queue rather than returning everything", async () => {
    // The test a filter actually needs: something it must exclude. One item in
    // each branch, then assert each filter returns its own and not the other.
    const here = await submitBundle(branchId);
    const elsewhere = await submitBundle(otherBranchId);

    const mine = await call(
      "GET",
      `/admin/approvals?branch_id=${branchId}`,
      admin,
    );
    const ids = (mine.body.data as { id: string }[]).map((i) => i.id);
    expect(ids).toContain(here.parentId);
    expect(ids).not.toContain(elsewhere.parentId);

    // `meta.total` must describe the FILTERED set, or the client renders pages
    // that are empty.
    expect(mine.body.meta?.page_size).toBe(25);
    const all = await call("GET", "/admin/approvals", admin);
    expect((all.body.data as { id: string }[]).map((i) => i.id)).toEqual(
      expect.arrayContaining([here.parentId, elsewhere.parentId]),
    );
  });

  it("R39: a branch filter excludes family-link items WHOLESALE", async () => {
    // A link request carries no branch, so asking for "branch X" asks for
    // something it can never be. Excluding the type keeps `meta.total` honest.
    const res = await call(
      "GET",
      `/admin/approvals?branch_id=${branchId}`,
      admin,
    );
    const types = new Set(
      (res.body.data as { type: string }[]).map((i) => i.type),
    );
    expect(types.has("family-link")).toBe(false);
  });

  it("R39: an unknown branch_id is a 400, not a silent empty list", async () => {
    // A malformed filter that returns nothing looks identical to a branch with
    // no applicants — the admin would conclude the queue is clear.
    const res = await call(
      "GET",
      "/admin/approvals?branch_id=not-a-uuid",
      admin,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses an anonymous caller with the TD-3.8 envelope", async () => {
    const res = await call("GET", "/admin/approvals");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("refuses a tampered token signature", async () => {
    const res = await call("GET", "/admin/approvals", `${admin}x`);
    expect(res.status).toBe(401);
  });

  it("TD-2: a teacher holding a valid token gets 403, not a filtered list", async () => {
    const res = await call("GET", "/admin/approvals", teacher);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
  });

  it("TD-12: a token claiming admin for a NON-admin user is refused", async () => {
    // The claim is genuinely signed — only the database says otherwise. This is
    // the whole point of the freshness assertion: claims are not authority.
    const res = await call(
      "GET",
      "/admin/approvals",
      bearer(teacherId, ["admin", "super_admin"]),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/admin/approvals/{id}/approve|reject", () => {
  it("approves a bundle end to end and reports what changed", async () => {
    const { parentId, applicationId } = await submitBundle();
    // §4.1 (R43): the placement IS the approval. The child is the student; the
    // parent's access comes through the family link.
    const res = await call(
      "POST",
      `/admin/approvals/${parentId}/approve`,
      admin,
      {
        // **R62 narrowed this.** The parent's approval no longer places a child;
        // the placement moved onto the child's own decision.
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("registration");
    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("active");
    // Untouched, and still decidable through its own endpoint.
    expect(
      (
        await prisma.childApplication.findUnique({
          where: { id: applicationId },
        })
      )?.status,
    ).toBe("pending");

    const second = await call(
      "POST",
      `/admin/approvals/${parentId}/approve`,
      admin,
      {},
    );
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("STATE_CONFLICT");
  });

  it("rejects with a reason, and refuses to reject without one", async () => {
    const { parentId } = await submitBundle();

    const bare = await call(
      "POST",
      `/admin/approvals/${parentId}/reject`,
      admin,
      {},
    );
    expect(bare.status).toBe(400);
    expect(bare.body.error?.code).toBe("VALIDATION_FAILED");

    // TD-9: 500 characters is the limit, so 501 must be refused at the edge.
    const tooLong = await call(
      "POST",
      `/admin/approvals/${parentId}/reject`,
      admin,
      {
        reason: "ط".repeat(501),
      },
    );
    expect(tooLong.status).toBe(400);

    const ok = await call(
      "POST",
      `/admin/approvals/${parentId}/reject`,
      admin,
      {
        reason: "الملف غير مكتمل",
      },
    );
    expect(ok.status).toBe(200);
    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("rejected");
  });

  it("a malformed id is 400 and a well-formed unknown one is 404", async () => {
    const malformed = await call(
      "POST",
      "/admin/approvals/not-a-uuid/approve",
      admin,
      {},
    );
    expect(malformed.status).toBe(400);

    // Shaped like a UUID but with an invalid version/variant nibble. Postgres
    // would accept it as a `uuid`; the edge rejects it as syntactically
    // impossible before any lookup, since every id this system issues is v4.
    const notRfcValid = await call(
      "POST",
      "/admin/approvals/11111111-2222-3333-4444-555555555555/approve",
      admin,
      {},
    );
    expect(notRfcValid.status).toBe(400);

    const unknown = await call(
      "POST",
      "/admin/approvals/11111111-2222-4333-8444-555555555555/approve",
      admin,
      {},
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe("NOT_FOUND");
  });

  it("a request with no body at all does not 500", async () => {
    // The point is the ABSENCE of a crash, not the status. Since §4.1 (R43)
    // made the placement part of the approval, a bodyless approve is a
    // well-formed refusal — which is still exactly what this test exists to
    // prove: a missing body reaches the validator, not the error middleware.
    const { parentId } = await submitBundle();
    const res = await call(
      "POST",
      `/admin/approvals/${parentId}/approve`,
      admin,
    );
    // R62 changed the STATUS, not the point: a parent registering children
    // enrols nobody at approval, so a bodyless approve is now well-formed.
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
  });

  it("TD-12: suspending the admin revokes approval power without touching the token", async () => {
    const { parentId } = await submitBundle();
    const solo = await makeStaff("admin");
    const soloToken = bearer(solo, ["admin"]);

    expect((await call("GET", "/admin/approvals", soloToken)).status).toBe(200);
    await prisma.user.update({
      where: { id: solo },
      data: { accountStatus: "suspended" },
    });

    expect((await call("GET", "/admin/approvals", soloToken)).status).toBe(403);
    const denied = await call(
      "POST",
      `/admin/approvals/${parentId}/approve`,
      soloToken,
      {},
    );
    expect(denied.status).toBe(403);
    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("pending");
  });
});
