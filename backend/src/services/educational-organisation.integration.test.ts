import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { RoleScope } from '../policies/branch-scope.js';
import {
  backfillFirstGroups,
  createAdministrativeGroup,
  deleteAdministrativeGroup,
  listAdministrativeGroups,
} from './administrative-group.service.js';
import type { Actor } from '../policies/actor.js';
import { createBranch } from './branch.service.js';
import { createLevel, FIRST_GROUP_NAME, levelsWithoutGroups } from './level.service.js';
import {
  enrolStudent,
  levelsForStudent,
  listGroupRoster,
  moveStudent,
  unenrolStudent,
} from './enrollment.service.js';
import {
  addMember,
  createTeachingGroup,
  deleteTeachingGroup,
  listUnassignedStudents,
  removeMember,
} from './teaching-group.service.js';

/**
 * The educational-organisation services — SRS §4.4b, §4.4c, TD-4.6b, TD-4.6d,
 * BR-21, BR-22, BR-23, Revisions 43 / 43.1 / 43.2 / 43.3.
 *
 * Organised by the rule each group of tests defends, not by the function it
 * calls, because the rules are what the specification actually promises.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[edu-org-test]';

let categoryId: string;
let actorUserId: string;
let amerchich: string;
let targa: string;

const actorOf = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor => actorOf([{ role: 'super_admin', branches: null }]);
const admin = (branches: string[]): Actor => actorOf([{ role: 'admin', branches }]);
const teacher = (): Actor => actorOf([{ role: 'teacher', branches: null }]);

/** Captures a thrown AppError without widening the success type into the union. */
async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; details?: Record<string, unknown> };
  }
}

async function student(label: string, sex: 'female' | 'male' | null = 'female'): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active', sex },
  });
  return u.id;
}

async function branch(label: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${label}`, operationalStartDate: new Date('2026-01-01') },
  });
  return b.id;
}

async function level(
  label: string,
  branchId: string,
  genderRestriction: 'any' | 'girls_only' | 'boys_only' = 'any',
): Promise<{ levelId: string; firstGroupId: string }> {
  const created = await createLevel(prisma, superAdmin(), {
    name: `${TAG} ${label}`,
    categoryId,
    genderRestriction,
    branchId,
  });
  return { levelId: created.level.id, firstGroupId: created.firstGroup.id };
}

async function subject(label: string, levelId: string): Promise<string> {
  const s = await prisma.subject.create({ data: { name: `${TAG} ${label}` } });
  await prisma.levelSubject.create({ data: { levelId, subjectId: s.id } });
  return s.id;
}

/** Every suite shares one database (§19.2), so the tag namespaces the fixtures
 *  and this removes only what this file made. */
async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const taggedPerson = { nameArabic: { startsWith: TAG } };

  await prisma.studentTeachingGroup.deleteMany({ where: { student: taggedPerson } });
  await prisma.enrollment.deleteMany({ where: { student: taggedPerson } });
  // Scoped by RELATION, not by name: the groups this suite cares most about are
  // the ones the code created for itself — المجموعة 1 from `createLevel` and
  // from the backfill — and those carry the production name, not the test tag.
  // Matching on name silently left them behind, and the Level delete then
  // failed on the FK. A teardown that filters on something the code under test
  // does not control is a teardown that misses exactly the rows under test.
  await prisma.teachingGroup.deleteMany({ where: { level: tagged } });
  await prisma.administrativeGroup.deleteMany({ where: { level: tagged } });
  await prisma.administrativeGroup.deleteMany({ where: { branch: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });

  // `AuditLog.actor_user_id` and `Trash.deleted_by` are both RESTRICT (TD-5),
  // so these must go before the users they point at — otherwise the teardown
  // fails on a foreign key and leaves the previous run's fixtures behind for
  // the next one to trip over. The same trap that once broke the settings
  // suite; the lesson is in testing.md.
  await prisma.trash.deleteMany({ where: { deletedBy: { nameArabic: { startsWith: TAG } } } });
  await prisma.auditLog.deleteMany({ where: { actor: taggedPerson } });

  await prisma.user.deleteMany({ where: taggedPerson });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  // The BR-23 test creates a Room to prove capacity constrains nothing; Rooms
  // are RESTRICT against Branch (TD-5), so they go first.
  await prisma.room.deleteMany({ where: { branch: tagged } });
  await prisma.branch.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
}

beforeEach(async () => {
  await cleanup();
  const cat = await prisma.category.create({ data: { name: `${TAG} الكبار` } });
  categoryId = cat.id;
  actorUserId = (
    await prisma.user.create({
      data: { nameArabic: `${TAG} المسؤولة`, accountStatus: 'active' },
    })
  ).id;
  amerchich = await branch('أمرشيش');
  targa = await branch('تاركة');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('TD-4.6b — a Level is never created without its first group', () => {
  it('creates المجموعة 1 at the supplied branch, in the same transaction', async () => {
    const created = await createLevel(prisma, superAdmin(), {
      name: `${TAG} المستوى 1`,
      categoryId,
      genderRestriction: 'any',
      branchId: amerchich,
    });

    expect(created.firstGroup.name).toBe(FIRST_GROUP_NAME);
    expect(created.firstGroup.branchId).toBe(amerchich);

    const groups = await prisma.administrativeGroup.findMany({
      where: { levelId: created.level.id, deletedAt: null },
    });
    expect(groups).toHaveLength(1);
  });

  it('leaves NO level without a group — the state TD-4.6b exists to prevent', async () => {
    await level('المستوى 1', amerchich);
    await level('المستوى 2', targa);
    const orphans = (await levelsWithoutGroups(prisma)).filter((l) => l.name.startsWith(TAG));
    expect(orphans).toEqual([]);
  });

  it('the branch is an INPUT, never a column on Level', async () => {
    const created = await createLevel(prisma, superAdmin(), {
      name: `${TAG} المستوى 1`,
      categoryId,
      genderRestriction: 'any',
      branchId: amerchich,
    });
    // A Level stays branch-independent (§4.4b) — it may later hold groups at
    // several branches, which `entire_level` teaching mode depends on.
    expect(Object.keys(created.level)).not.toContain('branchId');

    await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} المجموعة 2`,
      levelId: created.level.id,
      branchId: targa,
    });
    const branches = await prisma.administrativeGroup.findMany({
      where: { levelId: created.level.id, deletedAt: null },
      select: { branchId: true },
    });
    expect(new Set(branches.map((b) => b.branchId))).toEqual(new Set([amerchich, targa]));
  });

  it('rolls BOTH rows back when the branch does not exist', async () => {
    const before = await prisma.level.count({ where: { name: { startsWith: TAG } } });
    const err = await failure(() =>
      createLevel(prisma, superAdmin(), {
        name: `${TAG} المستوى الشبح`,
        categoryId,
        genderRestriction: 'any',
        branchId: '00000000-0000-0000-0000-000000000000',
      }),
    );
    expect(err.code).toBe('NOT_FOUND');
    // A Level committed without its group is exactly the outcome the
    // transaction exists to prevent.
    expect(await prisma.level.count({ where: { name: { startsWith: TAG } } })).toBe(before);
  });

  it('is Super Admin only — Levels are reference data (R26)', async () => {
    const err = await failure(() =>
      createLevel(prisma, admin([amerchich]), {
        name: `${TAG} المستوى المرفوض`,
        categoryId,
        genderRestriction: 'any',
        branchId: amerchich,
      }),
    );
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('TD-4.6d — the first-branch bootstrap backfill', () => {
  /** A seeded Level: written directly, exactly as §15.1's seed does, because no
   *  Branch exists at seed time and `createLevel` requires one. */
  async function seededLevel(label: string): Promise<string> {
    const l = await prisma.level.create({
      data: { name: `${TAG} ${label}`, categoryId, genderRestriction: 'any' },
    });
    return l.id;
  }

  it('gives EVERY group-less Level its المجموعة 1 when a Branch first appears', async () => {
    const a = await seededLevel('مستوى مزروع 1');
    const b = await seededLevel('مستوى مزروع 2');

    // Deliberately not scoped to this suite's fixtures. The developer database
    // carries the §15.1 production seed — 21 Levels created before any Branch
    // existed — and those ARE the bootstrap case this transaction was written
    // for. Asserting only the two tagged Levels would have passed while leaving
    // the real ones untouched.
    const orphansBefore = await levelsWithoutGroups(prisma);
    expect(orphansBefore.map((l) => l.id)).toEqual(expect.arrayContaining([a, b]));
    expect(orphansBefore.length).toBeGreaterThanOrEqual(2);

    const created = await createBranch(prisma, superAdmin(), { name: `${TAG} الفرع الأول` });

    expect(await levelsWithoutGroups(prisma)).toEqual([]);
    const groups = await prisma.administrativeGroup.findMany({
      where: { branchId: created.id, deletedAt: null },
      select: { name: true, levelId: true },
    });
    expect(groups).toHaveLength(orphansBefore.length);
    expect(groups.every((g) => g.name === FIRST_GROUP_NAME)).toBe(true);
    expect(groups.map((g) => g.levelId)).toEqual(
      expect.arrayContaining(orphansBefore.map((l) => l.id)),
    );
  });

  it('is a NO-OP on every subsequent branch — it is keyed on the condition, not on "first"', async () => {
    await seededLevel('مستوى مزروع');
    const first = await createBranch(prisma, superAdmin(), { name: `${TAG} فرع أ` });
    const atFirst = await prisma.administrativeGroup.count({ where: { branchId: first.id } });
    expect(atFirst).toBeGreaterThan(0);

    const second = await createBranch(prisma, superAdmin(), { name: `${TAG} فرع ب` });

    // Nothing is left to backfill, so the second branch gets no groups at all.
    // Keying on "every Level with no live group" is what makes that automatic —
    // an explicit "is this the first branch?" test would have been a second,
    // weaker way of asking the same question.
    expect(await prisma.administrativeGroup.count({ where: { branchId: second.id } })).toBe(0);
  });

  it('is idempotent when re-entered directly', async () => {
    const l = await seededLevel('مستوى مزروع');
    await prisma.$transaction(async (tx) => {
      await backfillFirstGroups(tx, amerchich, actorUserId);
      // A re-entry after a partial failure must complete, never duplicate.
      await backfillFirstGroups(tx, amerchich, actorUserId);
    });
    expect(
      await prisma.administrativeGroup.count({ where: { levelId: l, deletedAt: null } }),
    ).toBe(1);
  });

  it('commits the Branch and the groups it enabled together', async () => {
    await seededLevel('مستوى مزروع');
    const expected = (await levelsWithoutGroups(prisma)).length;
    const b = await createBranch(prisma, superAdmin(), { name: `${TAG} فرع ذري` });
    // Same transaction: a Branch that committed without them would leave every
    // Level unadmittable while looking successfully created.
    expect(
      await prisma.administrativeGroup.count({ where: { branchId: b.id, deletedAt: null } }),
    ).toBe(expected);
  });

  it('writes ONE audit row for the whole backfill, not one per group', async () => {
    await seededLevel('مستوى مزروع 1');
    await seededLevel('مستوى مزروع 2');
    const expected = (await levelsWithoutGroups(prisma)).length;
    const b = await createBranch(prisma, superAdmin(), { name: `${TAG} فرع مدقّق` });

    const rows = await prisma.auditLog.findMany({
      where: { actionType: 'administrativegroup.bootstrap_backfill', targetId: b.id },
    });
    // It was one operator action with one cause; N rows would misrepresent it
    // as N decisions (§7 attribution invariant).
    expect(rows).toHaveLength(1);
    expect((rows[0]?.detail as { levels?: number }).levels).toBe(expected);
  });
});

describe('BR-21 — exactly one Administrative Group per enrolled Level', () => {
  it('refuses a second group in the same Level, naming the one they are in', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const second = await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} المجموعة 2`,
      levelId,
      branchId: amerchich,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);

    const err = await failure(() => enrolStudent(prisma, superAdmin(), second.id, s));
    expect(err.code).toBe('STATE_CONFLICT');
    expect(err.details?.['reason']).toBe('ALREADY_ENROLLED_IN_LEVEL');
    // Naming the current group is what lets the admin decide to MOVE instead.
    expect(err.details?.['current_administrative_group_id']).toBe(firstGroupId);
  });

  it('allows the SAME student in several different Levels', async () => {
    const one = await level('المستوى 1', amerchich);
    const two = await level('المستوى 2', amerchich);
    const s = await student('هدى');

    await enrolStudent(prisma, superAdmin(), one.firstGroupId, s);
    await enrolStudent(prisma, superAdmin(), two.firstGroupId, s);

    const levels = await levelsForStudent(prisma, s);
    expect(levels.map((l) => l.levelId).sort()).toEqual([one.levelId, two.levelId].sort());
  });

  it('level membership is answered ONLY through the enrolment — never stored twice', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);

    const row = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: s, deletedAt: null },
      select: { levelId: true, administrativeGroup: { select: { levelId: true } } },
    });
    // The composite FK makes these provably equal; the withdrawn StudentLevel
    // entity is what would have made them able to disagree.
    expect(row.levelId).toBe(levelId);
    expect(row.administrativeGroup.levelId).toBe(levelId);
  });

  it('re-enrolment after leaving is allowed — the unique index spans live rows only', async () => {
    const { firstGroupId } = await level('المستوى 1', amerchich);
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);
    await unenrolStudent(prisma, superAdmin(), firstGroupId, s);
    await expect(enrolStudent(prisma, superAdmin(), firstGroupId, s)).resolves.toBeTruthy();
  });
});

describe('BR-23 — capacity informs, it never refuses', () => {
  it('enrols far beyond any plausible room capacity without complaint', async () => {
    const { firstGroupId } = await level('المستوى 1', amerchich);
    await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: amerchich, capacity: 2 },
    });

    for (let i = 0; i < 12; i += 1) {
      await enrolStudent(prisma, superAdmin(), firstGroupId, await student(`طالبة ${i}`));
    }
    const roster = await listGroupRoster(prisma, superAdmin(), firstGroupId, {});
    expect(roster.meta.total).toBe(12);
  });

  it('no CAPACITY_FULL code can be raised from this path', async () => {
    const { firstGroupId } = await level('المستوى 1', amerchich);
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 5; i += 1) {
      const id = await student(`ط ${i}`);
      codes.push((await failure(() => enrolStudent(prisma, superAdmin(), firstGroupId, id))).code);
    }
    // Every one of these SUCCEEDS, so every captured code is undefined — the
    // point is that no capacity path exists to raise the retired code at all.
    expect(codes).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe('gender restriction pairs Level with User.sex (§4.4b, R27)', () => {
  it('refuses a male student for a girls-only level', async () => {
    const { firstGroupId } = await level('المستوى 1', amerchich, 'girls_only');
    const boy = await student('عمر', 'male');
    const err = await failure(() => enrolStudent(prisma, superAdmin(), firstGroupId, boy));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.['reason']).toBe('GENDER_RESTRICTION');
  });

  it('treats a NULL sex as NOT eligible, never as a wildcard', async () => {
    const { firstGroupId } = await level('المستوى 1', amerchich, 'girls_only');
    const unknown = await student('مجهولة', null);
    const err = await failure(() => enrolStudent(prisma, superAdmin(), firstGroupId, unknown));
    expect(err.code).toBe('VALIDATION_FAILED');
  });

  it('does not echo the student’s own sex back in the error (§4.10, BR-16)', async () => {
    const { firstGroupId } = await level('المستوى 1', amerchich, 'girls_only');
    const boy = await student('عمر', 'male');
    const err = await failure(() => enrolStudent(prisma, superAdmin(), firstGroupId, boy));
    expect(Object.keys(err.details ?? {})).not.toContain('student_sex');
  });

  it('admits anyone when the level is unrestricted', async () => {
    const { firstGroupId } = await level('المستوى 1', amerchich, 'any');
    await expect(
      enrolStudent(prisma, superAdmin(), firstGroupId, await student('عمر', 'male')),
    ).resolves.toBeTruthy();
  });
});

describe('moving a student is one action (§5.6)', () => {
  it('never leaves the student in no group, and preserves enrolled_at', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const second = await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} المجموعة 2`,
      levelId,
      branchId: amerchich,
    });
    const s = await student('هدى');
    const original = await enrolStudent(prisma, superAdmin(), firstGroupId, s);

    const moved = await moveStudent(prisma, superAdmin(), s, firstGroupId, second.id);

    expect(moved.id).toBe(original.id);
    expect(moved.administrativeGroupId).toBe(second.id);
    // Re-pointed in place: a new row would reset enrolled_at and lose how long
    // the student has been in this Level.
    expect(moved.enrolledAt.getTime()).toBe(original.enrolledAt.getTime());
    expect(await prisma.enrollment.count({ where: { studentId: s, deletedAt: null } })).toBe(1);
  });

  it('refuses a cross-level move — that is two decisions, not one', async () => {
    const one = await level('المستوى 1', amerchich);
    const two = await level('المستوى 2', amerchich);
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), one.firstGroupId, s);

    const err = await failure(() =>
      moveStudent(prisma, superAdmin(), s, one.firstGroupId, two.firstGroupId),
    );
    expect(err.code).toBe('STATE_CONFLICT');
    expect(err.details?.['reason']).toBe('CROSS_LEVEL_MOVE');
  });

  it('keeps the student’s Teaching Group seats — splits belong to the Level, not the group', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const second = await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} المجموعة 2`,
      levelId,
      branchId: amerchich,
    });
    const quran = await subject('القرآن', levelId);
    const tg = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);
    await addMember(prisma, superAdmin(), tg.id, s);

    await moveStudent(prisma, superAdmin(), s, firstGroupId, second.id);

    expect(
      await prisma.studentTeachingGroup.count({ where: { studentId: s, deletedAt: null } }),
    ).toBe(1);
  });

  it('requires BOTH ends in scope — an admin cannot pull a student out of a branch they do not manage', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const atTarga = await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} مجموعة تاركة`,
      levelId,
      branchId: targa,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);

    const err = await failure(() =>
      moveStudent(prisma, admin([targa]), s, firstGroupId, atTarga.id),
    );
    // 404, never 403 — a 403 would confirm the source group exists (§20 r17).
    expect(err.code).toBe('NOT_FOUND');
  });
});

describe('un-enrolment (TD-5)', () => {
  it('removes the Teaching Group seats for that Level, and nothing else', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const tg = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);
    await addMember(prisma, superAdmin(), tg.id, s);

    await unenrolStudent(prisma, superAdmin(), firstGroupId, s);

    // A seat in a split inside a Level the student has left is a roster entry
    // for a class they no longer attend.
    expect(
      await prisma.studentTeachingGroup.count({ where: { studentId: s, deletedAt: null } }),
    ).toBe(0);
    // The student themselves survives — un-enrolment is not deletion.
    expect(await prisma.user.count({ where: { id: s, deletedAt: null } })).toBe(1);
  });
});

describe('a Level may never be left with no group', () => {
  it('refuses deletion of the last group in a Level', async () => {
    const { firstGroupId } = await level('المستوى 1', amerchich);
    const err = await failure(() =>
      deleteAdministrativeGroup(prisma, superAdmin(), firstGroupId),
    );
    expect(err.code).toBe('STATE_CONFLICT');
    // The state TD-4.6b prevents at creation, reached from the other side.
    expect(err.details?.['reason']).toBe('LAST_GROUP_IN_LEVEL');
  });

  it('refuses deletion while students are enrolled', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} المجموعة 2`,
      levelId,
      branchId: amerchich,
    });
    await enrolStudent(prisma, superAdmin(), firstGroupId, await student('هدى'));

    const err = await failure(() =>
      deleteAdministrativeGroup(prisma, superAdmin(), firstGroupId),
    );
    expect(err.details?.['reason']).toBe('ENROLMENTS_EXIST');
  });

  it('deletes a spare, empty group', async () => {
    const { levelId } = await level('المستوى 1', amerchich);
    const spare = await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} المجموعة 2`,
      levelId,
      branchId: amerchich,
    });
    await expect(
      deleteAdministrativeGroup(prisma, superAdmin(), spare.id),
    ).resolves.toBeUndefined();
  });
});

describe('branch scope on Administrative Groups', () => {
  it('an admin sees only their own branches’ groups', async () => {
    const { levelId } = await level('المستوى 1', amerchich);
    await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} مجموعة تاركة`,
      levelId,
      branchId: targa,
    });

    const mine = await listAdministrativeGroups(prisma, admin([amerchich]), { levelId });
    expect(mine.data.every((g) => g.branchId === amerchich)).toBe(true);

    const all = await listAdministrativeGroups(prisma, superAdmin(), { levelId });
    expect(all.meta.total).toBe(2);
  });

  it('an all-branches admin (NULL scope) sees everything — null is not "no branches"', async () => {
    const { levelId } = await level('المستوى 1', amerchich);
    await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} مجموعة تاركة`,
      levelId,
      branchId: targa,
    });
    const everywhere = await listAdministrativeGroups(
      prisma,
      actorOf([{ role: 'admin', branches: null }]),
      { levelId },
    );
    expect(everywhere.meta.total).toBe(2);
  });

  it('a teacher is refused outright', async () => {
    const err = await failure(() => listAdministrativeGroups(prisma, teacher(), {}));
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('Revision 43.3 — Teaching Group authority is split', () => {
  it('an Admin may NOT create a teaching group', async () => {
    const { levelId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const err = await failure(() =>
      createTeachingGroup(prisma, admin([amerchich]), {
        levelId,
        subjectId: quran,
        name: `${TAG} القرآن 1`,
      }),
    );
    // A Teaching Group has no branch, so "within your scope" has no referent —
    // a Marrakesh admin would otherwise be deleting Targa's splits.
    expect(err.code).toBe('FORBIDDEN');
  });

  it('an Admin MAY place their own branch’s students into one', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const tg = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);

    await expect(addMember(prisma, admin([amerchich]), tg.id, s)).resolves.toBeTruthy();
  });

  it('an Admin may NOT place a student enrolled at another branch', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const tg = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);

    // The scope referent is the branch the STUDENT is enrolled at.
    const err = await failure(() => addMember(prisma, admin([targa]), tg.id, s));
    expect(err.code).toBe('NOT_FOUND');
  });

  it('refuses placing a student who is not enrolled in the level at all', async () => {
    const { levelId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const tg = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const stranger = await student('غريبة');
    const err = await failure(() => addMember(prisma, superAdmin(), tg.id, stranger));
    expect(err.details?.['reason']).toBe('NOT_ENROLLED_IN_LEVEL');
  });

  it('refuses a split of a Subject the Level does not teach', async () => {
    const { levelId } = await level('المستوى 1', amerchich);
    const orphan = await prisma.subject.create({ data: { name: `${TAG} مادة غريبة` } });
    const err = await failure(() =>
      createTeachingGroup(prisma, superAdmin(), {
        levelId,
        subjectId: orphan.id,
        name: `${TAG} مجموعة`,
      }),
    );
    expect(err.details?.['reason']).toBe('SUBJECT_NOT_IN_LEVEL');
  });
});

describe('BR-22 — splits are per-Subject, and an unplaced student is never silent', () => {
  it('one student sits in two different subjects’ splits at once', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const tajweed = await subject('تجويد', levelId);
    const q1 = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const t1 = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: tajweed,
      name: `${TAG} تجويد 1`,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);

    await addMember(prisma, superAdmin(), q1.id, s);
    // The uniqueness is per (student, SUBJECT, level) — this is the whole
    // reason the splits are independent between subjects.
    await expect(addMember(prisma, superAdmin(), t1.id, s)).resolves.toBeTruthy();
  });

  it('refuses a SECOND split of the SAME subject, naming the one they are in', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const q1 = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const q2 = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 2`,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);
    await addMember(prisma, superAdmin(), q1.id, s);

    const err = await failure(() => addMember(prisma, superAdmin(), q2.id, s));
    expect(err.code).toBe('STATE_CONFLICT');
    expect(err.details?.['reason']).toBe('ALREADY_IN_SUBJECT_SPLIT');
    expect(err.details?.['current_teaching_group_id']).toBe(q1.id);
  });

  it('lists an enrolled but unplaced student for a SPLIT subject', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const placed = await student('هدى');
    const unplaced = await student('سارة');
    await enrolStudent(prisma, superAdmin(), firstGroupId, placed);
    await enrolStudent(prisma, superAdmin(), firstGroupId, unplaced);
    const q1 = await prisma.teachingGroup.findFirstOrThrow({ where: { subjectId: quran } });
    await addMember(prisma, superAdmin(), q1.id, placed);

    const result = await listUnassignedStudents(prisma, superAdmin(), levelId, quran);
    expect(result.split).toBe(true);
    expect(result.unassigned.map((u) => u.studentId)).toEqual([unplaced]);
  });

  it('reports split=false and an EMPTY list when the subject is not split at all', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const tafsir = await subject('تفسير', levelId);
    await enrolStudent(prisma, superAdmin(), firstGroupId, await student('هدى'));

    const result = await listUnassignedStudents(prisma, superAdmin(), levelId, tafsir);
    // An unsplit subject is taught to the entire Level, so nobody is
    // unassigned. Returning every enrolled student here would read as an alarm.
    expect(result).toEqual({ split: false, unassigned: [] });
  });

  it('returns a student to the unassigned list when their group is deleted', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const q1 = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 2`,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);
    await addMember(prisma, superAdmin(), q1.id, s);
    expect((await listUnassignedStudents(prisma, superAdmin(), levelId, quran)).unassigned).toEqual([]);

    const { releasedStudents } = await deleteTeachingGroup(prisma, superAdmin(), q1.id);

    expect(releasedStudents).toBe(1);
    // They return to the list rather than vanishing from it (BR-22, TD-5).
    expect(
      (await listUnassignedStudents(prisma, superAdmin(), levelId, quran)).unassigned.map(
        (u) => u.studentId,
      ),
    ).toEqual([s]);
  });

  it('returns a student to the list when they are removed from a split', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const quran = await subject('القرآن', levelId);
    const q1 = await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const s = await student('هدى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, s);
    await addMember(prisma, superAdmin(), q1.id, s);

    await removeMember(prisma, superAdmin(), q1.id, s);

    expect(
      (await listUnassignedStudents(prisma, superAdmin(), levelId, quran)).unassigned.map(
        (u) => u.studentId,
      ),
    ).toEqual([s]);
  });

  it('scopes the list by branch for an Admin — a partial list is correct here', async () => {
    const { levelId, firstGroupId } = await level('المستوى 1', amerchich);
    const atTarga = await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} مجموعة تاركة`,
      levelId,
      branchId: targa,
    });
    const quran = await subject('القرآن', levelId);
    await createTeachingGroup(prisma, superAdmin(), {
      levelId,
      subjectId: quran,
      name: `${TAG} القرآن 1`,
    });
    const here = await student('هدى');
    const there = await student('ليلى');
    await enrolStudent(prisma, superAdmin(), firstGroupId, here);
    await enrolStudent(prisma, superAdmin(), atTarga.id, there);

    const mine = await listUnassignedStudents(prisma, admin([amerchich]), levelId, quran);
    // An admin may place only the students they are responsible for (R43.3).
    expect(mine.unassigned.map((u) => u.studentId)).toEqual([here]);

    const all = await listUnassignedStudents(prisma, superAdmin(), levelId, quran);
    expect(all.unassigned.map((u) => u.studentId).sort()).toEqual([here, there].sort());
  });
});
