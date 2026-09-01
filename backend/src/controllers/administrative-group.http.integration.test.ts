import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/** R66 — an enrolment carries its own branch, taken from the group so the
 *  composite FK `(administrative_group_id, branch_id)` holds. */
async function branchOf(groupId: string): Promise<string> {
  const g = await prisma.administrativeGroup.findUniqueOrThrow({
    where: { id: groupId },
    select: { branchId: true },
  });
  return g.branchId;
}

/**
 * Administrative Groups over real HTTP (TD-3.12, §4.4c, Revision 43).
 *
 * **Why an HTTP suite exists beside the service suite.** A service test asserts
 * the *decision*; it never sees the *wire*. `GET /admin/branches` shipped raw
 * Prisma rows for months with every service test green, which is exactly how a
 * contract drifts unnoticed. So these tests assert the **exact key set** of each
 * response rather than the presence of the fields wanted — the failure being
 * guarded is a field *arriving* that nobody chose, and a presence check passes
 * straight through it.
 *
 * **The Revision 43 stake is higher than shape.** §20 rule 22 forbids ever
 * re-conflating organisation with delivery, and an API is where that would creep
 * back: a client asking for `max_students` and receiving `201` would reasonably
 * believe a capacity was recorded, when BR-23 says none exists to record. Those
 * keys are therefore asserted **refused**, not merely absent from the response.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-adminis-group-test]";

/** The whole contract, in one sorted list (§16.2 allow-list projection). */
const GROUP_KEYS = [
  "branch_id",
  "display_order",
  "id",
  "level_id",
  "member_count",
  "name",
  "version",
];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>[];
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

/**
 * **Why the ids are recorded and not just the name prefix** (2026-08-28).
 *
 * Two tests below reproduce R111 by rewriting `nameArabic` to «حساب محذوف» —
 * which is the point of de-identification, and which also erases the only
 * handle the teardown had on those rows. `startsWith(TAG)` then matched
 * nothing, and each full sweep left two users behind; the all-table snapshot
 * guard caught it as `user 25 → 27`.
 *
 * A tag in a mutable column is a handle the test under test is allowed to
 * destroy. The id is not, so the teardown takes the union of both (P1.2).
 */
const createdUserIds: string[] = [];

async function makeUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

function bearer(
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
): string {
  return issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

let superAdmin: string;
let scopedAdmin: string;
let teacherToken: string;
let branchA: string;
let branchB: string;
let levelId: string;
let soloLevelId: string;

async function clear(): Promise<void> {
  const groups = await prisma.administrativeGroup.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const branches = await prisma.branch.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  // TD-8 keeps `AuditLog.actor` and `Trash.deletedBy` RESTRICT on purpose:
  // deleting a user must never quietly erase the record of what they did. Every
  // write here is audited, so the fixture clears its OWN trail — scoped to these
  // ids, never a blanket truncate.
  const targetIds = [...groups.map((g) => g.id), ...branches.map((b) => b.id)];
  if (targetIds.length > 0) {
    await prisma.trash.deleteMany({ where: { targetId: { in: targetIds } } });
    await prisma.auditLog.deleteMany({
      where: { targetId: { in: targetIds } },
    });
  }
  await prisma.enrollment.deleteMany({
    where: { administrativeGroupId: { in: groups.map((g) => g.id) } },
  });
  await prisma.administrativeGroup.deleteMany({
    where: { id: { in: groups.map((g) => g.id) } },
  });
  // RESTRICT against both Level and Branch (TD-5), so groups go first.
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({
    where: { id: { in: branches.map((b) => b.id) } },
  });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  // The prefix AND the recorded ids — a de-identified account answers to
  // neither its old name nor the TAG.
  const userIds = [...new Set([...users.map((u) => u.id), ...createdUserIds])];
  if (userIds.length > 0) {
    await prisma.notification.deleteMany({
      where: {
        OR: [{ userId: { in: userIds } }, { subjectUserId: { in: userIds } }],
      },
    });
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: userIds } },
    });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

beforeAll(async () => {
  // Fail loudly rather than skipping (§19.2): a silently skipped wiring test is
  // indistinguishable from a passing one. Health is served at the ORIGIN root
  // (TD-14), not under /api/v1.
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        "docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api",
    );
  }

  await clear();

  // Branches are created through Prisma rather than the branch API on purpose:
  // `createBranch` runs the TD-4.6d backfill, which would give every grouples
  // Level in the database a المجموعة 1 at this branch — real behaviour, but it
  // would make this fixture's group counts depend on the rest of the database.
  const a = await prisma.branch.create({
    data: {
      name: `${TAG} فرع أ`,
      operationalStartDate: new Date("2026-01-01"),
    },
  });
  const b = await prisma.branch.create({
    data: {
      name: `${TAG} فرع ب`,
      operationalStartDate: new Date("2026-01-01"),
    },
  });
  branchA = a.id;
  branchB = b.id;

  const category = await prisma.category.create({
    data: { name: `${TAG} فئة` },
  });
  const level = await prisma.level.create({
    data: {
      name: `${TAG} مستوى`,
      categoryId: category.id,
      genderRestriction: "any",
    },
  });
  levelId = level.id;

  const solo = await prisma.level.create({
    data: {
      name: `${TAG} مستوى وحيد`,
      categoryId: category.id,
      genderRestriction: "any",
    },
  });
  soloLevelId = solo.id;
  // R66 — `soloLevelId` deliberately keeps NO group of its own: the tests that
  // need one create it, and the ones about deleting a last group need the Level
  // to be able to end up with none.

  superAdmin = bearer(await makeUser("مدير عام"), [
    { role: "super_admin", branches: null },
  ]);
  // Scoped to branch A ONLY — the half of TD-2 a null scope cannot exercise.
  scopedAdmin = bearer(await makeUser("مدير فرع"), [
    { role: "admin", branches: [branchA] },
  ]);
  teacherToken = bearer(await makeUser("أستاذة"), [
    { role: "teacher", branches: null },
  ]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("the response is an explicit contract DTO (§16.2)", () => {
  it("POST, GET and PATCH all return exactly the documented keys", async () => {
    const created = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} المجموعة أ`,
        level_id: levelId,
        branch_id: branchA,
        display_order: 1,
      },
    );
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(GROUP_KEYS);
    expect(created.body.level_id).toBe(levelId);
    expect(created.body.branch_id).toBe(branchA);

    const list = await call(
      "GET",
      `/admin/administrative-groups?level_id=${levelId}`,
      superAdmin,
    );
    expect(list.status).toBe(200);
    const row = list.body.data!.find((g) => g.id === created.body.id)!;
    expect(Object.keys(row).sort()).toEqual(GROUP_KEYS);

    const patched = await call(
      "PATCH",
      `/admin/administrative-groups/${created.body.id}`,
      superAdmin,
      { name: `${TAG} المجموعة أ معدّلة`, version: created.body.version },
    );
    expect(patched.status).toBe(200);
    expect(Object.keys(patched.body).sort()).toEqual(GROUP_KEYS);
    expect(patched.body.version).toBe((created.body.version as number) + 1);
  });

  it("exposes no internal column and no camelCase original", async () => {
    const list = await call(
      "GET",
      `/admin/administrative-groups?level_id=${levelId}`,
      superAdmin,
    );
    for (const row of list.body.data!) {
      // Named individually so the failure message says WHICH column leaked.
      for (const internal of [
        "created_at",
        "updated_at",
        "deleted_at",
        "deleted_by",
      ]) {
        expect(row).not.toHaveProperty(internal);
      }
      for (const camel of [
        "levelId",
        "branchId",
        "displayOrder",
        "deletedAt",
      ]) {
        expect(row).not.toHaveProperty(camel);
      }
    }
  });

  it("never carries a delivery field — §20 rule 22, and no capacity at all (BR-23)", async () => {
    const list = await call(
      "GET",
      `/admin/administrative-groups?level_id=${levelId}`,
      superAdmin,
    );
    for (const row of list.body.data!) {
      for (const retired of [
        "max_students",
        "capacity",
        "room_id",
        "teacher_id",
        "assistant_id",
        "day_of_week",
        "start_time",
        "end_time",
      ]) {
        expect(row).not.toHaveProperty(retired);
      }
    }
  });

  it("paginates per TD-10, reporting the unpaginated total", async () => {
    const res = await call(
      "GET",
      `/admin/administrative-groups?level_id=${levelId}&page=1&page_size=1`,
      superAdmin,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, page_size: 1 });
    expect((res.body.meta as { total: number }).total).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe("the write boundary REFUSES what Revision 43 removed", () => {
  it("rejects max_students rather than silently dropping it", async () => {
    // The important half: a 201 here would tell a client a capacity had been
    // recorded. BR-23 says there is none to record, so the honest answer is a
    // refusal — the field does not exist, rather than being ignored.
    const res = await call("POST", "/admin/administrative-groups", superAdmin, {
      name: `${TAG} بسعة`,
      level_id: levelId,
      branch_id: branchA,
      max_students: 30,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    expect(
      await prisma.administrativeGroup.count({
        where: { name: `${TAG} بسعة` },
      }),
    ).toBe(0);
  });

  it("rejects a room, a teacher and a weekly schedule the same way", async () => {
    for (const extra of [
      { room_id: branchA },
      { teacher_id: branchA },
      { day_of_week: "monday" },
      { start_time: "09:00" },
    ]) {
      const res = await call(
        "POST",
        "/admin/administrative-groups",
        superAdmin,
        {
          name: `${TAG} مرفوضة`,
          level_id: levelId,
          branch_id: branchA,
          ...extra,
        },
      );
      expect(res.status).toBe(400);
    }
  });

  it("refuses to move a group between Levels or Branches on PATCH", async () => {
    // Both are re-creations, not edits: a new Level would invalidate every
    // Enrollment.level_id pointing here, and a new Branch would change where
    // these students are recorded as attending without a per-student decision.
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} للنقل`,
        level_id: levelId,
        branch_id: branchA,
      },
    );

    for (const move of [{ level_id: soloLevelId }, { branch_id: branchB }]) {
      const res = await call(
        "PATCH",
        `/admin/administrative-groups/${group.body.id}`,
        superAdmin,
        { version: group.body.version, ...move },
      );
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    }

    const after = await prisma.administrativeGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { levelId: true, branchId: true },
    });
    expect(after).toEqual({ levelId, branchId: branchA });
  });

  it("TD-15: a stale version is a 409, not a silent overwrite", async () => {
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} للتعارض`,
        level_id: levelId,
        branch_id: branchA,
      },
    );

    // A real prior edit is what makes the stale version stale. Sending
    // `created.version - 1` instead would be **-1** on a fresh row, which the
    // validator refuses as malformed (`400`) before optimistic locking is ever
    // consulted — a test that would pass on a build with no locking at all.
    const first = await call(
      "PATCH",
      `/admin/administrative-groups/${group.body.id}`,
      superAdmin,
      { name: `${TAG} تحرير أول`, version: group.body.version },
    );
    expect(first.status).toBe(200);

    const stale = await call(
      "PATCH",
      `/admin/administrative-groups/${group.body.id}`,
      superAdmin,
      { name: `${TAG} تعارض`, version: group.body.version },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("VERSION_CONFLICT");

    // The colleague's edit survived — the point of the refusal.
    const row = await prisma.administrativeGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { name: true },
    });
    expect(row.name).toBe(`${TAG} تحرير أول`);
  });

  it("a malformed filter is a 400, not an empty list", async () => {
    // "That is not an id" and "this Level has no groups" are different answers,
    // and the second one misleads a screen into reporting an empty Level.
    const res = await call(
      "GET",
      "/admin/administrative-groups?level_id=not-a-uuid",
      superAdmin,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("the routes are mounted and guarded (TD-2)", () => {
  it("refuses an anonymous caller with the TD-3.8 envelope", async () => {
    const res = await call("GET", "/admin/administrative-groups");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("refuses a teacher — organisation is not a teaching concern", async () => {
    const res = await call("GET", "/admin/administrative-groups", teacherToken);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
  });

  it("a branch-scoped Admin reads their own branch and not another", async () => {
    await call("POST", "/admin/administrative-groups", superAdmin, {
      name: `${TAG} في ب`,
      level_id: levelId,
      branch_id: branchB,
    });

    const res = await call(
      "GET",
      `/admin/administrative-groups?level_id=${levelId}`,
      scopedAdmin,
    );
    expect(res.status).toBe(200);
    const branchIds = new Set(res.body.data!.map((g) => g.branch_id));
    expect(branchIds.has(branchA)).toBe(true);
    expect(branchIds.has(branchB)).toBe(false);
  });

  it("creating in a branch outside scope is 404, never 403 (§20 rule 17)", async () => {
    // A 403 would confirm that branch B exists, which is the leak the rule
    // exists to prevent.
    const res = await call(
      "POST",
      "/admin/administrative-groups",
      scopedAdmin,
      {
        name: `${TAG} تسلل`,
        level_id: levelId,
        branch_id: branchB,
      },
    );
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("NOT_FOUND");
  });

  it("a scoped Admin may create within their own branch", async () => {
    const res = await call(
      "POST",
      "/admin/administrative-groups",
      scopedAdmin,
      {
        name: `${TAG} مسموحة`,
        level_id: levelId,
        branch_id: branchA,
      },
    );
    expect(res.status).toBe(201);
  });

  it("an unknown Level is 404", async () => {
    const res = await call("POST", "/admin/administrative-groups", superAdmin, {
      name: `${TAG} بلا مستوى`,
      level_id: "00000000-0000-4000-8000-000000000000",
      branch_id: branchA,
    });
    expect(res.status).toBe(404);
  });
});

describe("deletion is guarded (TD-5, §4.4b)", () => {
  it("R66: an EMPTY last group may be removed — the Level stays directly enrollable", async () => {
    // `LAST_GROUP_IN_LEVEL` retired with Revision 66. It existed only to keep a
    // Level from reaching the group-less state TD-4.6b prevented at creation,
    // and that state is now ordinary: a Level nobody has subdivided needs no
    // group, and students are enrolled in it directly.
    //
    // The rule that actually protects people is unchanged and tested below:
    // a group holding students is still refused, now through the platform's
    // shared `blocked_by` shape rather than a vocabulary of its own.
    const solo = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} وحيدة`,
        level_id: soloLevelId,
        branch_id: branchA,
      },
    );
    expect(solo.status).toBe(201);
    const res = await call(
      "DELETE",
      `/admin/administrative-groups/${solo.body.id as string}`,
      superAdmin,
    );
    expect(res.status).toBe(204);
  });

  it("removes a group that is neither last nor referenced", async () => {
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} للحذف`,
        level_id: soloLevelId,
        branch_id: branchA,
      },
    );
    const res = await call(
      "DELETE",
      `/admin/administrative-groups/${group.body.id}`,
      superAdmin,
    );
    expect(res.status).toBe(204);

    // TD-5 soft delete: the row survives, carrying its tombstone.
    const row = await prisma.administrativeGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  it("refuses while students are still enrolled", async () => {
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} بطلبة`,
        level_id: soloLevelId,
        branch_id: branchA,
      },
    );
    const student = await prisma.user.create({
      data: {
        nameArabic: `${TAG} طالبة`,
        accountStatus: "active",
        sex: "female",
      },
    });
    createdUserIds.push(student.id);
    await prisma.enrollment.create({
      data: {
        studentId: student.id,
        administrativeGroupId: group.body.id as string,
        branchId: await branchOf(group.body.id as string),
        levelId: soloLevelId,
      },
    });

    const res = await call(
      "DELETE",
      `/admin/administrative-groups/${group.body.id}`,
      superAdmin,
    );
    expect(res.status).toBe(409);
    /**
     * **RESTATED 2026-08-27 — the rule is unchanged, the SHAPE is.**
     *
     * This pinned `details.reason === 'ENROLMENTS_EXIST'`, a refusal vocabulary
     * only this service used. The client classifies a blocked deletion on
     * `details.blocked_by`, so that bespoke shape meant the groups screen fell
     * through to the generic sentence — *«يرجى تحديث الصفحة»* — and refreshing
     * can never resolve an enrolled student. One mechanism now, so the named
     * dependency actually reaches the reader.
     *
     * A group holding students is still refused, which is what the guard is for.
     */
    expect(res.body.error?.details?.["blocked_by"]).toMatchObject({ enrollments: 1 });

    await prisma.enrollment.deleteMany({ where: { studentId: student.id } });
  });
});

/* ── Roster (TD-3.12, §5.6) ──────────────────────────────────────────────── */

const ROSTER_KEYS = ["enrolled_at", "id", "name", "student_id"];
/**
 * §16.2's exact key set for an enrolment.
 *
 * **`branch_id` joined it with Revision 66**, and the argument is written into
 * the pin rather than left in a commit message: a student's branch used to be
 * reachable only by following `administrative_group_id`, which is exactly why
 * that column could not be nullable. The enrolment now carries it, so a client
 * can ask *where is this student* of someone in a Level nobody has subdivided.
 */
const ENROLMENT_KEYS = [
  "administrative_group_id",
  "branch_id",
  "enrolled_at",
  "id",
  "level_id",
  "student_id",
];

async function makeStudent(label: string): Promise<string> {
  const s = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
      sex: "female",
    },
  });
  // Recorded for the same reason `makeUser` records: the teardown must not
  // depend on a column the tests are free to rewrite.
  createdUserIds.push(s.id);
  return s.id;
}

describe("the roster is a contract DTO too", () => {
  it("POST returns the enrolment, echoing the Level it resolved to", async () => {
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} روستر`,
        level_id: levelId,
        branch_id: branchA,
      },
    );
    const student = await makeStudent("طالبة أ");

    const res = await call(
      "POST",
      `/admin/administrative-groups/${group.body.id}/roster`,
      superAdmin,
      { student_id: student },
    );
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(ENROLMENT_KEYS);
    // The caller never sent it — the service read it from the group, and this is
    // how the client learns which Level the student is now in.
    expect(res.body.level_id).toBe(levelId);
    expect(res.body.administrative_group_id).toBe(group.body.id);
    // R66 — read from the group, which the composite FK then proves.
    expect(res.body.branch_id).toBe(branchA);
  });

  it("GET returns the roster in the TD-10 envelope with exactly the documented keys", async () => {
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} روستر قراءة`,
        level_id: soloLevelId,
        branch_id: branchA,
      },
    );
    const student = await makeStudent("طالبة ب");
    await call(
      "POST",
      `/admin/administrative-groups/${group.body.id}/roster`,
      superAdmin,
      {
        student_id: student,
      },
    );

    const res = await call(
      "GET",
      `/admin/administrative-groups/${group.body.id}/roster`,
      superAdmin,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data![0]!).sort()).toEqual(ROSTER_KEYS);
    // `id` is the ENROLMENT id, not the student's — they must not be confused,
    // since one is what DELETE addresses and the other is what it removes.
    expect(res.body.data![0]!.id).not.toBe(student);
    expect(res.body.data![0]!.student_id).toBe(student);
  });

  it("rejects level_id on enrolment rather than trusting the caller", async () => {
    // Accepting it would leave the composite FK as the only thing between a typo
    // and a mis-filed student — an opaque constraint error, not a decision.
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} روستر صارم`,
        level_id: levelId,
        branch_id: branchA,
      },
    );
    const res = await call(
      "POST",
      `/admin/administrative-groups/${group.body.id}/roster`,
      superAdmin,
      { student_id: await makeStudent("طالبة ج"), level_id: soloLevelId },
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("BR-21: a second group in the SAME Level is refused, and says which group holds them", async () => {
    const first = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} أولى`,
        level_id: soloLevelId,
        branch_id: branchA,
      },
    );
    const second = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} ثانية`,
        level_id: soloLevelId,
        branch_id: branchA,
      },
    );
    const student = await makeStudent("طالبة د");

    expect(
      (
        await call(
          "POST",
          `/admin/administrative-groups/${first.body.id}/roster`,
          superAdmin,
          {
            student_id: student,
          },
        )
      ).status,
    ).toBe(201);

    const same = await call(
      "POST",
      `/admin/administrative-groups/${first.body.id}/roster`,
      superAdmin,
      { student_id: student },
    );
    expect(same.status).toBe(409);
    expect(same.body.error?.code).toBe("DUPLICATE");

    const other = await call(
      "POST",
      `/admin/administrative-groups/${second.body.id}/roster`,
      superAdmin,
      { student_id: student },
    );
    expect(other.status).toBe(409);
    expect(other.body.error?.code).toBe("STATE_CONFLICT");
    expect(other.body.error?.details?.["reason"]).toBe(
      "ALREADY_ENROLLED_IN_LEVEL",
    );
    // The point of the explained refusal: this is what an administrator needs in
    // order to decide whether to MOVE the student instead.
    expect(other.body.error?.details?.["current_administrative_group_id"]).toBe(
      first.body.id,
    );
  });

  it("DELETE un-enrols and the student leaves the roster", async () => {
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} للإخراج`,
        level_id: levelId,
        branch_id: branchA,
      },
    );
    const student = await makeStudent("طالبة هـ");
    await call(
      "POST",
      `/admin/administrative-groups/${group.body.id}/roster`,
      superAdmin,
      {
        student_id: student,
      },
    );

    const res = await call(
      "DELETE",
      `/admin/administrative-groups/${group.body.id}/roster/${student}`,
      superAdmin,
    );
    expect(res.status).toBe(204);

    const after = await call(
      "GET",
      `/admin/administrative-groups/${group.body.id}/roster`,
      superAdmin,
    );
    expect(after.body.data).toHaveLength(0);

    // TD-5: the enrolment row survives with its tombstone — the academic record
    // is never rewritten by a person leaving.
    const row = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: student },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  it("is guarded exactly like the group it belongs to", async () => {
    const inB = await call("POST", "/admin/administrative-groups", superAdmin, {
      name: `${TAG} روستر ب`,
      level_id: levelId,
      branch_id: branchB,
    });

    // Out of scope answers 404, never 403 — a 403 confirms the group exists.
    const scoped = await call(
      "GET",
      `/admin/administrative-groups/${inB.body.id}/roster`,
      scopedAdmin,
    );
    expect(scoped.status).toBe(404);

    const asTeacher = await call(
      "GET",
      `/admin/administrative-groups/${inB.body.id}/roster`,
      teacherToken,
    );
    expect(asTeacher.status).toBe(403);
  });
});

/* ── The membership contradiction (2026-08-28) ───────────────────────────── */

/**
 * **One question, one predicate.**
 *
 * Deleting a group answered *«لا يمكن حذف هذه المجموعة … تسجيلات مستفيدات (2)»*
 * while the group's own roster read *«لا توجد مستفيدات في هذه المجموعة»*. Both
 * counted `Enrollment` rows and disagreed, because the roster required a **live
 * student** and the deletion refusal — and the `member_count` column beside it —
 * required only a live enrolment.
 *
 * The rows between them are **R111's, and are correct**: account deletion
 * preserves the enrolment because the educational record outlives the account.
 * So a group whose members had all deleted their accounts held live enrolment
 * rows and no beneficiaries, and the platform asserted both.
 *
 * These three assertions are one scenario deliberately: the contradiction was
 * never visible from a single view, and a test that read only one of them would
 * pass against the defect.
 */
describe("a group's membership means the same thing everywhere", () => {
  it("counts, lists and refuses on the SAME rows when a member's account is deleted", async () => {
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة التناقض`, levelId, branchId: branchA },
    });
    const live = await makeUser("مستفيدة حيّة");
    const departed = await makeUser("مستفيدة غادرت");
    for (const studentId of [live, departed]) {
      await prisma.enrollment.create({
        data: { studentId, levelId, branchId: branchA, administrativeGroupId: group.id },
      });
    }

    // R111's shape exactly: the ACCOUNT is soft-deleted and the enrolment is
    // deliberately left live, because the educational record outlives it.
    await prisma.user.update({
      where: { id: departed },
      data: { deletedAt: new Date(), nameArabic: "حساب محذوف" },
    });

    const roster = await call(
      "GET",
      `/admin/administrative-groups/${group.id}/roster`,
      superAdmin,
    );
    expect(roster.status).toBe(200);
    const rosterIds = (roster.body.data as unknown as Record<string, unknown>[]).map((r) =>
      String(r["student_id"]),
    );
    expect(rosterIds).toEqual([live]);

    const listed = await call(
      "GET",
      `/admin/administrative-groups?level_id=${levelId}&page_size=100`,
      superAdmin,
    );
    const row = (listed.body.data as unknown as Record<string, unknown>[]).find(
      (g) => g["id"] === group.id,
    );
    // The column beside the row must agree with the row's own roster.
    expect(row?.["member_count"]).toBe(1);

    // And the refusal must name that same one — not two.
    const refused = await call("DELETE", `/admin/administrative-groups/${group.id}`, superAdmin);
    expect(refused.status).toBe(409);
    expect(refused.body.error?.details?.["blocked_by"]).toMatchObject({ enrollments: 1 });
  });

  it("lets the group close once every member has gone, rather than blocking forever", async () => {
    /**
     * The other half, and the reason suppressing the blocker would have been the
     * wrong fix: a group whose members have all left **is** empty, and refusing
     * it forever on rows nobody can see is the defect, not the protection.
     */
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة انتهت`, levelId, branchId: branchA },
    });
    const departed = await makeUser("مستفيدة أخرى غادرت");
    await prisma.enrollment.create({
      data: { studentId: departed, levelId, branchId: branchA, administrativeGroupId: group.id },
    });
    await prisma.user.update({
      where: { id: departed },
      data: { deletedAt: new Date(), nameArabic: "حساب محذوف" },
    });

    const res = await call("DELETE", `/admin/administrative-groups/${group.id}`, superAdmin);
    expect(res.status).toBe(204);

    // TD-5, and R111's rule: the group is soft-deleted and the preserved
    // enrolment row is still there — closing a group erases no history.
    const after = await prisma.administrativeGroup.findUnique({ where: { id: group.id } });
    expect(after?.deletedAt).not.toBeNull();
    expect(
      await prisma.enrollment.count({ where: { administrativeGroupId: group.id } }),
    ).toBe(1);
  });
});
