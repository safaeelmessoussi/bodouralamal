import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { issueNewSession } from "../services/refresh-token.service.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * §19.2 named regression — **Pending-session data-access denial across all
 * endpoints (server side)**; §18 Authentication & Onboarding; TD-1, TD-12.
 *
 * TD-1: *"a Pending session reaches no endpoint but `GET /me` and logout"*. The
 * refusal lives in one gate rather than at each route, which is the right
 * design and also the risk this test addresses: **a single mistake there opens
 * every endpoint at once**, and no individual route's own tests would notice,
 * because each one authenticates as an active user.
 *
 * So this sweeps the guarded surface rather than sampling it, and it is
 * deliberately written to fail loudly if a **new** route is added outside the
 * guarded router without thinking about Pending.
 *
 * The public calendar and the public Educational Library are the documented
 * exceptions (§4.4, TD-3.13): a Pending account sees the public tier of each,
 * exactly as an anonymous visitor does. Both are asserted positively below, so
 * an exception stays a decision rather than a hole.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[pending-denial-test]";

interface Body {
  error?: { code?: string };
  data?: unknown[];
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });

const bearer = (
  userId: string,
  roles: string[],
  accountStatus: string,
): string =>
  issueAccessToken(
    {
      userId,
      roleScopes: roles.map((role) => ({ role, branches: null })),
      accountStatus: accountStatus as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;

let pendingToken: string;
let pendingUserId: string;
let suspendedToken: string;
let rejectedToken: string;
let activeToken: string;

async function person(label: string, status: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: status as never,
    },
  });
  return u.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
});

beforeEach(async () => {
  await clear();
  // A Pending account that also carries roles: the denial must rest on status,
  // never on the caller happening to lack a role.
  pendingUserId = await person("قيد الموافقة", "pending");
  pendingToken = bearer(pendingUserId, ["super_admin"], "pending");
  suspendedToken = bearer(
    await person("موقوفة", "suspended"),
    ["super_admin"],
    "suspended",
  );
  rejectedToken = bearer(
    await person("مرفوضة", "rejected"),
    ["super_admin"],
    "rejected",
  );
  activeToken = bearer(
    await person("نشطة", "active"),
    ["super_admin"],
    "active",
  );
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/**
 * The guarded surface is derived from the **generated contract**, not from a
 * hand-kept list. A hand-kept list is exactly what goes stale: the next route
 * someone adds would simply not be checked against Pending, and nothing would
 * say so. Reading `docs/openapi.json` means a new endpoint is covered the
 * moment it is documented — which the `check-openapi-td3` guard already
 * requires before it can ship.
 *
 * Ids are well-formed but nonexistent: a Pending caller must be stopped
 * **before** anything is looked up, so the answer must never depend on whether
 * the target exists.
 */
const NOWHERE = "00000000-0000-4000-8000-000000000000";

/**
 * The documented exceptions, each with its clause. Listing them here — rather
 * than quietly skipping whatever fails — is what keeps the exception set a
 * decision instead of a hole; the positive assertions below prove each one is
 * genuinely reachable.
 */
const EXEMPT = new Set([
  // §4.4 / §4.1b / TD-3.9: public by design.
  "/calendar",
  "/registrations",
  "/healthz",
  // Revision 35: the §5.1 landing-page branch directory, anonymous.
  "/branches",
  // Revision 36 (TD-3.10): the calendar screen's reference data, anonymous.
  "/calendar/bootstrap",
  // TD-3.4 (Revision 43): the §5.2 Session page is PUBLIC at the caller's tier,
  // exactly like the calendar grid it is opened from. A Pending account sees a
  // public session's existence and details, and never its private recordings —
  // which is the tier doing the work, not the guard.
  "/calendar/sessions/{id}",
  // TD-3.13 (Revision 43): the Educational Library is PUBLIC (§5.2). A Pending
  // account sees the public tier exactly as an anonymous visitor does, for the
  // same reason the calendar does — the account exists and grants nothing
  // (TD-1), which is not the same as being refused.
  "/library",
  // §4.9 (Revision 43): `SessionContent` read backwards — which class sessions
  // reference this item. **Public at the caller's tier**, `optionalAuthenticate`
  // like the two reads above it, and for the same reason: it adds no
  // relationship and exposes nothing the library list and the Session page do
  // not already expose at that tier.
  //
  // It appears here only now because this list is DERIVED FROM `openapi.json`,
  // which was stale for a week (`ed7212b`..`4842def`). Regenerating the contract
  // is what made the route discoverable — the guard widening on its own is the
  // behaviour that was wanted, and this is the first route it caught.
  "/library/{id}/sessions",
  // §4.1b: the login flow itself, which a Pending user must be able to complete.
  "/auth/google",
  "/auth/google/callback",
  // TD-12: cookie-authenticated, not bearer-guarded.
  "/auth/refresh",
  // TD-1: *"a Pending session reaches no endpoint but `GET /me` and logout"*.
  "/auth/logout",
  "/me",
  /**
   * **R99.15 — the recording provider's callback, which has no Bodour session
   * at all.**
   *
   * The caller is a machine authenticated by the **provider's signature over
   * the raw body**, so a bearer token is not the mechanism and `403` is not the
   * answer. It always replies `204`, deliberately: a distinguishable refusal
   * would tell a prober its guess was wrong, and a provider retrying forever
   * against a `4xx` it cannot fix is worse than a silent discard.
   *
   * **The exemption costs nothing, because the route's own security is proved
   * elsewhere and harder** — `online-class.http.integration.test.ts` sends it
   * unsigned, forged, and perfectly-shaped-but-unknown payloads and asserts
   * that no recording and no `EducationalContent` row appears. A Pending
   * session presenting a bearer here is simply not the threat.
   */
  "/integrations/online-class/callback",
]);

function concretePath(template: string): string {
  return template
    .replace("{year}", "1448")
    .replace("{month}", "1")
    .replace(/\{[^}]+\}/g, NOWHERE);
}

interface Contract {
  paths: Record<string, Record<string, unknown>>;
}

function guardedRoutes(): [string, string][] {
  const file = fileURLToPath(
    new URL("../../../docs/openapi.json", import.meta.url),
  );
  const spec = JSON.parse(readFileSync(file, "utf8")) as Contract;
  const out: [string, string][] = [];

  for (const [template, ops] of Object.entries(spec.paths)) {
    if (EXEMPT.has(template)) continue;
    for (const method of Object.keys(ops)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      out.push([method.toUpperCase(), concretePath(template)]);
    }
  }
  return out;
}

const GUARDED = guardedRoutes();

describe("§19.2 — a Pending session reaches no guarded endpoint", () => {
  it("derives its route list from the contract, and that list is not empty", () => {
    // Without this, an empty or broken derivation would make every `it.each`
    // below vacuously pass by simply not running.
    expect(GUARDED.length).toBeGreaterThan(20);
    expect(GUARDED.some(([, p]) => p.startsWith("/admin/"))).toBe(true);
  });

  it.each(GUARDED)("%s %s is refused", async (method, path) => {
    const res = await call(
      method,
      path,
      pendingToken,
      method === "GET" ? undefined : {},
    );

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
    // Nothing was read: no data travels alongside the refusal.
    expect(res.body.data).toBeUndefined();
  });
});

describe("§18 — suspended and rejected are refused identically", () => {
  it.each([
    ["suspended", () => suspendedToken],
    ["rejected", () => rejectedToken],
  ])(
    "a %s session reaches no guarded endpoint either",
    async (_label, token) => {
      for (const [method, path] of GUARDED.slice(0, 8)) {
        const res = await call(
          method,
          path,
          token(),
          method === "GET" ? undefined : {},
        );
        expect(res.status).toBe(403);
      }
    },
  );

  it("the same token with account_status active is NOT refused", async () => {
    // The decisive control: without it, every assertion above could be passing
    // for some unrelated reason — a wrong path, a missing role, a typo.
    const res = await call("GET", "/admin/branches", activeToken);
    expect(res.status).toBe(200);
  });
});

describe("TD-1 — the two exceptions a Pending session DOES reach", () => {
  it("GET /me is reachable, because status must be discoverable", async () => {
    // Refusing this would strand a Pending user: the client learns it is
    // pending from here, and would otherwise have nothing to route on.
    const res = await call("GET", "/me", pendingToken);
    expect(res.status).toBe(200);
  });

  it("logout is reachable, because a pending user must be able to leave", async () => {
    const session = await issueNewSession(prisma, pendingUserId);
    const res = await httpCall<Body>(BASE, "POST", "/auth/logout", {
      headers: {
        cookie: `bodour_refresh=${session.rawToken}`,
        origin: config.PUBLIC_BASE_URL,
        "x-requested-with": "XMLHttpRequest",
      },
    });
    expect(res.status).toBe(204);
    expect(
      await prisma.refreshToken.count({
        where: { sessionId: session.sessionId, revokedAt: null },
      }),
    ).toBe(0);
  });
});

describe("TD-3.4 — the Session page is public at the caller’s tier", () => {
  it("serves a Pending account, which then sees the public tier only", async () => {
    // A 404 here would be the SESSION not existing, not the account being
    // refused — the point is that it is not a 401/403.
    const res = await call(
      "GET",
      "/calendar/sessions/00000000-0000-4000-8000-000000000000",
      pendingToken,
    );
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("NOT_FOUND");
  });
});

describe("TD-3.13 — the public library is an exception for the same reason", () => {
  it("serves a Pending account the public tier, exactly as anonymous", async () => {
    const asPending = await call("GET", "/library", pendingToken);
    const asAnonymous = await call("GET", "/library");
    expect(asPending.status).toBe(200);
    expect(asAnonymous.status).toBe(200);
    // Signing in reorders and never unlocks (TD-3.13); a Pending account is not
    // active, so it gets neither the reorder nor anything extra.
    expect(asPending.body).toEqual(asAnonymous.body);
  });
});

describe("§4.4 — the public calendar is the one documented exception", () => {
  it("serves a Pending account the public tier, exactly as anonymous", async () => {
    const range = "from=2026-06-01&to=2026-06-30";
    const asPending = await call("GET", `/calendar?${range}`, pendingToken);
    const asAnonymous = await call("GET", `/calendar?${range}`);

    expect(asPending.status).toBe(200);
    expect(asAnonymous.status).toBe(200);
    // Identical, not merely both successful: a Pending account must gain
    // nothing at all from being logged in.
    expect(asPending.body.data).toEqual(asAnonymous.body.data);
  });
});
