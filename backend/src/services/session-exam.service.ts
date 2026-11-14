import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import { LEVEL_ADMIN_ORDER } from "../lib/sorting.js";
import type { Actor } from "../policies/actor.js";
import { assertSubjectTaughtAtLevel, resolveSurahs, subjectsTaughtAt } from "../policies/curriculum.js";
import { effectiveOn } from "../policies/effective-staffing.js";
import * as audit from "../repositories/audit.repository.js";
import { examTitle } from "./class-title.js";
import { assertCanManage } from "./exam.service.js";
import { assertTypeOfKind } from "./scheduling-type.service.js";
import { loadForWrite } from "./session.service.js";
import { assertStaffAccountsAvailable } from "./staffing-integrity.service.js";

/**
 * **R269 — a class occurrence becomes an exam** (the Owner, 2026-11-14: «in
 * تعديل الحصة of that session, i want to be able to change its type to exam»;
 * the exam REPLACES the class, and the class's مؤطِّرة may do it too).
 *
 * The exam is a physical sitting (staff mark it) that targets the Session
 * (`target_kind = 'session'`), so its audience is the class's own, and keeps
 * the class's date, times, branch, room — none for a class عن بُعد, whose
 * place stays the class's own call — visibility, description and staff (the
 * مؤطِّرة supervises, assistants assist). What a class does not say and an
 * exam needs is asked: the exam's type, its Level (one of the class's), its
 * Subject and Surah, and its maximum.
 *
 * The Session row stays, `overridden` so no schedule edit regenerates it away,
 * and every calendar hides it while the exam is live. Deleting the exam brings
 * the class back.
 */

/** The everyday scale (`exam-scheduling.service.ts`'s bare default). */
const DEFAULT_MAX_GRADE = 20;

export interface ExamConversionFacts {
  exam_types: { id: string; name: string }[];
  levels: {
    id: string;
    name: string;
    /** For the platform's one Level label, «الفئة — المستوى». */
    category_name: string | null;
    subjects: { id: string; name: string; requires_surahs: boolean }[];
    surahs: { id: number; name: string }[];
  }[];
  level_id: string | null;
  subject_id: string | null;
  surah_id: number | null;
  max_grade: number;
  version: number;
}

export interface ExamConversionInput {
  schedulingTypeId: string;
  levelId: string;
  subjectId: string;
  surahId: number | null;
  maxGrade: number;
  version: number;
}

/** What the form needs, decided here: the choices are the class's own. */
export async function readExamConversion(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
): Promise<ExamConversionFacts> {
  assertCanManage(actor);
  const session = await loadForWrite(prisma, actor, sessionId);
  await assertConvertible(prisma, session);

  const levels = await classLevels(prisma, sessionId);
  const levelIds = levels.map((l) => l.id);
  const [types, taught, syllabus, surahRows] = await Promise.all([
    prisma.schedulingType.findMany({
      where: { deletedAt: null, structuralKind: "exam" },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    subjectsTaughtAt(prisma, levelIds),
    prisma.levelSurah.findMany({
      where: { deletedAt: null, levelId: { in: levelIds } },
      orderBy: { surahId: "asc" },
      select: { levelId: true, surah: { select: { surahId: true, nameArabic: true } } },
    }),
    prisma.sessionSurah.findMany({ where: { sessionId }, select: { surahId: true } }),
  ]);
  const subjectIds = [...new Set([...taught.values()].flatMap((set) => [...set]))];
  const subjects = await prisma.subject.findMany({
    where: { id: { in: subjectIds }, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, requiresSurahs: true },
  });

  const subjectId = session.subjectId ?? session.schedule.subjectId;
  const classSurahs =
    surahRows.length > 0
      ? surahRows.map((r) => r.surahId)
      : (
          await prisma.courseScheduleSurah.findMany({
            where: { scheduleId: session.scheduleId },
            select: { surahId: true },
          })
        ).map((r) => r.surahId);

  return {
    exam_types: types,
    levels: levels.map((level) => ({
      id: level.id,
      name: level.name,
      category_name: level.category?.name ?? null,
      subjects: subjects
        .filter((s) => taught.get(level.id)?.has(s.id) === true)
        .map((s) => ({ id: s.id, name: s.name, requires_surahs: s.requiresSurahs })),
      surahs: syllabus
        .filter((row) => row.levelId === level.id)
        .map((row) => ({ id: row.surah.surahId, name: row.surah.nameArabic })),
    })),
    level_id: levels.length === 1 ? levels[0]!.id : null,
    subject_id: subjectId,
    surah_id: classSurahs.length === 1 ? classSurahs[0]! : null,
    max_grade: DEFAULT_MAX_GRADE,
    version: session.version,
  };
}

/** `POST /sessions/{id}/convert-to-exam` — one transaction, all or nothing. */
export async function convertSessionToExam(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  input: ExamConversionInput,
): Promise<{ examId: string }> {
  assertCanManage(actor);
  return prisma.$transaction(async (tx) => {
    // The same question «تعديل الحصة» asks: an administrator of the branch, or
    // the مؤطِّرة / assistant who staffs this occurrence (R269: «also the مؤطِّرة»).
    const session = await loadForWrite(tx as unknown as PrismaClient, actor, sessionId);
    if (session.version !== input.version) {
      throw new AppError("VERSION_CONFLICT", "the session changed since it was read");
    }
    await assertConvertible(tx, session);

    const levels = await classLevels(tx, sessionId);
    if (!levels.some((l) => l.id === input.levelId)) {
      throw new AppError("VALIDATION_FAILED", "the exam's level must be one of the class's", {
        reason: "LEVEL_NOT_OF_CLASS",
      });
    }
    await assertTypeOfKind(tx, input.schedulingTypeId, ["exam"] as const);
    await assertSubjectTaughtAtLevel(tx, input.levelId, input.subjectId);
    const [surahId] = await resolveSurahs(tx, {
      subjectId: input.subjectId,
      levelIds: [input.levelId],
      surahIds: input.surahId === null ? [] : [input.surahId],
    });

    const schedule = await tx.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: session.scheduleId },
      select: { academicYearId: true },
    });
    const staff = await sessionStaff(tx, session.id, session.scheduleId, session.date);
    await assertStaffAccountsAvailable(tx, staff.map((s) => s.userId));

    const exam = await tx.exam.create({
      data: {
        mode: "physical",
        status: "published",
        publishedAt: new Date(),
        // Recomposed below, once the Surah and the supervisor exist (R166 §3).
        title: "—",
        description: session.description,
        maxGrade: input.maxGrade,
        levelId: input.levelId,
        subjectId: input.subjectId,
        surahId: surahId ?? null,
        academicYearId: schedule.academicYearId,
        targetKind: "session",
        sessionId: session.id,
        replacesSession: true,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        branchId: session.schedule.branchId,
        roomId: session.roomId,
        schedulingTypeId: input.schedulingTypeId,
        visibility: session.visibility,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    for (const person of staff) {
      await tx.examStaff.create({
        data: {
          examId: exam.id,
          userId: person.userId,
          position: person.position,
          createdById: actor.userId,
        },
      });
    }
    await tx.exam.update({ where: { id: exam.id }, data: { title: await examTitle(tx, exam.id) } });

    // Kept, and kept out of a regeneration's reach: `overridden` is the rule
    // every schedule edit already spares (session-protection `OVERRIDDEN`).
    await tx.session.update({
      where: { id: session.id },
      data: { overridden: true, version: { increment: 1 } },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole !== undefined ? { activeRole: actor.activeRole } : {}),
      actionType: "session.convert_to_exam",
      targetEntity: "session",
      targetId: session.id,
      detail: {
        exam_id: exam.id,
        scheduling_type_id: input.schedulingTypeId,
        level_id: input.levelId,
        subject_id: input.subjectId,
        max_grade: input.maxGrade,
      },
    });
    return { examId: exam.id };
  });
}

/** Only a class still to be held, and not one already replaced. */
async function assertConvertible(
  db: Pick<Prisma.TransactionClient, "exam">,
  session: { id: string; status: string },
): Promise<void> {
  if (session.status !== "scheduled") {
    throw new AppError("STATE_CONFLICT", "only a scheduled class can become an exam", {
      reason: "SESSION_NOT_SCHEDULED",
    });
  }
  const replaced = await db.exam.count({
    where: { sessionId: session.id, replacesSession: true, deletedAt: null },
  });
  if (replaced > 0) {
    throw new AppError("STATE_CONFLICT", "this class is already an exam", {
      reason: "ALREADY_AN_EXAM",
    });
  }
}

type Db = Pick<
  Prisma.TransactionClient,
  "session" | "level" | "sessionStaff" | "courseScheduleStaff"
>;

/**
 * **The class's Levels**, as its calendar chip names them: the occurrence's own
 * audience when it has one, else the class's — its Levels, or the Levels of its
 * Categories when it names Categories only, or the one Level its group sits.
 */
export async function classLevels(
  db: Db,
  sessionId: string,
): Promise<{ id: string; name: string; category: { name: string } | null }[]> {
  const session = await db.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      audienceLevels: { select: { levelId: true } },
      audienceCategories: { select: { categoryId: true } },
      schedule: {
        select: {
          teachingMode: true,
          levelId: true,
          administrativeGroup: { select: { levelId: true } },
          teachingGroup: { select: { levelId: true } },
          levelScopes: { select: { levelId: true } },
          categoryScopes: { select: { categoryId: true } },
        },
      },
    },
  });
  const sch = session.schedule;
  const own = session.audienceLevels.length > 0 || session.audienceCategories.length > 0;
  let levelIds: string[];
  let categoryIds: string[] = [];
  if (own) {
    levelIds = session.audienceLevels.map((r) => r.levelId);
    categoryIds = session.audienceCategories.map((r) => r.categoryId);
  } else if (sch.teachingMode === "multi_dimension") {
    levelIds = sch.levelScopes.map((r) => r.levelId);
    categoryIds = sch.categoryScopes.map((r) => r.categoryId);
  } else {
    const legacy = sch.levelId ?? sch.administrativeGroup?.levelId ?? sch.teachingGroup?.levelId ?? null;
    levelIds = legacy ? [legacy] : [];
  }
  return db.level.findMany({
    where: {
      deletedAt: null,
      OR: [
        { id: { in: levelIds } },
        ...(levelIds.length === 0 && categoryIds.length > 0 ? [{ categoryId: { in: categoryIds } }] : []),
      ],
    },
    orderBy: [...LEVEL_ADMIN_ORDER],
    select: { id: true, name: true, category: { select: { name: true } } },
  });
}

/** Who takes the class takes the exam: the مؤطِّرة supervises, assistants assist. */
async function sessionStaff(
  db: Db,
  sessionId: string,
  scheduleId: string,
  date: Date,
): Promise<{ userId: string; position: "supervisor" | "assistant" }[]> {
  const own = await db.sessionStaff.findMany({
    where: { sessionId, deletedAt: null },
    select: { userId: true, position: true },
  });
  const rows =
    own.length > 0
      ? own
      : await db.courseScheduleStaff.findMany({
          where: { scheduleId, ...effectiveOn(date) },
          select: { userId: true, position: true },
        });
  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(r.userId) ? false : (seen.add(r.userId), true)))
    .map((r) => ({ userId: r.userId, position: r.position === "teacher" ? "supervisor" : "assistant" }));
}
