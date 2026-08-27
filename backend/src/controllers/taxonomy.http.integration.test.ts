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
 * Curriculum taxonomy CRUD over HTTP — Categories, Subjects and Levels
 * (§5.6, §14.1, TD-2 R26, TD-4.6b, TD-5, TD-15).
 *
 * The properties worth pinning are the ones that make the back office *safe*
 * rather than merely present: who may write, what a delete refuses, and the one
 * asymmetry TD-4.6b creates — a Level always owns at least one Administrative
 * Group, so a guard that counted groups would make deletion unreachable.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-taxonomy-test]";

interface Res {
  status: number;
  body: {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown> & Record<string, unknown>[];
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

let superAdmin: string;
let admin: string;
let teacher: string;
let branchId: string;
let categoryId: string;

async function makeUser(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  return u.id;
}

async function clear(): Promise<void> {
  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.teachingGroup.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  await prisma.levelSubject.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.administrativeGroup.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({
    where: { branch: { name: { startsWith: TAG } } },
  });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  superAdmin = bearer(await makeUser("مدير عام"), [
    { role: "super_admin", branches: null },
  ]);
  admin = bearer(await makeUser("مسؤولة"), [{ role: "admin", branches: null }]);
  teacher = bearer(await makeUser("أستاذة"), [
    { role: "teacher", branches: null },
  ]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("Categories (§5.6 الفئات والمواد)", () => {
  it("creates one, and reports that it holds no Levels yet", async () => {
    const res = await call("POST", "/admin/categories", superAdmin, {
      name: `${TAG} فئة`,
      display_order: 1,
    });
    expect(res.status).toBe(201);
    categoryId = String(
      (res.body.data as unknown as Record<string, unknown>)["id"],
    );
    // `level_count` is what tells the screen whether deleting is possible at
    // all, without a request per row.
    expect(
      (res.body.data as unknown as Record<string, unknown>)["level_count"],
    ).toBe(0);
  });

  it("lists with the version an editor must send back (TD-15)", async () => {
    const res = await call("GET", "/admin/categories", superAdmin);
    expect(res.status).toBe(200);
    const row = (res.body.data as unknown as Record<string, unknown>[]).find(
      (r) => r["id"] === categoryId,
    )!;
    expect(Object.keys(row).sort()).toEqual([
      "display_order",
      "id",
      "level_count",
      "name",
      "version",
    ]);
  });

  it("refuses a stale version with 409 VERSION_CONFLICT rather than overwriting", async () => {
    const res = await call(
      "PATCH",
      `/admin/categories/${categoryId}`,
      superAdmin,
      {
        version: 99,
        name: `${TAG} فئة معدلة`,
      },
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("VERSION_CONFLICT");
  });

  it("is Super Admin to write and Admin to read (TD-2 R26)", async () => {
    expect((await call("GET", "/admin/categories", admin)).status).toBe(200);
    const res = await call("POST", "/admin/categories", admin, {
      name: `${TAG} مرفوضة`,
    });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a Teacher entirely (Revision 30)", async () => {
    expect((await call("GET", "/admin/categories", teacher)).status).toBe(403);
  });
});

describe("Subjects (§5.6 الفئات والمواد)", () => {
  let subjectId = "";

  it("creates, renames and lists through the ONE subject endpoint", async () => {
    const created = await call("POST", "/admin/subjects", superAdmin, {
      name: `${TAG} مادة`,
    });
    expect(created.status).toBe(201);
    const row = created.body.data as unknown as Record<string, unknown>;
    subjectId = String(row["id"]);

    // The selector and the editor read the same list — that is why `version`
    // is published on it.
    const renamed = await call(
      "PATCH",
      `/admin/subjects/${subjectId}`,
      superAdmin,
      {
        version: row["version"],
        name: `${TAG} مادة معدلة`,
      },
    );
    expect(renamed.status).toBe(200);

    const list = await call("GET", "/admin/subjects", superAdmin);
    const listed = (
      list.body.data as unknown as Record<string, unknown>[]
    ).find((r) => r["id"] === subjectId)!;
    expect(listed["name"]).toBe(`${TAG} مادة معدلة`);
  });

  it("RESTATED: a Level pairing is an OWNED LINK — it follows, it does not block", async () => {
    const level = await prisma.level.create({
      data: {
        name: `${TAG} مستوى للمادة`,
        categoryId,
        genderRestriction: "any",
      },
    });
    await prisma.levelSubject.create({
      data: { levelId: level.id, subjectId },
    });

    /**
     * **RESTATED 2026-08-27.** This asserted a `409` naming `levels`, and the
     * rule it pinned made deletion impossible for every Subject anybody had
     * actually assigned — which is what the Owner reported.
     *
     * `LevelSubject` says *«this Level teaches this Subject»*. It records
     * nothing that happened, so it is an **owned link**: it follows the Subject
     * rather than refusing it. The need the old rule served — telling her which
     * Levels were affected — is answered by the refusal dialog naming
     * dependencies, not by refusing a deletion she is entitled to make.
     *
     * What must NOT happen is the Level being harmed, so that is asserted.
     */
    const res = await call(
      "DELETE",
      `/admin/subjects/${subjectId}`,
      superAdmin,
    );
    expect(res.status).toBe(204);

    const pairing = await prisma.levelSubject.findFirst({
      where: { levelId: level.id, subjectId },
    });
    // The link is detached, not destroyed — TD-5 soft delete, so the record of
    // what was taught stays readable.
    expect(pairing?.deletedAt).not.toBeNull();

    // **The Level itself is untouched.** A reference deletion must never take
    // an educational entity with it.
    const survivor = await prisma.level.findUnique({ where: { id: level.id } });
    expect(survivor?.deletedAt ?? null).toBeNull();

    await prisma.levelSubject.deleteMany({ where: { levelId: level.id } });
    await prisma.level.delete({ where: { id: level.id } });
    // This test now consumes the Subject, so the one below makes its own.
    await prisma.subject.update({
      where: { id: subjectId },
      data: { deletedAt: null, deletedById: null },
    });
    await prisma.trash.deleteMany({ where: { targetId: subjectId } });
  });

  it("deletes once nothing teaches it, and leaves a Trash snapshot (TD-5)", async () => {
    const res = await call(
      "DELETE",
      `/admin/subjects/${subjectId}`,
      superAdmin,
    );
    expect(res.status).toBe(204);
    const row = await prisma.subject.findUnique({ where: { id: subjectId } });
    expect(row?.deletedAt).not.toBeNull();
    expect(
      await prisma.trash.count({
        where: { targetEntity: "Subject", targetId: subjectId },
      }),
    ).toBe(1);
  });

  it("drops out of the selector once deleted", async () => {
    const list = await call("GET", "/admin/subjects", superAdmin);
    expect(
      (list.body.data as unknown as Record<string, unknown>[]).map(
        (r) => r["id"],
      ),
    ).not.toContain(subjectId);
  });
});

describe("Levels (§5.6 مستويات, TD-4.6b)", () => {
  let levelId = "";

  /**
   * §14.1 requires the upload screen to *honour* the Category default, and a
   * screen cannot honour a value it has no way to read. The default therefore
   * rides the Level — the list every scoping screen already loads — rather
   * than the Category, which is Admin-only (TD-2 R26, R30) and which the
   * content page never requests.
   *
   * **The defect this guards:** the selector was missing entirely, so the
   * default silently always won and nobody could publish privately. A field
   * that reported the wrong default would reproduce it in a subtler form —
   * the screen would show one tier and the server would store another.
   */
  it("carries its Category's §15.1 default visibility, read rather than assumed", async () => {
    const created = await call("POST", "/admin/categories", superAdmin, {
      name: `${TAG} فئة الظهور`,
    });
    const category = String((created.body.data as unknown as Record<string, unknown>)["id"]);
    const level = await call("POST", "/admin/levels", superAdmin, {
      name: `${TAG} مستوى الظهور`,
      category_id: category,
      gender_restriction: "any",
    });
    expect(level.status).toBe(201);
    const levelRowId = String((level.body.data as unknown as Record<string, unknown>)["id"]);

    const withoutSetting = (await call("GET", "/admin/levels", superAdmin)).body
      .data as unknown as { id: string; default_visibility: string }[];
    // No settings row yet. `private` is the safe tier and the one the server's
    // own `categoryDefaultVisibility` falls back to — never `public`.
    expect(withoutSetting.find((row) => row.id === levelRowId)?.default_visibility).toBe(
      "private",
    );

    await prisma.systemSetting.create({
      data: { key: `content.default_visibility.category.${category}`, value: "public" },
    });
    const withSetting = (await call("GET", "/admin/levels", superAdmin)).body
      .data as unknown as { id: string; default_visibility: string }[];
    expect(withSetting.find((row) => row.id === levelRowId)?.default_visibility).toBe(
      "public",
    );

    await prisma.systemSetting.updateMany({
      where: { key: `content.default_visibility.category.${category}` },
      data: { value: "nonsense" },
    });
    const withGarbage = (await call("GET", "/admin/levels", superAdmin)).body
      .data as unknown as { id: string; default_visibility: string }[];
    // Never widen on a surprise: a malformed settings row must not propose the
    // open tier.
    expect(withGarbage.find((row) => row.id === levelRowId)?.default_visibility).toBe(
      "private",
    );

    await prisma.systemSetting.deleteMany({
      where: { key: `content.default_visibility.category.${category}` },
    });
  });

  it("R66: creates ONLY the Level — no group, and no branch to ask for", async () => {
    // TD-4.6b created a first group in the same transaction, which is why this
    // endpoint used to demand a branch. R66 retires it: a Level belongs to a
    // Category and to no Branch, and a Level nobody has subdivided needs no
    // group — students are enrolled in it directly.
    const res = await call("POST", "/admin/levels", superAdmin, {
      name: `${TAG} مستوى`,
      category_id: categoryId,
      gender_restriction: "girls_only",
    });
    expect(res.status).toBe(201);
    const row = res.body.data as unknown as Record<string, unknown>;
    levelId = String(row["id"]);

    // No group, and none reported: creating a Level creates a Level.
    expect(row).not.toHaveProperty("first_group");
    expect(
      await prisma.administrativeGroup.count({
        where: { levelId, deletedAt: null },
      }),
    ).toBe(0);
  });

  it("R66: REFUSES a branch on level creation rather than ignoring it", async () => {
    // Refused, not stripped: a client that still sends one would otherwise get
    // `201` and believe a group had been created somewhere.
    const res = await call("POST", "/admin/levels", superAdmin, {
      name: `${TAG} مستوى بفرع`,
      category_id: categoryId,
      branch_id: branchId,
    });
    expect(res.status).toBe(400);
  });

  it("R66: still stores no branch on the Level — and no longer takes one", async () => {
    // A Level is Category-scoped and branch-independent. It never had a branch
    // column; R66 removes the last reason it was ever ASKED for one.
    const res = await call("GET", "/admin/levels", superAdmin);
    const row = (res.body.data as unknown as Record<string, unknown>[]).find(
      (r) => r["id"] === levelId,
    )!;
    expect(row).not.toHaveProperty("branch_id");
    expect(row["category_name"]).toBe(`${TAG} فئة`);
    // Zero, and that is a legitimate Level — not a broken one.
    expect(row["group_count"]).toBe(0);
    expect(row["gender_restriction"]).toBe("girls_only");
  });

  it("filters by category, and rejects a malformed filter rather than ignoring it", async () => {
    const ok = await call(
      "GET",
      `/admin/levels?category_id=${categoryId}`,
      superAdmin,
    );
    expect(ok.status).toBe(200);
    expect(
      (ok.body.data as unknown as Record<string, unknown>[]).length,
    ).toBeGreaterThan(0);

    // Silently returning every Level for a bad filter would answer a question
    // nobody asked.
    const bad = await call(
      "GET",
      "/admin/levels?category_id=not-a-uuid",
      superAdmin,
    );
    expect(bad.status).toBe(400);
  });

  it("will not move a Level between Categories", async () => {
    // Absent from the schema on purpose: a move would re-file every enrolled
    // student into a different educational stage, and §2.2 scopes display_order
    // within the Category, so the ordering would stop meaning anything.
    const row = await prisma.level.findUniqueOrThrow({
      where: { id: levelId },
    });
    const other = await prisma.category.create({
      data: { name: `${TAG} فئة أخرى` },
    });
    const res = await call("PATCH", `/admin/levels/${levelId}`, superAdmin, {
      version: row.version,
      category_id: other.id,
    });
    // The unknown key is rejected outright rather than quietly dropped, so a
    // client believing it moved the Level finds out immediately.
    expect(res.status).toBe(400);
    expect(
      (await prisma.level.findUniqueOrThrow({ where: { id: levelId } }))
        .categoryId,
    ).toBe(categoryId);
  });

  it("refuses deletion while a student is enrolled", async () => {
    // R66 — the Level has no group unless this test makes one, and this test is
    // about the enrolment guard, so it makes one.
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId, displayOrder: 0 },
    });
    const student = await makeUser("طالبة");
    await prisma.enrollment.create({
      data: {
        studentId: student,
        administrativeGroupId: group.id,
        levelId,
        branchId: await branchOf(group.id),
      },
    });

    const res = await call("DELETE", `/admin/levels/${levelId}`, superAdmin);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("STATE_CONFLICT");
    expect(res.body.error?.details?.["blocked_by"]).toHaveProperty(
      "enrollments",
    );

    await prisma.enrollment.deleteMany({ where: { levelId } });
  });

  it("deletes an empty Level, cascading whatever groups it has", async () => {
    // A group count is NOT a blocker, and R66 does not change that: the guards
    // above have already established nothing is enrolled, and an empty
    // subdivision is not a reason to refuse deleting what it subdivides.
    const res = await call("DELETE", `/admin/levels/${levelId}`, superAdmin);
    expect(res.status).toBe(204);
    expect(
      await prisma.administrativeGroup.count({
        where: { levelId, deletedAt: null },
      }),
    ).toBe(0);

    const audited = await prisma.auditLog.findFirst({
      where: {
        targetEntity: "Level",
        targetId: levelId,
        actionType: "level.delete",
      },
    });
    // The groups disappeared as a CONSEQUENCE of this decision; TD-8's record
    // has to say which.
    expect(
      (audited?.detail as Record<string, unknown>)["cascaded_group_ids"],
    ).toHaveLength(1);
  });

  it("is Super Admin to write (TD-2 R26)", async () => {
    const res = await call("POST", "/admin/levels", admin, {
      name: `${TAG} مستوى مرفوض`,
      category_id: categoryId,
    });
    expect(res.status).toBe(403);
  });
});

describe("Category deletion (TD-5)", () => {
  it("refuses while Levels reference it, and never cascades a live curriculum", async () => {
    const level = await prisma.level.create({
      data: { name: `${TAG} مستوى حي`, categoryId, genderRestriction: "any" },
    });
    const res = await call(
      "DELETE",
      `/admin/categories/${categoryId}`,
      superAdmin,
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["blocked_by"]).toHaveProperty("levels");
    // A Level carries enrolments, groups and schedules — cascading here would
    // delete a live curriculum from a control that says "delete category".
    expect(
      (await prisma.level.findUniqueOrThrow({ where: { id: level.id } }))
        .deletedAt,
    ).toBeNull();
    await prisma.level.delete({ where: { id: level.id } });
  });

  it("deletes once empty", async () => {
    expect(
      (await call("DELETE", `/admin/categories/${categoryId}`, superAdmin))
        .status,
    ).toBe(204);
  });
});

/**
 * **`?eligible_for_student=` — WHERE may SHE be enrolled** (R27 + BR-21).
 *
 * ## The direction, and why it was reversed
 *
 * A first attempt narrowed the BENEFICIARY list by a chosen Level. It was wrong
 * in the domain rather than in the code: a woman already enrolled in one Level
 * is still a beneficiary, and making her disappear from the picker because she
 * is not in the Level currently selected answers a question nobody asked. The
 * form's question is *who am I enrolling*; everything else answers *where*.
 *
 * So the dependency runs **beneficiary → Levels**, and the two rules that narrow
 * are the server's own:
 *
 * * **R27** — a restriction she cannot satisfy removes that Level from the offer.
 *   A NULL `sex` cannot PROVE eligibility, so restricted Levels are withheld;
 *   the backend would refuse the placement anyway.
 * * **BR-21** — the one Level she already holds is excluded. Only that exact
 *   pair: every other Level stays available, because one beneficiary may hold
 *   many enrolments, one per Level.
 */
describe("GET /admin/levels?eligible_for_student= (R27 + BR-21)", () => {
  let girlsOnly: string;
  let boysOnly: string;
  let open: string;
  let girl: string;
  let boy: string;

  const person = async (
    label: string,
    sex: "female" | "male",
  ): Promise<string> => {
    const u = await prisma.user.create({
      data: {
        nameArabic: `${TAG} ${label}`,
        accountStatus: "active",
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        // This was written twice: a `"female"` literal the parameter had
        // superseded, left above it. TypeScript refuses the duplicate key.
        sex,
      },
    });
    return u.id;
  };

  const levelIds = async (query: string): Promise<string[]> => {
    const res = await call("GET", `/admin/levels?${query}`, superAdmin);
    expect(res.status).toBe(200);
    return (res.body.data as unknown as Record<string, unknown>[]).map((l) =>
      String(l["id"]),
    );
  };

  beforeAll(async () => {
    const make = async (name: string, restriction: string): Promise<string> =>
      (
        await prisma.level.create({
          data: {
            name: `${TAG} ${name}`,
            categoryId,
            genderRestriction: restriction as never,
          },
        })
      ).id;
    girlsOnly = await make("للفتيات", "girls_only");
    boysOnly = await make("للفتيان", "boys_only");
    open = await make("مفتوح", "any");
    girl = await person("فتاة", "female");
    boy = await person("فتى", "male");
  });

  it("offers a female beneficiary the girls-only and the open Levels", async () => {
    const offered = await levelIds(`eligible_for_student=${girl}`);
    expect(offered).toContain(girlsOnly);
    expect(offered).toContain(open);
    expect(offered).not.toContain(boysOnly);
  });

  it("offers a male beneficiary the boys-only and the open Levels", async () => {
    const offered = await levelIds(`eligible_for_student=${boy}`);
    expect(offered).toContain(boysOnly);
    expect(offered).toContain(open);
    expect(offered).not.toContain(girlsOnly);
  });

  it("has no unrecorded sex left to withhold Levels for (R80)", async () => {
    // Restated, not deleted: R80 made the third case impossible. The rule is
    // still asserted by the two tests above — a female is offered girls-only,
    // a male is not.
    const offered = await levelIds(`eligible_for_student=${girl}`);
    expect(offered).toContain(girlsOnly);
    expect(offered).not.toContain(boysOnly);
  });

  it("excludes ONLY the Level she already holds, never the others (BR-21)", async () => {
    await prisma.enrollment.create({
      data: { studentId: girl, levelId: open, branchId },
    });
    const offered = await levelIds(`eligible_for_student=${girl}`);
    expect(offered).not.toContain(open);
    // The whole point of the correction: enrolment in one Level must not remove
    // her from anything else she is eligible for.
    expect(offered).toContain(girlsOnly);
  });

  it("narrows nothing when the parameter is absent", async () => {
    const offered = await levelIds("");
    for (const id of [girlsOnly, boysOnly, open]) expect(offered).toContain(id);
  });

  it("narrows to nothing for an unknown beneficiary, never back to everything", async () => {
    expect(
      await levelIds(
        "eligible_for_student=00000000-0000-4000-8000-000000000000",
      ),
    ).toEqual([]);
  });

  it("refuses a malformed id rather than ignoring it", async () => {
    expect(
      (await call("GET", "/admin/levels?eligible_for_student=nope", superAdmin))
        .status,
    ).toBe(400);
  });

  it("composes with the Category filter rather than replacing it", async () => {
    const offered = await levelIds(
      `eligible_for_student=${boy}&category_id=${categoryId}`,
    );
    expect(offered).toContain(boysOnly);
    expect(offered).not.toContain(girlsOnly);
  });
});
