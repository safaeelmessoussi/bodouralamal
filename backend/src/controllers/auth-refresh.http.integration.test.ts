import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  hashToken,
  issueNewSession,
} from "../services/refresh-token.service.js";

/**
 * `POST /auth/refresh` and `POST /auth/logout` — R101's two permitted
 * refresh-cookie consumers and their shared CSRF posture.
 *
 * These are the only endpoints a cross-site page could invoke with the
 * victim's ambient refresh credential, so their three defences — a custom
 * header no cross-site form can set, an Origin that must match ours, and
 * `SameSite=Lax` — are the whole reason another origin cannot rotate or revoke
 * the browser's session.
 *
 * None of them is exercised by the service-level rotation tests, because those
 * never travel over HTTP. Removing any one would leave every other test green.
 *
 * `fetch` is used directly rather than the shared client: these assertions are
 * about headers and cookies, which a helper would normalise away.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const REFRESH_URL = `${config.PUBLIC_BASE_URL}/api/v1/auth/refresh`;
const LOGOUT_URL = `${config.PUBLIC_BASE_URL}/api/v1/auth/logout`;
const TAG = "[refresh-csrf-test]";

let cookie: string;
let userId: string;
let sessionId: string;

interface Envelope {
  error?: { code?: string };
  access_token?: string;
}

async function post(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: Envelope; headers: Headers }> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    redirect: "manual",
  });
  const body = (await res.json().catch(() => ({}))) as Envelope;
  return { status: res.status, body, headers: res.headers };
}

const postRefresh = (headers: Record<string, string>) =>
  post(REFRESH_URL, headers);
const postLogout = (headers: Record<string, string>) =>
  post(LOGOUT_URL, headers);

function cookieFrom(setCookie: string): string {
  const pair = setCookie.split(";", 1)[0];
  if (!pair?.startsWith("bodour_refresh=")) {
    throw new Error(`response did not set the refresh cookie: ${setCookie}`);
  }
  return pair;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
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
  sessionId = issued.sessionId;
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
    const res = await postRefresh({
      cookie,
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
  });

  it("refuses a request with NO custom header — the cross-site form case", async () => {
    // A cross-site <form> can carry cookies but cannot set this header.
    const res = await postRefresh({ cookie, origin: config.PUBLIC_BASE_URL });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
    expect(res.body.access_token).toBeUndefined();
  });

  it("refuses a header with the wrong value, not merely a missing one", async () => {
    const res = await postRefresh({
      cookie,
      "x-requested-with": "fetch",
      origin: config.PUBLIC_BASE_URL,
    });
    expect(res.status).toBe(401);
  });

  it("refuses a foreign Origin even with the custom header present", async () => {
    const res = await postRefresh({
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
    const res = await postRefresh({ cookie, "x-requested-with": XHR });
    expect(res.status).toBe(200);
  });

  it("refuses when the cookie is absent, and does not mint anything", async () => {
    const res = await postRefresh({
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });

    expect(res.status).toBe(401);
    expect(res.body.access_token).toBeUndefined();
  });

  it("refuses a forged cookie value indistinguishably from a missing one", async () => {
    // TD-12/Revision 16: telling a stolen cookie *why* it failed would confirm
    // it was once real.
    const forged = await postRefresh({
      cookie: "bodour_refresh=not-a-real-token",
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    const absent = await postRefresh({
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });

    expect(forged.status).toBe(absent.status);
    expect(forged.body.error?.code).toBe(absent.body.error?.code);
  });

  it("the CSRF check runs BEFORE the cookie is even looked at", async () => {
    // Order matters: a cross-site probe must not be able to learn whether a
    // cookie was valid by comparing responses.
    const noHeaderValidCookie = await postRefresh({
      cookie,
      origin: config.PUBLIC_BASE_URL,
    });
    const noHeaderNoCookie = await postRefresh({ origin: config.PUBLIC_BASE_URL });

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

describe("logout ends the server-side session (R101)", () => {
  it("refreshes, logs out through the auth-path cookie, rejects a retained copy, and preserves another device", async () => {
    const otherDevice = await issueNewSession(prisma, userId);

    // Establish the exact credential the browser holds immediately before
    // logout: refresh rotates the setup token and returns its successor.
    const refreshed = await postRefresh({
      cookie,
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    expect(refreshed.status).toBe(200);
    const issuedHeader = refreshed.headers.get("set-cookie");
    expect(issuedHeader).toContain("Path=/api/v1/auth");
    expect(issuedHeader).toContain("SameSite=Lax");
    expect(issuedHeader).toContain("HttpOnly");
    expect(issuedHeader).toContain("Secure");
    const retained = cookieFrom(issuedHeader!);

    const loggedOut = await postLogout({
      cookie: retained,
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers.get("set-cookie")).toContain(
      "bodour_refresh=; Max-Age=0; Path=/api/v1/auth; SameSite=Lax; HttpOnly; Secure",
    );

    // Clearing a browser cookie is not the security property. The persisted
    // rotation chain itself must be dead.
    expect(
      await prisma.refreshToken.count({
        where: { sessionId, revokedAt: null },
      }),
    ).toBe(0);
    const current = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(retained.slice("bodour_refresh=".length)) },
    });
    expect(current?.revokedReason).toBe("logout");

    const logoutAudit = await prisma.auditLog.findFirst({
      where: {
        actorUserId: userId,
        actionType: "auth.logout",
        detail: { path: ["session_ids"], array_contains: [sessionId] },
      },
    });
    expect(logoutAudit).not.toBeNull();

    // The credential that preceded the browser's current cookie is still
    // inside the normal ten-second grace window. Ending the session must close
    // that window as well; otherwise logout could be undone immediately.
    const retainedPredecessor = await postRefresh({
      cookie,
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    expect(retainedPredecessor.status).toBe(401);
    expect(retainedPredecessor.body.error?.code).toBe("AUTH_REQUIRED");

    const retainedAttempt = await postRefresh({
      cookie: retained,
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    expect(retainedAttempt.status).toBe(401);
    expect(retainedAttempt.body.error?.code).toBe("AUTH_REQUIRED");

    const unrelated = await postRefresh({
      cookie: `bodour_refresh=${otherDevice.rawToken}`,
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    expect(unrelated.status).toBe(200);

    // A real browser has removed the cookie by now. Repeating the action with
    // no credential remains a successful no-op.
    const repeated = await postLogout({
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    expect(repeated.status).toBe(204);
  });

  it("clears an unknown cookie and remains idempotent without leaking validity", async () => {
    const forged = await postLogout({
      cookie: "bodour_refresh=not-a-real-token",
      "x-requested-with": XHR,
      origin: config.PUBLIC_BASE_URL,
    });
    expect(forged.status).toBe(204);
    expect(forged.headers.get("set-cookie")).toContain(
      "bodour_refresh=; Max-Age=0; Path=/api/v1/auth",
    );
  });

  it("applies the CSRF check before reading or revoking the logout cookie", async () => {
    const missingHeader = await postLogout({
      cookie,
      origin: config.PUBLIC_BASE_URL,
    });
    const foreignOrigin = await postLogout({
      cookie,
      "x-requested-with": XHR,
      origin: "https://evil.example.com",
    });

    expect(missingHeader.status).toBe(401);
    expect(foreignOrigin.status).toBe(401);
    expect(
      await prisma.refreshToken.count({
        where: { sessionId, revokedAt: null },
      }),
    ).toBe(1);
  });
});
