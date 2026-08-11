import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { RoleScope } from '../policies/branch-scope.js';
import {
  createAdministrativeGroup,
  deleteAdministrativeGroup,
  listAdministrativeGroups,
} from './administrative-group.service.js';
import type { Actor } from '../policies/actor.js';
import { createLevel, levelsWithoutGroups } from './level.service.js';
import {
  enrolInLevel,
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
  // R66 — `createLevel` creates ONLY the Level now (TD-4.6b retired). Suites
  // that need a group make one explicitly, which is also how an administrator
  // does it: create the Level, subdivide it when there is a reason to.
  const created = await createLevel(prisma, superAdmin(), {
    name: `${TAG} ${label}`,
    categoryId,
    genderRestriction,
  });
  const group = await prisma.administrativeGroup.create({
    data: { name: `${TAG} ${label} مجموعة`, levelId: created.level.id, branchId, displayOrder: 0 },
  });
  return { levelId: created.level.id, firstGroupId: group.id };
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

describe('R66 — a Level is created ALONE; a Group is a subdivision', () => {
  it('creates only the Level, and asks for no branch', async () => {
    // TD-4.6b created المجموعة 1 in the same transaction, which is why the
    // input carried a branch — a Level has never had one of its own. R66
    // retires it: a Level nobody has subdivided needs no group, exactly as a
    // Subject with no Teaching Groups is taught to the whole Level.
    const created = await createLevel(prisma, superAdmin(), {
      name: `${TAG} مستوى وحده`,
      categoryId,
      genderRestriction: 'any',
    });
    expect(created.level.id).toBeTruthy();
    expect(created).not.toHaveProperty('firstGroup');
    expect(
      await prisma.administrativeGroup.count({
        where: { levelId: created.level.id, deletedAt: null },
      }),
    ).toBe(0);
  });

  it('the Level still stores no branch — it never did', async () => {
    const created = await createLevel(prisma, superAdmin(), {
      name: `${TAG} مستوى بلا فرع`,
      categoryId,
      genderRestriction: 'any',
    });
    const row = await prisma.level.findUniqueOrThrow({ where: { id: created.level.id } });
    expect(row).not.toHaveProperty('branchId');
  });

  it('a student is enrolled DIRECTLY in an unsubdivided Level (R66)', async () => {
    // The capability the revision exists for, and the one the old invariant
    // made unreachable.
    const created = await createLevel(prisma, superAdmin(), {
      name: `${TAG} مستوى مباشر`,
      categoryId,
      genderRestriction: 'any',
    });
    const pupil = await student('طالبة مباشرة');
    const row = await prisma.$transaction((tx) =>
      enrolInLevel(tx, superAdmin(), created.level.id, amerchich, pupil, 'roster_edit'),
    );
    expect(row.administrativeGroupId).toBeNull();
    // The branch is on the ENROLMENT — the whole point of R66, and what makes
    // every branch-scoped rule keep working for an ungrouped student.
    expect(row.branchId).toBe(amerchich);
  });

  it('BR-21 still refuses a second placement in the same Level', async () => {
    const created = await createLevel(prisma, superAdmin(), {
      name: `${TAG} مستوى مكرر`,
      categoryId,
      genderRestriction: 'any',
    });
    const pupil = await student('طالبة مكررة');
    await prisma.$transaction((tx) =>
      enrolInLevel(tx, superAdmin(), created.level.id, amerchich, pupil, 'roster_edit'),
    );
    await expect(
      prisma.$transaction((tx) =>
        enrolInLevel(tx, superAdmin(), created.level.id, amerchich, pupil, 'roster_edit'),
      ),
    ).rejects.toMatchObject({ details: { reason: 'ALREADY_ENROLLED_IN_LEVEL' } });
  });
});

describe('R66 — `levelsWithoutGroups` is a report, not an invariant', () => {
  it('lists Levels with no group WITHOUT treating them as broken', async () => {
    // It existed for TD-4.6d's bootstrap backfill and to assert that the set
    // was always empty. R66 retires the backfill: a group-less Level is an
    // ordinary Level nobody has subdivided, and the helper now answers a
    // question rather than policing a rule.
    const created = await createLevel(prisma, superAdmin(), {
      name: `${TAG} مستوى بلا مجموعة`,
      categoryId,
      genderRestriction: 'any',
    });
    const listed = await levelsWithoutGroups(prisma);
    expect(listed.map((l) => l.id)).toContain(created.level.id);
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

describe('R66 — a Level MAY be left with no group', () => {
  it('deleting an empty last group is allowed; the Level stays enrollable', async () => {
    // `LAST_GROUP_IN_LEVEL` retired. It only ever stopped a Level reaching the
    // state TD-4.6b prevented at creation, and that state is now ordinary.
    const { levelId, firstGroupId } = await level('المستوى للحذف', amerchich);
    await deleteAdministrativeGroup(prisma, superAdmin(), firstGroupId);
    expect(
      await prisma.administrativeGroup.count({ where: { levelId, deletedAt: null } }),
    ).toBe(0);

    // And the Level still admits students — directly.
    const pupil = await student('طالبة بعد الحذف');
    const row = await prisma.$transaction((tx) =>
      enrolInLevel(tx, superAdmin(), levelId, amerchich, pupil, 'roster_edit'),
    );
    expect(row.administrativeGroupId).toBeNull();
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
