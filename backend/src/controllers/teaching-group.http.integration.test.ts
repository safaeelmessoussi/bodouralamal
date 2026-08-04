import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * Teaching Groups over real HTTP (TD-3.12, §4.4c, BR-22, Revision 43).
 *
 * As with the administrative groups, the point of an HTTP suite beside the
 * service suite is the **wire**: exact key sets, so a field arriving that nobody
 * chose fails rather than passing a presence check.
 *
 * **Two things here are only observable over HTTP.** The Revision 43.3 authority
 * split — Super Admin for the group, branch-scoped Admin for its membership —
 * is a rule about *who holds a token*, and the `/admin/` prefix is not what
 * enforces it. And the `split` flag is a contract decision: a service returning
 * `{split: false, unassigned: []}` proves nothing about whether the wire keeps
 * *the question does not apply* distinguishable from *everyone is placed*.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-teaching-group-test]';

/** The whole contract, sorted (§16.2 allow-list projection). */
const GROUP_KEYS = [
  'display_order',
  'id',
  'level_id',
  'member_count',
  'name',
  'subject_id',
  'version',
];
const UNASSIGNED_KEYS = ['administrative_group_id', 'branch_id', 'name', 'student_id'];
const MEMBER_KEYS = ['id', 'student_id', 'teaching_group_id'];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    groups?: Record<string, unknown>[];
    unassigned?: Record<string, unknown>[];
  };
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  return httpCall<Res['body']>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });
}

function bearer(userId: string, scopes: { role: string; branches: string[] | null }[]): string {
  return issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: 'active' as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

async function makeUser(label: string, sex: 'female' | null = null): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active', ...(sex ? { sex } : {}) },
  });
  return user.id;
}

let superAdmin: string;
let scopedAdmin: string;
let teacherToken: string;
let branchA: string;
let branchB: string;
let levelId: string;
/** Split — has Teaching Groups. */
let subjectSplit: string;
/** Assigned to the Level but never split: `split: false` (§4.4c). */
let subjectWhole: string;
/** Not assigned to the Level at all: SUBJECT_NOT_IN_LEVEL. */
let subjectElsewhere: string;
let groupA: string;
let groupB: string;
/** Enrolled at branch A, so within `scopedAdmin`'s reach. */
let studentA: string;
/** Enrolled at branch B — outside it. */
let studentB: string;

/** Enrols a student into the Level, which is the precondition for placement. */
async function enrol(studentId: string, administrativeGroupId: string): Promise<void> {
  await prisma.enrollment.create({ data: { studentId, administrativeGroupId, levelId } });
}

async function clear(): Promise<void> {
  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  const tGroups = await prisma.teachingGroup.findMany({
    where: { levelId: { in: levelIds } },
    select: { id: true },
  });
  const aGroups = await prisma.administrativeGroup.findMany({
    where: { levelId: { in: levelIds } },
    select: { id: true },
  });

  await prisma.studentTeachingGroup.deleteMany({
    where: { teachingGroupId: { in: tGroups.map((g) => g.id) } },
  });
  await prisma.enrollment.deleteMany({
    where: { administrativeGroupId: { in: aGroups.map((g) => g.id) } },
  });

  // TD-8 keeps `AuditLog.actor` and `Trash.deletedBy` RESTRICT on purpose, so the
  // fixture clears its own trail — scoped to these ids, never a blanket truncate.
  const targetIds = [...tGroups.map((g) => g.id), ...aGroups.map((g) => g.id)];
  if (targetIds.length > 0) {
    await prisma.trash.deleteMany({ where: { targetId: { in: targetIds } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: targetIds } } });
  }
  await prisma.teachingGroup.deleteMany({ where: { id: { in: tGroups.map((g) => g.id) } } });
  await prisma.administrativeGroup.deleteMany({ where: { id: { in: aGroups.map((g) => g.id) } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

beforeAll(async () => {
  // Fail loudly rather than skipping (§19.2): a silently skipped wiring test is
  // indistinguishable from a passing one.
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        'docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api',
    );
  }

  await clear();

  // Through Prisma, not the branch API: `createBranch` runs the TD-4.6d backfill,
  // which would make this fixture's counts depend on the rest of the database.
  branchA = (await prisma.branch.create({ data: { name: `${TAG} فرع أ` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `${TAG} فرع ب` } })).id;

  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
    })
  ).id;

  subjectSplit = (await prisma.subject.create({ data: { name: `${TAG} قرآن` } })).id;
  subjectWhole = (await prisma.subject.create({ data: { name: `${TAG} تجويد` } })).id;
  subjectElsewhere = (await prisma.subject.create({ data: { name: `${TAG} خارج` } })).id;
  await prisma.levelSubject.createMany({
    data: [
      { levelId, subjectId: subjectSplit },
      { levelId, subjectId: subjectWhole },
    ],
  });

  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} إدارية أ`, levelId, branchId: branchA },
    })
  ).id;
  groupB = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} إدارية ب`, levelId, branchId: branchB },
    })
  ).id;

  studentA = await makeUser('طالبة أ', 'female');
  studentB = await makeUser('طالبة ب', 'female');
  await enrol(studentA, groupA);
  await enrol(studentB, groupB);

  superAdmin = bearer(await makeUser('مدير عام'), [{ role: 'super_admin', branches: null }]);
  // Scoped to branch A ONLY — the half of TD-2 a null scope cannot exercise.
  scopedAdmin = bearer(await makeUser('مدير فرع'), [{ role: 'admin', branches: [branchA] }]);
  teacherToken = bearer(await makeUser('أستاذة'), [{ role: 'teacher', branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const collection = (subjectId: string): string =>
  `/admin/levels/${levelId}/subjects/${subjectId}/teaching-groups`;

describe('the response is an explicit contract DTO (§16.2)', () => {
  it('POST and GET return exactly the documented keys', async () => {
    const created = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج ١`,
      display_order: 1,
    });
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(GROUP_KEYS);
    expect(created.body.level_id).toBe(levelId);
    expect(created.body.subject_id).toBe(subjectSplit);
    // Stated rather than queried, so the shape never varies by verb.
    expect(created.body.member_count).toBe(0);

    const list = await call('GET', collection(subjectSplit), superAdmin);
    expect(list.status).toBe(200);
    expect(Object.keys(list.body).sort()).toEqual(['groups', 'split', 'unassigned']);
    const row = list.body.groups!.find((g) => g.id === created.body.id)!;
    expect(Object.keys(row).sort()).toEqual(GROUP_KEYS);
  });

  it('exposes no internal column, no camelCase original, and no branch_id', async () => {
    const list = await call('GET', collection(subjectSplit), superAdmin);
    for (const row of list.body.groups!) {
      for (const internal of ['created_at', 'updated_at', 'deleted_at', 'deleted_by']) {
        expect(row).not.toHaveProperty(internal);
      }
      for (const camel of ['levelId', 'subjectId', 'displayOrder', 'memberCount', 'deletedAt']) {
        expect(row).not.toHaveProperty(camel);
      }
      // A Teaching Group HAS no branch — a Level spans branches (§4.4b), and that
      // absence is the structural reason R43.3 split the authority. A branch_id
      // here would invite exactly the scope check that has no referent.
      expect(row).not.toHaveProperty('branch_id');
    }
  });

  it('member_count tracks live membership, so the screen needs no request per group', async () => {
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج العدّ`,
    });
    expect(group.body.member_count).toBe(0);

    await call('POST', `/admin/teaching-groups/${group.body.id}/members`, superAdmin, {
      student_id: studentA,
    });

    const list = await call('GET', collection(subjectSplit), superAdmin);
    const row = list.body.groups!.find((g) => g.id === group.body.id)!;
    expect(row.member_count).toBe(1);

    await call('DELETE', `/admin/teaching-groups/${group.body.id}/members/${studentA}`, superAdmin);
    const after = await call('GET', collection(subjectSplit), superAdmin);
    expect(after.body.groups!.find((g) => g.id === group.body.id)!.member_count).toBe(0);
  });
});

describe('the unassigned list is BR-22 made visible', () => {
  it('names an enrolled student holding no seat in a split subject', async () => {
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج غير مكتمل`,
    });
    expect(group.status).toBe(201);

    const res = await call('GET', collection(subjectSplit), superAdmin);
    expect(res.body.split).toBe(true);
    const entry = res.body.unassigned!.find((u) => u.student_id === studentA)!;
    expect(entry).toBeDefined();
    expect(Object.keys(entry).sort()).toEqual(UNASSIGNED_KEYS);
    // The screen's next action is *place this student*; without these the list
    // names a problem and withholds what is needed to fix it.
    expect(entry.administrative_group_id).toBe(groupA);
    expect(entry.branch_id).toBe(branchA);
  });

  it('drops a student from the list once they hold a seat, and returns them when it is removed', async () => {
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج التنقّل`,
    });
    await call('POST', `/admin/teaching-groups/${group.body.id}/members`, superAdmin, {
      student_id: studentA,
    });

    const placed = await call('GET', collection(subjectSplit), superAdmin);
    expect(placed.body.unassigned!.some((u) => u.student_id === studentA)).toBe(false);

    await call('DELETE', `/admin/teaching-groups/${group.body.id}/members/${studentA}`, superAdmin);
    const released = await call('GET', collection(subjectSplit), superAdmin);
    // Never silently classless — the whole justification for the list existing.
    expect(released.body.unassigned!.some((u) => u.student_id === studentA)).toBe(true);
  });

  it('split:false is NOT the same answer as "everyone is assigned"', async () => {
    // A Subject with no Teaching Groups is taught to the entire Level (§4.4c), so
    // nobody is unassigned and the question is a category error. Returning every
    // enrolled student would read as an alarm; returning [] without the flag
    // would be indistinguishable from a fully-placed split.
    const res = await call('GET', collection(subjectWhole), superAdmin);
    expect(res.status).toBe(200);
    expect(res.body.split).toBe(false);
    expect(res.body.unassigned).toEqual([]);
    expect(res.body.groups).toEqual([]);
  });

  it('a branch-scoped Admin sees only their own students unplaced', async () => {
    // Correct under R43.3, not a leak in the other direction: they may place only
    // the students they are responsible for, so a partial list is the honest one.
    await call('POST', collection(subjectSplit), superAdmin, { name: `${TAG} فوج النطاق` });

    const res = await call('GET', collection(subjectSplit), scopedAdmin);
    expect(res.status).toBe(200);
    const ids = res.body.unassigned!.map((u) => u.student_id);
    expect(ids).toContain(studentA);
    expect(ids).not.toContain(studentB);
  });
});

describe('Revision 43.3 splits the authority (group vs membership)', () => {
  it('refuses group CRUD to a branch Admin — a Teaching Group has no branch to scope by', async () => {
    // Without the split, a branch Admin could delete a split the other branch's
    // students depend on while the unassigned list showed them only their own:
    // authority over everyone, visibility of some.
    const res = await call('POST', collection(subjectSplit), scopedAdmin, {
      name: `${TAG} ممنوع`,
    });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
    expect(await prisma.teachingGroup.count({ where: { name: `${TAG} ممنوع` } })).toBe(0);
  });

  it('refuses PATCH and DELETE to the same Admin', async () => {
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج محمي`,
    });
    const patched = await call('PATCH', `/admin/teaching-groups/${group.body.id}`, scopedAdmin, {
      name: `${TAG} محاولة`,
      version: group.body.version,
    });
    expect(patched.status).toBe(403);
    const deleted = await call('DELETE', `/admin/teaching-groups/${group.body.id}`, scopedAdmin);
    expect(deleted.status).toBe(403);
  });

  it('ALLOWS that same Admin to place a student enrolled in their branch', async () => {
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج العضوية`,
    });
    const res = await call('POST', `/admin/teaching-groups/${group.body.id}/members`, scopedAdmin, {
      student_id: studentA,
    });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(MEMBER_KEYS);
    expect(res.body.student_id).toBe(studentA);
    expect(res.body.teaching_group_id).toBe(group.body.id);

    await call('DELETE', `/admin/teaching-groups/${group.body.id}/members/${studentA}`, scopedAdmin);
  });

  it('scopes membership by the STUDENT’s enrolment branch — 404, never 403', async () => {
    // The group carries no branch, so this is the only referent that exists. A 403
    // would confirm the student exists outside the caller's reach (§20 rule 17).
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج خارج النطاق`,
    });
    const res = await call('POST', `/admin/teaching-groups/${group.body.id}/members`, scopedAdmin, {
      student_id: studentB,
    });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('NOT_FOUND');
  });

  it('refuses a teacher and an anonymous caller with the TD-3.8 envelope', async () => {
    const anon = await call('GET', collection(subjectSplit));
    expect(anon.status).toBe(401);
    expect(anon.body.error?.code).toBe('AUTH_REQUIRED');

    const teacher = await call('GET', collection(subjectSplit), teacherToken);
    expect(teacher.status).toBe(403);
    expect(teacher.body.error?.code).toBe('FORBIDDEN');
  });
});

describe('the write boundary refuses what the URL already says', () => {
  it('rejects level_id and subject_id in a body rather than dropping them', async () => {
    // They are what a split IS, not properties it has. Accepting them would leave
    // the composite FK as the only guard against a seat filed under the wrong
    // curriculum item — an opaque constraint error, not a decision.
    for (const extra of [{ level_id: levelId }, { subject_id: subjectWhole }]) {
      const res = await call('POST', collection(subjectSplit), superAdmin, {
        name: `${TAG} مرفوض`,
        ...extra,
      });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_FAILED');
    }
    expect(await prisma.teachingGroup.count({ where: { name: `${TAG} مرفوض` } })).toBe(0);
  });

  it('refuses to move a group between Subjects or Levels on PATCH', async () => {
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج ثابت`,
    });
    for (const move of [{ subject_id: subjectWhole }, { level_id: levelId }]) {
      const res = await call('PATCH', `/admin/teaching-groups/${group.body.id}`, superAdmin, {
        version: group.body.version,
        ...move,
      });
      expect(res.status).toBe(400);
    }
    const after = await prisma.teachingGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { subjectId: true, levelId: true },
    });
    expect(after).toEqual({ subjectId: subjectSplit, levelId });
  });

  it('TD-15: a stale version is a 409, not a silent overwrite', async () => {
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج التعارض`,
    });
    // A real prior edit is what makes the version stale. `version - 1` on a fresh
    // row is -1, which the validator refuses as malformed before optimistic
    // locking is ever consulted — that test would pass with no locking at all.
    const first = await call('PATCH', `/admin/teaching-groups/${group.body.id}`, superAdmin, {
      name: `${TAG} تحرير أول`,
      version: group.body.version,
    });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe((group.body.version as number) + 1);

    const stale = await call('PATCH', `/admin/teaching-groups/${group.body.id}`, superAdmin, {
      name: `${TAG} تعارض`,
      version: group.body.version,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('VERSION_CONFLICT');

    const row = await prisma.teachingGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { name: true },
    });
    expect(row.name).toBe(`${TAG} تحرير أول`);
  });

  it('refuses a Subject the Level does not offer', async () => {
    // Splitting a Subject a Level does not teach would create groups nothing can
    // ever schedule, sitting in the taxonomy looking legitimate.
    const res = await call('POST', collection(subjectElsewhere), superAdmin, {
      name: `${TAG} فوج بلا مادة`,
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('STATE_CONFLICT');
    expect(res.body.error?.details?.['reason']).toBe('SUBJECT_NOT_IN_LEVEL');
  });

  it('a malformed path id is a 400, not an empty split', async () => {
    const res = await call(
      'GET',
      `/admin/levels/not-a-uuid/subjects/${subjectSplit}/teaching-groups`,
      superAdmin,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('at most one seat per (student, Subject, Level) — §4.4c', () => {
  it('refuses the same group twice, and a different split of the same Subject by name', async () => {
    const first = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج أ`,
    });
    const second = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج ب`,
    });

    expect(
      (
        await call('POST', `/admin/teaching-groups/${first.body.id}/members`, superAdmin, {
          student_id: studentA,
        })
      ).status,
    ).toBe(201);

    const same = await call('POST', `/admin/teaching-groups/${first.body.id}/members`, superAdmin, {
      student_id: studentA,
    });
    expect(same.status).toBe(409);
    expect(same.body.error?.code).toBe('DUPLICATE');

    const other = await call('POST', `/admin/teaching-groups/${second.body.id}/members`, superAdmin, {
      student_id: studentA,
    });
    expect(other.status).toBe(409);
    expect(other.body.error?.code).toBe('STATE_CONFLICT');
    expect(other.body.error?.details?.['reason']).toBe('ALREADY_IN_SUBJECT_SPLIT');
    // What an administrator needs to decide whether to MOVE the student instead.
    expect(other.body.error?.details?.['current_teaching_group_id']).toBe(first.body.id);

    await call('DELETE', `/admin/teaching-groups/${first.body.id}/members/${studentA}`, superAdmin);
  });

  it('refuses a student who is not enrolled in the Level at all', async () => {
    // BR-22 read from the other direction: enrolment precedes placement.
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج غير مسجّلة`,
    });
    const stranger = await makeUser('غريبة', 'female');
    const res = await call('POST', `/admin/teaching-groups/${group.body.id}/members`, superAdmin, {
      student_id: stranger,
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.['reason']).toBe('NOT_ENROLLED_IN_LEVEL');
  });

  it('the splits are independent between Subjects', async () => {
    // One student sits in an Administrative Group, a Quran split and a Tajweed
    // split at once — uniqueness is per (student, subject, level), never per
    // student, and nothing may quietly narrow it.
    await prisma.levelSubject.create({ data: { levelId, subjectId: subjectElsewhere } });
    const inQuran = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج قرآن`,
    });
    const inOther = await call('POST', collection(subjectElsewhere), superAdmin, {
      name: `${TAG} فوج آخر`,
    });

    expect(
      (
        await call('POST', `/admin/teaching-groups/${inQuran.body.id}/members`, superAdmin, {
          student_id: studentA,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call('POST', `/admin/teaching-groups/${inOther.body.id}/members`, superAdmin, {
          student_id: studentA,
        })
      ).status,
    ).toBe(201);

    await call('DELETE', `/admin/teaching-groups/${inQuran.body.id}/members/${studentA}`, superAdmin);
    await call('DELETE', `/admin/teaching-groups/${inOther.body.id}/members/${studentA}`, superAdmin);
    await prisma.levelSubject.deleteMany({ where: { levelId, subjectId: subjectElsewhere } });
  });
});

describe('deletion reports what it released (BR-22, TD-5)', () => {
  it('answers 200 with released_students rather than a silent 204', async () => {
    const group = await call('POST', collection(subjectSplit), superAdmin, {
      name: `${TAG} فوج للحذف`,
    });
    await call('POST', `/admin/teaching-groups/${group.body.id}/members`, superAdmin, {
      student_id: studentA,
    });

    const res = await call('DELETE', `/admin/teaching-groups/${group.body.id}`, superAdmin);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['released_students']);
    // The only moment this number exists: afterwards the unassigned list has been
    // worked through and released students are indistinguishable from those never
    // placed.
    expect(res.body.released_students).toBe(1);

    // TD-5 soft delete: the row survives carrying its tombstone.
    const row = await prisma.teachingGroup.findUniqueOrThrow({
      where: { id: group.body.id as string },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();

    // And the student is back on the unassigned list, not vanished from the
    // platform's account of who is taught what.
    const after = await call('GET', collection(subjectSplit), superAdmin);
    expect(after.body.unassigned!.some((u) => u.student_id === studentA)).toBe(true);
  });
});
