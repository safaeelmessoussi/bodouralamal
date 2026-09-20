import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import { studentsTaughtBy, teachesQuran } from "./roster-resolution.js";
import { overrideSession } from "../services/session.service.js";
import {
  clearTeachingContext,
  createTeachingContext,
  enrol,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";

/**
 * **Codex review, 2026-09-20 — a session's OWN Subject override (Revision
 * 161) now decides «is this a حفظ القرآن occurrence», not only the schedule's.**
 *
 * `teachesQuran`'s one-off-occurrence arm and `studentsTaughtBy`'s occurrence
 * arm both read `schedule.subjectId` unconditionally. The consequential
 * direction is not the missed positive (a one-off Quran cover on a non-Quran
 * schedule) — it is the false one this suite pins first: a مؤطِّرة covering a
 * single SESSION that was retaught AWAY from حفظ القرآن for that date kept
 * being offered «إدخال الحفظ» and kept reaching that student's memorisation
 * through `studentsTaughtBy`, because the check never looked past the
 * schedule's ordinary Subject.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[r161-subject-capability-test]";

const superAdmin = (userId: string): Actor => ({
  userId,
  roles: ["super_admin"],
  roleScopes: [{ role: "super_admin", branches: null }],
});

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  return u.id;
}

async function makeBranch(): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} فرع`, operationalStartDate: new Date("2020-01-01") },
  });
  return b.id;
}

async function clear(): Promise<void> {
  await prisma.sessionStaff.deleteMany({
    where: { session: { schedule: { subject: { name: { startsWith: TAG } } } } },
  });
  // **The "retaught away" test reassigns `ctx.scheduleId`'s own `subjectId`
  // to the (non-TAG) seeded حفظ القرآن Subject** — after that,
  // `clearTeachingContext`'s own cleanup, which finds a suite's schedules by
  // matching their SUBJECT's name against the TAG, can no longer find this
  // one at all, and it would be left referencing `createTeachingContext`'s
  // Administrative Group when `clearTeachingContext` tries to delete that
  // group — a RESTRICT failure. Found by BRANCH instead (branch names are
  // never reassigned) and swept first.
  const orphanable = await prisma.recurringCourseSchedule.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const orphanableIds = orphanable.map((s) => s.id);
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: orphanableIds } } } });
  await prisma.sessionSurah.deleteMany({ where: { session: { scheduleId: { in: orphanableIds } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: orphanableIds } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: orphanableIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: orphanableIds } } });
  // **Never the seeded حفظ القرآن Subject itself** — `subject_one_quran_
  // tracker` is a platform-wide unique index (at most one Subject may carry
  // the marker), so this suite reuses the SAME row every other test file
  // that needs it does (`journey.integration.test.ts`'s own established
  // pattern) rather than creating a second one. Only the `levelSubject` link
  // this suite made to it is TAG-owned — cleaned up here, BEFORE
  // `clearTeachingContext` deletes the (TAG-prefixed) Level it points at,
  // since that link is otherwise invisible to `clearTeachingContext`'s own
  // subject-scoped `levelSubject` cleanup (the Quran Subject itself carries
  // no TAG).
  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.levelSurah.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
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

/** الفاتحة — the one Surah this fixture's Level has reached. */
const SURAH = 1;

let ctx: TeachingFixture;
let quranSubjectId: string;
let studentId: string;
let admin: string;

beforeEach(async () => {
  await clear();
  const branchId = await makeBranch();
  // `createTeachingContext`'s own Subject is deliberately NOT the Quran one
  // — the schedule ordinarily teaches something else entirely.
  ctx = await createTeachingContext(prisma, TAG, branchId);
  // `subject_one_quran_tracker` allows at most one Subject to carry the
  // marker — the seed already provides it, so it is found rather than
  // created (the same pattern `journey.integration.test.ts` establishes).
  quranSubjectId = (
    await prisma.subject.findFirstOrThrow({
      where: { tracksQuranProgress: true, deletedAt: null },
      select: { id: true },
    })
  ).id;
  await prisma.levelSubject.create({ data: { levelId: ctx.levelId, subjectId: quranSubjectId } });
  // R165 §2 — حفظ القرآن works by Surah, so an occurrence retaught TO it must
  // say which; the Level's «مقرر الحفظ» is where that Surah has to come from.
  await prisma.levelSurah.create({ data: { levelId: ctx.levelId, surahId: SURAH } });
  studentId = await person("مستفيدة");
  await enrol(prisma, ctx, studentId);
  admin = await person("مديرة");
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("Codex review, 2026-09-20 — a one-off occurrence's OWN Subject override, not only its schedule's", () => {
  it("a cover teacher (SessionStaff only, no schedule assignment) gains Quran capability when the occurrence is overridden TO it", async () => {
    const coverTeacher = await person("مُغطِّية");
    await prisma.sessionStaff.create({
      data: { sessionId: ctx.sessionId, userId: coverTeacher, position: "teacher" },
    });
    // Before the override, this session is NOT Quran (the schedule's own
    // Subject is `createTeachingContext`'s ordinary one).
    expect(await teachesQuran(prisma, coverTeacher, new Date("2026-09-12"))).toBe(false);

    await overrideSession(prisma, superAdmin(admin), ctx.sessionId, {
      subjectId: quranSubjectId,
      surahIds: [SURAH],
      version: 0,
    });

    expect(await teachesQuran(prisma, coverTeacher, new Date("2026-09-12"))).toBe(true);

    const where = await studentsTaughtBy(prisma, coverTeacher, {
      subjectId: quranSubjectId,
      on: new Date("2026-09-12"),
    });
    const reached = await prisma.user.findFirst({ where: { ...where, id: studentId } });
    expect(reached).not.toBeNull();
  });

  it("MORE CONSEQUENTIAL: a Quran-schedule cover teacher LOSES Quran capability for a session retaught AWAY from it", async () => {
    // This schedule's ordinary Subject is now the Quran one, so a plain
    // schedule-level assignment would trivially pass through the FIRST
    // (schedule-level) check `teachesQuran` makes — masking the occurrence
    // arm entirely. A cover teacher, staffed ONLY on this one SESSION (no
    // `CourseScheduleStaff` row), isolates the arm this fix actually changed.
    await prisma.recurringCourseSchedule.update({
      where: { id: ctx.scheduleId },
      data: { subjectId: quranSubjectId },
    });
    const coverTeacher = await person("مُغطِّية أخرى");
    await prisma.sessionStaff.create({
      data: { sessionId: ctx.sessionId, userId: coverTeacher, position: "teacher" },
    });
    expect(await teachesQuran(prisma, coverTeacher, new Date("2026-09-12"))).toBe(true);

    // Retaught away from حفظ القرآن for exactly this sitting.
    const otherSubjectId = (
      await prisma.subject.create({ data: { name: `${TAG} مادة أخرى مؤقتة` } })
    ).id;
    await prisma.levelSubject.create({ data: { levelId: ctx.levelId, subjectId: otherSubjectId } });
    await overrideSession(prisma, superAdmin(admin), ctx.sessionId, {
      subjectId: otherSubjectId,
      version: 0,
    });

    expect(await teachesQuran(prisma, coverTeacher, new Date("2026-09-12"))).toBe(false);

    const where = await studentsTaughtBy(prisma, coverTeacher, {
      subjectId: quranSubjectId,
      on: new Date("2026-09-12"),
    });
    const reached = await prisma.user.findFirst({ where: { ...where, id: studentId } });
    expect(reached).toBeNull();
  });
});
