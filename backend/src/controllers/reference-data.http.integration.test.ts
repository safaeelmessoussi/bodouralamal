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
let levelId: string;
let categoryId: string;

async function makeUser(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

async function clear(): Promise<void> {
  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.teachingGroup.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
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
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: 'any' },
    })
  ).id;

  superAdmin = bearer(await makeUser('مدير عام'), [{ role: 'super_admin', branches: null }]);
  admin = bearer(await makeUser('مسؤولة'), [{ role: 'admin', branches: null }]);
  teacher = bearer(await makeUser('أستاذة'), [{ role: 'teacher', branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('GET /admin/subjects', () => {
  it('returns exactly the four selector fields', async () => {
    const res = await call('/admin/subjects', superAdmin);
    expect(res.status).toBe(200);
    const row = res.body.data!.find((r) => r.id === subjectId)!;
    expect(Object.keys(row).sort()).toEqual(['display_order', 'id', 'name', 'version']);
  });

  it('carries `version`, which is what stopped a second Subject list existing', async () => {
    // When Subject gained create/edit/delete, the الفئات والمواد screen needed
    // the TD-15 version to send back on an edit. Publishing it on THIS list let
    // that screen reuse this endpoint; the alternative was a parallel GET over
    // the same table with a wider projection — two reads of one concept, kept
    // in step by hand.
    const res = await call('/admin/subjects', superAdmin);
    for (const row of res.body.data!) expect(typeof row.version).toBe('number');
  });

  it('carries nothing a list has no use for', async () => {
    // A reference list is exactly where "just return the row" is most tempting.
    const res = await call('/admin/subjects', superAdmin);
    for (const row of res.body.data!) {
      for (const absent of ['created_at', 'updated_at', 'deleted_at', 'deleted_by']) {
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

/* ── Level ↔ Subject assignment (the SUBJECT_NOT_IN_LEVEL fix) ──────────── */

const call2 = (method: string, path: string, token?: string): Promise<Res> =>
  httpCall<Res['body']>(BASE, method, path, { token });

describe('assigning a Subject to a Level', () => {
  it('was impossible before this endpoint — the join had no write path', async () => {
    // The platform shipped with zero LevelSubject rows and nothing that could
    // create one, so createTeachingGroup refused every request with
    // SUBJECT_NOT_IN_LEVEL and the Subject Organisation screen was unusable.
    const before = await call(`/admin/levels/${levelId}/subjects`, superAdmin);
    expect(before.status).toBe(200);
    expect(before.body.data).toEqual([]);

    const assigned = await call2('PUT', `/admin/levels/${levelId}/subjects/${subjectId}`, superAdmin);
    expect(assigned.status).toBe(204);

    const after = await call(`/admin/levels/${levelId}/subjects`, superAdmin);
    expect(after.body.data!.map((r) => r.id)).toContain(subjectId);
  });

  it('is idempotent in effect — a second assignment is DUPLICATE, never a second row', async () => {
    const again = await call2('PUT', `/admin/levels/${levelId}/subjects/${subjectId}`, superAdmin);
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe('DUPLICATE');
    // One row, not two: "is this Subject taught here" must not have two answers.
    expect(
      await prisma.levelSubject.count({ where: { levelId, subjectId, deletedAt: null } }),
    ).toBe(1);
  });

  it('unblocks the teaching group that previously could not be created', async () => {
    // The whole point, asserted end to end.
    const created = await httpCall<Record<string, unknown>>(
      BASE,
      'POST',
      `/admin/levels/${levelId}/subjects/${subjectId}/teaching-groups`,
      { token: superAdmin, body: { name: `${TAG} فوج` } },
    );
    expect(created.status).toBe(201);
  });

  it('refuses removal while Teaching Groups exist for the pair', async () => {
    // Those groups are the split of a Subject the Level would no longer teach;
    // removing the assignment beneath them leaves members holding seats in a
    // subject the Level does not offer.
    const res = await call2('DELETE', `/admin/levels/${levelId}/subjects/${subjectId}`, superAdmin);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('STATE_CONFLICT');
  });

  it('is Super Admin only — an Admin may read the list but not change it', async () => {
    // Curriculum structure, alongside the Teaching Groups this join gates (R43.3).
    expect((await call(`/admin/levels/${levelId}/subjects`, admin)).status).toBe(200);
    expect(
      (await call2('PUT', `/admin/levels/${levelId}/subjects/${subjectId}`, admin)).status,
    ).toBe(403);
  });
});
