import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **The Trash's authority, over real HTTP** (§7, TD-2, BR-15, Revisions 52/59).
 *
 * The service suite proves the rules; this proves they hold **against a crafted
 * request**. That distinction is the whole point of the layer: restore and
 * permanent delete are hidden from every non-Super-Admin screen, and a hidden
 * button secures nothing — the question is what happens when somebody with an
 * Admin, Teacher, Student or Parent token calls the endpoint directly.
 *
 * Every assertion here also **reads the database back**. A `403` that
 * nonetheless destroyed the row would pass a status-code test, and that is
 * precisely the failure worth catching for an irreversible action.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[trash-http-test]";

interface Body {
  error?: { code?: string; details?: Record<string, unknown> };
  data?: Record<string, unknown>[];
  target_entity?: string;
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });

const bearer = (userId: string, role: string): string =>
  issueAccessToken(
    {
      userId,
      roleScopes: [{ role, branches: null }],
      accountStatus: "active" as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;

/** Every role that is NOT Super Admin. The rule is about all of them. */
const OTHER_ROLES = ["admin", "teacher", "student", "parent"] as const;

let superToken: string;
const tokens = new Map<string, string>();

async function withRole(label: string, role: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow!.id, branchId: null },
  });
  return user.id;
}

async function clear(): Promise<void> {
  const branches = await prisma.branch.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = branches.map((b) => b.id);
  await prisma.room.deleteMany({ where: { branchId: { in: ids } } });
  await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.branch.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/** A deleted Branch plus its tombstone — the shape every case below acts on. */
async function binnedBranch(): Promise<{ branchId: string; entryId: string }> {
  const deleter = await prisma.user.findFirst({
    where: { nameArabic: { startsWith: `${TAG} مشرفة` } },
    select: { id: true },
  });
  const branch = await prisma.branch.create({
    data: {
      name: `${TAG} فرع`,
      deletedAt: new Date(),
      deletedById: deleter!.id,
    },
  });
  const entry = await prisma.trash.create({
    data: {
      targetEntity: "Branch",
      targetId: branch.id,
      snapshot: { name: `${TAG} فرع` },
      deletedById: deleter!.id,
      purgeAfter: new Date(Date.now() + 90 * 24 * 3600 * 1000),
    },
  });
  return { branchId: branch.id, entryId: entry.id };
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        "docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api",
    );
  }
});

beforeEach(async () => {
  await clear();
  superToken = bearer(
    await withRole("مشرفة عامة", "super_admin"),
    "super_admin",
  );
  for (const role of OTHER_ROLES) {
    tokens.set(role, bearer(await withRole(role, role), role));
  }
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("reading the Trash", () => {
  it("is Super Admin only — every other role is refused by the SERVER", async () => {
    for (const role of OTHER_ROLES) {
      const res = await call("GET", "/admin/trash", tokens.get(role));
      expect(res.status, `${role} must not read the Trash`).toBe(403);
      // Not an empty list, which would be a different and misleading answer.
      expect(res.body.data).toBeUndefined();
    }
    expect((await call("GET", "/admin/trash")).status).toBe(401);
    expect((await call("GET", "/admin/trash", superToken)).status).toBe(200);
  });

  it("says per row what may be done to it, decided by the server", async () => {
    await binnedBranch();
    const res = await call(
      "GET",
      "/admin/trash?entity=Branch&page_size=100",
      superToken,
    );

    const row = res.body.data!.find((r) => String(r["label"]).startsWith(TAG));
    expect(row).toBeDefined();
    // Enough to identify what was deleted: what it was, what it was called, who
    // removed it, when, and when BR-15's window closes.
    expect(Object.keys(row!).sort()).toEqual([
      "deleted_at",
      "deleted_by_id",
      "deleted_by_name",
      "id",
      "label",
      "purge_after",
      "purge_blocked_reason",
      "purgeable",
      "restorable",
      "restore_blocked_reason",
      "target_entity",
      "target_id",
    ]);
    expect(row!["deleted_by_name"]).toContain("مشرفة");
    expect(row!["restorable"]).toBe(true);
    expect(row!["purgeable"]).toBe(true);
  });
});

describe("restore is Super Admin only, enforced server-side", () => {
  it("refuses every other role AND leaves the record deleted", async () => {
    for (const role of OTHER_ROLES) {
      const { branchId, entryId } = await binnedBranch();

      const res = await call(
        "POST",
        `/admin/trash/${entryId}/restore`,
        tokens.get(role),
      );
      expect(res.status, `${role} must not restore`).toBe(403);

      // The refusal is real, not cosmetic: still deleted, still tombstoned.
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
      });
      expect(branch?.deletedAt).not.toBeNull();
      expect(await prisma.trash.count({ where: { id: entryId } })).toBe(1);
    }
  });

  it("restores for a Super Admin and puts the record back in normal use", async () => {
    const { branchId, entryId } = await binnedBranch();

    const res = await call(
      "POST",
      `/admin/trash/${entryId}/restore`,
      superToken,
    );
    expect(res.status).toBe(200);

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    expect(branch?.deletedAt).toBeNull();
    // `deleted_by` is cleared with it — a restored row that still names a
    // deleter reads as deleted to anything looking at that column.
    expect(branch?.deletedById).toBeNull();
    // The tombstone goes, or the Trash disagrees with the platform.
    expect(await prisma.trash.count({ where: { id: entryId } })).toBe(0);

    // Back in the ordinary list, which is the point of restoring it.
    const list = await call("GET", "/admin/branches?page_size=100", superToken);
    expect(list.body.data!.some((b) => b["id"] === branchId)).toBe(true);
  });
});

describe("permanent deletion is Super Admin only, enforced server-side (R59.1)", () => {
  it("refuses every other role AND leaves the record intact", async () => {
    for (const role of OTHER_ROLES) {
      const { branchId, entryId } = await binnedBranch();

      const res = await call(
        "DELETE",
        `/admin/trash/${entryId}`,
        tokens.get(role),
      );
      expect(res.status, `${role} must not permanently delete`).toBe(403);

      // The one assertion that matters for an irreversible action.
      expect(await prisma.branch.count({ where: { id: branchId } })).toBe(1);
      expect(await prisma.trash.count({ where: { id: entryId } })).toBe(1);
    }

    const { branchId, entryId } = await binnedBranch();
    expect((await call("DELETE", `/admin/trash/${entryId}`)).status).toBe(401);
    expect(await prisma.branch.count({ where: { id: branchId } })).toBe(1);
  });

  it("destroys the record and its tombstone for a Super Admin", async () => {
    const { branchId, entryId } = await binnedBranch();

    expect(
      (await call("DELETE", `/admin/trash/${entryId}`, superToken)).status,
    ).toBe(204);

    expect(await prisma.branch.count({ where: { id: branchId } })).toBe(0);
    expect(await prisma.trash.count({ where: { id: entryId } })).toBe(0);
    // Retained indefinitely — absent from the audit-purge allowlist.
    expect(
      await prisma.auditLog.count({
        where: { actionType: "trash.permanent_delete", targetId: branchId },
      }),
    ).toBe(1);
  });

  it("refuses while something live still references it, and says which", async () => {
    const { branchId, entryId } = await binnedBranch();
    await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId } });

    const res = await call("DELETE", `/admin/trash/${entryId}`, superToken);

    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("DEPENDENTS_EXIST");
    // The constraint is named, so the remedy is findable rather than guessable.
    expect(res.body.error?.details?.["constraint"]).toBe("room_branch_id_fkey");
    expect(await prisma.branch.count({ where: { id: branchId } })).toBe(1);
  });
});

/**
 * TD-12 freshness on the destructive verbs.
 *
 * The token is a snapshot; the roles it claims may be minutes or hours out of
 * date. For a verb that destroys records irreversibly that is not good enough,
 * and `/admin/settings` already sets the standard by re-reading live rows.
 */
describe("a revoked Super Admin loses the destructive verbs at once (TD-12)", () => {
  it("refuses restore and purge on a validly signed token the live rows do not support", async () => {
    // A real teacher, holding no admin role in the database, with a correctly
    // signed token CLAIMING super_admin. Nothing a browser can produce — it is
    // the strongest form of "the token is stale or wrong", which is what the
    // freshness rule is for.
    const teacherId = await withRole("مؤطرة فقط", "teacher");
    const forged = bearer(teacherId, "super_admin");

    const { branchId, entryId } = await binnedBranch();

    expect(
      (await call("POST", `/admin/trash/${entryId}/restore`, forged)).status,
    ).toBe(403);
    expect(
      (await call("DELETE", `/admin/trash/${entryId}`, forged)).status,
    ).toBe(403);

    // And nothing moved: still deleted, still tombstoned, still there.
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    expect(branch?.deletedAt).not.toBeNull();
    expect(await prisma.trash.count({ where: { id: entryId } })).toBe(1);
  });

  it("still lets a genuine Super Admin through", async () => {
    // The guard must refuse the stale claim without refusing the real thing.
    const { entryId } = await binnedBranch();
    expect(
      (await call("DELETE", `/admin/trash/${entryId}`, superToken)).status,
    ).toBe(204);
  });
});
