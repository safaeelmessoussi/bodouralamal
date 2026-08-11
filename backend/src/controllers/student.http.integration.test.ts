import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';
import { clearPlacement, provisionPlacement, type Placement } from '../test-support/placement.js';

/**
 * `GET /students/me` — the Student Dashboard's identity block (SRS Revision 63).
 *
 * **This is the first route to mount `childContext`**, so these cases are as
 * much a test of §4.3's resolution reaching production as of the projection
 * itself. The three §4.3 branches each get a case, and so does the one that
 * matters most: a parent naming **another family's** child gets the same `404`
 * as one naming a child that does not exist.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-studentme-test]';
const PLACEMENT_TAG = '[http-studentme-test-place]';

interface Body {
  error?: { code?: string };
  id?: string;
  name_arabic?: string;
  reference_code?: string | null;
  enrollments?: {
    category: { id: string; name: string };
    level: { id: string; name: string };
    branch: { id: string; name: string };
  }[];
}

const call = (method: string, path: string, token?: string, headers?: Record<string, string>) =>
  httpCall<Body>(BASE, method, path, { token, ...(headers ? { headers } : {}) });

function bearer(userId: string, roles: string[]): string {
  return issueAccessToken(
    {
      userId,
      roleScopes: roles.map((role) => ({ role, branches: null })),
      accountStatus: 'active' as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;
}

async function makeUser(label: string, referenceCode?: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      accountStatus: 'active',
      ...(referenceCode ? { referenceCode } : {}),
    },
  });
  return user.id;
}

async function link(parentId: string, studentId: string, status: 'approved' | 'pending') {
  await prisma.familyLink.create({ data: { parentId, studentId, status } });
}

let placement: Placement;
/** An enrolled child, so the identity block has a Category, Level and branch. */
let childId = '';
let parentId = '';
/** A second family, which is what makes the `404` meaningful. */
let strangerChildId = '';
let strangerParentId = '';
/** An adult student: their own account, no reference code, no enrolment. */
let adultId = '';
let staffId = '';

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await clearPlacement(prisma, PLACEMENT_TAG);
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: docker compose up -d --build api`,
    );
  }

  await clear();
  placement = await provisionPlacement(prisma, PLACEMENT_TAG);

  childId = await makeUser('طفلة', 'BA-TEST1');
  parentId = await makeUser('والدة');
  await link(parentId, childId, 'approved');
  await prisma.enrollment.create({
    data: {
      studentId: childId,
      administrativeGroupId: placement.groupId,
      // R66 — the enrolment's own branch, from the same placement fixture.
      branchId: placement.branchId,
      levelId: placement.levelId,
    },
  });

  strangerChildId = await makeUser('طفلة أخرى');
  strangerParentId = await makeUser('والدة أخرى');
  await link(strangerParentId, strangerChildId, 'approved');

  adultId = await makeUser('راشدة');
  staffId = await makeUser('مسؤولة');
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('§4.3 case 2 — a student acts on their own record', () => {
  it('returns the identity block with no header at all', async () => {
    const res = await call('GET', '/students/me', bearer(adultId, ['student']));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(adultId);
    expect(res.body.name_arabic).toBe(`${TAG} راشدة`);
    // R62.6 — null for an adult, which is a real answer, not a missing one.
    expect(res.body.reference_code).toBeNull();
    // An account admitted to no Level yet: an empty list, never an error.
    expect(res.body.enrollments).toEqual([]);
  });
});

describe('§4.3 case 1 — a parent acts for an approved child', () => {
  it('returns the CHILD, and the R43 chain resolved to Category, Level and branch', async () => {
    const res = await call('GET', '/students/me', bearer(parentId, ['parent']), {
      'X-Active-Child-ID': childId,
    });
    expect(res.status).toBe(200);
    // The subject is the child, not the caller — the distinction R63 records
    // between `GET /me` and this endpoint.
    expect(res.body.id).toBe(childId);
    expect(res.body.reference_code).toBe('BA-TEST1');
    expect(res.body.enrollments).toHaveLength(1);
    const enrolment = res.body.enrollments![0]!;
    expect(enrolment.level.id).toBe(placement.levelId);
    expect(enrolment.category.id).toBe(placement.categoryId);
    expect(typeof enrolment.branch.name).toBe('string');
  });

  it('carries EXACTLY R62.10’s five fields — the projection is the rule', async () => {
    const res = await call('GET', '/students/me', bearer(parentId, ['parent']), {
      'X-Active-Child-ID': childId,
    });
    // Stated as an exact key set rather than a list of absences: a field added
    // by reflex to a screen a parent looks at is personal data published to one
    // more surface, and this is where that is caught.
    expect(Object.keys(res.body as object).sort()).toEqual([
      'enrollments',
      'id',
      'name_arabic',
      'reference_code',
    ]);
    expect(Object.keys(res.body.enrollments![0]!).sort()).toEqual([
      'branch',
      'category',
      'level',
    ]);
  });
});

describe('§4.3 case 3 and the no-existence-leak rule', () => {
  it('refuses a Parent-only caller who names no child', async () => {
    const res = await call('GET', '/students/me', bearer(parentId, ['parent']));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('gives staff the same 400 — they reach a student through §14.2, not here', async () => {
    const res = await call('GET', '/students/me', bearer(staffId, ['admin']));
    expect(res.status).toBe(400);
  });

  it("answers 404 for ANOTHER family's child — the same answer as a child that does not exist", async () => {
    const foreign = await call('GET', '/students/me', bearer(parentId, ['parent']), {
      'X-Active-Child-ID': strangerChildId,
    });
    const absent = await call('GET', '/students/me', bearer(parentId, ['parent']), {
      'X-Active-Child-ID': '00000000-0000-4000-8000-000000000000',
    });
    expect(foreign.status).toBe(404);
    expect(absent.status).toBe(404);
    // Indistinguishable, which is the point: a different answer would confirm
    // that another family's child exists (§20 rule 17). `request_id` is
    // excluded because it is per-request BY DESIGN (§14.4 traceability) and
    // carries nothing about the subject — comparing it would assert the
    // opposite of what this test is for.
    const withoutRequestId = (body: Body) => ({
      ...body,
      error: { ...body.error, request_id: undefined },
    });
    expect(withoutRequestId(foreign.body)).toEqual(withoutRequestId(absent.body));
  });

  it('answers 404 once the link is revoked, on the very next request', async () => {
    const token = bearer(strangerParentId, ['parent']);
    const header = { 'X-Active-Child-ID': strangerChildId };
    expect((await call('GET', '/students/me', token, header)).status).toBe(200);

    // §4.3 (Revision 16) — soft-deleting the link IS revocation. Nothing is
    // cached in the token, which is why this takes effect immediately.
    await prisma.familyLink.updateMany({
      where: { parentId: strangerParentId, studentId: strangerChildId },
      data: { deletedAt: new Date() },
    });

    expect((await call('GET', '/students/me', token, header)).status).toBe(404);
  });

  it('is behind authentication', async () => {
    const res = await call('GET', '/students/me');
    expect(res.status).toBe(401);
  });
});
