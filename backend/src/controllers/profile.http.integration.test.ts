import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * `GET`/`PATCH /profile` — the personal section (SRS Revision 65).
 *
 * **The property that matters is role-independence**, so the cases here are
 * deliberately run as a *teacher who is nobody's student*: the Owner's own
 * example, and the account R64's role-shaped page had locked out. If this
 * suite ever needs a student or a parent to pass, the model has regressed.
 *
 * The second property is the narrow write surface: §5.2 permits *basic contact
 * info*, and a request naming a name, a sex or a status must be **refused**,
 * not silently ignored.
 *
 * Requires the compose stack, with the api image built from current source.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-profile-test]';

interface Body {
  error?: { code?: string };
  id?: string;
  name_arabic?: string;
  nickname?: string | null;
  phone?: string | null;
  email?: string | null;
  sex?: string | null;
  account_status?: string;
  reference_code?: string | null;
  version?: number;
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });

const bearer = (userId: string, roles: string[]): string =>
  issueAccessToken(
    {
      userId,
      roleScopes: roles.map((role) => ({ role, branches: null })),
      accountStatus: 'active' as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;

/** A مؤطِّرة: staff, and nobody's student or parent. */
let teacherId = '';
let teacher = '';

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: docker compose up -d --build api`,
    );
  }
  await clear();
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} مؤطِّرة`,
      accountStatus: 'active',
      phone: '+212 600 000 001',
      sex: 'female',
    },
  });
  teacherId = user.id;
  const role = await prisma.role.findUnique({ where: { name: 'teacher' } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: role!.id, branchId: null },
  });
  teacher = bearer(user.id, ['teacher']);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('GET /profile — role-independent by construction', () => {
  it('answers a TEACHER who is nobody’s student or parent', async () => {
    // The account R64's `/dashboard/student/register-child` had locked out.
    const res = await call('GET', '/profile', teacher);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(teacherId);
    expect(res.body.name_arabic).toBe(`${TAG} مؤطِّرة`);
    expect(res.body.phone).toBe('+212 600 000 001');
    // TD-15 — the caller cannot edit without it.
    expect(typeof res.body.version).toBe('number');
  });

  it('carries the person, not the session — no roles, no scopes, no child links', async () => {
    // `/me` answers *which account is this*; this answers *who is behind it*
    // (R63, R65). Conflating them is how one of the two grows into the other.
    const res = await call('GET', '/profile', teacher);
    const keys = Object.keys(res.body as object);
    expect(keys).not.toContain('roles');
    expect(keys).not.toContain('role_scopes');
    expect(keys).not.toContain('approved_child_links');
  });

  it('is behind authentication', async () => {
    expect((await call('GET', '/profile')).status).toBe(401);
  });
});

describe('PATCH /profile — §5.2 basic contact info, and nothing else', () => {
  it('updates the two fields a person owns', async () => {
    const before = await call('GET', '/profile', teacher);
    const res = await call('PATCH', '/profile', teacher, {
      phone: '+212 600 111 222',
      nickname: 'أم مريم',
      version: before.body.version,
    });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('+212 600 111 222');
    expect(res.body.nickname).toBe('أم مريم');
    // TD-15: the version moves, so a replayed edit is refused.
    expect(res.body.version).toBe(before.body.version! + 1);
  });

  it('REFUSES a name, a sex or a status — not ignored, refused', async () => {
    // A silently dropped field would let a client believe it had renamed
    // someone. Each of these is excluded for its own reason: the name is
    // identity, `sex` feeds §4.4b's admission rule, and the status is a
    // decision an approver takes.
    const current = await call('GET', '/profile', teacher);
    for (const forbidden of [
      { name_arabic: 'اسم آخر' },
      { sex: 'male' },
      { account_status: 'active' },
      { email: 'other@example.com' },
    ]) {
      const res = await call('PATCH', '/profile', teacher, {
        ...forbidden,
        version: current.body.version,
      });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_FAILED');
    }
    // …and the record is untouched by any of them.
    const after = await call('GET', '/profile', teacher);
    expect(after.body.name_arabic).toBe(`${TAG} مؤطِّرة`);
    expect(after.body.sex).toBe('female');
  });

  it('refuses a stale version (TD-15)', async () => {
    const current = await call('GET', '/profile', teacher);
    const stale = current.body.version! - 1;
    const res = await call('PATCH', '/profile', teacher, { nickname: 'أخرى', version: stale });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('VERSION_CONFLICT');
  });

  it('records WHICH fields changed and never their values (§14, TD-8)', async () => {
    const current = await call('GET', '/profile', teacher);
    await call('PATCH', '/profile', teacher, { phone: '+212 600 999 888', version: current.body.version });
    const row = await prisma.auditLog.findFirst({
      where: { actorUserId: teacherId, actionType: 'user.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    // A phone number in an audit row is personal data in a log.
    expect(JSON.stringify(row?.detail)).not.toContain('600 999 888');
    expect(JSON.stringify(row?.detail)).toContain('phone');
  });
});
