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
    // **`Trash.deleted_by` is `ON DELETE RESTRICT`** (R59), so a user who
    // soft-deleted anything cannot be removed while their Trash row survives.
    // This suite gained a test that unassigns a Subject — a soft delete — and the
    // cleanup then failed on the constraint. Every other suite that deletes
    // through the API already clears Trash first; this one had never needed to.
    await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
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
  it('returns exactly the selector fields, plus the Levels that teach it', async () => {
    /**
     * **`levels` was added 2026-08-17 and the key set is still asserted exactly.**
     *
     * The point of pinning it has never been the *number* of fields — it is that
     * a column added to the Prisma model cannot appear here by accident (§16.2's
     * allow-list projection). So the assertion grows by one deliberate entry
     * rather than being loosened to `toContain`, which would stop catching the
     * thing it exists for.
     *
     * `levels` is here because a Subject paired with any Level **cannot be
     * deleted**, and an administrator meeting that refusal had no way to see which
     * Levels to unpair. It is on THIS read and not on
     * `/admin/levels/{id}/subjects`, whose question is the other direction.
     */
    const res = await call('/admin/subjects', superAdmin);
    expect(res.status).toBe(200);
    const row = res.body.data!.find((r) => r.id === subjectId)!;
    expect(Object.keys(row).sort()).toEqual([
      'display_order',
      'id',
      'levels',
      'name',
      'version',
    ]);
  });

  it('names each linked Level with its Category, and joins neither into the other', async () => {
    // §4.4b — Level names are not unique across Categories, so the client's
    // `levelLabel` needs both halves. A pre-joined «الفئة — المستوى» string here
    // would be a second implementation of a format the client owns.
    const res = await call('/admin/subjects', superAdmin);
    const row = res.body.data!.find((r) => r.id === subjectId)!;
    const levels = row['levels'] as unknown as Record<string, unknown>[];
    expect(Array.isArray(levels)).toBe(true);
    for (const level of levels) {
      expect(Object.keys(level).sort()).toEqual(['category_name', 'id', 'name']);
      expect(typeof level['category_name']).toBe('string');
      // Not pre-joined: the Level's own name carries no separator.
      expect(String(level['name'])).not.toContain('—');
    }
  });

  it('excludes a Level from the list once the pairing is removed', async () => {
    // The dependency shown must be the LIVE one: a soft-deleted pairing blocks
    // nothing, so listing it would name a constraint that is not there.
    //
    // **The pairing is created here rather than assumed.** The suite's fixtures
    // build a Level and a Subject but do not pair them — the assignment tests
    // below do that themselves — so a first draft of this test asserted a link
    // the fixtures had never made.
    await httpCall(BASE, 'PUT', `/admin/levels/${levelId}/subjects/${subjectId}`, {
      token: superAdmin,
    });

    const before = await call('/admin/subjects', superAdmin);
    const linked = (
      (before.body.data!.find((r) => r.id === subjectId)!['levels'] as unknown as {
        id: string;
      }[]) ?? []
    ).map((l) => l.id);
    expect(linked).toContain(levelId);

    await httpCall(BASE, 'DELETE', `/admin/levels/${levelId}/subjects/${subjectId}`, {
      token: superAdmin,
    });
    const after = await call('/admin/subjects', superAdmin);
    const stillLinked = (
      (after.body.data!.find((r) => r.id === subjectId)!['levels'] as unknown as {
        id: string;
      }[]) ?? []
    ).map((l) => l.id);
    expect(stillLinked).not.toContain(levelId);

    // Left UNPAIRED, which is the state the fixtures hand over: the assignment
    // tests below create the pairing themselves and would meet a `409 DUPLICATE`
    // if this one left it behind.
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
