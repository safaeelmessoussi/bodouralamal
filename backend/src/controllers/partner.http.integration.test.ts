import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { issueAccessToken } from '../lib/access-token.js';

/**
 * Partners over HTTP (NEW N / R113).
 *
 * The properties that matter are the two the design turns on: **the public read
 * shows only what is visible**, and **management is Super Admin's alone**. Both
 * are asserted at the API boundary, because a forged request never opens a
 * screen and a menu test cannot show a refusal.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-partner-test]';

const createdUserIds: string[] = [];

const bearer = (
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
): string =>
  issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;

async function makeStaff(role: string): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: 'female', nameArabic: `${TAG} ${role}`, accountStatus: 'active' },
  });
  createdUserIds.push(user.id);
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow.id, branchId: null },
  });
  return user.id;
}

interface Res {
  status: number;
  body: { data?: unknown; error?: { code?: string } };
}

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Res['body']) : {} };
}

let superAdmin: string;
let admin: string;

async function clear(): Promise<void> {
  await prisma.partner.deleteMany({ where: { name: { startsWith: TAG } } });
  if (createdUserIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
}

beforeAll(async () => {
  await clear();
  superAdmin = bearer(await makeStaff('super_admin'), [{ role: 'super_admin', branches: null }]);
  admin = bearer(await makeStaff('admin'), [{ role: 'admin', branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('the partners catalogue', () => {
  it('serves the public list with NO authentication', async () => {
    // §5.1's landing section is a public page; requiring a token would make the
    // section invisible to exactly the audience it exists for.
    const res = await call('GET', '/partners');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('shows a visible partner publicly and HIDES a withheld one', async () => {
    /**
     * The distinction the whole design turns on: `is_visible` is not
     * `deleted_at`. A withheld partner is absent from the public page and still
     * present in the back office.
     */
    const shown = await call('POST', '/admin/partners', superAdmin, {
      name: `${TAG} شريك ظاهر`,
    });
    const withheld = await call('POST', '/admin/partners', superAdmin, {
      name: `${TAG} شريك محجوب`,
      is_visible: false,
    });
    expect(shown.status).toBe(201);
    expect(withheld.status).toBe(201);

    const publicNames = ((await call('GET', '/partners')).body.data as { name: string }[]).map(
      (p) => p.name,
    );
    expect(publicNames).toContain(`${TAG} شريك ظاهر`);
    expect(publicNames).not.toContain(`${TAG} شريك محجوب`);

    // ...and the management read shows both, so «not on the site» is never
    // mistaken for «deleted».
    const managed = ((await call('GET', '/admin/partners', superAdmin)).body.data as {
      name: string;
    }[]).map((p) => p.name);
    expect(managed).toContain(`${TAG} شريك ظاهر`);
    expect(managed).toContain(`${TAG} شريك محجوب`);
  });

  it('sends the public list a NAME and nothing else', async () => {
    // A partner is a name. Asserted as an exact key set so a field added for the
    // back office cannot reach a public page unnoticed.
    await call('POST', '/admin/partners', superAdmin, { name: `${TAG} شريك للمفاتيح` });
    const rows = (await call('GET', '/partners')).body.data as Record<string, unknown>[];
    const row = rows.find((r) => String(r['name']).startsWith(TAG));
    if (!row) throw new Error('the seeded partner did not appear on the public list');
    expect(Object.keys(row).sort()).toEqual(['id', 'name']);
  });

  it('refuses an Admin every management verb — OD-01 keeps Partners undelegated', async () => {
    const created = await call('POST', '/admin/partners', superAdmin, {
      name: `${TAG} شريك للصلاحيات`,
    });
    const id = (created.body.data as { id: string }).id;

    for (const [method, path, body] of [
      ['GET', '/admin/partners', undefined],
      ['POST', '/admin/partners', { name: `${TAG} من مسؤولة` }],
      ['PATCH', `/admin/partners/${id}`, { version: 0, name: `${TAG} معدّل` }],
      ['DELETE', `/admin/partners/${id}`, undefined],
    ] as [string, string, Record<string, unknown> | undefined][]) {
      const res = await call(method, path, admin, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('refuses a logo or a URL rather than silently dropping it', async () => {
    // A 201 after sending a logo would reasonably be read as one having been
    // recorded, and there is nothing to record it in.
    const res = await call('POST', '/admin/partners', superAdmin, {
      name: `${TAG} شريك بشعار`,
      logo_url: 'https://example.com/logo.png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('soft-deletes, and the public list stops carrying it', async () => {
    const created = await call('POST', '/admin/partners', superAdmin, {
      name: `${TAG} شريك للحذف`,
    });
    const id = (created.body.data as { id: string }).id;
    expect((await call('DELETE', `/admin/partners/${id}`, superAdmin)).status).toBe(204);

    const publicNames = ((await call('GET', '/partners')).body.data as { name: string }[]).map(
      (p) => p.name,
    );
    expect(publicNames).not.toContain(`${TAG} شريك للحذف`);
    // TD-5: the row survives for the runbook, it is merely not live.
    const row = await prisma.partner.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });
});
