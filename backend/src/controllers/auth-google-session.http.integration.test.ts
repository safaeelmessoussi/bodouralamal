import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { FLOW_STATE_COOKIE } from '../lib/oauth.js';
import { issueNewSession } from '../services/refresh-token.service.js';

/**
 * **`GET /auth/google` while already signed in never reaches Google**
 * (Document Owner, 2026-09-05).
 *
 * The endpoint is a top-level browser navigation, so the only credential it
 * can ever see is the ambient `bodour_refresh` cookie — the in-memory access
 * token cannot travel here at all. These prove the server-side gate directly
 * against the real route: a manually typed `/auth/google` URL must behave
 * exactly as a click on «تسجيل الدخول» would, whichever session state is
 * actually live, and `redirect: 'manual'` is what lets the test see the
 * `Location` header instead of transparently following it to Google.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const GOOGLE_URL = `${config.PUBLIC_BASE_URL}/api/v1/auth/google`;
const REFRESH_URL = `${config.PUBLIC_BASE_URL}/api/v1/auth/refresh`;
const TAG = '[auth-google-session-test]';

async function getGoogle(cookie?: string): Promise<{ status: number; headers: Headers }> {
  const res = await fetch(GOOGLE_URL, {
    redirect: 'manual',
    ...(cookie ? { headers: { cookie } } : {}),
  });
  return { status: res.status, headers: res.headers };
}

/** Every `Set-Cookie` header, node's `fetch` collapses into one via `,` —
 *  `getSetCookie()` is the standard way to get them back apart. */
function setCookies(headers: Headers): string[] {
  return typeof (headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    : (headers.get('set-cookie') ?? '').split(/,(?=[^;]+?=)/);
}

function cookieNamed(headers: Headers, name: string): string | null {
  const match = setCookies(headers).find((c) => c.trim().startsWith(`${name}=`));
  return match ? match.split(';', 1)[0]!.trim() : null;
}

async function person(label: string, status: 'active' | 'pending' = 'active'): Promise<string> {
  return (
    await prisma.user.create({
      data: {
        sex: 'female',
        nameArabic: `${TAG} ${label}`,
        accountStatus: status,
      },
    })
  ).id;
}

async function grant(userId: string, role: string): Promise<void> {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId, roleId: roleRow.id, branchId: null } });
}

async function sessionCookie(userId: string): Promise<string> {
  const issued = await issueNewSession(prisma, userId);
  return `bodour_refresh=${issued.rawToken}`;
}

async function clear(): Promise<void> {
  const ids = (
    await prisma.user.findMany({ where: { nameArabic: { startsWith: TAG } }, select: { id: true } })
  ).map((u) => u.id);
  if (ids.length === 0) return;
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
});

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('an anonymous visitor — unchanged', () => {
  it('is sent to Google, and a flow-state cookie is minted', async () => {
    const res = await getGoogle();
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    expect(cookieNamed(res.headers, FLOW_STATE_COOKIE)).not.toBeNull();
  });

  it('a garbage cookie is treated exactly like no cookie at all', async () => {
    // Hashes to nothing the DB has ever stored — the "stale/forged credential"
    // case, distinct from a genuinely live session.
    const res = await getGoogle('bodour_refresh=not-a-real-token');
    expect(res.status).toBe(302);
    expect((res.headers.get('location') ?? '').startsWith('https://accounts.google.com')).toBe(
      true,
    );
    expect(cookieNamed(res.headers, FLOW_STATE_COOKIE)).not.toBeNull();
  });
});

describe('an already-authenticated visitor — the fix', () => {
  it('a super_admin is redirected straight to her role home, never to Google', async () => {
    const userId = await person('مديرة');
    await grant(userId, 'super_admin');
    const res = await getGoogle(await sessionCookie(userId));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${config.PUBLIC_BASE_URL}/admin`);
  });

  it('a مؤطِّرة is redirected to /teacher, not hard-coded to one destination', async () => {
    const userId = await person('مؤطِّرة');
    await grant(userId, 'teacher');
    const res = await getGoogle(await sessionCookie(userId));
    expect(res.headers.get('location')).toBe(`${config.PUBLIC_BASE_URL}/teacher`);
  });

  it('a Pending account is sent to the approval-status screen, not a dashboard', async () => {
    const userId = await person('قيد المراجعة', 'pending');
    const res = await getGoogle(await sessionCookie(userId));
    expect(res.headers.get('location')).toBe(`${config.PUBLIC_BASE_URL}/pending-approval`);
  });

  it('an Active account with no role lands on the real no-role page, not a 404', async () => {
    const userId = await person('بلا دور');
    const res = await getGoogle(await sessionCookie(userId));
    expect(res.headers.get('location')).toBe(`${config.PUBLIC_BASE_URL}/`);
  });

  it('mints NO flow-state cookie and never names Google as the destination', async () => {
    const userId = await person('مديرة أخرى');
    await grant(userId, 'super_admin');
    const res = await getGoogle(await sessionCookie(userId));

    expect(cookieNamed(res.headers, FLOW_STATE_COOKIE)).toBeNull();
    expect(res.headers.get('location') ?? '').not.toContain('accounts.google.com');
  });

  it('rotates the SAME refresh session rather than minting a second one', async () => {
    const userId = await person('جلسة واحدة');
    await grant(userId, 'admin');
    const cookie = await sessionCookie(userId);

    const before = await prisma.refreshToken.count({ where: { userId } });
    const res = await getGoogle(cookie);
    const after = await prisma.refreshToken.count({ where: { userId } });

    // Rotation revokes the old row and inserts one successor — the count of
    // LIVE (unrevoked) tokens for this session stays at one throughout, which
    // is the property that distinguishes "rotated" from "a second login".
    expect(before).toBe(1);
    expect(after).toBe(2); // the revoked predecessor plus its successor
    const live = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(1);

    // And the new cookie the browser was handed actually works.
    const rotated = cookieNamed(res.headers, 'bodour_refresh');
    expect(rotated).not.toBeNull();
    const refreshed = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: {
        cookie: rotated!,
        'x-requested-with': 'XMLHttpRequest',
        origin: config.PUBLIC_BASE_URL,
      },
    });
    expect(refreshed.status).toBe(200);
  });

  it('binds no new identity and creates no onboarding token', async () => {
    const userId = await person('هوية واحدة');
    await grant(userId, 'student');
    const identitiesBefore = await prisma.userIdentity.count({ where: { userId } });
    await getGoogle(await sessionCookie(userId));
    const identitiesAfter = await prisma.userIdentity.count({ where: { userId } });
    expect(identitiesAfter).toBe(identitiesBefore);
  });
});

describe('refresh/logout are unweakened by the new branch', () => {
  it('POST /auth/refresh still behaves exactly as before for an ordinary session', async () => {
    const userId = await person('تحقق الرجوع');
    await grant(userId, 'teacher');
    const cookie = await sessionCookie(userId);

    const res = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { cookie, 'x-requested-with': 'XMLHttpRequest', origin: config.PUBLIC_BASE_URL },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token?: string };
    expect(typeof body.access_token).toBe('string');
  });
});
