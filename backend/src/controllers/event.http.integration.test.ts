import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Event routes over real HTTP (TD-3.4, §4.4).
 *
 * Proves the wiring the service tests cannot see: paths, the `YYYY-MM-DD` /
 * `HH:MM` boundary formats (TD-11), and that the response reports what was
 * actually attached rather than what was requested.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[event-http-test]';

interface Body {
  error?: { code?: string };
  data?: { id: string }[];
  id?: string;
  attached?: { branches: number; groups: number };
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });

const bearer = (userId: string, roles: string[]): string =>
  issueAccessToken(
    { userId, roleScopes: roles.map((role) => ({ role, branches: null })), accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superToken: string;
let parentToken: string;

async function withRole(label: string, role: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  const r = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId: u.id, roleId: r!.id, branchId: null } });
  return u.id;
}

/** Past date = already operational; future = not yet open (§4.4). */
async function makeBranch(name: string, opened = '2020-01-01'): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: new Date(`${opened}T00:00:00.000Z`) },
  });
  return b.id;
}

async function clear(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = events.map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.eventGroup.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.event.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: ids } }] },
  });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
});

beforeEach(async () => {
  await clear();
  superToken = bearer(await withRole('مشرف عام', 'super_admin'), ['super_admin']);
  parentToken = bearer(await withRole('والدة', 'parent'), ['parent']);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const payload = (over: Record<string, unknown> = {}) => ({
  title: `${TAG} نشاط`,
  visibility: 'private',
  start_date: '2026-06-15',
  recurrence_type: 'none',
  ...over,
});

describe('POST /events', () => {
  it('creates an event and reports what was ACTUALLY attached', async () => {
    const open = await makeBranch('مراكش');
    const future = await makeBranch('أكادير', '2099-01-01');

    const res = await call('POST', '/events', superToken, payload({ branch_ids: [open, future] }));

    expect(res.status).toBe(201);
    // Two branches requested, one attached: §4.4 excludes the future-opening one.
    expect(res.body.attached?.branches).toBe(1);
  });

  it('refuses an anonymous caller', async () => {
    const res = await call('POST', '/events', undefined, payload());
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('AUTH_REQUIRED');
  });

  it('TD-2: a parent cannot schedule', async () => {
    expect((await call('POST', '/events', parentToken, payload({ global: true }))).status).toBe(403);
  });

  it('validates the boundary date and time formats (TD-11)', async () => {
    const branchId = await makeBranch('مراكش');
    expect(
      (await call('POST', '/events', superToken, payload({ branch_ids: [branchId], start_date: '15/06/2026' }))).status,
    ).toBe(400);
    expect(
      (await call('POST', '/events', superToken, payload({ branch_ids: [branchId], start_time: '9am' }))).status,
    ).toBe(400);
  });

  it('refuses a recurring event with no end date', async () => {
    const branchId = await makeBranch('مراكش');
    const res = await call('POST', '/events', superToken,
      payload({ branch_ids: [branchId], recurrence_type: 'weekly' }));
    expect(res.status).toBe(400);
  });

  it('accepts biweekly-alternating with an end date', async () => {
    const branchId = await makeBranch('مراكش');
    const res = await call('POST', '/events', superToken, payload({
      branch_ids: [branchId],
      recurrence_type: 'biweekly_alternating',
      recurrence_end_date: '2026-12-31',
    }));
    expect(res.status).toBe(201);
  });
});

describe('DELETE /events/{id} and the backfill endpoints', () => {
  it('deletes an event and removes its scope rows (TD-5)', async () => {
    const branchId = await makeBranch('مراكش');
    const created = await call('POST', '/events', superToken, payload({ branch_ids: [branchId] }));

    expect((await call('DELETE', `/events/${created.body.id}`, superToken)).status).toBe(204);
    expect(await prisma.eventBranch.count({ where: { eventId: created.body.id! } })).toBe(0);
  });

  it('lists then attaches backfill candidates, idempotently', async () => {
    await makeBranch('مراكش');
    const created = await call('POST', '/events', superToken, payload({ global: true }));
    const late = await makeBranch('أكادير', '2099-01-01');

    const candidates = await call('GET', `/admin/branches/${late}/event-backfill`, superToken);
    expect(candidates.status).toBe(200);
    expect(candidates.body.data!.map((e) => e.id)).toContain(created.body.id);

    const first = await call('POST', `/admin/branches/${late}/event-backfill`, superToken, {
      event_ids: [created.body.id],
    });
    expect(first.status).toBe(200);

    // Retrying must not duplicate scope rows.
    await call('POST', `/admin/branches/${late}/event-backfill`, superToken, {
      event_ids: [created.body.id],
    });
    expect(
      await prisma.eventBranch.count({ where: { eventId: created.body.id!, branchId: late } }),
    ).toBe(1);
  });

  it('backfill requires a non-empty event list', async () => {
    const branchId = await makeBranch('مراكش');
    expect(
      (await call('POST', `/admin/branches/${branchId}/event-backfill`, superToken, { event_ids: [] })).status,
    ).toBe(400);
  });
});
