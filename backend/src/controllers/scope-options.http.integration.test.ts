import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **NEW D — `GET /me/scope-options`, and the reads it deliberately does not
 * widen.**
 *
 * A مؤطِّرة opening مكتبة المحتوى met three `403`s and a half-dead filter row:
 * `useScopeOptions` loaded its vocabulary from `/admin/levels`,
 * `/admin/subjects` and `/admin/academic-years`, and `assertCanReadReferenceData`
 * excludes teachers **by design** (R30). Only `/admin/branches` answered her,
 * because `branch.service` admits teachers for exactly this reason (R61.2).
 *
 * This suite proves the fix at the API boundary, which is the only place the
 * claim means anything: the narrow question is answered, **every admin read
 * still refuses her**, and — the part that matters most — **an option appearing
 * in her vocabulary reaches no content she may not read.**
 *
 * Owned rows only, one tag, cleaned by that tag (P1.2).
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[newd-scope-options]";

interface Body {
  error?: { code?: string };
  data?: Record<string, unknown> & {
    levels?: Record<string, unknown>[];
    subjects?: Record<string, unknown>[];
    academic_years?: Record<string, unknown>[];
    branches?: Record<string, unknown>[];
    categories?: Record<string, unknown>[];
  };
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, {
    ...(token ? { token } : {}),
    ...(body !== undefined ? { body } : {}),
  });

const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

const bearer = (
  userId: string,
  roleScopes: { role: string; branches: string[] | null }[],
): string =>
  issueAccessToken(
    { userId, roleScopes: roleScopes as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

async function person(label: string): Promise<string> {
  return (
    await prisma.user.create({
      data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
    })
  ).id;
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  ids["branchA"] = (
    await prisma.branch.create({
      data: { name: `${TAG} فرع أ`, operationalStartDate: new Date("2026-01-01") },
    })
  ).id;
  ids["branchB"] = (
    await prisma.branch.create({
      data: { name: `${TAG} فرع ب`, operationalStartDate: new Date("2026-01-01") },
    })
  ).id;
  ids["category"] = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
  ids["level"] = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: ids["category"]!, genderRestriction: "any" },
    })
  ).id;
  ids["taught"] = (await prisma.subject.create({ data: { name: `${TAG} مادة مقررة` } })).id;
  ids["untaught"] = (await prisma.subject.create({ data: { name: `${TAG} مادة غير مقررة` } })).id;
  await prisma.levelSubject.create({
    data: { levelId: ids["level"]!, subjectId: ids["taught"]! },
  });
  ids["year"] = (await prisma.academicYear.findFirstOrThrow({ select: { id: true } })).id;

  // A hidden item at this suite's own Level: §4.9 tier 3 admits staff, so it is
  // the row that shows an option is not a key — a Teacher may filter by this
  // Level and still meet the content rules, not bypass them.
  ids["hiddenContent"] = (
    await prisma.educationalContent.create({
      data: {
        title: `${TAG} محتوى مخفي`,
        subjectId: ids["taught"]!,
        levelId: ids["level"]!,
        academicYearId: ids["year"]!,
        visibility: "hidden",
        storageKey: `${TAG}/hidden.pdf`,
        storageBucket: "private",
        mimeType: "application/pdf",
        originalFilename: "hidden.pdf",
        sizeBytes: 512,
      },
    })
  ).id;

  ids["teacher"] = await person("مؤطرة");
  ids["admin"] = await person("إدارية");
  ids["student"] = await person("مستفيدة");
  tokens["teacher"] = bearer(ids["teacher"]!, [
    { role: "teacher", branches: [ids["branchA"]!] },
  ]);
  tokens["admin"] = bearer(ids["admin"]!, [{ role: "admin", branches: null }]);
  tokens["student"] = bearer(ids["student"]!, [{ role: "student", branches: null }]);
});

async function clear(): Promise<void> {
  const tagged = { startsWith: TAG };
  await prisma.educationalContent.deleteMany({ where: { title: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: { name: tagged } } });
  await prisma.subject.deleteMany({ where: { name: tagged } });
  await prisma.level.deleteMany({ where: { name: tagged } });
  await prisma.category.deleteMany({ where: { name: tagged } });
  const users = await prisma.user.findMany({
    where: { nameArabic: tagged },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: tagged } });
}

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/* ── The original failure, and its absence ──────────────────────────────── */

describe("NEW D — the reads that refused a مؤطِّرة still refuse her", () => {
  it.each([
    ["/admin/levels", "levels"],
    ["/admin/subjects", "subjects"],
    ["/admin/academic-years", "academic years"],
    [`/admin/levels/${"00000000-0000-4000-8000-000000000000"}/subjects`, "level subjects"],
  ])("%s stays 403 for a Teacher — the admin read is NOT widened", async (path) => {
    // This is the half that says the fix is R93.4's and not a permission grant.
    // If one of these ever answers 200, reference-data management has been
    // opened to teaching staff and R26/R30 have been silently reversed.
    const res = await call("GET", path, tokens["teacher"]);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
  });

  it("/admin/branches still answers her — it always did (R61.2)", async () => {
    expect((await call("GET", "/admin/branches", tokens["teacher"])).status).toBe(200);
  });
});

describe("NEW D — /me/scope-options answers the narrow question", () => {
  it("gives a مؤطِّرة the whole filter vocabulary she was missing", async () => {
    const res = await call("GET", "/me/scope-options", tokens["teacher"]);
    expect(res.status).toBe(200);
    const d = res.body.data!;
    // Each of the three that used to be a 403.
    expect((d.levels ?? []).some((l) => l["id"] === ids["level"])).toBe(true);
    expect((d.subjects ?? []).some((s) => s["id"] === ids["taught"])).toBe(true);
    expect((d.academic_years ?? []).length).toBeGreaterThan(0);
  });

  it("carries each Level's Subjects inline, so narrowing needs no second read", async () => {
    // The second read was `/admin/levels/{id}/subjects`, itself Admin-only —
    // a client that kept it would have traded three 403s for one.
    const res = await call("GET", "/me/scope-options", tokens["teacher"]);
    const level = (res.body.data!.levels ?? []).find((l) => l["id"] === ids["level"]);
    expect(level?.["subject_ids"]).toEqual([ids["taught"]]);
    expect(level?.["subject_ids"]).not.toContain(ids["untaught"]);
  });

  it("carries the Level's §15.1 default visibility, which the upload form preselects", async () => {
    const res = await call("GET", "/me/scope-options", tokens["teacher"]);
    const level = (res.body.data!.levels ?? []).find((l) => l["id"] === ids["level"]);
    // Fail-closed: an unconfigured Category resolves `private`, never `public`.
    expect(level?.["default_visibility"]).toBe("private");
  });

  it("scopes BRANCHES by her branch scope, unlike the curriculum vocabulary", async () => {
    // `UserBranchRole` is a real boundary (§7, R24); the curriculum is not, and
    // narrowing it would hide content §4.9 already admits her to.
    const res = await call("GET", "/me/scope-options", tokens["teacher"]);
    const branchIds = (res.body.data!.branches ?? []).map((b) => String(b["id"]));
    expect(branchIds).toContain(ids["branchA"]);
    expect(branchIds).not.toContain(ids["branchB"]);
  });

  it("gives an all-branches Admin every branch — null means every, never none", async () => {
    const res = await call("GET", "/me/scope-options", tokens["admin"]);
    const branchIds = (res.body.data!.branches ?? []).map((b) => String(b["id"]));
    expect(branchIds).toEqual(expect.arrayContaining([ids["branchA"]!, ids["branchB"]!]));
  });

  it("refuses a beneficiary outright — she composes nothing", async () => {
    const res = await call("GET", "/me/scope-options", tokens["student"]);
    expect(res.status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    expect((await call("GET", "/me/scope-options")).status).toBe(401);
  });
});

/* ── An option is not a key ─────────────────────────────────────────────── */

describe("NEW D — appearing in a dropdown grants nothing", () => {
  it("catalogue WRITES stay refused, though every value is now offered", async () => {
    // The distinction the Owner drew: "which Levels may I filter by" is not
    // "edit Levels". Each of these is a real management route.
    const writes: [string, string, unknown][] = [
      ["POST", "/admin/subjects", { name: `${TAG} مادة مسروقة` }],
      ["PATCH", `/admin/levels/${ids["level"]}`, { version: 0, name: `${TAG} مُعاد` }],
      ["DELETE", `/admin/subjects/${ids["untaught"]}`, undefined],
      ["POST", "/admin/academic-years", { label: "2099-2100" }],
      ["POST", "/admin/branches", { name: `${TAG} فرع مسروق` }],
    ];
    for (const [method, path, body] of writes) {
      const res = await call(method, path, tokens["teacher"], body);
      /**
       * **403 or 404, and the difference is honest.** Every route here that
       * exists refuses her with `FORBIDDEN`; `POST /admin/academic-years` does
       * not exist at all, because the platform has no academic-year write
       * surface. Asserting a flat `403` would have demanded a refusal from a
       * route nobody built — and would have made this test fail for a reason
       * unrelated to authorization. What the assertion needs to exclude is a
       * **success**, and it does.
       */
      expect({ path, status: res.status }).toEqual({
        path,
        status: res.status === 404 ? 404 : 403,
      });
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);
    }
  });

  it("the library still applies §4.9 — a filterable Level is not readable content", async () => {
    // She may filter by this Level. The hidden item at it is admitted to her
    // because §4.9 tier 3 admits STAFF — not because the option existed — and
    // the same request from a beneficiary returns nothing.
    const hers = await call(
      "GET",
      `/library?level_id=${ids["level"]}&page_size=100`,
      tokens["teacher"],
    );
    expect(hers.status).toBe(200);

    const beneficiary = await call(
      "GET",
      `/library?level_id=${ids["level"]}&page_size=100`,
      tokens["student"],
    );
    expect(beneficiary.status).toBe(200);
    const seen = ((beneficiary.body.data ?? []) as unknown as Record<string, unknown>[]).map(
      (r) => String(r["id"]),
    );
    expect(seen).not.toContain(ids["hiddenContent"]);
  });

  it("direct content authorization is unchanged by the new vocabulary", async () => {
    // The storage boundary is the content's alone (B-01/B-02). An option in a
    // filter cannot mint a URL.
    const refused = await call(
      "GET",
      `/content/${ids["hiddenContent"]}/download-url`,
      tokens["student"],
    );
    expect([401, 403, 404]).toContain(refused.status);
  });
});
