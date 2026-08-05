import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Reference-data selectors (TD-3 extension, 2026-08-05).
 *
 * These exist so a form can offer a real choice, so the properties worth pinning
 * are the ones a selector depends on: the exact key set, the absence of
 * everything a read-only list has no use for, and who may ask.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-reference-data-test]';
const YEAR_LABEL = '2095-2096';

interface Res {
  status: number;
  body: { error?: { code?: string }; data?: Record<string, unknown>[] };
}

const call = (path: string, token?: string): Promise<Res> =>
  httpCall<Res['body']>(BASE, 'GET', path, { token });

const bearer = (userId: string, scopes: { role: string; branches: string[] | null }[]): string =>
  issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superAdmin: string;
let admin: string;
let teacher: string;
let subjectId: string;

async function makeUser(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

async function clear(): Promise<void> {
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.academicYear.deleteMany({ where: { label: YEAR_LABEL } });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
  await clear();

  subjectId = (
    await prisma.subject.create({ data: { name: `${TAG} مادة`, displayOrder: 1 } })
  ).id;
  await prisma.academicYear.create({ data: { label: YEAR_LABEL } });

  superAdmin = bearer(await makeUser('مدير عام'), [{ role: 'super_admin', branches: null }]);
  admin = bearer(await makeUser('مسؤولة'), [{ role: 'admin', branches: null }]);
  teacher = bearer(await makeUser('أستاذة'), [{ role: 'teacher', branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('GET /admin/subjects', () => {
  it('returns exactly the three selector fields', async () => {
    const res = await call('/admin/subjects', superAdmin);
    expect(res.status).toBe(200);
    const row = res.body.data!.find((r) => r.id === subjectId)!;
    expect(Object.keys(row).sort()).toEqual(['display_order', 'id', 'name']);
  });

  it('carries nothing a read-only list has no use for', async () => {
    // A reference list is exactly where "just return the row" is most tempting.
    // The endpoint has no write, so a `version` would be a field with no
    // possible use and one more thing a client could come to depend on.
    const res = await call('/admin/subjects', superAdmin);
    for (const row of res.body.data!) {
      for (const absent of ['version', 'created_at', 'updated_at', 'deleted_at', 'deleted_by']) {
        expect(row).not.toHaveProperty(absent);
      }
    }
  });

  it('is unpaginated — a selector offering a subset lies about the choice', async () => {
    const res = await call('/admin/subjects', superAdmin);
    expect(res.body).not.toHaveProperty('meta');
  });
});

describe('GET /admin/academic-years', () => {
  it('returns id, label and is_current', async () => {
    const res = await call('/admin/academic-years', superAdmin);
    expect(res.status).toBe(200);
    const row = res.body.data!.find((r) => r.label === YEAR_LABEL)!;
    expect(Object.keys(row).sort()).toEqual(['id', 'is_current', 'label']);
    // The one piece of metadata a selector needs: it lets a form default to the
    // live year rather than asking someone to remember which it is.
    expect(typeof row.is_current).toBe('boolean');
  });

  it('orders newest first', async () => {
    const res = await call('/admin/academic-years', superAdmin);
    const labels = res.body.data!.map((r) => String(r.label));
    expect([...labels].sort((a, b) => b.localeCompare(a))).toEqual(labels);
  });
});

describe('who may ask (TD-2 R26 read, R30 excludes Teacher)', () => {
  it('serves an Admin as well as a Super Admin', async () => {
    // Admins read reference data because operational work depends on it — a
    // schedule references a Subject and an Academic Year.
    expect((await call('/admin/subjects', admin)).status).toBe(200);
    expect((await call('/admin/academic-years', admin)).status).toBe(200);
  });

  it('refuses a Teacher (Revision 30)', async () => {
    // Reference data is an administrative concern; a teacher receives subject
    // information through the operational APIs they are authorised to use.
    for (const path of ['/admin/subjects', '/admin/academic-years']) {
      const res = await call(path, teacher);
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    }
  });

  it('refuses an anonymous caller with the TD-3.8 envelope', async () => {
    const res = await call('/admin/subjects');
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('AUTH_REQUIRED');
  });
});
