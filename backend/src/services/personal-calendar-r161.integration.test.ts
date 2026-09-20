import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import type { Actor } from "../policies/actor.js";
import { readCalendar, type CalendarActor } from "./calendar.service.js";
import { setSessionAudienceOverrides } from "./session.service.js";
import {
  clearTeachingContext,
  createTeachingContext,
  enrol,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";

/**
 * **Codex review, 2026-09-20 — `personalFilters`'s Session predicate reaches
 * `multi_dimension` schedules and Revision 161's four newer occurrence
 * overrides, not only the three legacy modes and the branch table R92 left
 * behind.**
 *
 * Before this fix a beneficiary of a `multi_dimension` class could miss its
 * Sessions on her own calendar entirely, and an occurrence combined by
 * Level, Category, Administrative Group or Circle (Revision 161 — R92
 * previously covered only branches) was invisible to exactly the students it
 * was meant to add. `session-audience.http.integration.test.ts` already
 * proves the SERVER-SIDE roster those overrides resolve to; this proves the
 * SAME occurrences reach `GET /calendar?mine=true` for the students they
 * name — the two are deliberately different consumers of one resolver
 * (`audienceForSession`), and R92's own docstring is explicit that letting
 * them disagree is the one failure this architecture exists to prevent.
 *
 * The precision test at the end is the other half: the SQL-level predicate
 * is a deliberate SUPERSET (documented beside `personalFilters` itself), so
 * this also proves `filterSessionsByPersonalAudience` actually narrows it
 * back down rather than leaking a session to someone an override does not
 * really name.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[r161-personal-cal-test]";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
// Matches `createTeachingContext`'s own hard-coded occurrence date, so its
// fixture session needs no extra materialization to fall inside this range.
const range = { from: day("2026-09-01"), to: day("2026-09-30") };

let actorUserId: string;
const staffActor = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = () => staffActor([{ role: "super_admin", branches: null }]);

const viewer = (userId: string): CalendarActor => ({
  userId,
  roles: ["student"],
  roleScopes: [{ role: "student", branches: null }],
  accountStatus: "active",
});

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  return u.id;
}

async function makeBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: day("2020-01-01") },
  });
  return b.id;
}

/** A genuine `multi_dimension`-mode schedule, scoped to one Administrative
 *  Group — the mode `personalFilters` never resolved at all before this fix. */
async function multiDimensionSchedule(
  ctx: TeachingFixture,
  branchId: string,
): Promise<{ scheduleId: string; sessionId: string }> {
  const academicYear = await prisma.academicYear.findFirstOrThrow({ select: { id: true } });
  // **One transaction.** `course_schedule_multi_dimension_nonempty` is a
  // `DEFERRABLE INITIALLY DEFERRED` constraint trigger, checked at COMMIT —
  // exactly so the service can write the schedule row, then its join rows,
  // inside one transaction. Two separate top-level `prisma.create()` calls
  // each auto-commit on their own, so the schedule's own commit fires the
  // trigger before its join row exists at all.
  return prisma.$transaction(async (tx) => {
    const schedule = await tx.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة متعددة الأبعاد`,
        subjectId: ctx.subjectId,
        teachingMode: "multi_dimension",
        branchId,
        startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 10, 30, 0)),
        recurrence: "weekly",
        weekdays: ["saturday" as never],
        academicYearId: academicYear.id,
      },
    });
    await tx.courseScheduleAdministrativeGroup.create({
      data: { scheduleId: schedule.id, administrativeGroupId: ctx.administrativeGroupId },
    });
    const session = await tx.session.create({
      data: {
        scheduleId: schedule.id,
        date: day("2026-09-12"),
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      },
    });
    return { scheduleId: schedule.id, sessionId: session.id };
  });
}

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  const sessions = await prisma.session.findMany({
    where: { scheduleId: { in: scheduleIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  await prisma.sessionAudienceBranch.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.sessionAudienceCategory.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.sessionAudienceLevel.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.sessionAudienceAdministrativeGroup.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.sessionAudienceTeachingGroup.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: sessionIds } } });
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.courseScheduleAdministrativeGroup.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.courseScheduleTeachingGroup.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });

  await prisma.studentTeachingGroup.deleteMany({ where: { teachingGroup: { name: { startsWith: TAG } } } });
  await prisma.teachingGroup.deleteMany({ where: { name: { startsWith: TAG } } });

  await clearTeachingContext(prisma, TAG);

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

let ctxA: TeachingFixture;
let ctxB: TeachingFixture;

beforeEach(async () => {
  await clear();
  actorUserId = await person("فاعلة");
  const branchA = await makeBranch("فرع أ");
  const branchB = await makeBranch("فرع ب");
  ctxA = await createTeachingContext(prisma, TAG, branchA);
  ctxB = await createTeachingContext(prisma, TAG, branchB);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const scoped = (rows: { id: string }[], sessionId: string) => rows.some((r) => r.id === sessionId);

describe("Codex review, 2026-09-20 — a multi_dimension class reaches its beneficiaries' personal calendars", () => {
  it("a student enrolled in the scoped Administrative Group sees the Session", async () => {
    const studentId = await person("مستفيدة أ");
    await enrol(prisma, ctxA, studentId);
    const { sessionId } = await multiDimensionSchedule(ctxA, ctxA.branchId);

    const rows = await readCalendar(prisma, viewer(studentId), { ...range, mine: true });
    expect(scoped(rows, sessionId)).toBe(true);
  });

  it("a student enrolled in a DIFFERENT group does not see it", async () => {
    const studentId = await person("مستفيدة ب");
    await enrol(prisma, ctxB, studentId);
    const { sessionId } = await multiDimensionSchedule(ctxA, ctxA.branchId);

    const rows = await readCalendar(prisma, viewer(studentId), { ...range, mine: true });
    expect(scoped(rows, sessionId)).toBe(false);
  });
});

describe("Codex review, 2026-09-20 — Revision 161's four newer occurrence overrides reach the personal calendar, not only R92's branch table", () => {
  it("an Administrative Group override adds a student OUTSIDE the schedule's own natural audience", async () => {
    // ctxA's session naturally reaches ctxA's own Administrative Group only
    // (this mode's Level/Category/Branch dimensions are all naturally EMPTY
    // — `naturalDimensions` — so combining the SAME kind the mode already
    // constrains by, its own Administrative Group, is what actually adds a
    // new population; an override on an UNRELATED dimension would leave
    // this natural Group constraint standing and AND against it instead).
    // A student enrolled ONLY in ctxB's group has no natural path to it —
    // the OLD `personalFilters` never consulted `audienceAdministrativeGroups`
    // at all, so she stayed invisible to it even after this exact override
    // was set.
    const studentId = await person("مستفيدة ج — تُضاف بمجموعة");
    await enrol(prisma, ctxB, studentId);

    await setSessionAudienceOverrides(prisma, superAdmin(), ctxA.sessionId, 0, {
      branchIds: [],
      categoryIds: [],
      levelIds: [],
      administrativeGroupIds: [ctxA.administrativeGroupId, ctxB.administrativeGroupId],
      teachingGroupIds: [],
    });

    const rows = await readCalendar(prisma, viewer(studentId), { ...range, mine: true });
    expect(scoped(rows, ctxA.sessionId)).toBe(true);
  });

  it("a Circle override adds its members, whatever the schedule's mode", async () => {
    const circle = await prisma.teachingGroup.create({
      data: { name: `${TAG} حلقة`, subjectId: ctxB.subjectId, levelId: ctxB.levelId },
    });
    const studentId = await person("مستفيدة د — حلقة");
    await prisma.studentTeachingGroup.create({
      data: {
        studentId,
        teachingGroupId: circle.id,
        subjectId: ctxB.subjectId,
        levelId: ctxB.levelId,
      },
    });

    await setSessionAudienceOverrides(prisma, superAdmin(), ctxA.sessionId, 0, {
      branchIds: [],
      categoryIds: [],
      levelIds: [],
      administrativeGroupIds: [],
      teachingGroupIds: [circle.id],
    });

    const rows = await readCalendar(prisma, viewer(studentId), { ...range, mine: true });
    expect(scoped(rows, ctxA.sessionId)).toBe(true);
  });

  it("clearing the override removes her again", async () => {
    const studentId = await person("مستفيدة هـ — تُزال");
    await enrol(prisma, ctxB, studentId);
    await setSessionAudienceOverrides(prisma, superAdmin(), ctxA.sessionId, 0, {
      branchIds: [],
      categoryIds: [],
      levelIds: [],
      administrativeGroupIds: [ctxA.administrativeGroupId, ctxB.administrativeGroupId],
      teachingGroupIds: [],
    });
    // The "before" state is verified too — otherwise this test would pass
    // vacuously if the override had never taken effect at all.
    const before = await readCalendar(prisma, viewer(studentId), { ...range, mine: true });
    expect(scoped(before, ctxA.sessionId)).toBe(true);

    await setSessionAudienceOverrides(prisma, superAdmin(), ctxA.sessionId, 1, {
      branchIds: [],
      categoryIds: [],
      levelIds: [],
      administrativeGroupIds: [],
      teachingGroupIds: [],
    });

    const rows = await readCalendar(prisma, viewer(studentId), { ...range, mine: true });
    expect(scoped(rows, ctxA.sessionId)).toBe(false);
  });
});

describe("Codex review, 2026-09-20 — the SQL candidate filter is a deliberate superset; the result must not leak beyond it", () => {
  it("a Category override that does not name her real category does not admit a student the group dimension still excludes", async () => {
    // ctxA's session is `administrative_group` mode: its NATURAL audience is
    // bound to ctxA's own group, unaffected by a Category override (Category
    // and Administrative Group are independent dimensions of the same
    // synthetic spec). A student enrolled only in ctxB — a different group,
    // a different branch — must stay excluded even though the SQL
    // pre-filter's broad "any override table names one of my ids" arm would
    // otherwise have picked this Session up as a CANDIDATE.
    const studentId = await person("مستفيدة و — لا تسرّب");
    await enrol(prisma, ctxB, studentId);

    await setSessionAudienceOverrides(prisma, superAdmin(), ctxA.sessionId, 0, {
      branchIds: [],
      categoryIds: [ctxB.categoryId],
      levelIds: [],
      administrativeGroupIds: [],
      teachingGroupIds: [],
    });

    const rows = await readCalendar(prisma, viewer(studentId), { ...range, mine: true });
    expect(scoped(rows, ctxA.sessionId)).toBe(false);
  });
});
