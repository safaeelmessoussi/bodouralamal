import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { RoleScope } from '../policies/branch-scope.js';
import type { Actor } from '../policies/actor.js';
import { createAdministrativeGroup } from './administrative-group.service.js';
import { createLevel } from './level.service.js';
import {
  createCourseSchedule,
  deleteCourseSchedule,
  previewConflicts,
  updateCourseSchedule,
  type CourseScheduleInput,
  listScheduleSessions,
} from './course-schedule.service.js';
import { runMaterialization } from './session-materialize.service.js';
import {
  cancelSession,
  linkContent,
  markHeld,
  overrideSession,
  regenerateSessions,
  restoreSession,
  unlinkContent,
} from './session.service.js';

/**
 * Course schedules, materialization, and the session lifecycle — SRS §4.4,
 * §4.4c, TD-1, TD-4.6c, TD-7, TD-15.2, BR-23, §20 rule 24.
 *
 * **The alternating-week conflict is the headline case** (§19.2 names it): a
 * weekly and a biweekly-alternating class in one room collide **only on
 * alternate weeks**, and comparing recurrence rules cannot see that. It is the
 * stated justification for materializing eagerly, so it is tested against real
 * session rows rather than against the expansion function.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[schedule-test]';

/** Fixed "today" so every horizon and every expected date is deterministic. */
const NOW = new Date('2026-06-01T08:00:00.000Z');
const at = (hh: number, mm = 0): Date => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

let categoryId: string;
let actorUserId: string;
let branchId: string;
let otherBranchId: string;
let levelId: string;
let groupId: string;
let roomA: string;
let roomB: string;
let subjectId: string;
let academicYearId: string;

const actorOf = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor => actorOf([{ role: 'super_admin', branches: null }]);
const admin = (branches: string[]): Actor => actorOf([{ role: 'admin', branches }]);

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

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

const baseInput = (over: Partial<CourseScheduleInput> = {}): CourseScheduleInput => ({
  subjectId,
  teachingMode: 'administrative_group',
  targetId: groupId,
  branchId,
  roomId: roomA,
  startTime: at(15),
  endTime: at(17),
  recurrence: 'weekly',
  weekdays: ['tuesday'],
  academicYearId,
  staff: [],
  ...over,
});

const datesOf = async (scheduleId: string): Promise<string[]> =>
  (
    await prisma.session.findMany({
      where: { scheduleId, deletedAt: null },
      select: { date: true },
      orderBy: { date: 'asc' },
    })
  ).map((s) => s.date.toISOString().slice(0, 10));

async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const taggedPerson = { nameArabic: { startsWith: TAG } };
  const scheduleWhere = { schedule: { subject: tagged } };

  await prisma.sessionContent.deleteMany({ where: { session: scheduleWhere } });
  // Revision 43.4: sessions carry their own staffing snapshot, RESTRICT against
  // Session (TD-5), so it goes before them.
  await prisma.sessionStaff.deleteMany({ where: { session: scheduleWhere } });
  await prisma.educationalContent.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.session.deleteMany({ where: scheduleWhere });
  await prisma.courseScheduleStaff.deleteMany({ where: { schedule: { subject: tagged } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.enrollment.deleteMany({ where: { student: taggedPerson } });
  await prisma.teachingGroup.deleteMany({ where: { level: tagged } });
  await prisma.administrativeGroup.deleteMany({ where: { level: tagged } });
  await prisma.administrativeGroup.deleteMany({ where: { branch: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
  await prisma.trash.deleteMany({ where: { deletedBy: taggedPerson } });
  await prisma.auditLog.deleteMany({ where: { actor: taggedPerson } });
  await prisma.user.deleteMany({ where: taggedPerson });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.room.deleteMany({ where: tagged });
  await prisma.branch.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
}

beforeEach(async () => {
  await cleanup();
  actorUserId = await person('المسؤولة');
  categoryId = (await prisma.category.create({ data: { name: `${TAG} الكبار` } })).id;
  branchId = (
    await prisma.branch.create({
      data: { name: `${TAG} أمرشيش`, operationalStartDate: day('2026-01-01') },
    })
  ).id;
  otherBranchId = (
    await prisma.branch.create({
      data: { name: `${TAG} تاركة`, operationalStartDate: day('2026-01-01') },
    })
  ).id;

  const created = await createLevel(prisma, superAdmin(), {
    name: `${TAG} المستوى 1`,
    categoryId,
    genderRestriction: 'any',
    branchId,
  });
  levelId = created.level.id;
  groupId = created.firstGroup.id;

  roomA = (await prisma.room.create({ data: { name: `${TAG} قاعة أ`, branchId } })).id;
  roomB = (await prisma.room.create({ data: { name: `${TAG} قاعة ب`, branchId } })).id;

  subjectId = (await prisma.subject.create({ data: { name: `${TAG} القرآن` } })).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });

  academicYearId = (await prisma.academicYear.findFirstOrThrow({ select: { id: true } })).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('materialization (TD-7, §20 rule 24)', () => {
  it('creates one session per occurrence, from today to the horizon', async () => {
    const { id, materialized } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    expect(materialized.created).toBeGreaterThan(0);

    const dates = await datesOf(id);
    // Every one is a Tuesday, and none is in the past.
    expect(dates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 2)).toBe(true);
    expect(dates[0]).toBe('2026-06-02');
    expect(dates.every((d) => d >= '2026-06-01')).toBe(true);
  });

  it('is IDEMPOTENT — a second run creates nothing', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const before = await datesOf(id);

    const [again] = await runMaterialization(prisma, { schedule_id: id }, NOW);

    expect(again?.created).toBe(0);
    expect(await datesOf(id)).toEqual(before);
  });

  it('never regenerates the past', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    // Run "later in the year": nothing before that day may appear, and the
    // sessions already generated for June stay exactly as they are.
    const later = new Date('2026-09-01T08:00:00.000Z');
    await runMaterialization(prisma, { schedule_id: id }, later);

    const dates = await datesOf(id);
    expect(dates.filter((d) => d < '2026-06-01')).toEqual([]);
    expect(dates).toContain('2026-06-02');
  });
});

describe('a schedule edit never destroys work (§4.4, §20 rule 24)', () => {
  it('leaves an OVERRIDDEN session alone and REPORTS it', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const target = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-16') },
    });
    await overrideSession(prisma, superAdmin(), target.id, {
      roomId: roomB,
      version: target.version,
    });

    // Move the whole schedule to Wednesdays. Every un-overridden Tuesday goes;
    // the one a human moved must not.
    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { weekdays: ['wednesday'], version: 0 },
      NOW,
    );

    const survivor = await prisma.session.findUnique({ where: { id: target.id } });
    expect(survivor?.deletedAt).toBeNull();
    expect(survivor?.roomId).toBe(roomB);
    // Reported, not silently skipped — the administrator is told.
    expect(result.materialized.protectedSessions.flatMap((p) => p.reasons)).toContain('OVERRIDDEN');
  });

  it('leaves a session carrying LINKED CONTENT alone', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const target = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-23') },
    });
    const content = await prisma.educationalContent.create({
      data: {
        title: `${TAG} ملف`,
        levelId,
        subjectId,
        academicYearId,
        storageBucket: 'private',
        storageKey: `${TAG}/k/${Date.now()}`,
        originalFilename: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(10),
      },
    });
    await linkContent(prisma, superAdmin(), target.id, content.id);

    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { weekdays: ['wednesday'], version: 0 },
      NOW,
    );

    expect((await prisma.session.findUnique({ where: { id: target.id } }))?.deletedAt).toBeNull();
    expect(result.materialized.protectedSessions.flatMap((p) => p.reasons)).toContain('HAS_CONTENT');
  });

  it('leaves a CANCELLED session alone — the cancellation is a record', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const target = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-09') },
    });
    await cancelSession(prisma, superAdmin(), target.id, 'عطلة', target.version);

    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { weekdays: ['wednesday'], version: 0 },
      NOW,
    );

    const survivor = await prisma.session.findUnique({ where: { id: target.id } });
    expect(survivor?.deletedAt).toBeNull();
    expect(survivor?.status).toBe('cancelled');
    expect(result.materialized.protectedSessions.flatMap((p) => p.reasons)).toContain('LIFECYCLE');
  });

  it('DOES remove plain, untouched sessions the rule no longer produces', async () => {
    // The other half of the guarantee: protection is for work, not for
    // everything. A schedule moved to Wednesdays must stop claiming Tuesdays.
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    await updateCourseSchedule(prisma, superAdmin(), id, { weekdays: ['wednesday'], version: 0 }, NOW);

    const dates = await datesOf(id);
    expect(dates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3)).toBe(true);
  });
});

describe('conflict detection against MATERIALIZED sessions (§4.4, TD-4.6c)', () => {
  it('refuses a second class in the same room at an overlapping time', async () => {
    await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);

    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({ startTime: at(16), endTime: at(18) }),
        NOW,
      ),
    );
    expect(err.code).toBe('SCHEDULE_CONFLICT');
    expect((err.details?.['conflicts'] as { kind: string }[])[0]?.kind).toBe('room');
  });

  it('allows a BACK-TO-BACK class in the same room — the boundary is not a clash', async () => {
    await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    // 15:00–17:00 then 17:00–19:00. Treating the touching boundary as a
    // collision would make consecutive classes impossible.
    await expect(
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({ startTime: at(17), endTime: at(19) }),
        NOW,
      ),
    ).resolves.toBeTruthy();
  });

  it('allows the same room on a DIFFERENT weekday', async () => {
    await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    await expect(
      createCourseSchedule(prisma, superAdmin(), baseInput({ weekdays: ['thursday'] }), NOW),
    ).resolves.toBeTruthy();
  });

  it('THE headline case: a biweekly class collides with a weekly one only on its own weeks', async () => {
    // A weekly Tuesday 15:00–17:00 in room A already exists.
    await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);

    // A biweekly-alternating Tuesday in the SAME room at the SAME time must be
    // refused — it collides on the weeks it runs. Comparing recurrence rules
    // could not tell this apart from the non-colliding case below.
    const clashing = await failure(() =>
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({ recurrence: 'biweekly_alternating', anchorDate: day('2026-06-02') }),
        NOW,
      ),
    );
    expect(clashing.code).toBe('SCHEDULE_CONFLICT');
  });

  it('…and the OFF weeks are genuinely free once the weekly class is fortnightly too', async () => {
    // Weekly → biweekly on the even weeks.
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ recurrence: 'biweekly_alternating', anchorDate: day('2026-06-02') }),
      NOW,
    );
    const first = await datesOf(id);
    expect(first).toContain('2026-06-02');
    expect(first).not.toContain('2026-06-09');

    // The opposite fortnight in the same room at the same time is FREE, and
    // this is the assertion rule-comparison could never make.
    const { id: second } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ recurrence: 'biweekly_alternating', anchorDate: day('2026-06-09') }),
      NOW,
    );
    const offWeek = await datesOf(second);
    expect(offWeek).toContain('2026-06-09');
    expect(offWeek.filter((d) => first.includes(d))).toEqual([]);
  });

  it('detects a TEACHER double-booked in two different rooms', async () => {
    const teacher = await person('الأستاذة');
    await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: teacher, position: 'teacher' }] }),
      NOW,
    );

    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({ roomId: roomB, staff: [{ userId: teacher, position: 'teacher' }] }),
        NOW,
      ),
    );
    expect(err.code).toBe('SCHEDULE_CONFLICT');
    expect((err.details?.['conflicts'] as { kind: string }[]).some((c) => c.kind === 'teacher')).toBe(
      true,
    );
  });

  it('detects an ASSISTANT double-booked, and reports them as an assistant', async () => {
    const helper = await person('المساعدة');
    await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: helper, position: 'assistant' }] }),
      NOW,
    );

    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({ roomId: roomB, staff: [{ userId: helper, position: 'assistant' }] }),
        NOW,
      ),
    );
    expect(err.code).toBe('SCHEDULE_CONFLICT');
    // The kind matters: an administrator resolving the clash needs to know
    // whether the person is the teacher or a helper.
    expect(
      (err.details?.['conflicts'] as { kind: string }[]).some((c) => c.kind === 'assistant'),
    ).toBe(true);
  });

  it('a CANCELLED session frees its room', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    for (const s of await prisma.session.findMany({ where: { scheduleId: id } })) {
      await cancelSession(prisma, superAdmin(), s.id, 'إلغاء', s.version);
    }
    // The row survives so the cancellation is visible, but it occupies nothing.
    await expect(createCourseSchedule(prisma, superAdmin(), baseInput(), NOW)).resolves.toBeTruthy();
  });

  it('does not conflict with ITSELF on edit', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    await expect(
      updateCourseSchedule(prisma, superAdmin(), id, { startTime: at(15, 30), version: 0 }, NOW),
    ).resolves.toBeTruthy();
    expect(await previewConflicts(prisma, superAdmin(), id, NOW)).toEqual([]);
  });
});

describe('branch and target agreement (§4.4)', () => {
  it('refuses a group at a different branch than the schedule', async () => {
    const elsewhere = await createAdministrativeGroup(prisma, superAdmin(), {
      name: `${TAG} مجموعة تاركة`,
      levelId,
      branchId: otherBranchId,
    });
    const err = await failure(() =>
      createCourseSchedule(prisma, superAdmin(), baseInput({ targetId: elsewhere.id }), NOW),
    );
    expect(err.details?.['reason']).toBe('BRANCH_MISMATCH');
  });

  it('refuses a room at a different branch', async () => {
    const elsewhere = await prisma.room.create({
      data: { name: `${TAG} قاعة تاركة`, branchId: otherBranchId },
    });
    const err = await failure(() =>
      createCourseSchedule(prisma, superAdmin(), baseInput({ roomId: elsewhere.id }), NOW),
    );
    expect(err.details?.['reason']).toBe('ROOM_BRANCH_MISMATCH');
  });

  it('an admin outside the branch is refused with 404, not 403', async () => {
    const err = await failure(() =>
      createCourseSchedule(prisma, admin([otherBranchId]), baseInput(), NOW),
    );
    expect(err.code).toBe('NOT_FOUND');
  });

  it('BR-23: a tiny room capacity refuses nothing', async () => {
    await prisma.room.update({ where: { id: roomA }, data: { capacity: 1 } });
    await expect(createCourseSchedule(prisma, superAdmin(), baseInput(), NOW)).resolves.toBeTruthy();
  });
});

describe('session lifecycle (TD-1)', () => {
  async function oneSession(): Promise<{ id: string; version: number }> {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const s = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-16') },
    });
    return { id: s.id, version: s.version };
  }

  it('cancel requires a reason, and keeps the row', async () => {
    const s = await oneSession();
    const blank = await failure(() => cancelSession(prisma, superAdmin(), s.id, '   ', s.version));
    expect(blank.details?.['reason']).toBe('CANCELLATION_REASON_REQUIRED');

    const cancelled = await cancelSession(prisma, superAdmin(), s.id, 'عطلة رسمية', s.version);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancellationReason).toBe('عطلة رسمية');
  });

  it('records the audience size on cancellation — unanswerable later', async () => {
    const student = await person('طالبة');
    await prisma.enrollment.create({
      data: { studentId: student, administrativeGroupId: groupId, levelId },
    });
    const s = await oneSession();
    await cancelSession(prisma, superAdmin(), s.id, 'عطلة', s.version);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: 'session.cancel', targetId: s.id },
    });
    expect((row.detail as { audience_size?: number }).audience_size).toBe(1);
  });

  it('restore reverses a cancellation before the date', async () => {
    const s = await oneSession();
    const cancelled = await cancelSession(prisma, superAdmin(), s.id, 'عطلة', s.version);
    const restored = await restoreSession(prisma, superAdmin(), s.id, cancelled.version, NOW);
    expect(restored.status).toBe('scheduled');
    // The former reason survives: why a class was once cancelled is history.
    expect(restored.cancellationReason).toBe('عطلة');
  });

  it('refuses to restore a session whose date has passed', async () => {
    const s = await oneSession();
    const cancelled = await cancelSession(prisma, superAdmin(), s.id, 'عطلة', s.version);
    const later = new Date('2026-07-01T08:00:00.000Z');
    const err = await failure(() =>
      restoreSession(prisma, superAdmin(), s.id, cancelled.version, later),
    );
    expect(err.details?.['reason']).toBe('SESSION_IN_PAST');
  });

  it('held is terminal — every transition out of it is STATE_CONFLICT', async () => {
    const s = await oneSession();
    const held = await markHeld(prisma, superAdmin(), s.id, s.version);
    expect(held.status).toBe('held');

    const cancel = await failure(() =>
      cancelSession(prisma, superAdmin(), s.id, 'متأخر', held.version),
    );
    expect(cancel.code).toBe('STATE_CONFLICT');
    expect(cancel.details?.['reason']).toBe('INVALID_TRANSITION');

    const reschedule = await failure(() =>
      overrideSession(prisma, superAdmin(), s.id, { roomId: roomB, version: held.version }),
    );
    expect(reschedule.details?.['reason']).toBe('ALREADY_HELD');
  });

  it('an override marks the row and survives a later schedule edit', async () => {
    const s = await oneSession();
    const moved = await overrideSession(prisma, superAdmin(), s.id, {
      startTime: at(9),
      endTime: at(10),
      version: s.version,
    });
    expect(moved.overridden).toBe(true);
    // A field edit, NOT a transition (TD-1) — the status is untouched.
    expect(moved.status).toBe('scheduled');
  });

  it('a stale version is a coded conflict, never a silent overwrite (TD-15)', async () => {
    const s = await oneSession();
    await overrideSession(prisma, superAdmin(), s.id, { roomId: roomB, version: s.version });
    const stale = await failure(() =>
      overrideSession(prisma, superAdmin(), s.id, { roomId: roomA, version: s.version }),
    );
    expect(stale.code).toBe('VERSION_CONFLICT');
  });
});

describe('SessionContent — referenced, never owned (§4.9)', () => {
  it('unlinking leaves the file itself untouched', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const s = await prisma.session.findFirstOrThrow({ where: { scheduleId: id } });
    const content = await prisma.educationalContent.create({
      data: {
        title: `${TAG} ملف`,
        levelId,
        subjectId,
        academicYearId,
        storageBucket: 'private',
        storageKey: `${TAG}/k2/${Date.now()}`,
        originalFilename: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(10),
      },
    });

    await linkContent(prisma, superAdmin(), s.id, content.id);
    await unlinkContent(prisma, superAdmin(), s.id, content.id);

    const still = await prisma.educationalContent.findUnique({ where: { id: content.id } });
    expect(still?.deletedAt).toBeNull();
  });

  it('one content item may be referenced by several sessions', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const sessions = await prisma.session.findMany({ where: { scheduleId: id }, take: 3 });
    const content = await prisma.educationalContent.create({
      data: {
        title: `${TAG} ملف الفصل`,
        levelId,
        subjectId,
        academicYearId,
        storageBucket: 'private',
        storageKey: `${TAG}/k3/${Date.now()}`,
        originalFilename: 'semester.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(10),
      },
    });

    for (const s of sessions) await linkContent(prisma, superAdmin(), s.id, content.id);

    expect(
      await prisma.sessionContent.count({ where: { contentId: content.id, deletedAt: null } }),
    ).toBe(sessions.length);
  });
});

describe('deleting a schedule (TD-5)', () => {
  it('removes future plain sessions and RETAINS held ones', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const first = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-02') },
    });
    await markHeld(prisma, superAdmin(), first.id, first.version);

    const result = await deleteCourseSchedule(prisma, superAdmin(), id, NOW);

    expect(result.futureRemoved).toBeGreaterThan(0);
    // A held session records what happened; discontinuing a schedule does not
    // un-teach it.
    const survivor = await prisma.session.findUnique({ where: { id: first.id } });
    expect(survivor?.deletedAt).toBeNull();
    expect(survivor?.status).toBe('held');
  });
});

describe('Revision 43.4 — a Session snapshots its teaching assignment', () => {
  it('materializes each session WITH the schedule’s room and staff', async () => {
    const teacher = await person('الأستاذة');
    const helper = await person('المساعدة');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        staff: [
          { userId: teacher, position: 'teacher' },
          { userId: helper, position: 'assistant' },
        ],
      }),
      NOW,
    );

    const s = await prisma.session.findFirstOrThrow({ where: { scheduleId: id } });
    expect(s.roomId).toBe(roomA);
    const staff = await prisma.sessionStaff.findMany({
      where: { sessionId: s.id, deletedAt: null },
      select: { userId: true, position: true },
    });
    expect(staff.map((x) => `${x.position}:${x.userId}`).sort()).toEqual(
      [`teacher:${teacher}`, `assistant:${helper}`].sort(),
    );
  });

  it('a HELD session keeps its original staffing when the schedule changes', async () => {
    // The reason the snapshot exists. Re-deriving from the schedule would claim
    // the new teacher taught a class they were never at.
    const original = await person('الأستاذة الأولى');
    const replacement = await person('الأستاذة الثانية');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: original, position: 'teacher' }] }),
      NOW,
    );
    const past = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-02') },
    });
    await markHeld(prisma, superAdmin(), past.id, past.version);

    // The schedule changes hands entirely.
    await prisma.courseScheduleStaff.updateMany({
      where: { scheduleId: id },
      data: { deletedAt: new Date() },
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: id, userId: replacement, position: 'teacher' },
    });
    await updateCourseSchedule(prisma, superAdmin(), id, { startTime: at(16), version: 0 }, NOW);

    const heldStaff = await prisma.sessionStaff.findMany({
      where: { sessionId: past.id, deletedAt: null },
      select: { userId: true },
    });
    expect(heldStaff.map((x) => x.userId)).toEqual([original]);
    // …and its time is untouched too: history is history.
    const stillHeld = await prisma.session.findUniqueOrThrow({ where: { id: past.id } });
    expect(stillHeld.startTime.toISOString()).toBe(past.startTime.toISOString());
  });

  it('FUTURE un-overridden sessions ARE re-synced to the new schedule', async () => {
    // The other half: the snapshot protects history, not the future. Without
    // this, §4.4's promise that an edit "rewrites future Sessions" is false —
    // and it WAS false before Revision 43.4.
    const original = await person('الأستاذة الأولى');
    const replacement = await person('الأستاذة الثانية');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: original, position: 'teacher' }] }),
      NOW,
    );

    await prisma.courseScheduleStaff.updateMany({
      where: { scheduleId: id },
      data: { deletedAt: new Date() },
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: id, userId: replacement, position: 'teacher' },
    });
    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { startTime: at(16), roomId: roomB, version: 0 },
      NOW,
    );

    expect(result.materialized.resynced).toBeGreaterThan(0);
    const future = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-16') },
      include: { staff: { where: { deletedAt: null }, select: { userId: true } } },
    });
    expect(future.roomId).toBe(roomB);
    expect(future.startTime.toISOString()).toBe(at(16).toISOString());
    expect(future.staff.map((x) => x.userId)).toEqual([replacement]);
  });

  it('an OVERRIDDEN future session is NOT re-synced', async () => {
    const original = await person('الأستاذة الأولى');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: original, position: 'teacher' }] }),
      NOW,
    );
    const target = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-16') },
    });
    await overrideSession(prisma, superAdmin(), target.id, {
      roomId: roomB,
      version: target.version,
    });

    await updateCourseSchedule(prisma, superAdmin(), id, { roomId: roomA, version: 0 }, NOW);

    const after = await prisma.session.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.roomId).toBe(roomB);
  });

  it('an override can replace the occurrence’s staff, and records old→new', async () => {
    const original = await person('الأستاذة الأولى');
    const cover = await person('الأستاذة البديلة');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: original, position: 'teacher' }] }),
      NOW,
    );
    const target = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-16') },
    });

    await overrideSession(prisma, superAdmin(), target.id, {
      staff: [{ userId: cover, position: 'teacher' }],
      version: target.version,
    });

    const staff = await prisma.sessionStaff.findMany({
      where: { sessionId: target.id, deletedAt: null },
      select: { userId: true },
    });
    expect(staff.map((x) => x.userId)).toEqual([cover]);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: 'session.override', targetId: target.id },
    });
    const changed = (row.detail as { changed?: Record<string, { from: string; to: string }> })
      .changed;
    expect(changed?.['staff']?.from).toContain(original);
    expect(changed?.['staff']?.to).toContain(cover);
  });

  it('a person covering ONE session is detected as a conflict for that date', async () => {
    // Conflict detection reads the session's own snapshot, so an individually
    // assigned cover is visible to it. Asking the schedule would miss them.
    const cover = await person('الأستاذة البديلة');
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const target = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-16') },
    });
    await overrideSession(prisma, superAdmin(), target.id, {
      staff: [{ userId: cover, position: 'teacher' }],
      version: target.version,
    });

    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({
          roomId: roomB,
          weekdays: ['tuesday'],
          staff: [{ userId: cover, position: 'teacher' }],
        }),
        NOW,
      ),
    );
    expect(err.code).toBe('SCHEDULE_CONFLICT');
    expect(
      (err.details?.['conflicts'] as { date: string }[]).some((c) => c.date === '2026-06-16'),
    ).toBe(true);
  });

  it('regenerate is the ONLY way to re-align history, and records what it overwrote', async () => {
    const original = await person('الأستاذة الأولى');
    const replacement = await person('الأستاذة الثانية');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: original, position: 'teacher' }] }),
      NOW,
    );
    const past = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-02') },
    });
    await markHeld(prisma, superAdmin(), past.id, past.version);

    await prisma.courseScheduleStaff.updateMany({
      where: { scheduleId: id },
      data: { deletedAt: new Date() },
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: id, userId: replacement, position: 'teacher' },
    });

    await regenerateSessions(prisma, superAdmin(), [past.id]);

    const after = await prisma.sessionStaff.findMany({
      where: { sessionId: past.id, deletedAt: null },
      select: { userId: true },
    });
    expect(after.map((x) => x.userId)).toEqual([replacement]);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: 'session.regenerate', targetId: past.id },
    });
    const overwrote = (row.detail as { overwrote?: { staff?: string[] } }).overwrote;
    // After this the previous truth exists nowhere else, which is why it is
    // captured here.
    expect(overwrote?.staff?.join(',')).toContain(original);
  });

  it('a teacher may not regenerate — rewriting a taught class is not a teaching action', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const s = await prisma.session.findFirstOrThrow({ where: { scheduleId: id } });
    const teacher = await person('الأستاذة');
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: id, userId: teacher, position: 'teacher' },
    });

    const err = await failure(() =>
      regenerateSessions(
        prisma,
        { userId: teacher, roles: ['teacher'], roleScopes: [{ role: 'teacher', branches: null }] },
        [s.id],
      ),
    );
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('Revision 43.5 — a Session carrying educational work is protected', () => {
  /** Attaches a piece of educational content to a session — the one kind of
   *  "work" that exists today. Attendance (§4.7) and notes (§10.1) join the
   *  same predicate when they ship. */
  async function attachWork(sessionId: string): Promise<string> {
    const content = await prisma.educationalContent.create({
      data: {
        title: `${TAG} تسجيل`,
        levelId,
        subjectId,
        academicYearId,
        storageBucket: 'private',
        storageKey: `${TAG}/w/${Date.now()}-${Math.random()}`,
        originalFilename: 'lesson.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: BigInt(1024),
      },
    });
    await linkContent(prisma, superAdmin(), sessionId, content.id);
    return content.id;
  }

  it('a FUTURE session with work is protected — the rule is date-independent', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    // Well in the future, and NOT overridden: work alone must protect it.
    const future = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-30') },
    });
    await attachWork(future.id);
    expect(future.overridden).toBe(false);

    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { weekdays: ['wednesday'], roomId: roomB, version: 0 },
      NOW,
    );

    const after = await prisma.session.findUniqueOrThrow({ where: { id: future.id } });
    expect(after.deletedAt).toBeNull();
    // Neither deleted by the weekday change nor re-pointed by the room change.
    expect(after.roomId).toBe(roomA);
    expect(result.materialized.protectedSessions.flatMap((p) => p.reasons)).toContain('HAS_CONTENT');
  });

  it('a future session with work keeps its STAFF when the schedule changes hands', async () => {
    const original = await person('الأستاذة الأولى');
    const replacement = await person('الأستاذة الثانية');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: original, position: 'teacher' }] }),
      NOW,
    );
    const future = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-30') },
    });
    await attachWork(future.id);

    await prisma.courseScheduleStaff.updateMany({
      where: { scheduleId: id },
      data: { deletedAt: new Date() },
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: id, userId: replacement, position: 'teacher' },
    });
    await updateCourseSchedule(prisma, superAdmin(), id, { startTime: at(16), version: 0 }, NOW);

    const staff = await prisma.sessionStaff.findMany({
      where: { sessionId: future.id, deletedAt: null },
      select: { userId: true },
    });
    expect(staff.map((x) => x.userId)).toEqual([original]);
  });

  it('DELETING the schedule also spares a future session carrying work', async () => {
    // The path that used to re-implement the predicate inline. Before it was
    // unified, attendance would have joined the protection for edits and not
    // for deletes.
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const future = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-30') },
    });
    await attachWork(future.id);

    await deleteCourseSchedule(prisma, superAdmin(), id, NOW);

    expect((await prisma.session.findUniqueOrThrow({ where: { id: future.id } })).deletedAt).toBeNull();
  });

  it('regeneration requires the sessions to be NAMED — there is no blanket option', async () => {
    const empty = await failure(() => regenerateSessions(prisma, superAdmin(), []));
    expect(empty.code).toBe('VALIDATION_FAILED');
    // An option that can be defaulted true is not a confirmation, so none exists.
    expect(empty.details?.['reason']).toBe('NO_SESSIONS_NAMED');
  });

  it('naming a protected future session regenerates it, and records WHY it was protected', async () => {
    const original = await person('الأستاذة الأولى');
    const replacement = await person('الأستاذة الثانية');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: original, position: 'teacher' }] }),
      NOW,
    );
    const future = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-30') },
    });
    const contentId = await attachWork(future.id);

    await prisma.courseScheduleStaff.updateMany({
      where: { scheduleId: id },
      data: { deletedAt: new Date() },
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: id, userId: replacement, position: 'teacher' },
    });
    await updateCourseSchedule(prisma, superAdmin(), id, { roomId: roomB, version: 0 }, NOW);

    await regenerateSessions(prisma, superAdmin(), [future.id]);

    const after = await prisma.session.findUniqueOrThrow({ where: { id: future.id } });
    expect(after.roomId).toBe(roomB);
    const staff = await prisma.sessionStaff.findMany({
      where: { sessionId: future.id, deletedAt: null },
      select: { userId: true },
    });
    expect(staff.map((x) => x.userId)).toEqual([replacement]);

    // The work itself SURVIVES: regeneration re-points the occurrence, it does
    // not discard what someone attached to it.
    expect(
      await prisma.sessionContent.count({ where: { sessionId: future.id, deletedAt: null } }),
    ).toBe(1);
    expect(contentId).toBeTruthy();

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: 'session.regenerate', targetId: future.id },
    });
    const detail = row.detail as { was_protected_for?: string[]; overwrote?: { staff?: string[] } };
    expect(detail.was_protected_for).toContain('HAS_CONTENT');
    expect(detail.overwrote?.staff?.join(',')).toContain(original);
  });

  it('regenerating several sessions at once still names each one', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const a = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-16') },
    });
    const b = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-30') },
    });
    await attachWork(a.id);
    await attachWork(b.id);

    const result = await regenerateSessions(prisma, superAdmin(), [a.id, b.id]);
    expect(result.regenerated.sort()).toEqual([a.id, b.id].sort());
    expect(
      await prisma.auditLog.count({
        where: { actionType: 'session.regenerate', targetId: { in: [a.id, b.id] } },
      }),
    ).toBe(2);
  });
});

describe('SRS Revision 50 — "this session and all future sessions" splits the schedule', () => {
  /** The third Tuesday of the run, safely inside the horizon and after some
   *  occurrences have already been generated. */
  const SPLIT = '2026-06-16';

  it('closes the original and anchors a successor at the split date', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const before = await datesOf(id);
    expect(before).toContain(SPLIT);

    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { version: 0, roomId: roomB, scope: 'this_and_future', fromDate: day(SPLIT) },
      NOW,
    );

    expect(result.successorId).toBeDefined();
    const closed = await prisma.recurringCourseSchedule.findUniqueOrThrow({ where: { id } });
    // Closed the DAY BEFORE, so the split date itself belongs to the successor.
    expect(closed.effectiveUntil?.toISOString().slice(0, 10)).toBe('2026-06-15');
    const successor = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: result.successorId! },
    });
    expect(successor.anchorDate?.toISOString().slice(0, 10)).toBe(SPLIT);
    expect(successor.roomId).toBe(roomB);
  });

  it('leaves past occurrences alone and gives later ones to the successor', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { version: 0, roomId: roomB, scope: 'this_and_future', fromDate: day(SPLIT) },
      NOW,
    );

    // The original keeps everything before the split — those sessions belong to
    // a rule that has not changed for any date it still covers.
    const kept = await datesOf(id);
    expect(kept.every((d) => d < SPLIT)).toBe(true);
    expect(kept).toContain('2026-06-02');

    // And the successor owns the split date onward.
    const moved = await datesOf(result.successorId!);
    expect(moved.every((d) => d >= SPLIT)).toBe(true);
    expect(moved).toContain(SPLIT);
  });

  it('materializes NOTHING after `effective_until` — the bound is real', async () => {
    // §18: a split schedule produces no occurrence past its end. Re-running
    // materialization is the honest test, because that is what the nightly cron
    // does and where an unbounded rule would show up.
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { version: 0, roomId: roomB, scope: 'this_and_future', fromDate: day(SPLIT) },
      NOW,
    );

    await runMaterialization(prisma, { schedule_id: id }, NOW);
    expect((await datesOf(id)).filter((d) => d >= SPLIT)).toEqual([]);
  });

  it('PRESERVES an overridden session — the split does not own it', async () => {
    // The whole reason "this session only" and "this and all future" coexist:
    // an occurrence a human decided about (R43.4) is not the split's to move,
    // and the same protection predicate every other scheduling path asks
    // (R43.6) is what keeps it.
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const target = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id, date: day('2026-06-23') },
    });
    await prisma.session.update({ where: { id: target.id }, data: { overridden: true } });

    await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { version: 0, roomId: roomB, scope: 'this_and_future', fromDate: day(SPLIT) },
      NOW,
    );

    const survivor = await prisma.session.findUnique({ where: { id: target.id } });
    expect(survivor?.deletedAt).toBeNull();
    // Still the ORIGINAL schedule's session: a split moves the rule, never the
    // decisions somebody already made about individual occurrences.
    expect(survivor?.scheduleId).toBe(id);
  });

  it('COPIES the staff, or the teacher vanishes from every future session', async () => {
    // §4.4 names this failure explicitly, because it would look like a UI bug
    // for weeks rather than like a split that dropped a column.
    const teacher = await person('الأستاذة');
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ staff: [{ userId: teacher, position: 'teacher' }] }),
      NOW,
    );

    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { version: 0, roomId: roomB, scope: 'this_and_future', fromDate: day(SPLIT) },
      NOW,
    );

    const staff = await prisma.courseScheduleStaff.findMany({
      where: { scheduleId: result.successorId!, deletedAt: null },
    });
    expect(staff.map((s) => s.userId)).toEqual([teacher]);
    // And it reached the sessions, which is what anybody actually notices.
    const session = await prisma.session.findFirstOrThrow({
      where: { scheduleId: result.successorId!, deletedAt: null },
      include: { staff: true },
    });
    expect(session.staff.map((s) => s.userId)).toEqual([teacher]);
  });

  it('refuses `this_and_future` with no from_date', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const e = await failure(() =>
      updateCourseSchedule(prisma, superAdmin(), id, { version: 0, scope: 'this_and_future' }, NOW),
    );
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.details?.['reason']).toBe('FROM_DATE_REQUIRED');
  });

  it('leaves `all_sessions` behaving exactly as before', async () => {
    // The default is unchanged by R50, and that is worth a test rather than an
    // assumption: the whole revision is additive.
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const result = await updateCourseSchedule(prisma, superAdmin(), id, { version: 0, roomId: roomB }, NOW);

    expect(result.successorId).toBeUndefined();
    expect(
      (await prisma.recurringCourseSchedule.findUniqueOrThrow({ where: { id } })).effectiveUntil,
    ).toBeNull();
    expect(await prisma.recurringCourseSchedule.count({ where: { subjectId, deletedAt: null } })).toBe(1);
  });
});

describe('listing a schedule\'s occurrences (§4.4, Revision 50)', () => {
  it('returns them chronologically, with the protection reasons the dialog needs', async () => {
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const page = await listScheduleSessions(prisma, superAdmin(), id, {});

    expect(page.data.length).toBeGreaterThan(0);
    const dates = page.data.map((s) => s.date.toISOString().slice(0, 10));
    expect([...dates].sort()).toEqual(dates);
    // Nothing is protected yet, and an EMPTY list is the meaningful answer: it
    // says a schedule edit or a split may rewrite this occurrence.
    expect(page.data.every((s) => s.protectedReasons.length === 0)).toBe(true);
  });

  it('names WHY an occurrence is protected, using the shared rules', async () => {
    // §4.4 requires the dialog to state which occurrences will change, which is
    // unanswerable without knowing which are spared — and the codes come from
    // the same R43.6 rule set every scheduling path asks, not a second copy.
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const first = await prisma.session.findFirstOrThrow({
      where: { scheduleId: id },
      orderBy: { date: 'asc' },
    });
    await prisma.session.update({ where: { id: first.id }, data: { overridden: true } });

    const page = await listScheduleSessions(prisma, superAdmin(), id, {});
    const row = page.data.find((s) => s.id === first.id)!;
    expect(row.overridden).toBe(true);
    expect(row.protectedReasons.length).toBeGreaterThan(0);
  });

  it('answers 404 for a schedule outside the caller\'s branch scope', async () => {
    // §20 rule 17: out of reach is NOT_FOUND, never FORBIDDEN — expressed in the
    // lookup rather than as a check afterwards.
    const { id } = await createCourseSchedule(prisma, superAdmin(), baseInput(), NOW);
    const e = await failure(() => listScheduleSessions(prisma, admin([otherBranchId]), id, {}));
    expect(e.code).toBe('NOT_FOUND');
  });
});
