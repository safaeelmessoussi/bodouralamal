import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { isValidScore, toNumber } from '../policies/grading.js';
import { notifyGradePublished } from './notification.service.js';
import {
  assertAudienceWithinBranchScope,
  assertQuestionPointsConsistent,
} from './assessment.service.js';
import {
  assertExamInTeacherScope,
  examAudienceWhere,
  staffsSession,
  staffsTeachingGroup,
  studentsTaughtBy,
} from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';
import { lockExamRow } from '../repositories/exam.repository.js';

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
 * | **absent** | `score = 0`, `absent = true` | sat nothing — BR-7 |
 * | **an actual zero** | `score = 0`, `absent = false` | marked, and scored nothing |
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
  /**
   * The score on the exam's own scale — `null` is **no row yet**, which is a
   * different fact from `0`, the mark somebody entered (R81).
   */
  score: number | null;
  absent: boolean;
  status: 'draft' | 'published';
  /** `null` until a row exists; TD-15 requires it on every subsequent write. */
  version: number | null;
  /**
   * **Owner-reported, 2026-09-15 — per-question grading, where the exam's
   * own R137 points allocation is actually in use.** `undefined` when the
   * exam does not use points at all (`GradeSheet.questions` is then absent
   * too) — a different fact from an empty array, which would say *"she uses
   * points and none are entered yet"*. `score` above remains the single
   * source of truth for the total; this is a breakdown of it, never the
   * other way around.
   */
  question_scores?: { question_id: string; score: number }[];
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
    /** R136 (H1) — an online occurrence may name any of R125's five arms;
     *  `administrative_group_name` alone reads the other three as "the
     *  whole Level". */
    target_kind: string;
    teaching_group_name: string | null;
    /** Derived, never stored (R70.5): recorded after the sitting it describes. */
    recorded_late: boolean;
    /** Owner-reported, 2026-09-15 — so the sheet can offer «عرض الإجابات»
     *  only where a submission is a thing that exists at all: a physical
     *  sitting is answered on paper, never through this platform. */
    mode: string;
  };
  /**
   * R81 — **the exam's maximum**, which is what every score here is out of. It
   * travels with the sheet because the sheet is what renders «النقطة (من 20)»,
   * and there is no global scale left to ask.
   */
  max_grade: number;
  /** Whether any row is published — what makes the action *re*-publish (BR-8). */
  has_published: boolean;
  rows: GradeSheetRow[];
  /**
   * **Owner-reported, 2026-09-15 — present only where the exam uses R137's
   * points allocation** (every live question carries one, summing to
   * `max_grade` — `readGradeSheet` re-verifies this every read rather than
   * trusting the exam's own history). Absent for every exam that leaves
   * `points` unset, which is most of them; the marking screen then renders
   * exactly as it always has, one field per student.
   */
  questions?: { id: string; prompt: string; points: number }[];
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
  /** R124 — `null` on an ONLINE assessment: a quick test needs no Subject, and
   *  the pre-R58 guard below is narrowed to physical sittings for that reason. */
  subjectId: string | null;
  /** R124 — `null` on an ONLINE assessment, which is sat nowhere and whose
   *  audience is therefore not branch-bound. */
  branchId: string | null;
  administrativeGroupId: string | null;
  mode: string;
  /** R124 — which of the five audiences this paper is for. `level` and
   *  `administrative_group` are R58's two; the other three arrive with the
   *  online builder and resolve through the same shared function. */
  targetKind: string;
  sessionId: string | null;
  teachingGroupId: string | null;
  studentId: string | null;
  level: { name: string };
  subject: { name: string } | null;
  branch: { name: string } | null;
  administrativeGroup: { name: string } | null;
  // R136 (H1) — the sheet's own summary line named a `session`/
  // `teaching_group`/`student` target as "the whole Level"; this is the
  // fourth arm's own name.
  teachingGroup: { name: string } | null;
  maxGrade: Prisma.Decimal;
}

const EXAM_SELECT = {
  id: true,
  title: true,
  date: true,
  createdAt: true,
  // R81 — every score on this sheet is out of this, and the bound is checked
  // against it on every write.
  maxGrade: true,
  levelId: true,
  subjectId: true,
  branchId: true,
  administrativeGroupId: true,
  // R124 — the mode and the five-way target, so `audienceOf` resolves the sheet
  // through the one shared definition of *who is this for*.
  mode: true,
  targetKind: true,
  sessionId: true,
  teachingGroupId: true,
  studentId: true,
  level: { select: { name: true } },
  subject: { select: { name: true } },
  branch: { select: { name: true } },
  administrativeGroup: { select: { name: true } },
  teachingGroup: { select: { name: true } },
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
  /**
   * **R124 — an ONLINE assessment legitimately has neither**, and that is not
   * the pre-R58 hole this guard exists for. `exam_online_has_no_room_check`
   * forbids a branch on an online row, and a quick test needs no Subject; its
   * audience comes from the target rather than from *the Level at this branch*,
   * so there is nothing missing to refuse.
   */
  if (exam.mode === 'physical' && (exam.branchId === null || exam.subjectId === null)) {
    throw new AppError('STATE_CONFLICT', 'this exam names no branch or subject (pre-R58)', {
      reason: 'EXAM_INCOMPLETE',
    });
  }
  const sitting: ExamForGrading = exam;

  if (scope.isSuperAdmin(actor.roleScopes)) return sitting;

  if (scope.hasRole(actor.roleScopes, 'admin')) {
    if (sitting.branchId !== null) {
      scope.assertCanActOnBranch(actor.roleScopes, 'admin', sitting.branchId, 'no such exam');
    }
    // **R136 (Codex B4).** A branchless online sitting used to return here
    // unchecked — no branch to assert against was read as no assertion
    // needed, letting a branch-scoped Admin grade an online exam whose
    // audience never reaches her branches. `assertAudienceWithinBranchScope`
    // is the same rule authoring already applies to the same five target
    // arms (§4.4c): a branch-scoped Admin may act only when everybody the
    // exam's audience resolves to is inside her branches.
    await assertAudienceWithinBranchScope(prisma, actor, sitting);
    return sitting;
  }

  if (!scope.hasRole(actor.roleScopes, 'teacher')) {
    throw new AppError('FORBIDDEN', 'grading requires staff (TD-2)');
  }

  /**
   * **Owner-reported, 2026-09-15 — the assigned supervisor could not grade
   * her own sitting.** `assertMayMark` (`attendance.service.ts`) already
   * lets an exam's `ExamStaff.position = 'supervisor'` act "regardless of
   * target kind" — the same fact `EventDetailsDialog`'s own comment states
   * for её visibility. Grading never carried the identical short-circuit, so
   * a مؤطِّرة named supervisor on a `target_kind: 'level'` sitting she does
   * not teach `entire_level` for fell through to `assertExamInTeacherScope`'s
   * whole-Level question below and was refused — despite being the one
   * person the exam explicitly names as responsible for it.
   */
  const supervises = await prisma.examStaff.count({
    where: { examId, userId: actor.userId, position: 'supervisor', deletedAt: null },
  });
  if (supervises > 0) return sitting;

  /**
   * **R136 (Codex B5) — the grading picker asks the same per-arm question
   * authoring does, not a fifth one of its own.**
   *
   * This used to go straight to `assertExamInTeacherScope`'s Level/named-
   * administrative-group question for every target, which is the exact
   * shape of hole B3 found in authoring one file over: a `student` or
   * `session` target names neither, so a مؤطِّرة who staffs that exact
   * occurrence — or teaches that exact beneficiary — but not the whole
   * Level was wrongly refused the grade sheet for it, and a `teaching_group`
   * target's `administrative_group_id IS NULL` (`exam_target_check`) made
   * `assertExamInTeacherScope` refuse every مؤطِّرة outright. The three
   * direct predicates are `assertMayAuthor`'s own — reused, not restated, so
   * *may she grade this* and *may she author this* never drift onto two
   * different answers for one exam.
   */
  if (sitting.targetKind === 'student' && sitting.studentId != null) {
    const taught = await studentsTaughtBy(prisma, actor.userId, { on: sitting.date });
    const reaches = await prisma.user.count({
      where: { AND: [taught, { id: sitting.studentId, deletedAt: null }] },
    });
    if (reaches === 0) throw new AppError('NOT_FOUND', 'no such exam');
    return sitting;
  }
  if (sitting.targetKind === 'session' && sitting.sessionId != null) {
    const staffs = await staffsSession(prisma, actor.userId, sitting.sessionId);
    if (!staffs) throw new AppError('NOT_FOUND', 'no such exam');
    return sitting;
  }
  if (sitting.targetKind === 'teaching_group' && sitting.teachingGroupId != null) {
    const staffs = await staffsTeachingGroup(
      prisma,
      actor.userId,
      sitting.teachingGroupId,
      sitting.date,
    );
    if (!staffs) throw new AppError('NOT_FOUND', 'no such exam');
    return sitting;
  }

  // **Judged on the sitting's own date (R91), not today's** — the same
  // dated-staffing gap this arm carried in authoring (see
  // `assertMayAuthor`'s identical fix, `assessment.service.ts`).
  await assertExamInTeacherScope(
    prisma,
    actor.userId,
    {
      branchId: sitting.branchId ?? '',
      levelId: sitting.levelId,
      subjectId: sitting.subjectId ?? '',
      administrativeGroupId: sitting.administrativeGroupId,
    },
    sitting.date,
  );
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
async function audienceOf(
  prisma: PrismaClient | Prisma.TransactionClient,
  exam: ExamForGrading,
): Promise<Prisma.UserWhereInput> {
  /**
   * **R124 — through the shared resolver, so the sheet and the paper agree.**
   *
   * This branched on `administrativeGroupId` being null, which was R58's whole
   * targeting model. With a Session, a Teaching Group and a single beneficiary
   * added, that branch would silently resolve a quick test's sheet to the whole
   * Level — grading people who were never eligible to answer it. One function
   * answers *who is this for* everywhere (§4.4c).
   */
  const where = await examAudienceWhere(prisma, {
    targetKind: exam.targetKind,
    levelId: exam.levelId,
    branchId: exam.branchId,
    administrativeGroupId: exam.administrativeGroupId,
    sessionId: exam.sessionId,
    teachingGroupId: exam.teachingGroupId,
    studentId: exam.studentId,
    /**
     * **R124 — the date only for an ONLINE assessment.** A physical sitting has
     * been resolved period-blind since R58, and narrowing it here would drop
     * every pre-R122 enrolment off a sheet that has always shown her. What R124
     * introduces, R124 narrows.
     */
    on: exam.mode === 'online' ? exam.date : null,
  });
  // `null` means the target is gone — an occurrence deleted underneath a quick
  // test. An empty sheet is the honest answer; a Level-wide one would not be.
  return where ?? { id: { in: [] } };
}


/**
 * **Owner-reported, 2026-09-15 — this exam's live, points-carrying
 * questions, or `null` when per-question grading does not apply.**
 *
 * `null` covers two different facts on purpose, neither of which the
 * marking screen needs to tell apart: the exam leaves every question
 * unallocated (the ordinary case), or it carries an inconsistent
 * configuration `assertQuestionPointsConsistent` refuses. The second case
 * is real only for a PHYSICAL sitting — R137's own check runs only at
 * REMOTE publish time (`publishOccurrenceTx`), so a physical exam's
 * questions are never verified against it at all. Falling back to the
 * classic whole-exam field here, rather than surfacing the inconsistency on
 * a read, is deliberate: a marking screen is not where a content problem
 * should be discovered or fixed.
 */
async function pointsBreakdown(
  prisma: PrismaClient | Prisma.TransactionClient,
  examId: string,
  maxGrade: Prisma.Decimal,
): Promise<{ id: string; prompt: string; points: Prisma.Decimal }[] | null> {
  const questions = await prisma.examQuestion.findMany({
    where: { examId, deletedAt: null },
    select: { id: true, prompt: true, points: true },
    orderBy: { displayOrder: 'asc' },
  });
  if (questions.length === 0 || questions.every((q) => q.points === null)) return null;
  try {
    assertQuestionPointsConsistent(questions, maxGrade);
  } catch {
    return null;
  }
  return questions as { id: string; prompt: string; points: Prisma.Decimal }[];
}

function toRow(
  student: { id: string; nameArabic: string },
  grade: {
    score: Prisma.Decimal;
    absent: boolean;
    status: string;
    version: number;
    questionScores?: { questionId: string; score: Prisma.Decimal }[];
  } | null,
  usesPoints: boolean,
): GradeSheetRow {
  if (!grade) {
    return {
      student_id: student.id,
      student_name: student.nameArabic,
      score: null,
      absent: false,
      status: 'draft',
      version: null,
      ...(usesPoints ? { question_scores: [] } : {}),
    };
  }
  return {
    student_id: student.id,
    student_name: student.nameArabic,
    score: toNumber(grade.score),
    absent: grade.absent,
    status: grade.status === 'published' ? 'published' : 'draft',
    version: grade.version,
    ...(usesPoints
      ? {
          question_scores: (grade.questionScores ?? []).map((qs) => ({
            question_id: qs.questionId,
            score: toNumber(qs.score),
          })),
        }
      : {}),
  };
}

/** `GET /exams/{id}/grades` — the sheet, whether or not anything is marked. */
export async function readGradeSheet(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
): Promise<GradeSheet> {
  const exam = await loadForGrading(prisma, actor, examId);

  const [students, grades, questions] = await Promise.all([
    prisma.user.findMany({
      // `deletedAt: null` is redundant — every arm of `audienceWhere` already
      // constrains it — and it is written anyway, deliberately: this call site
      // must be safe on its own reading, not on a promise made one module over.
      where: { ...(await audienceOf(prisma, exam)), deletedAt: null },
      select: { id: true, nameArabic: true },
      orderBy: { nameArabic: 'asc' },
    }),
    prisma.grade.findMany({
      where: { examId },
      include: { questionScores: { select: { questionId: true, score: true } } },
    }),
    pointsBreakdown(prisma, examId, exam.maxGrade),
  ]);
  const usesPoints = questions !== null;

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
      // R136 (H1) — see the type's own comment above `EXAM_SELECT`.
      target_kind: exam.targetKind,
      teaching_group_name: exam.teachingGroup?.name ?? null,
      // Derived at read time and stored nowhere (R70.5): the sitting was
      // recorded after the day it took place.
      recorded_late: exam.createdAt.toISOString().slice(0, 10) > exam.date.toISOString().slice(0, 10),
      mode: exam.mode,
    },
    max_grade: toNumber(exam.maxGrade),
    has_published: grades.some((g) => g.status === 'published'),
    rows: students.map((s) => toRow(s, byStudent.get(s.id) ?? null, usesPoints)),
    ...(questions
      ? {
          questions: questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            points: toNumber(q.points),
          })),
        }
      : {}),
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
 * The row carries the mark and nothing that labels the person — and since R81
 * there is nothing anywhere to label her with: the passing threshold, the
 * computed verdict and BR-12's manual override are all retired. A grade is a
 * grade. `15 / 20`, never `15 / 20 — ناجحة`.
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
  /** The score she was given, on that exam's own scale (R81). */
  score: number;
  /** What it is out of — carried per row, because each exam sets its own. */
  max_grade: number;
  absent: boolean;
  /** Owner-reported, 2026-09-16 — اختباراتي/نقاطي merge: طريقة الحضور needs
   *  every published row to say which it was. */
  mode: 'physical' | 'online';
}

export async function readPublishedGrades(
  prisma: PrismaClient,
  studentId: string,
): Promise<{ rows: PublishedGradeRow[] }> {
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
      score: true,
      absent: true,
      exam: {
        select: {
          id: true,
          title: true,
          date: true,
          maxGrade: true,
          mode: true,
          level: { select: { name: true } },
          subject: { select: { name: true } },
        },
      },
    },
  });

  return {
    rows: grades.map((g) => ({
      exam_id: g.exam.id,
      exam_title: g.exam.title,
      date: g.exam.date.toISOString().slice(0, 10),
      level_name: g.exam.level.name,
      subject_name: g.exam.subject?.name ?? null,
      // **No conversion at all**, which is the point of R81: the number stored
      // is the number given, and the number beside it is the exam's own.
      score: toNumber(g.score),
      max_grade: toNumber(g.exam.maxGrade),
      absent: g.absent,
      mode: g.exam.mode,
    })),
  };
}

export interface GradeEntry {
  studentId: string;
  /** `null` **leaves the student unmarked**; BR-7 then makes them absent-zero. */
  score: number | null;
  absent: boolean;
  /** TD-15 — required once a row exists, refused as stale if it has moved on. */
  version?: number | undefined;
  /**
   * **Owner-reported, 2026-09-15 — per-question grading, where the exam
   * uses R137's points allocation.** When present, this REPLACES `score`
   * above for this entry — the sum becomes the row's score, computed here
   * rather than trusted from the caller, so `score` need not agree with it
   * and is simply ignored when this is sent. Refused entirely (`VALIDATION_
   * FAILED`, `QUESTIONS_HAVE_NO_POINTS`) if the exam does not use points at
   * all; refused per-entry (`QUESTION_SCORE_OUT_OF_RANGE`) if any value
   * exceeds ITS OWN question's points, not the exam's maximum. A PARTIAL
   * set — some questions scored, others not yet — is legal for a draft; the
   * derived total is simply whatever has been entered so far.
   */
  questionScores?: { questionId: string; score: number }[];
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
  return prisma.$transaction(async (tx) => {
    await lockExamRow(tx, examId);
    const exam = await loadForGrading(tx as PrismaClient, actor, examId);
    // The audience at the moment of the save. Everything below is checked
    // against it, so a student who left the Level between page load and save
    // cannot be marked.
    const audience = await tx.user.findMany({
      // Redundant with `audienceWhere`'s own `deletedAt: null`, and written
      // anyway for the reason given in `readGradeSheet`.
      where: { ...(await audienceOf(tx, exam)), deletedAt: null },
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

    // **Owner-reported, 2026-09-15 — resolved once per save, not per entry**:
    // whether the exam uses R137's points at all, and the exact bound each
    // question carries, is a fact about the EXAM, asked once.
    const breakdown = await pointsBreakdown(tx, examId, exam.maxGrade);
    const pointsById = new Map((breakdown ?? []).map((q) => [q.id, q.points]));

    let saved = 0;
    for (const entry of entries) {
      let questionScores: { questionId: string; score: number }[] | null = null;
      if (entry.questionScores !== undefined && !entry.absent) {
        if (breakdown === null) {
          throw new AppError(
            'VALIDATION_FAILED',
            'this exam does not use per-question points',
            { reason: 'QUESTIONS_HAVE_NO_POINTS', student_id: entry.studentId },
          );
        }
        const seen = new Set<string>();
        for (const qs of entry.questionScores) {
          if (seen.has(qs.questionId)) {
            throw new AppError(
              'VALIDATION_FAILED',
              'one question holds one score per student',
              { reason: 'QUESTION_SCORE_DUPLICATE', student_id: entry.studentId, question_id: qs.questionId },
            );
          }
          seen.add(qs.questionId);
          const points = pointsById.get(qs.questionId);
          if (points === undefined) {
            throw new AppError('NOT_FOUND', 'no such question on this exam', {
              student_id: entry.studentId,
              question_id: qs.questionId,
            });
          }
          if (!isValidScore(new Prisma.Decimal(qs.score), points)) {
            throw new AppError(
              'VALIDATION_FAILED',
              'score is outside this question’s own range',
              {
                reason: 'QUESTION_SCORE_OUT_OF_RANGE',
                student_id: entry.studentId,
                question_id: qs.questionId,
                max_points: toNumber(points),
              },
            );
          }
        }
        questionScores = entry.questionScores;
      }

      // An absent student holds a real 0 (BR-7) — never a null, which is what
      // "nobody has marked this" means and would collapse the two states.
      // A per-question breakdown REPLACES the direct score entirely — the
      // sum is computed here, never trusted from the caller.
      const score = entry.absent
        ? 0
        : questionScores !== null
          ? questionScores.reduce((total, qs) => total + qs.score, 0)
          : (entry.score ?? 0);
      const current = byStudent.get(entry.studentId);

      /**
       * **The bound is the exam's own maximum, and the server is what applies
       * it** (R81). The form refuses an out-of-range mark first as a courtesy;
       * this refuses it regardless, because a forged request never opens the
       * form. `Decimal` throughout, so 20.00 on a /20 exam is accepted and
       * 20.01 is not — a boundary decided exactly rather than by a float that
       * is a hair over.
       */
      if (!isValidScore(new Prisma.Decimal(score), exam.maxGrade)) {
        throw new AppError('VALIDATION_FAILED', 'score is outside this exam’s range', {
          reason: 'SCORE_OUT_OF_RANGE',
          student_id: entry.studentId,
          max_grade: toNumber(exam.maxGrade),
        });
      }

      let gradeId: string;
      if (!current) {
        const created = await tx.grade.create({
          data: {
            examId,
            studentId: entry.studentId,
            administrativeGroupId: exam.administrativeGroupId,
            score,
            absent: entry.absent,
            status: 'draft',
            // Revision 156 — who entered the mark, distinct from `studentId`
            // (who it is about).
            createdById: actor.userId,
          },
          select: { id: true },
        });
        gradeId = created.id;
      } else {
        if (current.version !== entry.version) {
          throw new AppError('VERSION_CONFLICT', 'this grade was changed by someone else', {
            student_id: entry.studentId,
          });
        }
        await tx.grade.update({
          where: { id: current.id },
          data: {
            score,
            absent: entry.absent,
            // BR-8 — amending a published grade returns it to draft; the new
            // value is invisible until somebody re-publishes deliberately.
            status: 'draft',
            publishedAt: null,
            version: { increment: 1 },
          },
        });
        gradeId = current.id;
      }

      // **Owner-reported, 2026-09-15 — the breakdown is REPLACED whole, on
      // the identical convention `staff`/every other whole-row field on this
      // platform already follows**: this save states the complete current
      // set, and a question absent from it no longer holds a score (an
      // absent student's breakdown, if it had one, is cleared entirely).
      if (entry.absent) {
        await tx.gradeQuestionScore.deleteMany({ where: { gradeId } });
      } else if (questionScores !== null) {
        await tx.gradeQuestionScore.deleteMany({
          where: { gradeId, questionId: { notIn: questionScores.map((qs) => qs.questionId) } },
        });
        for (const qs of questionScores) {
          await tx.gradeQuestionScore.upsert({
            where: { gradeId_questionId: { gradeId, questionId: qs.questionId } },
            create: { gradeId, questionId: qs.questionId, score: qs.score },
            update: { score: qs.score },
          });
        }
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
          score: 0,
          absent: true,
          status: 'draft',
          // Revision 156 — the row exists because THIS save triggered BR-7's
          // initialisation, even though it names no explicit entry for her.
          createdById: actor.userId,
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
): Promise<{ published: number; republished: boolean; notified: number }> {
  return prisma.$transaction(async (tx) => {
    await lockExamRow(tx, examId);
    await loadForGrading(tx as PrismaClient, actor, examId);
    const rows = await tx.grade.findMany({
      where: { examId },
      select: { id: true, status: true, publishedAt: true, studentId: true },
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

    /**
     * **R82.4 — the student is told, at publication and only there.**
     *
     * Inside this transaction, like R77.4's cancellation notices and for the
     * same reason: a committed publication nobody was told about cannot be told
     * apart, on retry, from one already announced. A draft save writes nothing
     * at all, because a draft sheet is a مؤطرة's working document (BR-8).
     *
     * **Re-publication after a real change makes the notice UNREAD again**
     * (2026-08-20). R82.4 made it write nothing, reasoning that her screen
     * shows the current mark — which holds only if she looks again, and a
     * student given 17 after reading a notice about 12 had nothing telling her
     * to. One row per (student, exam), reactivated on a change and silent
     * without one; the rule lives in `notifyGradePublished`.
     */
    /**
     * **Every published row is a candidate, not only the ones drafted now.**
     *
     * This passed `rows.filter(r => draft.some(...))`, so a republish after a
     * correction offered the notifier nobody at all — the second of the two
     * reasons a corrected mark reached no one. Whether anything is actually
     * announced is `notifyGradePublished`'s decision, and it makes it from the
     * grade's own timestamp.
     */
    const notified = await notifyGradePublished(
      tx,
      examId,
      rows.map((r) => r.studentId),
      actor.userId,
    );

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: republished ? 'grade.republish' : 'grade.publish',
      targetEntity: 'Exam',
      targetId: examId,
      detail: { students_affected: draft.length, notified },
    });

    return { published: draft.length, republished, notified };
  });
}
