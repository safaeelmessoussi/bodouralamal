import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

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
const TAG = '[http-branch-test]';

const BRANCH_KEYS = [
  'address',
  'display_order',
  'email',
  'google_maps_url',
  'id',
  'name',
  'opening_hours_ar',
  'operational_start_date',
  'phone',
  'version',
];
const ROOM_KEYS = ['branch_id', 'id', 'name', 'version'];

interface Res {
  status: number;
  body: Record<string, unknown> & { error?: { code?: string }; data?: Record<string, unknown>[] };
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  return httpCall<Res['body']>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });
}

async function makeStaff(role: string): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} ${role}`, accountStatus: 'active' },
  });
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow!.id, branchId: null },
  });
  return user.id;
}

function bearer(userId: string, roles: string[]): string {
  return issueAccessToken(
    { userId, roleScopes: roles.map((role) => ({ role, branches: null })), accountStatus: 'active' as never },
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
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: docker compose up -d --build api`,
    );
  }

  await clear();
  superAdmin = bearer(await makeStaff('super_admin'), ['super_admin', 'admin']);
  adminToken = bearer(await makeStaff('admin'), ['admin']);

  const created = await call('POST', '/admin/branches', superAdmin, {
    name: `${TAG} مقر`,
    operational_start_date: '2026-03-01',
    display_order: 1,
    address: 'شارع محمد السادس',
    phone: '+212524000000',
    email: 'branch@example.com',
    opening_hours_ar: 'الاثنين–الجمعة\n09:00–17:00',
    google_maps_url: 'https://maps.example.com/x',
  });
  branchId = created.body.id as string;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('branch responses are an explicit contract DTO (§16.2, Revision 38)', () => {
  it('POST returns exactly the documented keys, and no others', async () => {
    const res = await call('POST', '/admin/branches', superAdmin, { name: `${TAG} ثانٍ` });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(BRANCH_KEYS);
  });

  it('GET returns the same shape inside the TD-10 envelope', async () => {
    const res = await call('GET', '/admin/branches', superAdmin);
    expect(res.status).toBe(200);
    const row = res.body.data!.find((b) => b.id === branchId)!;
    expect(Object.keys(row).sort()).toEqual(BRANCH_KEYS);
  });

  it('PATCH returns the same shape, carrying the incremented version', async () => {
    const before = (await call('GET', '/admin/branches', superAdmin)).body.data!.find(
      (b) => b.id === branchId,
    )!;
    const res = await call('PATCH', `/admin/branches/${branchId}`, superAdmin, {
      name: `${TAG} مقر معدّل`,
      version: before.version,
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(BRANCH_KEYS);
    expect(res.body.version).toBe((before.version as number) + 1);
  });

  it('never exposes the internal columns, on any verb', async () => {
    // Named individually rather than inferred from the key set, so the failure
    // message says WHICH column leaked.
    const res = await call('GET', '/admin/branches', superAdmin);
    for (const row of res.body.data!) {
      for (const internal of ['created_at', 'updated_at', 'deleted_at', 'deleted_by']) {
        expect(row).not.toHaveProperty(internal);
      }
      // The camelCase originals, in case a future change reintroduces the row
      // spread rather than adding a field to the DTO.
      for (const camel of ['operationalStartDate', 'displayOrder', 'openingHoursAr', 'googleMapsUrl']) {
        expect(row).not.toHaveProperty(camel);
      }
    }
  });

  it('TD-11: operational_start_date is a calendar date, never an instant', async () => {
    // An instant here is what invites a client-side timezone conversion, which
    // is the exact class of bug TD-11 exists to prevent — a branch opening on
    // 1 March reading as 28 February one timezone west.
    const res = await call('GET', '/admin/branches', superAdmin);
    const row = res.body.data!.find((b) => b.id === branchId)!;
    expect(row.operational_start_date).toBe('2026-03-01');
  });

  it('preserves opening_hours_ar verbatim, newlines included (§7)', async () => {
    const res = await call('GET', '/admin/branches', superAdmin);
    const row = res.body.data!.find((b) => b.id === branchId)!;
    expect(row.opening_hours_ar).toBe('الاثنين–الجمعة\n09:00–17:00');
  });
});

describe('room responses are an explicit contract DTO', () => {
  it('POST, GET and PATCH all return exactly the documented keys', async () => {
    const created = await call('POST', `/admin/branches/${branchId}/rooms`, superAdmin, {
      name: `${TAG} قاعة`,
    });
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(ROOM_KEYS);
    expect(created.body.branch_id).toBe(branchId);

    const list = await call('GET', `/admin/branches/${branchId}/rooms`, superAdmin);
    expect(Object.keys(list.body.data![0]!).sort()).toEqual(ROOM_KEYS);

    const patched = await call('PATCH', `/admin/rooms/${created.body.id}`, superAdmin, {
      name: `${TAG} قاعة معدّلة`,
      version: created.body.version,
    });
    expect(Object.keys(patched.body).sort()).toEqual(ROOM_KEYS);
  });
});

describe('the routes are mounted and guarded (TD-2 Revision 26)', () => {
  it('an admin may READ branches but not write them', async () => {
    expect((await call('GET', '/admin/branches', adminToken)).status).toBe(200);

    const denied = await call('POST', '/admin/branches', adminToken, { name: `${TAG} مرفوض` });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe('FORBIDDEN');
  });

  it('refuses an anonymous caller with the TD-3.8 envelope', async () => {
    const res = await call('GET', '/admin/branches');
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('AUTH_REQUIRED');
  });

  it('TD-15: a stale version is a 409, not a silent overwrite', async () => {
    const row = (await call('GET', '/admin/branches', superAdmin)).body.data!.find(
      (b) => b.id === branchId,
    )!;
    const stale = (row.version as number) - 1;
    const res = await call('PATCH', `/admin/branches/${branchId}`, superAdmin, {
      name: `${TAG} تعارض`,
      version: stale,
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('VERSION_CONFLICT');
  });
});
