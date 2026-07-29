import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * `GET /calendar` over real HTTP — the one public read (TD-3.4, §4.4).
 *
 * What only an HTTP test can show: that the route is genuinely reachable
 * **without a token**, that a Pending token is served rather than refused, and
 * that a malformed token is IGNORED rather than refused (Revision 34).
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[cal-http-test]';

interface Row {
  kind: string;
  title: string;
  date: string;
  start_time: string | null;
  visibility: string | null;
  hijri_date: string | null;
  hijri_month_ar: string | null;
}
interface Body {
  error?: { code?: string };
  data?: Row[];
}

const call = (path: string, token?: string) => httpCall<Body>(BASE, 'GET', path, { token });

const bearer = (userId: string, roles: string[], accountStatus = 'active'): string =>
  issueAccessToken(
    { userId, roleScopes: roles.map((role) => ({ role, branches: null })), accountStatus: accountStatus as never },
    config.JWT_SIGNING_KEY,
  ).token;

const mine = (b: Body): Row[] => (b.data ?? []).filter((r) => r.title.startsWith(TAG));

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

async function clear(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = events.map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.event.deleteMany({ where: { id: { in: ids } } });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.hijriMonthStart.deleteMany({ where: { hijriYear: 1447 } });
}

/** Events created directly: this suite tests the READ path, not creation. */
async function seedEvent(visibility: 'public' | 'private' | 'hidden'): Promise<void> {
  await prisma.event.create({
    data: {
      title: `${TAG} ${visibility}`,
      visibility: visibility as never,
      startDate: new Date('2026-06-15T00:00:00.000Z'),
      startTime: new Date(Date.UTC(1970, 0, 1, 14, 0)),
      recurrenceType: 'none' as never,
    },
  });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
});

beforeEach(async () => {
  await clear();
  await seedEvent('public');
  await seedEvent('private');
  await seedEvent('hidden');
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const RANGE = 'from=2026-06-01&to=2026-06-30';

describe('GET /calendar — public access', () => {
  it('is reachable with NO token and returns the public tier only', async () => {
    const res = await call(`/calendar?${RANGE}`);

    expect(res.status).toBe(200);
    const rows = mine(res.body);
    expect(rows.map((r) => r.visibility)).toEqual(['public']);
    // Wall-clock time survives the boundary (TD-11).
    expect(rows[0]!.start_time).toBe('14:00');
    // Revision 31: with no official month recorded, the overlay is absent
    // rather than computed. The Gregorian date still renders.
    expect(rows[0]!.date).toBe('2026-06-15');
    expect(rows[0]!.hijri_date).toBeNull();
    expect(rows[0]!.hijri_month_ar).toBeNull();
  });

  it('carries the official Hijri overlay once the month is published', async () => {
    // The officially announced Moroccan date: 1 Dhu al-Hijja 1447 = 18 May 2026.
    await prisma.hijriMonthStart.create({
      data: {
        hijriYear: 1447,
        hijriMonth: 12,
        gregorianStartDate: new Date('2026-05-18T00:00:00.000Z'),
        status: 'published',
      },
    });

    const rows = mine((await call(`/calendar?${RANGE}`)).body);

    expect(rows[0]!.hijri_date).toBe('1447-12-29');
    expect(rows[0]!.hijri_month_ar).toBe('ذو الحجة');
  });

  it('a PENDING token is served the public tier, not refused', async () => {
    // The guarded router rejects non-active accounts outright; §4.4 requires the
    // calendar to serve them the public tier instead.
    const pending = bearer(await person('قيد الموافقة'), ['student'], 'pending');
    const res = await call(`/calendar?${RANGE}`, pending);

    expect(res.status).toBe(200);
    expect(mine(res.body).map((r) => r.visibility)).toEqual(['public']);
  });

  it('an approved student adds the private tier but never hidden', async () => {
    const student = bearer(await person('طالبة'), ['student']);
    const rows = mine((await call(`/calendar?${RANGE}`, student)).body);

    expect(rows.map((r) => r.visibility).sort()).toEqual(['private', 'public']);
  });

  it('a Super Admin sees every tier', async () => {
    const su = bearer(await person('مشرف عام'), ['super_admin']);
    const rows = mine((await call(`/calendar?${RANGE}`, su)).body);

    expect(rows.map((r) => r.visibility).sort()).toEqual(['hidden', 'private', 'public']);
  });

  it('Revision 34: a token that does NOT verify is IGNORED, not refused', async () => {
    // A public endpoint never returns 401. The landing page (§5.1) renders this
    // calendar, so refusing a request that merely carries a stale token would
    // serve an error on a page with no login requirement — and a client
    // treating 401 as "redirect to login" would login-wall a public page.
    const corrupt = `${bearer(await person('س'), ['student'])}x`;
    const res = await call(`/calendar?${RANGE}`, corrupt);

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });

  it('an ignored credential yields EXACTLY the anonymous response', async () => {
    // Not merely "also 200": a credential that fails verification carries no
    // identity, so the caller must be indistinguishable from one who sent no
    // token at all. A richer tier leaking through would mean the token was
    // partly trusted.
    const student = await person('طالبة معتمدة');
    const expired = `${bearer(student, ['student'])}tampered`;

    const ignored = await call(`/calendar?${RANGE}`, expired);
    const anonymous = await call(`/calendar?${RANGE}`);

    expect(ignored.status).toBe(anonymous.status);
    expect(mine(ignored.body)).toEqual(mine(anonymous.body));
    // And specifically: the private tier a valid student token would have
    // unlocked is absent.
    expect(mine(ignored.body).every((r) => r.visibility === 'public')).toBe(true);
    expect(mine(ignored.body).length).toBeGreaterThan(0);
  });

  it('a garbage Authorization header is anonymous, not a 500', async () => {
    // The header is attacker-controllable, so every shape has to be survivable.
    for (const authorization of ['Bearer', 'Bearer ...', 'Basic abc', 'nonsense']) {
      const res = await httpCall<Body>(BASE, 'GET', `/calendar?${RANGE}`, {
        rawAuthorization: authorization,
      });
      expect(res.status, `Authorization: ${authorization}`).toBe(200);
    }
  });
});

describe('GET /calendar — query validation', () => {
  it('requires from and to as YYYY-MM-DD', async () => {
    expect((await call('/calendar')).status).toBe(400);
    expect((await call('/calendar?from=2026-06-01')).status).toBe(400);
    expect((await call('/calendar?from=01-06-2026&to=2026-06-30')).status).toBe(400);
  });

  it('refuses an inverted range and one longer than a year', async () => {
    expect((await call('/calendar?from=2026-06-30&to=2026-06-01')).status).toBe(400);
    expect((await call('/calendar?from=2026-01-01&to=2028-01-01')).status).toBe(400);
  });
});
