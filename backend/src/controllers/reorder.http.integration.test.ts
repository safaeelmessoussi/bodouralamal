import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **R76 over HTTP for the four resources that are not Branch.**
 *
 * `branch.http.integration.test.ts` pins the contract itself — the allow-list,
 * the tiebreaker, the exact-set refusals, the authority. This file exists
 * because *"the same helper is called"* is not evidence that a resource is
 * wired: every defect this project has shipped in this area was a **wiring**
 * defect, not a logic one. What is asserted per resource is therefore what
 * wiring can get wrong:
 *
 * * the route exists and is **not captured by `/:id`**;
 * * `sort_by` reaches the service rather than being dropped by a controller
 *   that never spread it;
 * * the allow-list is the **resource's own**, so a field that another endpoint
 *   accepts is still refused here;
 * * the **scope** is the parent, for the two whose `display_order` is scoped to
 *   one (§2.2) — a global sequence across every Level would write positions that
 *   mean nothing beside each other.
 *
 * Requires the compose stack: `docker compose up -d --build api`.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-reorder-test]";

interface Res {
  status: number;
  body: {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>[] & Record<string, unknown>;
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
let teacher: string;
let branchId: string;
let categoryA: string;
let categoryB: string;
let levelA1: string;
let levelB1: string;
let sharedCategoryOrder: Array<{ id: string; displayOrder: number | null }> = [];
let sharedSubjectOrder: Array<{ id: string; displayOrder: number | null }> = [];

async function makeUser(label: string): Promise<string> {
  return (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} ${label}`, accountStatus: "active" },
    })
  ).id;
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

/** The ids of one collection, in the order the API returns them. */
async function idsOf(path: string): Promise<string[]> {
  const res = await call("GET", path, superAdmin);
  expect(res.status, path).toBe(200);
  return (res.body.data as unknown as Record<string, unknown>[]).map((r) =>
    String(r["id"]),
  );
}

/** Only the rows this file created — other suites share the database. */
const mine = (rows: Record<string, unknown>[]): string[] =>
  rows
    .filter((r) => String(r["name"]).startsWith(TAG))
    .map((r) => String(r["name"]));

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();
  [sharedCategoryOrder, sharedSubjectOrder] = await Promise.all([
    prisma.category.findMany({
      where: { deletedAt: null, NOT: { name: { startsWith: TAG } } },
      select: { id: true, displayOrder: true },
    }),
    prisma.subject.findMany({
      where: { deletedAt: null, NOT: { name: { startsWith: TAG } } },
      select: { id: true, displayOrder: true },
    }),
  ]);

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  superAdmin = bearer(await makeUser("مدير عام"), [
    { role: "super_admin", branches: null },
  ]);
  teacher = bearer(await makeUser("أستاذة"), [
    { role: "teacher", branches: null },
  ]);

  // Names are deliberately NOT in the order they are created, so an assertion
  // that a sort happened cannot be satisfied by insertion order.
  categoryA = (
    await prisma.category.create({
      data: { name: `${TAG} ج فئة`, displayOrder: 1 },
    })
  ).id;
  categoryB = (
    await prisma.category.create({
      data: { name: `${TAG} أ فئة`, displayOrder: 2 },
    })
  ).id;
  // `display_order` deliberately DISAGREES with the alphabet, so BR-19's order
  // and `sort_by=name` are different lists — an endpoint that dropped the
  // parameter would otherwise pass by returning the default.
  for (const [i, name] of [
    `${TAG} ج مادة`,
    `${TAG} أ مادة`,
    `${TAG} ب مادة`,
  ].entries()) {
    await prisma.subject.create({ data: { name, displayOrder: i + 1 } });
  }
  levelA1 = (
    await prisma.level.create({
      data: {
        name: `${TAG} ج مستوى`,
        categoryId: categoryA,
        genderRestriction: "any",
      },
    })
  ).id;
  await prisma.level.create({
    data: {
      name: `${TAG} أ مستوى`,
      categoryId: categoryA,
      genderRestriction: "any",
    },
  });
  levelB1 = (
    await prisma.level.create({
      data: {
        name: `${TAG} ب مستوى آخر`,
        categoryId: categoryB,
        genderRestriction: "any",
      },
    })
  ).id;
  for (const [i, name] of [
    `${TAG} ج مجموعة`,
    `${TAG} أ مجموعة`,
    `${TAG} ب مجموعة`,
  ].entries()) {
    await prisma.administrativeGroup.create({
      data: { name, levelId: levelA1, branchId, displayOrder: i + 1 },
    });
  }
  await prisma.administrativeGroup.create({
    data: {
      name: `${TAG} مجموعة أخرى`,
      levelId: levelB1,
      branchId,
      displayOrder: 4,
    },
  });
});

afterAll(async () => {
  try {
    await clear();
  } finally {
    try {
      // Flat reorder endpoints necessarily include Owner-managed rows. Restore
      // their exact positions after removing this suite's rows: replaying only
      // the relative sequence would leave gaps where the deleted fixtures sat.
      await prisma.$transaction([
        ...sharedCategoryOrder.map((row) =>
          prisma.category.update({
            where: { id: row.id },
            data: { displayOrder: row.displayOrder },
          }),
        ),
        ...sharedSubjectOrder.map((row) =>
          prisma.subject.update({
            where: { id: row.id },
            data: { displayOrder: row.displayOrder },
          }),
        ),
      ]);
    } finally {
      await prisma.$disconnect();
    }
  }
});

/* ── Sorting reaches every list ───────────────────────────────────────────── */

describe.each([
  ["categories", "/admin/categories", "name"],
  ["subjects", "/admin/subjects", "name"],
  ["levels", "/admin/levels", "name"],
  [
    "administrative-groups",
    "/admin/administrative-groups?page_size=100&",
    "name",
  ],
])("R76 sorting — %s", (_label, base, field) => {
  const q = (suffix: string): string =>
    base.endsWith("&") ? base + suffix : `${base}?${suffix}`;

  it("preserves BR-19 when nothing is asked, and sorts both ways when asked", async () => {
    const plain = await call("GET", base.replace(/[?&]$/, ""), superAdmin);
    expect(plain.status).toBe(200);

    const asc = await call(
      "GET",
      q(`sort_by=${field}&sort_dir=asc`),
      superAdmin,
    );
    const desc = await call(
      "GET",
      q(`sort_by=${field}&sort_dir=desc`),
      superAdmin,
    );
    expect(asc.status).toBe(200);
    expect(desc.status).toBe(200);
    const ascNames = mine(
      asc.body.data as unknown as Record<string, unknown>[],
    );
    expect(ascNames.length).toBeGreaterThan(1);
    expect(
      mine(desc.body.data as unknown as Record<string, unknown>[]),
    ).toEqual([...ascNames].reverse());
    // Sorting by name is not the same list as BR-19's order — otherwise this
    // test would pass against an endpoint that ignored the parameter entirely.
    expect(ascNames).not.toEqual(
      mine(plain.body.data as unknown as Record<string, unknown>[]),
    );
  });

  it("refuses an unknown field, a column name and a bad direction", async () => {
    for (const bad of [
      "nope",
      "display_order",
      "displayOrder",
      "deleted_at",
      "id",
    ]) {
      const res = await call("GET", q(`sort_by=${bad}`), superAdmin);
      expect(res.status, bad).toBe(400);
      expect(res.body.error?.code, bad).toBe("VALIDATION_FAILED");
    }
    expect(
      (await call("GET", q(`sort_by=${field}&sort_dir=up`), superAdmin)).status,
    ).toBe(400);
    expect((await call("GET", q("sort_dir=desc"), superAdmin)).status).toBe(
      400,
    );
  });
});

it("keeps each allow-list its own — `category` sorts Levels and nothing else", async () => {
  // R76.1 is per ENDPOINT. A shared allow-list would quietly make every list
  // accept every other list's fields, which is how an allow-list stops being one.
  expect(
    (await call("GET", "/admin/levels?sort_by=category", superAdmin)).status,
  ).toBe(200);
  expect(
    (await call("GET", "/admin/categories?sort_by=category", superAdmin))
      .status,
  ).toBe(400);
  expect(
    (await call("GET", "/admin/subjects?sort_by=category", superAdmin)).status,
  ).toBe(400);
});

/* ── Reordering, per resource ─────────────────────────────────────────────── */

describe("R76 reorder — flat collections (Categories, Subjects)", () => {
  it.each([
    ["categories", "/admin/categories"],
    ["subjects", "/admin/subjects"],
  ])(
    "%s: writes contiguous 1..n from the sequence and persists it",
    async (_l, base) => {
      const before = await idsOf(base);
      const reversed = [...before].reverse();
      try {
        const res = await call("PATCH", `${base}/order`, superAdmin, {
          ids: reversed,
        });
        expect(res.status).toBe(200);
        expect((res.body.data as unknown as { ids: string[] }).ids).toEqual(
          reversed,
        );
        expect(await idsOf(base)).toEqual(reversed);

        // Idempotent — a retry after a dropped response is safe.
        expect(
          (await call("PATCH", `${base}/order`, superAdmin, { ids: reversed }))
            .status,
        ).toBe(200);
        expect(await idsOf(base)).toEqual(reversed);
      } finally {
        // Categories and Subjects are global whole sets. The rows not carrying
        // TAG are shared development/Owner state, so exact restoration is part
        // of this test rather than something teardown may infer from names.
        const restored = await call("PATCH", `${base}/order`, superAdmin, {
          ids: before,
        });
        if (restored.status !== 200) {
          throw new Error(`could not restore shared ${String(_l)} order`);
        }
      }
    },
  );

  it.each([
    ["categories", "/admin/categories"],
    ["subjects", "/admin/subjects"],
  ])(
    "%s: refuses a duplicate, a foreign id and a partial sequence",
    async (_l, base) => {
      const order = await idsOf(base);

      const dup = await call("PATCH", `${base}/order`, superAdmin, {
        ids: [order[0]!, order[0]!, ...order.slice(1)],
      });
      expect(dup.body.error?.details?.["reason"]).toBe("DUPLICATE_ID");

      const foreign = await call("PATCH", `${base}/order`, superAdmin, {
        ids: [...order.slice(1), "00000000-0000-4000-8000-000000000000"],
      });
      expect(foreign.body.error?.details?.["reason"]).toBe("UNKNOWN_ID");

      const partial = await call("PATCH", `${base}/order`, superAdmin, {
        ids: order.slice(0, 1),
      });
      expect(partial.body.error?.details?.["reason"]).toBe("INCOMPLETE_ORDER");

      expect(await idsOf(base)).toEqual(order);
    },
  );

  it.each([
    ["categories", "/admin/categories"],
    ["subjects", "/admin/subjects"],
  ])(
    "%s: inherits the write authority and is not captured by /:id",
    async (_l, base) => {
      const order = await idsOf(base);
      expect(
        (await call("PATCH", `${base}/order`, teacher, { ids: order })).status,
      ).toBe(403);
      expect(
        (await call("PATCH", `${base}/order`, undefined, { ids: order }))
          .status,
      ).toBe(401);
      // If `/:id` had been declared first the literal would arrive as a uuid param
      // and fail validation on the id, never reaching this handler.
      expect(
        (await call("PATCH", `${base}/order`, superAdmin, { ids: order }))
          .status,
      ).toBe(200);
    },
  );
});

describe("R76 reorder — collections scoped to a parent (Levels, Groups)", () => {
  const cases = [
    {
      label: "levels",
      base: "/admin/levels",
      list: () => `/admin/levels?category_id=${categoryA}`,
      within: () => categoryA,
      outsider: () => levelB1,
    },
    {
      label: "administrative-groups",
      base: "/admin/administrative-groups",
      list: () =>
        `/admin/administrative-groups?level_id=${levelA1}&page_size=100`,
      within: () => levelA1,
      outsider: async (): Promise<string> =>
        (
          await idsOf(
            `/admin/administrative-groups?level_id=${levelB1}&page_size=100`,
          )
        )[0]!,
    },
  ];

  for (const c of cases) {
    it(`${c.label}: reorders one parent's collection only`, async () => {
      const before = await idsOf(c.list());
      expect(before.length).toBeGreaterThan(1);
      const reversed = [...before].reverse();

      const res = await call("PATCH", `${c.base}/order`, superAdmin, {
        within: c.within(),
        ids: reversed,
      });
      expect(res.status).toBe(200);
      expect(await idsOf(c.list())).toEqual(reversed);
    });

    it(`${c.label}: refuses a sequence that reaches outside the named parent`, async () => {
      // §2.2 scopes `display_order` to the parent; a sequence mixing two of them
      // would write positions that mean nothing beside each other.
      const order = await idsOf(c.list());
      const foreign = await (typeof c.outsider === "function"
        ? c.outsider()
        : c.outsider);
      const res = await call("PATCH", `${c.base}/order`, superAdmin, {
        within: c.within(),
        ids: [...order, String(foreign)],
      });
      expect(res.status).toBe(400);
      expect(res.body.error?.details?.["reason"]).toBe("UNKNOWN_ID");
      expect(await idsOf(c.list())).toEqual(order);
    });

    it(`${c.label}: requires the parent — the sequence alone cannot name it`, async () => {
      const order = await idsOf(c.list());
      expect(
        (await call("PATCH", `${c.base}/order`, superAdmin, { ids: order }))
          .status,
      ).toBe(400);
    });

    it(`${c.label}: inherits the write authority`, async () => {
      const body = { within: c.within(), ids: await idsOf(c.list()) };
      expect(
        (await call("PATCH", `${c.base}/order`, teacher, body)).status,
      ).toBe(403);
      expect(
        (await call("PATCH", `${c.base}/order`, undefined, body)).status,
      ).toBe(401);
    });
  }
});
