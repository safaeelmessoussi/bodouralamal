import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * **The Active Role, over real HTTP** (SRS Revision 60).
 *
 * The claim R60 makes is that a Super Admin working as مؤطِّرة *genuinely loses
 * Super Admin authority*. That is not observable from a unit test of the token,
 * from a narrowed array, or from a screen: it is observable only by asking the
 * running server to do something Super-Admin-only and being refused — **by the
 * same account, in the same session, that succeeds a moment later**.
 *
 * Every case below therefore uses one account holding several roles, and the
 * difference between success and refusal is nothing but which role it is
 * working as.
 *
 * The framing R60.0 records applies throughout: this is a **safety** mechanism.
 * Switching back is one call, so none of these tests claims containment.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[active-role-test]';

interface Body {
  error?: { code?: string; details?: Record<string, unknown> };
  access_token?: string;
  active_role?: string | null;
  roles?: string[];
  data?: Record<string, unknown>[];
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });

/** A token exactly as the platform mints it for an un-narrowed session. */
const tokenFor = (userId: string, roles: string[]): string =>
  issueAccessToken(
    {
      userId,
      roleScopes: roles.map((role) => ({ role, branches: null })),
      accountStatus: 'active' as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;

let multiRole = '';
let multiToken = '';
let branchId = '';

async function grant(userId: string, role: string, branch: string | null = null): Promise<void> {
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId, roleId: roleRow!.id, branchId: branch },
  });
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // **TD-4.6d backfills `المجموعة 1` for every Level when a branch is created**,
  // and those groups reference the branch under RESTRICT. The audit test creates
  // a branch through the API, so teardown has to unwind the backfill — otherwise
  // the run that created it passes and the NEXT run fails in `beforeEach`, which
  // is how this surfaced.
  const branches = await prisma.branch.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const branchIds = branches.map((b) => b.id);
  await prisma.administrativeGroup.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        'docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api',
    );
  }
});

beforeEach(async () => {
  await clear();
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;

  // ONE account, four roles. Every assertion below is about this person.
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} متعددة الأدوار`, accountStatus: 'active' },
  });
  multiRole = user.id;
  await grant(multiRole, 'super_admin');
  await grant(multiRole, 'admin', branchId);
  await grant(multiRole, 'teacher');
  await grant(multiRole, 'parent');
  multiToken = tokenFor(multiRole, ['super_admin', 'admin', 'teacher', 'parent']);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

async function switchTo(role: string, token = multiToken): Promise<Body & { status: number }> {
  const res = await call('POST', '/auth/switch-role', token, { role });
  return { ...res.body, status: res.status };
}

describe('switching to a role the account holds', () => {
  it('returns a token narrowed to it, and says which role was granted', async () => {
    const res = await switchTo('teacher');

    expect(res.status).toBe(200);
    expect(res.active_role).toBe('teacher');

    // The narrowing is IN the token, which is what makes every downstream check
    // correct without knowing this endpoint exists.
    const claims = JSON.parse(
      Buffer.from(res.access_token!.split('.')[1]!, 'base64url').toString(),
    ) as { roles: string[]; role_scopes: unknown[]; active_role: string };
    expect(claims.roles).toEqual(['teacher']);
    expect(claims.role_scopes).toHaveLength(1);
    expect(claims.active_role).toBe('teacher');
  });

  it('REFUSES a role the account does not hold', async () => {
    // The invariant of §60.2, at the only place a claim can be created.
    const student = await switchTo('student');
    expect(student.status).toBe(403);
    expect(student.error?.details?.['reason']).toBe('ROLE_NOT_ASSIGNED');

    const invented = await switchTo('wizard');
    expect(invented.status).toBe(403);
  });

  it('records the switch with both ends of the move', async () => {
    await switchTo('teacher');
    const row = await prisma.auditLog.findFirst({
      where: { actorUserId: multiRole, actionType: 'auth.role_switch' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.detail).toMatchObject({ from: null, to: 'teacher' });
  });
});

describe('a Super Admin working as مؤطِّرة genuinely loses Super Admin', () => {
  /** The Trash is Super Admin only AND TD-12 fresh — the strongest case. */
  it('is refused the Trash while acting as teacher, and allowed after switching back', async () => {
    // Un-narrowed: this account really is a Super Admin.
    expect((await call('GET', '/admin/trash', multiToken)).status).toBe(200);

    const asTeacher = await switchTo('teacher');
    expect((await call('GET', '/admin/trash', asTeacher.access_token)).status).toBe(403);

    // **Same account, same session, one call apart.** This is the whole feature.
    const back = await switchTo('super_admin', asTeacher.access_token!);
    expect(back.status).toBe(200);
    expect((await call('GET', '/admin/trash', back.access_token)).status).toBe(200);
  });

  it('loses Super-Admin-only WRITES, not merely reads', async () => {
    const asTeacher = await switchTo('teacher');
    // Reference data is Super Admin only to write (R26).
    const res = await call('POST', '/admin/subjects', asTeacher.access_token, {
      name: `${TAG} مادة`,
    });
    expect(res.status).toBe(403);
    expect(await prisma.subject.count({ where: { name: { startsWith: TAG } } })).toBe(0);
  });

  it('cannot switch OUT of a narrowed session by presenting the narrowed token elsewhere', async () => {
    // The narrowed token is not a lesser credential to be smuggled: it grants
    // the teacher's authority and nothing more, wherever it is presented.
    const asTeacher = await switchTo('teacher');
    for (const path of ['/admin/trash', '/admin/settings']) {
      expect((await call('GET', path, asTeacher.access_token)).status, path).toBe(403);
    }

    // **`/admin/branches` was in this list and no longer belongs.** A teacher
    // now READS branches — scoped to the ones they teach in — because R26
    // always granted that and the guard wrongly demanded `isAdmin`. So the
    // narrowing shows up as an empty list rather than a refusal: this account
    // staffs no schedule, so as مؤطِّرة it reaches no branch at all.
    const branches = await call('GET', '/admin/branches?page_size=100', asTeacher.access_token);
    expect(branches.status).toBe(200);
    expect(branches.body.data).toHaveLength(0);

    // …while the same account un-narrowed is a Super Admin and sees them.
    const asSuper = await switchTo('super_admin', asTeacher.access_token!);
    const all = await call('GET', '/admin/branches?page_size=100', asSuper.access_token);
    expect(all.body.data!.length).toBeGreaterThan(0);
  });
});

describe('TD-12 freshness follows the ACTIVE role (§60.5)', () => {
  it('refuses a high-risk endpoint the active role does not authorize', async () => {
    // `/admin/settings` re-reads live rows and ignores the token, so before R60
    // it would have found this account's Super Admin row and allowed it — the
    // exact split R60.5 exists to prevent: everything narrows EXCEPT the most
    // dangerous surfaces.
    const asTeacher = await switchTo('teacher');
    expect((await call('GET', '/admin/settings', asTeacher.access_token)).status).toBe(403);

    const asSuper = await switchTo('super_admin', asTeacher.access_token!);
    expect((await call('GET', '/admin/settings', asSuper.access_token)).status).toBe(200);
  });

  it('refuses at once when the ACTIVE role is revoked mid-session', async () => {
    const asAdmin = await switchTo('admin');
    expect((await call('GET', '/admin/approvals', asAdmin.access_token)).status).toBe(200);

    // Revoked while the token is still perfectly valid and unexpired.
    const roleRow = await prisma.role.findUnique({ where: { name: 'admin' } });
    await prisma.userBranchRole.updateMany({
      where: { userId: multiRole, roleId: roleRow!.id },
      data: { deletedAt: new Date() },
    });

    const res = await call('GET', '/admin/approvals', asAdmin.access_token);
    expect(res.status).toBe(403);
  });
});

describe('branch scope survives narrowing (§60.6)', () => {
  it('keeps the active role its OWN branches, not everyone else\'s', async () => {
    // The account is Admin of one branch and Teacher everywhere. Narrowed to
    // admin, the entry must keep `branches: [thatBranch]` — dropping it would
    // silently promote a scoped admin to an unscoped one.
    const res = await switchTo('admin');
    const claims = JSON.parse(
      Buffer.from(res.access_token!.split('.')[1]!, 'base64url').toString(),
    ) as { role_scopes: { role: string; branches: string[] | null }[] };

    expect(claims.role_scopes).toEqual([{ role: 'admin', branches: [branchId] }]);
  });
});

describe('refresh carries the role, and fails safe (§60.4)', () => {
  it('returns the active role explicitly so the client never guesses', async () => {
    // Refresh needs the cookie, which this suite has no session for; the
    // contract is asserted at the endpoint that mints the same shape.
    const res = await switchTo('teacher');
    expect(res).toHaveProperty('active_role', 'teacher');
    expect(res).toHaveProperty('expires_at');
  });
});

describe('/me stays the switcher\'s menu (§60.9)', () => {
  it('reports EVERY assigned role while the token carries one', async () => {
    const asTeacher = await switchTo('teacher');
    const me = await call('GET', '/me', asTeacher.access_token);

    // Narrowing the menu would let a person narrow themselves and never widen
    // again — the one place the un-narrowed set is the correct answer.
    expect(me.body.roles?.sort()).toEqual(['admin', 'parent', 'super_admin', 'teacher']);
    expect(me.body.active_role).toBe('teacher');
  });

  it('reflects a revoked role on the next read, so the menu cannot offer it', async () => {
    const roleRow = await prisma.role.findUnique({ where: { name: 'parent' } });
    await prisma.userBranchRole.updateMany({
      where: { userId: multiRole, roleId: roleRow!.id },
      data: { deletedAt: new Date() },
    });

    const me = await call('GET', '/me', multiToken);
    expect(me.body.roles).not.toContain('parent');
  });
});

describe('tampering', () => {
  it('cannot mint its own active role — the claim is inside the signature', async () => {
    const asTeacher = await switchTo('teacher');
    const [header, payload, signature] = asTeacher.access_token!.split('.');

    // Rewrite the claim to super_admin and keep the original signature.
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    claims['active_role'] = 'super_admin';
    claims['roles'] = ['super_admin'];
    claims['role_scopes'] = [{ role: 'super_admin', branches: null }];
    const forged = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;

    expect((await call('GET', '/admin/trash', forged)).status).toBe(401);
  });

  it('a token narrowed for one account is useless for another', async () => {
    const other = await prisma.user.create({
      data: { nameArabic: `${TAG} أخرى`, accountStatus: 'active' },
    });
    await grant(other.id, 'teacher');

    // Correctly signed, but its subject is the other account: it carries that
    // person's authority, never this one's.
    const theirs = tokenFor(other.id, ['teacher']);
    expect((await call('GET', '/admin/trash', theirs)).status).toBe(403);
  });
});

describe('concurrent sessions', () => {
  it('lets two devices of ONE account hold different active roles at once', async () => {
    // Two independent switches from the same account, as two browsers produce.
    const deviceA = await switchTo('super_admin');
    const deviceB = await switchTo('teacher');

    expect(deviceA.active_role).toBe('super_admin');
    expect(deviceB.active_role).toBe('teacher');

    // Neither affected the other: no shared row, nothing to reconcile, which is
    // what "stateless" buys (§60.3).
    expect((await call('GET', '/admin/trash', deviceA.access_token)).status).toBe(200);
    expect((await call('GET', '/admin/trash', deviceB.access_token)).status).toBe(403);
  });
});

describe('the audit trail records the capacity (§60.8)', () => {
  it('names the account AND the role it was acting as', async () => {
    const asSuper = await switchTo('super_admin');
    const branch = await call('POST', '/admin/branches', asSuper.access_token, {
      name: `${TAG} فرع جديد`,
    });
    expect(branch.status).toBe(201);

    const row = await prisma.auditLog.findFirst({
      where: { actorUserId: multiRole, actionType: 'branch.create' },
      orderBy: { createdAt: 'desc' },
    });
    // The account stays the accountable identity; the role is the capacity.
    expect(row?.actorUserId).toBe(multiRole);
    expect(row?.detail).toMatchObject({ active_role: 'super_admin' });
  });
});
