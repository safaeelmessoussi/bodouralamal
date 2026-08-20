import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * Admin branch and room routes over real HTTP (§7, TD-2 Revision 26).
 *
 * **Why this file exists.** Until Revision 38 `GET /admin/branches` returned the
 * Prisma row itself, and shipped that way for months: `camelCase` fields inside
 * a `snake_case` envelope, an instant where TD-11 defines a calendar date, and
 * four internal columns no screen consumes. Every service test was green
 * throughout, because a service test asserts the *decision* and never the
 * *wire*. There was no HTTP-level test here at all — which is precisely how the
 * contract drifted unnoticed.
 *
 * So these tests assert the **exact key set** of every response, never merely
 * that the wanted fields are present. The failure mode being guarded is a field
 * *arriving* that nobody chose, and a presence check passes straight through it.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-branch-test]";

const BRANCH_KEYS = [
  "address",
  "display_order",
  "email",
  "google_maps_url",
  "id",
  "name",
  "opening_hours_ar",
  "operational_start_date",
  "phone",
  "version",
];
const ROOM_KEYS = ["branch_id", "id", "name", "version"];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    // TD-3.8 — a refusal carries a `details` bag beside its code, and these
    // tests read it. Omitting it here made `npm run typecheck` red.
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

let superAdmin: string;
let adminToken: string;
let branchId: string;

async function clear(): Promise<void> {
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  // TD-4.6d (Revision 43.1): creating a Branch also backfills المجموعة 1 for
  // every Level that has none, so a branch created here owns groups it never
  // asked for. RESTRICT against Branch (TD-5), so they go first.
  await prisma.administrativeGroup.deleteMany({
    where: { branch: { name: { startsWith: TAG } } },
  });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    // TD-8: `AuditLog.actor` and `Trash.deletedBy` are `onDelete: Restrict` on
    // purpose — deleting a user must never quietly erase the record of what
    // they did. Every write in this suite is audited, so the fixture has to
    // clear its OWN trail explicitly. Scoped to these user ids, never a blanket
    // truncate: the constraint exists to make erasure deliberate, and a test
    // that erased it wholesale would be defeating the thing it depends on.
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

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
  superAdmin = bearer(await makeStaff("super_admin"), ["super_admin", "admin"]);
  adminToken = bearer(await makeStaff("admin"), ["admin"]);

  const created = await call("POST", "/admin/branches", superAdmin, {
    name: `${TAG} مقر`,
    operational_start_date: "2026-03-01",
    display_order: 1,
    address: "شارع محمد السادس",
    phone: "+212524000000",
    email: "branch@example.com",
    opening_hours_ar: "الاثنين–الجمعة\n09:00–17:00",
    google_maps_url: "https://maps.example.com/x",
  });
  branchId = created.body.id as string;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("branch responses are an explicit contract DTO (§16.2, Revision 38)", () => {
  it("POST returns exactly the documented keys, and no others", async () => {
    const res = await call("POST", "/admin/branches", superAdmin, {
      name: `${TAG} ثانٍ`,
    });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(BRANCH_KEYS);
  });

  it("GET returns the same shape inside the TD-10 envelope", async () => {
    const res = await call("GET", "/admin/branches", superAdmin);
    expect(res.status).toBe(200);
    const row = res.body.data!.find((b) => b.id === branchId)!;
    expect(Object.keys(row).sort()).toEqual(BRANCH_KEYS);
  });

  it("PATCH returns the same shape, carrying the incremented version", async () => {
    const before = (
      await call("GET", "/admin/branches", superAdmin)
    ).body.data!.find((b) => b.id === branchId)!;
    const res = await call("PATCH", `/admin/branches/${branchId}`, superAdmin, {
      name: `${TAG} مقر معدّل`,
      version: before.version,
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(BRANCH_KEYS);
    expect(res.body.version).toBe((before.version as number) + 1);
  });

  it("never exposes the internal columns, on any verb", async () => {
    // Named individually rather than inferred from the key set, so the failure
    // message says WHICH column leaked.
    const res = await call("GET", "/admin/branches", superAdmin);
    for (const row of res.body.data!) {
      for (const internal of [
        "created_at",
        "updated_at",
        "deleted_at",
        "deleted_by",
      ]) {
        expect(row).not.toHaveProperty(internal);
      }
      // The camelCase originals, in case a future change reintroduces the row
      // spread rather than adding a field to the DTO.
      for (const camel of [
        "operationalStartDate",
        "displayOrder",
        "openingHoursAr",
        "googleMapsUrl",
      ]) {
        expect(row).not.toHaveProperty(camel);
      }
    }
  });

  it("TD-11: operational_start_date is a calendar date, never an instant", async () => {
    // An instant here is what invites a client-side timezone conversion, which
    // is the exact class of bug TD-11 exists to prevent — a branch opening on
    // 1 March reading as 28 February one timezone west.
    const res = await call("GET", "/admin/branches", superAdmin);
    const row = res.body.data!.find((b) => b.id === branchId)!;
    expect(row.operational_start_date).toBe("2026-03-01");
  });

  it("preserves opening_hours_ar verbatim, newlines included (§7)", async () => {
    const res = await call("GET", "/admin/branches", superAdmin);
    const row = res.body.data!.find((b) => b.id === branchId)!;
    expect(row.opening_hours_ar).toBe("الاثنين–الجمعة\n09:00–17:00");
  });
});

describe("room responses are an explicit contract DTO", () => {
  it("POST, GET and PATCH all return exactly the documented keys", async () => {
    const created = await call(
      "POST",
      `/admin/branches/${branchId}/rooms`,
      superAdmin,
      {
        name: `${TAG} قاعة`,
      },
    );
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(ROOM_KEYS);
    expect(created.body.branch_id).toBe(branchId);

    const list = await call(
      "GET",
      `/admin/branches/${branchId}/rooms`,
      superAdmin,
    );
    expect(Object.keys(list.body.data![0]!).sort()).toEqual(ROOM_KEYS);

    const patched = await call(
      "PATCH",
      `/admin/rooms/${created.body.id}`,
      superAdmin,
      {
        name: `${TAG} قاعة معدّلة`,
        version: created.body.version,
      },
    );
    expect(Object.keys(patched.body).sort()).toEqual(ROOM_KEYS);
  });
});

describe("the routes are mounted and guarded (TD-2 Revision 26)", () => {
  it("an admin may READ branches but not write them", async () => {
    expect((await call("GET", "/admin/branches", adminToken)).status).toBe(200);

    const denied = await call("POST", "/admin/branches", adminToken, {
      name: `${TAG} مرفوض`,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe("FORBIDDEN");
  });

  it("refuses an anonymous caller with the TD-3.8 envelope", async () => {
    const res = await call("GET", "/admin/branches");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("TD-15: a stale version is a 409, not a silent overwrite", async () => {
    const row = (
      await call("GET", "/admin/branches", superAdmin)
    ).body.data!.find((b) => b.id === branchId)!;
    const stale = (row.version as number) - 1;
    const res = await call("PATCH", `/admin/branches/${branchId}`, superAdmin, {
      name: `${TAG} تعارض`,
      version: stale,
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("VERSION_CONFLICT");
  });
});

/**
 * **R76 — sorting and manual ordering, over real HTTP.**
 *
 * The two contracts are tested together here because they are two halves of one
 * question: *what order is this collection in, and who decided it*.
 */
describe("R76 — list sorting is a contract, not a column name", () => {
  it("preserves BR-19’s order when nothing is asked (R76.2)", async () => {
    // This revision adds a capability and moves no default.
    const res = await call("GET", "/admin/branches?page_size=100", superAdmin);
    expect(res.status).toBe(200);
    const ours = res.body.data!.filter((b) =>
      String(b["name"]).startsWith(TAG),
    );
    expect(ours.length).toBeGreaterThan(1);
  });

  it("sorts ascending and descending by an allowed field", async () => {
    const asc = await call(
      "GET",
      "/admin/branches?sort_by=name&sort_dir=asc&page_size=100",
      superAdmin,
    );
    const desc = await call(
      "GET",
      "/admin/branches?sort_by=name&sort_dir=desc&page_size=100",
      superAdmin,
    );
    expect(asc.status).toBe(200);
    expect(desc.status).toBe(200);
    const names = (r: Res): string[] =>
      r.body
        .data!.filter((b) => String(b["name"]).startsWith(TAG))
        .map((b) => String(b["name"]));
    expect(names(desc)).toEqual([...names(asc)].reverse());
  });

  it("refuses an unknown field — a typo must not look like a working sort", async () => {
    const res = await call("GET", "/admin/branches?sort_by=nope", superAdmin);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a database column name, which is not a contract field", async () => {
    // The security property over the wire: `sort_by` names a field the endpoint
    // promises, and there is no path from the query string to a column.
    for (const injected of ["display_order", "displayOrder", "deleted_at"]) {
      const res = await call(
        "GET",
        `/admin/branches?sort_by=${injected}`,
        superAdmin,
      );
      expect(res.status, injected).toBe(400);
    }
  });

  it("refuses a direction that is neither asc nor desc, and one with no field", async () => {
    expect(
      (
        await call(
          "GET",
          "/admin/branches?sort_by=name&sort_dir=up",
          superAdmin,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call("GET", "/admin/branches?sort_dir=desc", superAdmin)).status,
    ).toBe(400);
  });

  it("keeps pagination deterministic across pages while sorted", async () => {
    // R76.3 — the appended `id` tiebreaker. Without it a row sharing a sort value
    // can appear on two pages or on neither.
    const first = await call(
      "GET",
      "/admin/branches?sort_by=name&page=1&page_size=2",
      superAdmin,
    );
    const second = await call(
      "GET",
      "/admin/branches?sort_by=name&page=2&page_size=2",
      superAdmin,
    );
    const ids = (r: Res): string[] => r.body.data!.map((b) => String(b["id"]));
    expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
  });
});

describe("R76 — reordering takes the sequence, not per-row numbers", () => {
  const ids = async (): Promise<string[]> => {
    const res = await call("GET", "/admin/branches?page_size=100", superAdmin);
    return res.body.data!.map((b) => String(b["id"]));
  };

  it("assigns contiguous 1..n from the sequence, and persists it", async () => {
    const before = await ids();
    const reversed = [...before].reverse();

    const res = await call("PATCH", "/admin/branches/order", superAdmin, {
      ids: reversed,
    });
    expect(res.status).toBe(200);
    // Returns the resulting order, so a client re-renders from the server rather
    // than from its own optimistic guess.
    expect((res.body.data as unknown as { ids: string[] }).ids).toEqual(
      reversed,
    );

    // R76.6 — contiguous and unique, never duplicated or gapped, because the
    // positions came from a list rather than from the caller's arithmetic.
    const rows = await prisma.branch.findMany({
      where: { id: { in: reversed }, deletedAt: null },
      select: { id: true, displayOrder: true },
      orderBy: { displayOrder: "asc" },
    });
    expect(rows.map((r) => r.displayOrder)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.map((r) => r.id)).toEqual(reversed);

    // And a fresh read returns it — the order survives the request.
    expect(await ids()).toEqual(reversed);
  });

  it("is idempotent — the same sequence twice is safe after a dropped response", async () => {
    const order = await ids();
    expect(
      (await call("PATCH", "/admin/branches/order", superAdmin, { ids: order }))
        .status,
    ).toBe(200);
    expect(
      (await call("PATCH", "/admin/branches/order", superAdmin, { ids: order }))
        .status,
    ).toBe(200);
    expect(await ids()).toEqual(order);
  });

  it("refuses a duplicate, a foreign id and a partial sequence — each by name", async () => {
    const order = await ids();

    const dup = await call("PATCH", "/admin/branches/order", superAdmin, {
      ids: [order[0]!, order[0]!, ...order.slice(1)],
    });
    expect(dup.status).toBe(400);
    expect(dup.body.error?.details?.["reason"]).toBe("DUPLICATE_ID");

    const foreign = await call("PATCH", "/admin/branches/order", superAdmin, {
      ids: [...order.slice(1), "00000000-0000-4000-8000-000000000000"],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error?.details?.["reason"]).toBe("UNKNOWN_ID");

    // A partial sequence cannot say where the omitted rows belong.
    const partial = await call("PATCH", "/admin/branches/order", superAdmin, {
      ids: order.slice(0, 1),
    });
    expect(partial.status).toBe(400);
    expect(partial.body.error?.details?.["reason"]).toBe("INCOMPLETE_ORDER");

    // None of the refusals wrote anything.
    expect(await ids()).toEqual(order);
  });

  it("refuses a malformed body, and a body carrying anything else", async () => {
    expect(
      (
        await call("PATCH", "/admin/branches/order", superAdmin, {
          ids: ["nope"],
        })
      ).status,
    ).toBe(400);
    // `.strict()` — a `version` here would propose a concurrency model this
    // contract deliberately does not use.
    const order = await ids();
    expect(
      (
        await call("PATCH", "/admin/branches/order", superAdmin, {
          ids: order,
          version: 1,
        })
      ).status,
    ).toBe(400);
  });

  it("inherits the resource’s write authority, and adds no TD-2 row", async () => {
    // R76.5 — whoever may edit a Branch may reorder Branches; an Admin may not
    // write reference data, and is refused here exactly as they are on `PATCH`.
    const order = await ids();
    expect(
      (await call("PATCH", "/admin/branches/order", adminToken, { ids: order }))
        .status,
    ).toBe(403);
    expect(
      (await call("PATCH", "/admin/branches/order", undefined, { ids: order }))
        .status,
    ).toBe(401);
  });

  it("does not capture `order` as a branch id", async () => {
    // The route is declared before `/:id`; this is what proves it.
    const res = await call("PATCH", "/admin/branches/order", superAdmin, {
      ids: await ids(),
    });
    expect(res.status).not.toBe(404);
  });
});
