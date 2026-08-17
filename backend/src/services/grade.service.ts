import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { passes, readGradingScale, type GradingScale } from '../policies/grading.js';
import { assertExamInTeacherScope, audienceWhere } from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * **Per-exam grading (§4.6, BR-7, BR-8, BR-12; M5a, SRS Revision 70).**
 *
 * ## What this is, and what it deliberately is not
 *
 * Grades here are **per-exam and informational**. There are no averages, no
 * transcripts, no weight templates and no aggregation of any kind — Revision 12
 * postponed the basis-point template engine to §10.1 and states the trap in
 * plain words: *"Do not hardcode an interim average formula — an interim formula
 * is a second grading engine that would have to be ripped out."* Nothing in this
 * file computes across exams.
 *
 * ## Empty is not zero, and the distinction is structural
 *
 * Three states, told apart by the data rather than by a convention:
 *
 * | State | Row | Meaning |
 * |---|---|---|
 * | **empty** | no `Grade` row | nobody has marked this student yet |
 * | **absent** | `value_bp = 0`, `absent = true` | sat nothing — BR-7 |
 * | **an actual zero** | `value_bp = 0`, `absent = false` | marked, and scored nothing |
 *
 * A nullable score column would have collapsed the first two, which is exactly
 * what BR-7 exists to prevent: *"draft averages are never inflated by omission"*
 * requires the absentee to hold a real 0 rather than an absence of a row.
 *
 * ## BR-7's initialisation, at the moment R10 specifies
 *
 * The absent-zero rows are created **at the first draft save**, not at exam
 * creation and not at publish. Before that first save the sheet is genuinely
 * blank, and blank is the honest rendering of *nobody has looked at this yet*.
 *
 * ## The audience is R58's and is resolved, never stored
 *
 * A named Administrative Group, or — when `administrative_group_id` is NULL —
 * the students enrolled in the exam's Level **at the exam's branch**
 * (`Enrollment.branch_id`, R66). Revision 70.2 corrected BR-7's pre-R58 wording
 * to say exactly this. It resolves through `audienceWhere`, the single §4.4c
 * implementation, rather than a fourth query shaped like it.
 *
 * ## Authorization (TD-2 as split by R70.4)
 *
 * Entering and publishing are separate capabilities in the matrix and separate
 * functions here. **A Teacher reaches a sheet only through §4.4c** — the exam's
 * branch, `(level, subject)` and any named group must all fall inside the
 * schedules they staff — which is asserted by `assertExamInTeacherScope` and not
 * re-derived. Because that assertion establishes they teach the audience, no
 * per-student check is layered on top of it; what IS checked per student is
 * audience membership, which is a different question and belongs to every role.
 */

export interface GradeSheetRow {
  student_id: string;
  student_name: string;
  /** `null` — **no row yet**. Distinct from `0`, which is a mark somebody entered. */
  value_bp: number | null;
  absent: boolean;
  status: 'draft' | 'published';
  /** BR-12 — set means a human decided pass/fail regardless of the mark. */
  manual_pass_fail_override: boolean | null;
  override_reason: string | null;
  /** `null` until a row exists; TD-15 requires it on every subsequent write. */
  version: number | null;
  passed: boolean | null;
}

export interface GradeSheet {
  exam: {
    id: string;
    title: string;
    date: string;
    level_id: string;
    level_name: string;
    subject_id: string | null;
    subject_name: string | null;
    branch_id: string | null;
    branch_name: string | null;
    administrative_group_id: string | null;
    administrative_group_name: string | null;
    /** Derived, never stored (R70.5): recorded after the sitting it describes. */
    recorded_late: boolean;
  };
  display_scale: number;
  passing_grade_bp: number;
  /** Whether any row is published — what makes the action *re*-publish (BR-8). */
  has_published: boolean;
  rows: GradeSheetRow[];
}

/**
 * An exam whose sitting is fully described — **narrowed deliberately**.
 *
 * `branch_id` and `subject_id` are nullable columns because rows predate
 * Revision 58, which is the standing division the validators record: nullable in
 * the database for history, required at the write boundary. A grade sheet needs
 * both — the audience is *the Level's students **at the exam's branch***, and
 * there is no honest answer without one — so the guard runs before anything
 * else and the type carries the result, leaving no `?? ''` to hand an empty
 * string to a uuid column.
 */
interface ExamForGrading {
  id: string;
  title: string;
  date: Date;
  createdAt: Date;
  levelId: string;
  subjectId: string;
  branchId: string;
  administrativeGroupId: string | null;
  level: { name: string };
  subject: { name: string } | null;
  branch: { name: string } | null;
  administrativeGroup: { name: string } | null;
}

const EXAM_SELECT = {
  id: true,
  title: true,
  date: true,
  createdAt: true,
  levelId: true,
  subjectId: true,
  branchId: true,
  administrativeGroupId: true,
  level: { select: { name: true } },
  subject: { select: { name: true } },
  branch: { select: { name: true } },
  administrativeGroup: { select: { name: true } },
} as const;

/**
 * Load the exam and assert the caller may work on its sheet.
 *
 * **Out of scope answers `NOT_FOUND`, not `FORBIDDEN`** (§20 rule 17) for an
 * Admin at another branch: a response must never be usable to discover that an
 * exam exists elsewhere. A Teacher receives the coded `FORBIDDEN` that
 * `assertExamInTeacherScope` raises, because they reached a sheet for an exam
 * they can already see in their own portal — there is nothing to conceal, and a
 * bare 404 would read as *this exam vanished*.
 */
async function loadForGrading(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
): Promise<ExamForGrading> {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, deletedAt: null },
    select: EXAM_SELECT,
  });
  if (!exam) throw new AppError('NOT_FOUND', 'no such exam');

  // **A pre-R58 exam cannot be graded, and says so rather than failing.** Found
  // against live data, not by a test: every fixture builds a post-R58 sitting,
  // while the real database still holds rows created when an exam carried no
  // branch and no subject. Without a branch the audience — *the Level's
  // students at the exam's branch* — has no meaning, and resolving it Level-wide
  // would put students from other branches on the sheet.
  if (exam.branchId === null || exam.subjectId === null) {
    throw new AppError('STATE_CONFLICT', 'this exam names no branch or subject (pre-R58)', {
      reason: 'EXAM_INCOMPLETE',
    });
  }
  const sitting: ExamForGrading = { ...exam, branchId: exam.branchId, subjectId: exam.subjectId };

  if (scope.isSuperAdmin(actor.roleScopes)) return sitting;

  if (scope.hasRole(actor.roleScopes, 'admin')) {
    scope.assertCanActOnBranch(actor.roleScopes, 'admin', sitting.branchId, 'no such exam');
    return sitting;
  }

  if (!scope.hasRole(actor.roleScopes, 'teacher')) {
    throw new AppError('FORBIDDEN', 'grading requires staff (TD-2)');
  }

  await assertExamInTeacherScope(prisma, actor.userId, {
    branchId: sitting.branchId,
    levelId: sitting.levelId,
    subjectId: sitting.subjectId,
    administrativeGroupId: sitting.administrativeGroupId,
  });
  return sitting;
}

/**
 * **The exam's audience (R58, as R70.2 restated BR-7).**
 *
 * Expressed through `audienceWhere` rather than as its own query: §4.4c is the
 * single definition of *which students is this for*, and a sheet that resolved
 * its own roster would be a second answer that drifts the first time enrolment
 * rules change. The two exam shapes map onto two of its three modes; the
 * teaching-group mode is deliberately never used here, because R58 states that
 * *"the Teaching Group split has no bearing on who sits a paper"*.
 */
function audienceOf(exam: ExamForGrading): Prisma.UserWhereInput {
  return exam.administrativeGroupId !== null
    ? audienceWhere({
        teachingMode: 'administrative_group',
        levelId: null,
        administrativeGroupId: exam.administrativeGroupId,
        teachingGroupId: null,
        branchId: exam.branchId,
      })
    : audienceWhere({
        teachingMode: 'entire_level',
        levelId: exam.levelId,
        administrativeGroupId: null,
        teachingGroupId: null,
        branchId: exam.branchId,
      });
}

function toRow(
  student: { id: string; nameArabic: string },
  grade: {
    valueBp: number;
    absent: boolean;
    status: string;
    manualPassFailOverride: boolean | null;
    overrideReason: string | null;
    version: number;
  } | null,
  scale: GradingScale,
): GradeSheetRow {
  if (!grade) {
    return {
      student_id: student.id,
      student_name: student.nameArabic,
      value_bp: null,
      absent: false,
      status: 'draft',
      manual_pass_fail_override: null,
      override_reason: null,
      version: null,
      passed: null,
    };
  }
  return {
    student_id: student.id,
    student_name: student.nameArabic,
    value_bp: grade.valueBp,
    absent: grade.absent,
    status: grade.status === 'published' ? 'published' : 'draft',
    manual_pass_fail_override: grade.manualPassFailOverride,
    override_reason: grade.overrideReason,
    version: grade.version,
    // BR-12 — a manual override always wins over the computed result.
    passed: grade.manualPassFailOverride ?? passes(grade.valueBp, scale.passingGradeBp),
  };
}

/** `GET /exams/{id}/grades` — the sheet, whether or not anything is marked. */
export async function readGradeSheet(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
): Promise<GradeSheet> {
  const exam = await loadForGrading(prisma, actor, examId);
  const scale = await readGradingScale(prisma);

  const [students, grades] = await Promise.all([
    prisma.user.findMany({
      // `deletedAt: null` is redundant — every arm of `audienceWhere` already
      // constrains it — and it is written anyway, deliberately: this call site
      // must be safe on its own reading, not on a promise made one module over.
      where: { ...audienceOf(exam), deletedAt: null },
      select: { id: true, nameArabic: true },
      orderBy: { nameArabic: 'asc' },
    }),
    prisma.grade.findMany({ where: { examId } }),
  ]);

  const byStudent = new Map(grades.map((g) => [g.studentId, g]));

  return {
    exam: {
      id: exam.id,
      title: exam.title,
      date: exam.date.toISOString().slice(0, 10),
      level_id: exam.levelId,
      level_name: exam.level.name,
      subject_id: exam.subjectId,
      subject_name: exam.subject?.name ?? null,
      branch_id: exam.branchId,
      branch_name: exam.branch?.name ?? null,
      administrative_group_id: exam.administrativeGroupId,
      administrative_group_name: exam.administrativeGroup?.name ?? null,
      // Derived at read time and stored nowhere (R70.5): the sitting was
      // recorded after the day it took place.
      recorded_late: exam.createdAt.toISOString().slice(0, 10) > exam.date.toISOString().slice(0, 10),
    },
    display_scale: scale.displayScale,
    passing_grade_bp: scale.passingGradeBp,
    has_published: grades.some((g) => g.status === 'published'),
    rows: students.map((s) => toRow(s, byStudent.get(s.id) ?? null, scale)),
  };
}

/**
 * **What a مستفيدة sees of her own attainment** — §5.3's
 * `My Grades & Exams (/dashboard/student/grades)`, *"published grades"*.
 *
 * ## Published only, and *absent* rather than *hidden*
 *
 * `status: 'published'` is in the **`where`**, not in a filter applied to a
 * fetched list. A draft grade is a مؤطرة's working note (BR-8), and the
 * difference between *not selected* and *selected then dropped* is the
 * difference between a rule and a habit: the first cannot be undone by a
 * refactor that forgets why the filter was there.
 *
 * ## No pass/fail
 *
 * The row carries the mark and nothing that labels the person. `Grade.status`,
 * `passed` and BR-12's override are **untouched in the model and on the staff
 * sheet** — they are how the association decides retakes and progression — but a
 * student's own screen reports what she scored, not a verdict about her. This is
 * the Owner's decision of 2026-08-17, and it removes no business logic
 * whatsoever.
 *
 * ## The subject is resolved, never named by the caller
 *
 * `studentId` arrives from `childContext` middleware — the JWT `sub`, or an
 * approved `FamilyLink` child (§4.3) — exactly as `GET /students/me` and
 * `GET /students/me/quran` receive theirs. **There is no path parameter and this
 * function performs no authorization**, because there is nothing here for a
 * caller to name: TD-12's property is that the identifier was never in their
 * hands (R63.3). A caller who could pass an arbitrary id would need a scope
 * check; one who cannot, does not.
 *
 * ## Not audited
 *
 * R63.6's reasoning, unchanged: a student reading her own mark is ordinary use,
 * not a security-sensitive act, and TD-8 gains no row.
 */
export interface PublishedGradeRow {
  exam_id: string;
  exam_title: string;
  date: string;
  level_name: string;
  subject_name: string | null;
  /** On the association's display scale, never basis points (R8/R14). */
  mark: number;
  absent: boolean;
}

export async function readPublishedGrades(
  prisma: PrismaClient,
  studentId: string,
): Promise<{ rows: PublishedGradeRow[]; displayScale: number }> {
  const scale = await readGradingScale(prisma);

  const grades = await prisma.grade.findMany({
    where: {
      studentId,
      // The rule, in the query. See the docstring.
      status: 'published',
      // A soft-deleted exam's grades are not history a student should be shown:
      // the sitting was withdrawn (R59), and the mark went with it.
      exam: { deletedAt: null },
    },
    // Most recent sitting first — a student opens this to see what just came
    // back, not to read a chronicle from the beginning.
    orderBy: [{ exam: { date: 'desc' } }],
    select: {
      valueBp: true,
      absent: true,
      exam: {
        select: {
          id: true,
          title: true,
          date: true,
          level: { select: { name: true } },
          subject: { select: { name: true } },
        },
      },
    },
  });

  return {
    displayScale: scale.displayScale,
    rows: grades.map((g) => ({
      exam_id: g.exam.id,
      exam_title: g.exam.title,
      date: g.exam.date.toISOString().slice(0, 10),
      level_name: g.exam.level.name,
      subject_name: g.exam.subject?.name ?? null,
      // The one conversion, and it is the same arithmetic the staff sheet's
      // display uses (R8 keeps the rounding on the WRITE path; this is a read).
      mark: (g.valueBp * scale.displayScale) / 10_000,
      absent: g.absent,
    })),
  };
}

export interface GradeEntry {
  studentId: string;
  /** `null` **leaves the student unmarked**; BR-7 then makes them absent-zero. */
  valueBp: number | null;
  absent: boolean;
  /** TD-15 — required once a row exists, refused as stale if it has moved on. */
  version?: number | undefined;
}

/**
 * `PUT /exams/{id}/grades` — save the sheet as a draft (BR-7, BR-8, TD-15).
 *
 * **The whole sheet is one save**, which is what makes BR-7's initialisation
 * meaningful: *"every student in the exam's audience without a score gets a
 * draft `0`/`absent` row immediately"*. Saving one row at a time would leave the
 * rule with no moment at which to fire.
 *
 * **Published rows return to draft when amended** (BR-8): *"recalculated grades
 * require explicit re-publish before the new values are visible"*. A silent
 * in-place edit of a published grade would change what a parent already saw
 * without anybody re-publishing it.
 */
export async function saveGradeDraft(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  entries: GradeEntry[],
): Promise<{ saved: number; initialised: number }> {
  const exam = await loadForGrading(prisma, actor, examId);

  return prisma.$transaction(async (tx) => {
    // The audience at the moment of the save. Everything below is checked
    // against it, so a student who left the Level between page load and save
    // cannot be marked.
    const audience = await tx.user.findMany({
      // Redundant with `audienceWhere`'s own `deletedAt: null`, and written
      // anyway for the reason given in `readGradeSheet`.
      where: { ...audienceOf(exam), deletedAt: null },
      select: { id: true },
    });
    const inAudience = new Set(audience.map((s) => s.id));

    for (const entry of entries) {
      if (!inAudience.has(entry.studentId)) {
        throw new AppError('VALIDATION_FAILED', 'that student is not sitting this exam', {
          reason: 'NOT_IN_AUDIENCE',
          student_id: entry.studentId,
        });
      }
    }

    const existing = await tx.grade.findMany({ where: { examId } });
    const byStudent = new Map(existing.map((g) => [g.studentId, g]));

    let saved = 0;
    for (const entry of entries) {
      // An absent student holds a real 0 (BR-7) — never a null, which is what
      // "nobody has marked this" means and would collapse the two states.
      const valueBp = entry.absent ? 0 : (entry.valueBp ?? 0);
      const current = byStudent.get(entry.studentId);

      if (!current) {
        await tx.grade.create({
          data: {
            examId,
            studentId: entry.studentId,
            administrativeGroupId: exam.administrativeGroupId,
            valueBp,
            absent: entry.absent,
            status: 'draft',
          },
        });
      } else {
        if (entry.version !== undefined && current.version !== entry.version) {
          throw new AppError('VERSION_CONFLICT', 'this grade was changed by someone else', {
            student_id: entry.studentId,
          });
        }
        await tx.grade.update({
          where: { id: current.id },
          data: {
            valueBp,
            absent: entry.absent,
            // BR-8 — amending a published grade returns it to draft; the new
            // value is invisible until somebody re-publishes deliberately.
            status: 'draft',
            publishedAt: null,
            version: { increment: 1 },
          },
        });
      }
      saved += 1;
    }

    // **BR-7, at R10's moment.** Every student in the audience still holding no
    // row after this save gets a draft 0/absent one, so figures computed from
    // the sheet are never inflated by an omission.
    const marked = new Set([...byStudent.keys(), ...entries.map((e) => e.studentId)]);
    const missing = audience.filter((s) => !marked.has(s.id));
    for (const student of missing) {
      await tx.grade.create({
        data: {
          examId,
          studentId: student.id,
          administrativeGroupId: exam.administrativeGroupId,
          valueBp: 0,
          absent: true,
          status: 'draft',
        },
      });
    }

    // R70.3 — one row per sheet save, not per student.
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'grade.enter',
      targetEntity: 'Exam',
      targetId: examId,
      detail: { students_affected: saved + missing.length, initialised_absent: missing.length },
    });

    return { saved, initialised: missing.length };
  });
}

/**
 * `POST /exams/{id}/grades/publish` — BR-8.
 *
 * **Publishing is its own capability** (R70.4) and its own action, because it is
 * the moment a mark becomes something a student and their parents can see.
 * Re-publishing is the same verb: TD-8 distinguishes the two by whether anything
 * had been published before, which is a fact the rows already carry rather than
 * a second endpoint.
 */
export async function publishGrades(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
): Promise<{ published: number; republished: boolean }> {
  await loadForGrading(prisma, actor, examId);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.grade.findMany({
      where: { examId },
      select: { id: true, status: true, publishedAt: true },
    });
    if (rows.length === 0) {
      throw new AppError('STATE_CONFLICT', 'there is nothing to publish', {
        reason: 'NOTHING_TO_PUBLISH',
      });
    }

    // Anything previously published makes this a RE-publish, which TD-8 records
    // as a different action — the audit trail should not have to infer it.
    const republished = rows.some((r) => r.publishedAt !== null);
    const draft = rows.filter((r) => r.status === 'draft');

    const now = new Date();
    for (const row of draft) {
      await tx.grade.update({
        where: { id: row.id },
        data: { status: 'published', publishedAt: now, version: { increment: 1 } },
      });
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: republished ? 'grade.republish' : 'grade.publish',
      targetEntity: 'Exam',
      targetId: examId,
      detail: { students_affected: draft.length },
    });

    return { published: draft.length, republished };
  });
}

/**
 * `POST /exams/{id}/grades/{studentId}/override` — BR-12.
 *
 * **A manual override always wins and is never clobbered by recalculation.** It
 * is stored beside the mark rather than replacing it, so the sheet keeps saying
 * what the student scored *and* what a human decided about it — collapsing them
 * would destroy the reason the override exists.
 *
 * `grade.passfail_override` is one of the four action types Revision 19 names as
 * **indefinitely retained**; `audit.purge` must never touch it.
 */
export async function overridePassFail(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  studentId: string,
  input: { value: boolean | null; reason: string; version: number },
): Promise<void> {
  await loadForGrading(prisma, actor, examId);

  await prisma.$transaction(async (tx) => {
    const grade = await tx.grade.findFirst({ where: { examId, studentId } });
    if (!grade) throw new AppError('NOT_FOUND', 'no grade to override');
    if (grade.version !== input.version) {
      throw new AppError('VERSION_CONFLICT', 'this grade was changed by someone else');
    }

    await tx.grade.update({
      where: { id: grade.id },
      data: {
        manualPassFailOverride: input.value,
        overrideById: input.value === null ? null : actor.userId,
        overrideAt: input.value === null ? null : new Date(),
        overrideReason: input.value === null ? null : input.reason,
        version: { increment: 1 },
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'grade.passfail_override',
      targetEntity: 'Grade',
      targetId: grade.id,
      detail: { exam_id: examId, student_id: studentId, value: input.value, reason: input.reason },
    });
  });
}
