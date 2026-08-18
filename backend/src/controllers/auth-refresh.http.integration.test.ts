import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { issueNewSession } from "../services/refresh-token.service.js";

/**
 * `POST /auth/refresh` — the CSRF posture of TD-12's **sole cookie-authenticated
 * route**; §18 *"refresh endpoint requires custom header + Origin check"*.
 *
 * This is the one endpoint a cross-site page could invoke with the victim's
 * ambient credentials, so its three defences — a custom header no cross-site
 * form can set, an Origin that must match ours, and `SameSite=Lax` — are the
 * whole reason a stolen session cannot be minted from another origin.
 *
 * None of them is exercised by the service-level rotation tests, because those
 * never travel over HTTP. Removing any one would leave every other test green.
 *
 * `fetch` is used directly rather than the shared client: these assertions are
 * about headers and cookies, which a helper would normalise away.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const URL_ = `${config.PUBLIC_BASE_URL}/api/v1/auth/refresh`;
const TAG = "[refresh-csrf-test]";

let cookie: string;
let userId: string;

interface Envelope {
  error?: { code?: string };
  access_token?: string;
}

async function post(
  headers: Record<string, string>,
): Promise<{ status: number; body: Envelope }> {
  const res = await fetch(URL_, {
    method: "POST",
    headers,
    redirect: "manual",
  });
  const body = (await res.json().catch(() => ({}))) as Envelope;
  return { status: res.status, body };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
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
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} مستخدمة`,
      accountStatus: "active",
    },
  });
  userId = user.id;
  const issued = await issueNewSession(prisma, userId);
  cookie = `bodour_refresh=${issued.rawToken}`;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const XHR = "XMLHttpRequest";

describe("the CSRF posture (TD-12)", () => {
  it("accepts a well-formed request and returns a fresh access token", async () => {
    // The control: everything below must fail for its own reason, not because
    // the happy path was broken.
    const res = await post({
      cookie,
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
  });

  it("refuses a request with NO custom header — the cross-site form case", async () => {
    // A cross-site <form> can carry cookies but cannot set this header.
    const res = await post({ cookie, origin: config.PUBLIC_BASE_URL });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
    expect(res.body.access_token).toBeUndefined();
  });

  it("refuses a header with the wrong value, not merely a missing one", async () => {
    const res = await post({
      cookie,
      "x-requested-with": "fetch",
      origin: config.PUBLIC_BASE_URL,
    });
    expect(res.status).toBe(401);
  });

  it("refuses a foreign Origin even with the custom header present", async () => {
    const res = await post({
      cookie,
      "x-requested-with": XHR,
      origin: "https://evil.example.com",
    });

    expect(res.status).toBe(401);
    expect(res.body.access_token).toBeUndefined();
  });

  it("allows an ABSENT Origin, which same-origin XHR may omit", async () => {
    // Deliberate: requiring it would break legitimate same-origin callers, and
    // the custom header already carries the cross-site protection.
    const res = await post({ cookie, "x-requested-with": XHR });
    expect(res.status).toBe(200);
  });

  it("refuses when the cookie is absent, and does not mint anything", async () => {
    const res = await post({
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });

    expect(res.status).toBe(401);
    expect(res.body.access_token).toBeUndefined();
  });

  it("refuses a forged cookie value indistinguishably from a missing one", async () => {
    // TD-12/Revision 16: telling a stolen cookie *why* it failed would confirm
    // it was once real.
    const forged = await post({
      cookie: "bodour_refresh=not-a-real-token",
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    const absent = await post({
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });

    expect(forged.status).toBe(absent.status);
    expect(forged.body.error?.code).toBe(absent.body.error?.code);
  });

  it("the CSRF check runs BEFORE the cookie is even looked at", async () => {
    // Order matters: a cross-site probe must not be able to learn whether a
    // cookie was valid by comparing responses.
    const noHeaderValidCookie = await post({
      cookie,
      origin: config.PUBLIC_BASE_URL,
    });
    const noHeaderNoCookie = await post({ origin: config.PUBLIC_BASE_URL });

    expect(noHeaderValidCookie.status).toBe(noHeaderNoCookie.status);
    expect(noHeaderValidCookie.body.error?.code).toBe(
      noHeaderNoCookie.body.error?.code,
    );

    // And a refused CSRF probe must not consume or revoke the real token.
    // Asserted against the row rather than by refreshing again: the auth
    // endpoints are rate-limited, and spending a request here would make this
    // test's outcome depend on how many the ones above happened to use.
    const live = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    expect(live).toBe(1);
  });
});
