import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { resolveLogin } from "./auth.service.js";

/**
 * §4.1b steps 3–4 — login resolution and routing, against the real database.
 * The routing condition is an access-control boundary, so every terminal status
 * is exercised rather than assumed.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

const TAG = "[auth-test]";

async function makeUser(opts: {
  status?: "pending" | "active" | "rejected" | "suspended";
  preProvisionedEmail?: string;
  deleted?: boolean;
}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} مستخدم`,
      accountStatus: opts.status ?? "active",
      ...(opts.preProvisionedEmail
        ? { preProvisionedEmail: opts.preProvisionedEmail }
        : {}),
      ...(opts.deleted ? { deletedAt: new Date() } : {}),
    },
  });
  return user.id;
}

function uniqueEmail(): string {
  return `user-${randomUUID().slice(0, 8)}@example.com`;
}

async function clear(): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: { actor: { nameArabic: { startsWith: TAG } } },
  });
  await prisma.userIdentity.deleteMany({
    where: { user: { nameArabic: { startsWith: TAG } } },
  });
  await prisma.user.deleteMany({ where: { nameArabic: { startsWith: TAG } } });
  await prisma.normalizedEmailLock.deleteMany({ where: { email: { startsWith: 'user-' } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("§4.1b login resolution and routing", () => {
  it("4c — an unknown person is routed to onboarding, and nothing is persisted", async () => {
    const email = uniqueEmail();
    const route = await resolveLogin(prisma, {
      email,
      providerSubjectId: "sub-unknown",
    });

    expect(route.kind).toBe("onboarding");
    // §4.1b step 6: abandonment persists nothing — no orphan identity, no user.
    // Scoped to THIS identity rather than a global count: vitest runs test files
    // in parallel, so a global count is a race, not an assertion.
    expect(
      await prisma.userIdentity.count({
        where: { providerSubjectId: "sub-unknown" },
      }),
    ).toBe(0);
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: email } }),
    ).toBe(0);
  });

  it("4b — a pre-provisioned account binds on first login and writes auth.identity_bound", async () => {
    const email = uniqueEmail();
    const userId = await makeUser({
      status: "active",
      preProvisionedEmail: email,
    });

    const route = await resolveLogin(prisma, {
      email,
      providerSubjectId: "sub-bind",
    });
    expect(route.kind).toBe("active");
    if (route.kind === "active") expect(route.boundNow).toBe(true);

    const identity = await prisma.userIdentity.findFirst({ where: { userId } });
    expect(identity?.providerSubjectId).toBe("sub-bind");
    expect(identity?.email).toBe(email);

    const bound = await prisma.auditLog.findFirst({
      where: { targetId: userId, actionType: "auth.identity_bound" },
    });
    expect(bound).not.toBeNull();

    // §7: pre_provisioned_email is RETAINED, not cleared — provenance survives.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.preProvisionedEmail).toBe(email);
  });

  it("4a — the second login resolves by identity and does NOT re-bind", async () => {
    const email = uniqueEmail();
    const userId = await makeUser({
      status: "active",
      preProvisionedEmail: email,
    });
    await resolveLogin(prisma, { email, providerSubjectId: "sub-twice" });

    const second = await resolveLogin(prisma, {
      email,
      providerSubjectId: "sub-twice",
    });
    expect(second.kind).toBe("active");
    if (second.kind === "active") expect(second.boundNow).toBe(false);

    // Exactly one identity, and only one binding audit row.
    expect(await prisma.userIdentity.count({ where: { userId } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { targetId: userId, actionType: "auth.identity_bound" },
      }),
    ).toBe(1);
  });

  it("matches the pre-provisioned email case-insensitively (TD-12)", async () => {
    const email = uniqueEmail();
    await makeUser({ status: "active", preProvisionedEmail: email });

    // Google hands back a capitalised address; it must still resolve.
    const route = await resolveLogin(prisma, {
      email: email.toUpperCase(),
      providerSubjectId: "sub-case",
    });
    expect(route.kind).toBe("active");
  });

  it("Pending routes to the status screen, never to a dashboard (TD-1)", async () => {
    const email = uniqueEmail();
    await makeUser({ status: "pending", preProvisionedEmail: email });
    const route = await resolveLogin(prisma, {
      email,
      providerSubjectId: "sub-pending",
    });
    expect(route.kind).toBe("pending");
  });

  it.each([
    ["rejected" as const, "rejected"],
    ["suspended" as const, "suspended"],
  ])(
    "%s routes to the deactivated screen and is NEVER bound (R16)",
    async (status, reason) => {
      const email = uniqueEmail();
      const userId = await makeUser({ status, preProvisionedEmail: email });

      const route = await resolveLogin(prisma, {
        email,
        providerSubjectId: `sub-${status}`,
      });
      expect(route.kind).toBe("deactivated");
      if (route.kind === "deactivated") expect(route.reason).toBe(reason);

      // Authenticating must not bind, and must not reactivate (§4.1).
      expect(await prisma.userIdentity.count({ where: { userId } })).toBe(0);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.accountStatus).toBe(status);

      const denied = await prisma.auditLog.findFirst({
        where: { targetId: userId, actionType: "auth.login_denied" },
      });
      expect(denied).not.toBeNull();
      expect((denied!.detail as Record<string, unknown>)["reason"]).toBe(
        reason,
      );
    },
  );

  it("a BOUND account with deleted_at set is deactivated though its status is active (F6)", async () => {
    // The exact case status-only routing would get wrong: a dashboard for a
    // deleted user. `deleted_at` must be part of the condition (Revision 16),
    // so the account is bound first and only then soft-deleted — which keeps
    // this test on the settled path and out of the §7-vs-§4.1 question below.
    const email = uniqueEmail();
    const userId = await makeUser({
      status: "active",
      preProvisionedEmail: email,
    });
    await resolveLogin(prisma, { email, providerSubjectId: "sub-deleted" });

    await prisma.user.update({
      where: { id: userId },
      // account_status deliberately left `active`: only deleted_at moves.
      data: { deletedAt: new Date() },
    });

    const route = await resolveLogin(prisma, {
      email,
      providerSubjectId: "sub-deleted",
    });
    expect(route.kind).toBe("deactivated");
    if (route.kind === "deactivated") expect(route.reason).toBe("deleted");
  });

  it("a soft-deleted, NEVER-BOUND account is refused, not sent to registration (R20)", async () => {
    // Revision 20 option (a): the lookup finds it, step 4a refuses it. Before
    // that decision this fell through to onboarding — offering a deleted person
    // the registration form, which §4.1 forbids.
    const email = uniqueEmail();
    const userId = await makeUser({
      status: "active",
      preProvisionedEmail: email,
      deleted: true,
    });

    const route = await resolveLogin(prisma, {
      email,
      providerSubjectId: "sub-never-bound",
    });
    expect(route.kind).toBe("deactivated");
    if (route.kind === "deactivated") expect(route.reason).toBe("deleted");

    // Refused, never bound, never reactivated.
    expect(await prisma.userIdentity.count({ where: { userId } })).toBe(0);
    expect(
      (await prisma.user.findUnique({ where: { id: userId } }))?.deletedAt,
    ).toBeInstanceOf(Date);
  });

  it("a deactivated identity (user soft-deleted after binding) does not resolve (TD-5)", async () => {
    const email = uniqueEmail();
    const userId = await makeUser({
      status: "active",
      preProvisionedEmail: email,
    });
    await resolveLogin(prisma, { email, providerSubjectId: "sub-deact" });

    // TD-5: user soft-delete deactivates identity rows.
    await prisma.userIdentity.updateMany({
      where: { userId },
      data: { isActive: false },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    const route = await resolveLogin(prisma, {
      email,
      providerSubjectId: "sub-deact",
    });
    expect(route.kind).toBe("deactivated");
  });

  it("concurrent first logins bind exactly once (TD-4.10, TD-15.3)", async () => {
    const email = uniqueEmail();
    const userId = await makeUser({
      status: "active",
      preProvisionedEmail: email,
    });

    const results = await Promise.allSettled([
      resolveLogin(prisma, { email, providerSubjectId: "sub-race" }),
      resolveLogin(prisma, { email, providerSubjectId: "sub-race" }),
    ]);

    // Neither may fail: the loser re-reads and continues as 4a.
    for (const result of results) expect(result.status).toBe("fulfilled");
    expect(await prisma.userIdentity.count({ where: { userId } })).toBe(1);
  });
});
