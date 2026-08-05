import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Recording the Ministry's official Hijri announcements over real HTTP — SRS
 * Revisions 31–32, §5.7.
 *
 * The service suite proves the invariants; this proves the **wiring**: paths,
 * the authenticate middleware, status codes, the `YYYY-MM-DD` boundary format
 * and the structured `details` a client receives.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[hijri-http-test]';

/** Inside TD-9's range, but no real date resolves against it. */
const YEAR = 1591;

interface Row {
  hijri_month: number;
  month_name_ar: string;
  gregorian_start_date: string | null;
  status: string | null;
  version: number | null;
}
interface Body {
  error?: { code?: string; details?: Record<string, unknown> };
  data?: Row[];
  year?: number;
  hijri_month?: number;
  gregorian_start_date?: string;
  status?: string;
  version?: number;
  published?: number;
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });

const bearer = (userId: string, roles: string[]): string =>
  issueAccessToken(
    { userId, roleScopes: roles.map((role) => ({ role, branches: null })), accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superToken: string;
let adminToken: string;

async function withRole(label: string, role: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  const r = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId: u.id, roleId: r!.id, branchId: null } });
  return u.id;
}

async function clear(): Promise<void> {
  await prisma.hijriMonthStart.deleteMany({ where: { hijriYear: { in: [YEAR - 1, YEAR, YEAR + 1] } } });
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
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
});

beforeEach(async () => {
  await clear();
  superToken = bearer(await withRole('مشرف عام', 'super_admin'), ['super_admin']);
  adminToken = bearer(await withRole('مسؤولة', 'admin'), ['admin']);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const recordMonth = (month: number, date: string, version?: number) =>
  call('PUT', `/admin/hijri-calendar/${YEAR}/${month}`, superToken, {
    gregorian_start_date: date,
    ...(version !== undefined ? { version } : {}),
  });

describe('GET /admin/hijri-calendar', () => {
  it('returns all twelve months of the requested year', async () => {
    await recordMonth(1, '2026-06-17');
    const res = await call('GET', `/admin/hijri-calendar?year=${YEAR}`, superToken);

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(YEAR);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.data![0]).toMatchObject({
      hijri_month: 1,
      month_name_ar: 'محرم',
      gregorian_start_date: '2026-06-17',
      status: 'draft',
    });
    // A month not yet announced is a blank to fill, not a missing row.
    expect(res.body.data![1]!.gregorian_start_date).toBeNull();
  });

  it('pins the EXACT wire shape of the envelope and of a month row', async () => {
    // `toMatchObject` above checks a subset, which is right for values and
    // wrong for the contract: it cannot see a field that is missing, and the
    // client's declared type had invented three names — `hijri_year`/`months`/
    // `hijri_month_ar` against the real `year`/`data`/`month_name_ar`. Nothing
    // failed, because `api<T>()` is an unchecked cast, so the mismatch surfaced
    // only in a browser: `data.months` was undefined, `.filter()` on it threw,
    // and the admin screen rendered blank white.
    //
    // The exact key set is the assertion that would have caught it.
    await recordMonth(1, '2026-06-17');
    const res = await call('GET', `/admin/hijri-calendar?year=${YEAR}`, superToken);

    expect(Object.keys(res.body).sort()).toEqual(['coverage', 'data', 'year']);
    // The coverage report (2026-08-05): the safeguard against a manually
    // maintained calendar running out in silence. Automation is impossible by
    // the nature of the source — Morocco declares months on actual moon
    // sighting — so the honest alternative is to make the gap loud.
    expect(Object.keys(res.body.coverage as object).sort()).toEqual([
      'days_remaining',
      'next_unrecorded',
      'published_through',
      'warning',
    ]);
    expect(Object.keys(res.body.data![0]!).sort()).toEqual([
      'gregorian_start_date',
      'hijri_month',
      'month_name_ar',
      'source',
      'status',
      'version',
    ]);
  });

  it('TD-2: an Admin is refused, and an anonymous caller gets the TD-3.8 envelope', async () => {
    expect((await call('GET', `/admin/hijri-calendar?year=${YEAR}`, adminToken)).status).toBe(403);

    const anon = await call('GET', `/admin/hijri-calendar?year=${YEAR}`);
    expect(anon.status).toBe(401);
    expect(anon.body.error?.code).toBe('AUTH_REQUIRED');
  });

  it('requires a year inside the TD-9 range', async () => {
    expect((await call('GET', '/admin/hijri-calendar', superToken)).status).toBe(400);
    // The likeliest data-entry slip: a Gregorian year typed into the Hijri field.
    expect((await call('GET', '/admin/hijri-calendar?year=2026', superToken)).status).toBe(400);
  });
});

describe('PUT /admin/hijri-calendar/{year}/{month}', () => {
  it('records a month start and returns it as YYYY-MM-DD', async () => {
    const res = await recordMonth(1, '2026-06-17');

    expect(res.status).toBe(200);
    // TD-11: a local calendar date at the boundary, never an ISO instant.
    expect(res.body.gregorian_start_date).toBe('2026-06-17');
    expect(res.body.status).toBe('draft');
  });

  it('TD-15: correcting requires the version, and a stale one is 409', async () => {
    const first = await recordMonth(1, '2026-06-17');
    const stale = first.body.version!;

    // No version at all on an existing month is a 400, not a silent overwrite.
    expect((await recordMonth(1, '2026-06-18')).status).toBe(400);

    expect((await recordMonth(1, '2026-06-18', stale)).status).toBe(200);
    const conflict = await recordMonth(1, '2026-06-19', stale);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe('VERSION_CONFLICT');
  });

  it('an out-of-order month is 400 with structured details', async () => {
    await recordMonth(1, '2026-06-17');
    const res = await recordMonth(2, '2026-06-01');

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
    expect(res.body.error?.details?.['reason']).toBe('MONTH_ORDER');
    expect(res.body.error?.details?.['conflicting_month']).toBe(1);
  });

  it('rejects a malformed date and an out-of-range month at the boundary', async () => {
    expect((await recordMonth(1, '17/06/2026')).status).toBe(400);
    expect((await recordMonth(13, '2026-06-17')).status).toBe(400);
    expect((await recordMonth(0, '2026-06-17')).status).toBe(400);
  });

  it('TD-2: an Admin cannot record a month', async () => {
    const res = await call('PUT', `/admin/hijri-calendar/${YEAR}/1`, adminToken, {
      gregorian_start_date: '2026-06-17',
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/hijri-calendar/{year}/publish', () => {
  it('publishes the year’s drafts and reports the count', async () => {
    await recordMonth(1, '2026-06-17');
    await recordMonth(2, '2026-07-16');

    const res = await call('POST', `/admin/hijri-calendar/${YEAR}/publish`, superToken);
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(2);

    const listed = await call('GET', `/admin/hijri-calendar?year=${YEAR}`, superToken);
    expect(listed.body.data![0]!.status).toBe('published');
  });

  it('publishing with nothing to publish is 409, not a silent success', async () => {
    await recordMonth(1, '2026-06-17');
    await call('POST', `/admin/hijri-calendar/${YEAR}/publish`, superToken);

    const again = await call('POST', `/admin/hijri-calendar/${YEAR}/publish`, superToken);
    expect(again.status).toBe(409);
    expect(again.body.error?.details?.['reason']).toBe('NOTHING_TO_PUBLISH');
  });
});

describe('GET /admin/hijri-calendar/{year}/history', () => {
  it('returns the audit trail carrying both the old and new date', async () => {
    const first = await recordMonth(1, '2026-06-17');
    await recordMonth(1, '2026-06-18', first.body.version!);

    const res = await call('GET', `/admin/hijri-calendar/${YEAR}/history`, superToken);
    expect(res.status).toBe(200);

    const latest = res.body.data![0] as unknown as { action_type: string; detail: Record<string, unknown> };
    expect(latest.action_type).toBe('hijri.month_start.record');
    expect(latest.detail['previous_start_date']).toBe('2026-06-17');
    expect(latest.detail['new_start_date']).toBe('2026-06-18');
  });
});
