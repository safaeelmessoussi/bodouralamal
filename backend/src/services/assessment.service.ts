import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';

import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import {
  assertExamInTeacherScope,
  examAudienceWhere,
  studentsTaughtBy,
  teacherEventScope,
} from '../policies/roster-resolution.js';

/**
 * **A simple online assessment — the paper, its audience, and the answers**
 * (SRS §4.6 as extended by R124).
 *
 * ## This is an Exam, deliberately
 *
 * `exam.mode = 'online'` has existed since R58 and was refused at the service
 * level with a coded `ONLINE_NOT_AVAILABLE`, because — in that service's own
 * words — *"`physical` carries a place and staff and no questions; `online`
 * will carry questions and no place"*. This module builds the half that was
 * declared and postponed. **No second assessment entity was created**: one
 * would fork `Grade`, which is keyed `(exam_id, student_id)` and already
 * carries the 20-point scale, the draft/published split, the sheet, the
 * student's results screen and the parent visibility rule. A parallel model
 * would have had to reproduce all five.
 *
 * ## Five audiences, one resolver
 *
 * A formal paper for a Level, a narrower one for an Administrative Group, a
 * quick test on one Session, one for a Teaching Group, and one addressed to a
 * single beneficiary. All five go through `examAudienceWhere`, so *who may open
 * this* and *who appears on the grade sheet* cannot disagree.
 *
 * ## Eligibility is derived; a submission is a fact
 *
 * Nobody is copied into an assignment table (§20 rule 22). Eligibility is
 * resolved at read time against the enrolments live in the `AcademicPeriod`
 * covering **the assessment's own date** (R122) — and a `StudentExamSubmission`
 * row, once it exists, is never touched by a later enrolment change. *Who may
 * start now* and *who answered* are different questions with different sources,
 * which is exactly why the second is a row and the first is a query.
 */

const MANAGING_ROLE = 'admin';

/* ── Authoring authority ──────────────────────────────────────────────────── */

/**
 * **The same rule an exam already has** (TD-2 as split by R70.4), reused rather
 * than restated: Super Admin everywhere, Admin within branch scope, Teacher
 * within their own teaching. Authoring an online paper is not a new capability
 * and does not get a new matrix row.
 *
 * **Not a TD-12 freshness surface.** That catalogue is approvals, consent
 * overrides, pass/fail overrides, user management and presigned minting;
 * writing a question is ordinary operational work, and adding it here would
 * make one write assert against live rows while its siblings on the same screen
 * do not.
 */
async function assertMayAuthor(
  prisma: PrismaClient | Prisma.TransactionClient,
  actor: Actor,
  exam: {
    levelId: string;
    subjectId: string | null;
    branchId: string | null;
    administrativeGroupId: string | null;
    /** R124 — the named individual, when the target is one. */
    studentId?: string | null;
    /** R125 — the arm, so the audience can be resolved without re-deriving it. */
    targetKind?: string;
    sessionId?: string | null;
    teachingGroupId?: string | null;
    date?: Date;
  },
): Promise<void> {
  if (scope.isSuperAdmin(actor.roleScopes)) return;

  if (scope.hasRole(actor.roleScopes, MANAGING_ROLE)) {
    if (exam.branchId !== null) {
      scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, exam.branchId, 'no such assessment');
    }
    await assertAudienceWithinBranchScope(prisma, actor, exam);
    return;
  }

  /**
   * **R125 — «may this مؤطِّرة address THIS student», not «this whole Level».**
   *
   * A `student` target names no group, so the pre-R125 path asked
   * `assertExamInTeacherScope` with a null group — which is the question *do you
   * teach the entire Level*. A مؤطِّرة staffing one Administrative Group inside
   * it was refused for a student she teaches every week, and the Owner has
   * ruled that too broad.
   *
   * **`studentsTaughtBy` is the canonical answer and is reused, not restated.**
   * §4.4c names it as the derivation behind Quran logging on *her own students*,
   * exam authoring, sensitive social data, hidden-event visibility and content
   * scope; a second rule here would be the drift that file's own comment warns
   * about. It resolves the union of the audiences of the schedules she staffs —
   * so knowing a UUID grants nothing, and a student in the same Level taught by
   * somebody else is not hers.
   */
  if (exam.targetKind === 'student' && exam.studentId != null) {
    const taught = await studentsTaughtBy(prisma as PrismaClient, actor.userId);
    const reaches = await (prisma as PrismaClient).user.count({
      where: { AND: [taught, { id: exam.studentId, deletedAt: null }] },
    });
    // §20 rule 17 — a student she may not address is indistinguishable from one
    // who does not exist, or the refusal becomes a lookup.
    if (reaches === 0) throw new AppError('NOT_FOUND', 'no such beneficiary');
    return;
  }

  await assertExamInTeacherScope(prisma as PrismaClient, actor.userId, {
    branchId: exam.branchId ?? '',
    levelId: exam.levelId,
    subjectId: exam.subjectId ?? '',
    administrativeGroupId: exam.administrativeGroupId,
  });
}

/**
 * **R125 — a Level target does not override branch authorization.**
 *
 * A Level spans branches; an online paper carries none of its own, and the
 * pre-R125 reading turned *no branch to assert* into *no assertion*. The Owner's
 * rule is stated in terms of the **audience**: a branch-scoped Admin may use a
 * target only when everybody it resolves to is inside her branches.
 *
 * **So the audience is what is checked, not the target's shape.** One rule for
 * all five arms, composed from `examAudienceWhere` — the single definition of
 * *who is this for* (§4.4c) — rather than five per-arm branch lookups that would
 * be a second source of truth for branch membership. A Level that exists only at
 * her branch is usable; the same Level once a second branch teaches it is not,
 * and she is told so rather than silently reaching those students.
 *
 * **Enrolment is the branch fact** (§20 rule 22): a beneficiary is outside her
 * scope only when she has **no** live enrolment at any reachable branch — a
 * student enrolled at two branches, one of them hers, is somebody she already
 * administers.
 */
async function assertAudienceWithinBranchScope(
  prisma: PrismaClient | Prisma.TransactionClient,
  actor: Actor,
  exam: {
    levelId: string;
    branchId: string | null;
    administrativeGroupId: string | null;
    studentId?: string | null;
    targetKind?: string;
    sessionId?: string | null;
    teachingGroupId?: string | null;
    date?: Date;
  },
): Promise<void> {
  const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);
  // `null` is every branch (§7, R24) — never "no branches".
  if (reachable === null) return;

  const audience = await examAudienceWhere(prisma, {
    targetKind: exam.targetKind ?? 'level',
    levelId: exam.levelId,
    branchId: exam.branchId,
    administrativeGroupId: exam.administrativeGroupId ?? null,
    sessionId: exam.sessionId ?? null,
    teachingGroupId: exam.teachingGroupId ?? null,
    studentId: exam.studentId ?? null,
    on: exam.date ?? null,
  });
  // A target that resolves to nobody in particular reaches nobody, so there is
  // nothing outside her scope in it.
  if (audience === null) return;

  const outside = await (prisma as PrismaClient).user.count({
    where: {
      AND: [
        audience,
        { deletedAt: null },
        { levelEnrollments: { none: { deletedAt: null, branchId: { in: reachable } } } },
      ],
    },
  });
  if (outside > 0) {
    throw new AppError(
      'FORBIDDEN',
      'this target reaches beneficiaries outside your branches',
      { reason: 'TARGET_OUTSIDE_BRANCH_SCOPE', outside_count: outside },
    );
  }
}

const ASSESSMENT_SELECT = {
  id: true,
  title: true,
  description: true,
  mode: true,
  status: true,
  targetKind: true,
  levelId: true,
  subjectId: true,
  branchId: true,
  administrativeGroupId: true,
  sessionId: true,
  teachingGroupId: true,
  studentId: true,
  academicYearId: true,
  date: true,
  maxGrade: true,
  publishedAt: true,
  closedAt: true,
  version: true,
} as const;

type AssessmentRow = Prisma.ExamGetPayload<{ select: typeof ASSESSMENT_SELECT }>;

/** Out of scope answers `404`, never `403` (§20 rule 17). */
async function loadForAuthor(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<AssessmentRow> {
  const exam = await prisma.exam.findFirst({
    where: { id, deletedAt: null, mode: 'online' },
    select: ASSESSMENT_SELECT,
  });
  if (!exam) throw new AppError('NOT_FOUND', 'no such assessment');
  // `ASSESSMENT_SELECT` already carries the arm and the date, so the branch rule
  // resolves this row's real audience rather than a partial view of it.
  await assertMayAuthor(prisma, actor, { ...exam, date: exam.date });
  return exam;
}

/* ── The freeze ───────────────────────────────────────────────────────────── */

/**
 * **The paper freezes the moment somebody submits.**
 *
 * The simplest rule that is safe, and the reason no versioning scheme was
 * introduced: a question whose wording, order or options changed after an
 * answer was given makes that answer mean something the student never said.
 * Reordering is included — a printed register of *«السؤال 3»* has to keep
 * meaning the same question.
 *
 * A **draft in progress** is not a submission and does not freeze anything: she
 * has answered nothing anybody has read, and the author is still writing.
 */
async function assertNotFrozen(
  prisma: PrismaClient | Prisma.TransactionClient,
  examId: string,
): Promise<void> {
  const submitted = await prisma.studentExamSubmission.count({
    where: { examId, state: { not: 'in_progress' } },
  });
  if (submitted > 0) {
    throw new AppError('STATE_CONFLICT', 'answers have been submitted; the paper is fixed', {
      reason: 'ASSESSMENT_HAS_SUBMISSIONS',
    });
  }
}

/* ── Authoring ────────────────────────────────────────────────────────────── */

export interface AssessmentTarget {
  kind: 'level' | 'administrative_group' | 'session' | 'teaching_group' | 'student';
  /** The id of whatever the kind names. Absent only for `level`. */
  id?: string;
}

export interface AssessmentInput {
  title: string;
  description?: string | null;
  maxGrade: number;
  levelId: string;
  subjectId?: string | null;
  academicYearId?: string | null;
  target: AssessmentTarget;
  /** Absent on a `session` target, where the Session's own date is the answer. */
  date?: Date;
}

/**
 * `POST /assessments` — a new paper, in `draft`.
 *
 * **Draft, always.** An assessment nobody has written questions for is not
 * something to publish, and starting anywhere else would mean a student could
 * open an empty paper.
 */
export async function createAssessment(
  prisma: PrismaClient,
  actor: Actor,
  input: AssessmentInput,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const target = await resolveTarget(tx, input);
    await assertMayAuthor(tx, actor, {
      levelId: input.levelId,
      subjectId: input.subjectId ?? null,
      // An online paper is sat nowhere, so it carries no branch — the CHECK
      // `exam_online_has_no_room_check` refuses one outright.
      branchId: null,
      administrativeGroupId: target.administrativeGroupId,
      studentId: target.studentId,
      // R125 — the whole arm, so the branch rule can resolve the audience it is
      // stated in terms of rather than guessing from which columns are set.
      targetKind: input.target.kind,
      sessionId: target.sessionId,
      teachingGroupId: target.teachingGroupId,
      date: target.date,
    });

    const created = await tx.exam.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        mode: 'online',
        status: 'draft',
        levelId: input.levelId,
        subjectId: input.subjectId ?? null,
        academicYearId: input.academicYearId ?? null,
        maxGrade: input.maxGrade,
        date: target.date,
        targetKind: input.target.kind,
        administrativeGroupId: target.administrativeGroupId,
        sessionId: target.sessionId,
        teachingGroupId: target.teachingGroupId,
        studentId: target.studentId,
      },
      select: { id: true },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'assessment.create',
      targetEntity: 'Exam',
      targetId: created.id,
      // Ids and a kind. **Never the title**, which is free text a person wrote
      // (TD-14), and never a question or an answer anywhere in this module.
      detail: { target_kind: input.target.kind, level_id: input.levelId },
    });
    return created;
  });
}

/** Every target arm validated once, and the date it implies resolved with it. */
async function resolveTarget(
  tx: Prisma.TransactionClient,
  input: AssessmentInput,
): Promise<{
  date: Date;
  administrativeGroupId: string | null;
  sessionId: string | null;
  teachingGroupId: string | null;
  studentId: string | null;
}> {
  const none = {
    administrativeGroupId: null,
    sessionId: null,
    teachingGroupId: null,
    studentId: null,
  };
  const requireId = (): string => {
    if (input.target.id === undefined) {
      throw new AppError('VALIDATION_FAILED', 'this target needs the thing it names', {
        reason: 'TARGET_ID_REQUIRED',
      });
    }
    return input.target.id;
  };
  const requireDate = (): Date => {
    if (input.date === undefined) {
      /**
       * **The date is not decoration.** Eligibility resolves against the
       * `AcademicPeriod` covering it (R122), so an assessment with no date has
       * no answerable audience — and `exam.date` is NOT NULL besides.
       */
      throw new AppError('VALIDATION_FAILED', 'an assessment needs its date', {
        reason: 'DATE_REQUIRED',
      });
    }
    return input.date;
  };

  switch (input.target.kind) {
    case 'level':
      return { date: requireDate(), ...none };

    case 'administrative_group': {
      const id = requireId();
      const group = await tx.administrativeGroup.findFirst({
        where: { id, deletedAt: null, levelId: input.levelId },
        select: { id: true },
      });
      // A group of another Level would be sat by people the paper was not
      // written for — the same refusal R58 gives a physical sitting.
      if (!group) throw new AppError('NOT_FOUND', 'no such group in this level');
      return { date: requireDate(), ...none, administrativeGroupId: id };
    }

    case 'session': {
      const id = requireId();
      const session = await tx.session.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, date: true },
      });
      if (!session) throw new AppError('NOT_FOUND', 'no such occurrence');
      // **The occurrence's own date, never the caller's.** A quick test belongs
      // to the class that happened, so its audience and its academic period are
      // that day's — and a caller-supplied date could disagree with it.
      return { date: session.date, ...none, sessionId: id };
    }

    case 'teaching_group': {
      const id = requireId();
      const group = await tx.teachingGroup.findFirst({
        where: { id, deletedAt: null, levelId: input.levelId },
        select: { id: true },
      });
      if (!group) throw new AppError('NOT_FOUND', 'no such teaching group in this level');
      return { date: requireDate(), ...none, teachingGroupId: id };
    }

    case 'student': {
      const id = requireId();
      const student = await tx.user.findFirst({
        where: { id, deletedAt: null, isBeneficiary: true },
        select: { id: true },
      });
      if (!student) throw new AppError('NOT_FOUND', 'no such beneficiary');
      return { date: requireDate(), ...none, studentId: id };
    }
  }
}

export interface QuestionInput {
  kind: 'short_text' | 'long_text' | 'single_choice' | 'multiple_choice';
  prompt: string;
  justification?: 'none' | 'optional' | 'required';
  /** Required for a choice question, refused for a text one. */
  options?: string[];
}

/** `POST /assessments/{id}/questions` — appended, never inserted at a position. */
export async function addQuestion(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  input: QuestionInput,
): Promise<{ id: string }> {
  await loadForAuthor(prisma, actor, examId);
  assertQuestionShape(input);

  return prisma.$transaction(async (tx) => {
    await assertNotFrozen(tx, examId);
    /**
     * **Appended.** A create that also chose a position would be a second
     * ordering mechanism beside the reorder route, and R76 settled that
     * ordering is expressed as a whole sequence.
     */
    const last = await tx.examQuestion.aggregate({
      where: { examId, deletedAt: null },
      _max: { displayOrder: true },
    });
    const question = await tx.examQuestion.create({
      data: {
        examId,
        displayOrder: (last._max.displayOrder ?? 0) + 1,
        kind: input.kind,
        prompt: input.prompt,
        justification: input.justification ?? 'none',
        ...(input.options === undefined
          ? {}
          : {
              options: {
                create: input.options.map((label, index) => ({
                  displayOrder: index + 1,
                  label,
                })),
              },
            }),
      },
      select: { id: true },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'assessment.question.add',
      targetEntity: 'ExamQuestion',
      targetId: question.id,
      // **The kind and a count — never the prompt or an option label.** A
      // question is free text a person wrote, and TD-14 keeps it out of the log
      // exactly as it keeps a student's answer out.
      detail: { exam_id: examId, kind: input.kind, option_count: input.options?.length ?? 0 },
    });
    return question;
  });
}

/**
 * The shapes a question kind can and cannot have.
 *
 * **Refused rather than silently dropped**: a client sending options on a
 * `short_text` has misunderstood something, and a `201` would confirm the
 * misunderstanding.
 */
function assertQuestionShape(input: QuestionInput): void {
  const isChoice = input.kind === 'single_choice' || input.kind === 'multiple_choice';
  if (isChoice) {
    if (!input.options || input.options.length < 2) {
      throw new AppError('VALIDATION_FAILED', 'a choice question needs at least two options', {
        reason: 'OPTIONS_REQUIRED',
      });
    }
    return;
  }
  if (input.options !== undefined && input.options.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'a text question has no options', {
      reason: 'OPTIONS_NOT_ALLOWED',
    });
  }
  if (input.justification !== undefined && input.justification !== 'none') {
    // A text answer IS its own justification; the CHECK refuses this too.
    throw new AppError('VALIDATION_FAILED', 'a text question asks for no justification', {
      reason: 'JUSTIFICATION_NOT_ALLOWED',
    });
  }
}

/** `PATCH /assessments/{id}/questions/{questionId}` — wording, justification, options. */
export async function updateQuestion(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  questionId: string,
  expectedVersion: number,
  patch: { prompt?: string; justification?: 'none' | 'optional' | 'required'; options?: string[] },
): Promise<void> {
  await loadForAuthor(prisma, actor, examId);

  await prisma.$transaction(async (tx) => {
    await assertNotFrozen(tx, examId);
    const existing = await tx.examQuestion.findFirst({
      where: { id: questionId, examId, deletedAt: null },
      select: { id: true, kind: true },
    });
    if (!existing) throw new AppError('NOT_FOUND', 'no such question');
    assertQuestionShape({
      kind: existing.kind,
      prompt: patch.prompt ?? 'x',
      ...(patch.justification === undefined ? {} : { justification: patch.justification }),
      ...(patch.options === undefined ? {} : { options: patch.options }),
    });

    await updateWithVersion({
      delegate: tx.examQuestion,
      id: questionId,
      expectedVersion,
      requireNotDeleted: true,
      data: {
        ...(patch.prompt === undefined ? {} : { prompt: patch.prompt }),
        ...(patch.justification === undefined ? {} : { justification: patch.justification }),
      },
    });

    if (patch.options !== undefined) {
      /**
       * **Replaced as a whole set, and only while nothing is submitted.**
       *
       * `assertNotFrozen` above is what makes this safe: an option a student
       * chose is referenced by `student_exam_answer_option` under `RESTRICT`,
       * so the database would refuse this soft delete anyway — the service
       * refuses first, with a sentence an administrator can act on.
       */
      await tx.examQuestionOption.updateMany({
        where: { questionId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
      for (const [index, label] of patch.options.entries()) {
        await tx.examQuestionOption.create({
          data: { questionId, displayOrder: index + 1, label },
        });
      }
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'assessment.question.update',
      targetEntity: 'ExamQuestion',
      targetId: questionId,
      detail: { exam_id: examId, fields: Object.keys(patch) },
    });
  });
}

/** `DELETE /assessments/{id}/questions/{questionId}` — TD-5, and the order closes up. */
export async function removeQuestion(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  questionId: string,
): Promise<void> {
  await loadForAuthor(prisma, actor, examId);

  await prisma.$transaction(async (tx) => {
    await assertNotFrozen(tx, examId);
    const existing = await tx.examQuestion.findFirst({
      where: { id: questionId, examId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new AppError('NOT_FOUND', 'no such question');

    /**
     * **The snapshot before the tombstone** (§20 rule 11, TD-5).
     *
     * A question is something a member of staff wrote, and Trash is what lets a
     * deletion be undone — the same reason every other soft delete on this
     * platform files one. **No student answer can be in it**: `assertNotFrozen`
     * above refuses this path once anybody has submitted, so the snapshot is
     * the author's own text and nothing of anybody else's.
     */
    const full = await tx.examQuestion.findUniqueOrThrow({
      where: { id: questionId },
      select: {
        id: true,
        examId: true,
        displayOrder: true,
        kind: true,
        prompt: true,
        justification: true,
        options: {
          where: { deletedAt: null },
          select: { id: true, displayOrder: true, label: true },
        },
      },
    });
    await trash.snapshot(tx, {
      targetEntity: 'ExamQuestion',
      targetId: questionId,
      snapshot: full,
      deletedById: actor.userId,
    });

    const now = new Date();
    await tx.examQuestionOption.updateMany({
      where: { questionId, deletedAt: null },
      data: { deletedAt: now, deletedById: actor.userId },
    });
    await tx.examQuestion.update({
      where: { id: questionId },
      data: { deletedAt: now, deletedById: actor.userId },
    });

    // **The remaining questions close up.** The partial unique index would let a
    // gap stand, but «السؤال 4» on a paper of three reads as a question that
    // went missing.
    const remaining = await tx.examQuestion.findMany({
      where: { examId, deletedAt: null },
      select: { id: true },
      orderBy: { displayOrder: 'asc' },
    });
    await renumber(tx, remaining.map((q) => q.id));

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'assessment.question.remove',
      targetEntity: 'ExamQuestion',
      targetId: questionId,
      detail: { exam_id: examId },
    });
  });
}

/**
 * `PATCH /assessments/{id}/questions/order` — the whole sequence, as R76 requires.
 *
 * Two passes through a negative range first: `exam_question_order_unique` is a
 * real index, so writing `1,2,3` over `3,1,2` collides halfway unless the rows
 * are parked somewhere no live row can be.
 */
async function renumber(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  for (const [index, id] of ids.entries()) {
    await tx.examQuestion.update({ where: { id }, data: { displayOrder: -(index + 1) } });
  }
  for (const [index, id] of ids.entries()) {
    await tx.examQuestion.update({ where: { id }, data: { displayOrder: index + 1 } });
  }
}

export async function reorderQuestions(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  ids: string[],
): Promise<void> {
  await loadForAuthor(prisma, actor, examId);

  await prisma.$transaction(async (tx) => {
    await assertNotFrozen(tx, examId);
    const live = await tx.examQuestion.findMany({
      where: { examId, deletedAt: null },
      select: { id: true },
    });
    const known = new Set(live.map((q) => q.id));
    // **The whole sequence or nothing.** A partial list would leave the omitted
    // questions somewhere the caller did not decide, which is how an order
    // silently becomes whatever the database happened to return.
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new AppError('VALIDATION_FAILED', 'the order must list every question exactly once', {
        reason: 'INCOMPLETE_ORDER',
      });
    }
    await renumber(tx, ids);

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'assessment.question.reorder',
      targetEntity: 'Exam',
      targetId: examId,
      detail: { question_count: ids.length },
    });
  });
}

/* ── Lifecycle ────────────────────────────────────────────────────────────── */

/** `POST /assessments/{id}/publish` — draft → published. */
export async function publishAssessment(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
): Promise<void> {
  const exam = await loadForAuthor(prisma, actor, examId);
  if (exam.status !== 'draft') {
    throw new AppError('STATE_CONFLICT', 'this assessment is not a draft', {
      reason: 'INVALID_TRANSITION',
    });
  }

  await prisma.$transaction(async (tx) => {
    /**
     * **Re-checked at publish, and that is the Owner's word — «author or
     * publish»** (R125). The audience is resolved, not stored, so a Level that
     * was entirely at her branch when she drafted the paper may have gained a
     * second branch since. Publishing is the moment it reaches people, so it is
     * the moment the question has to be asked again.
     */
    await assertAudienceWithinBranchScope(tx, actor, { ...exam, date: exam.date });

    const questions = await tx.examQuestion.count({ where: { examId, deletedAt: null } });
    // **An empty paper is not publishable.** A student opening one would be
    // shown a title and nothing to answer, and would have no way to tell that
    // from a fault.
    if (questions === 0) {
      throw new AppError('STATE_CONFLICT', 'an assessment with no questions cannot be published', {
        reason: 'NO_QUESTIONS',
      });
    }
    await tx.exam.update({
      where: { id: examId },
      data: { status: 'published', publishedAt: new Date() },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'assessment.publish',
      targetEntity: 'Exam',
      targetId: examId,
      detail: { question_count: questions, target_kind: exam.targetKind },
    });
  });
}

/**
 * `POST /assessments/{id}/close` — published → closed.
 *
 * **Closing stops new answers and hides nothing.** Every submitted response
 * stays readable to the people who may read it, and a published grade stays
 * published: a closed assessment is one that has finished, not one that has
 * been withdrawn.
 */
export async function closeAssessment(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
): Promise<void> {
  const exam = await loadForAuthor(prisma, actor, examId);
  if (exam.status !== 'published') {
    throw new AppError('STATE_CONFLICT', 'only a published assessment can be closed', {
      reason: 'INVALID_TRANSITION',
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.exam.update({
      where: { id: examId },
      data: { status: 'closed', closedAt: new Date() },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'assessment.close',
      targetEntity: 'Exam',
      targetId: examId,
      detail: {},
    });
  });
}

/* ── Eligibility, and the student's paper ─────────────────────────────────── */

/**
 * **May this person open this assessment right now?**
 *
 * Two separate facts, and the distinction is the Owner's: *eligible to start*
 * is derived from live enrolment through `examAudienceWhere`; *has already
 * answered* is a `StudentExamSubmission` row that no enrolment change ever
 * touches. A student who leaves the Level keeps her submission and loses the
 * ability to start a new one, which is the only reading that is true of both.
 */
async function eligible(
  prisma: PrismaClient | Prisma.TransactionClient,
  exam: AssessmentRow,
  studentId: string,
): Promise<boolean> {
  const where = await examAudienceWhere(prisma, {
    targetKind: exam.targetKind,
    levelId: exam.levelId,
    branchId: exam.branchId,
    administrativeGroupId: exam.administrativeGroupId,
    sessionId: exam.sessionId,
    teachingGroupId: exam.teachingGroupId,
    studentId: exam.studentId,
    // The assessment's own date — R122's rule, so a paper read two years later
    // resolves to the students who were enrolled then.
    on: exam.date,
  });
  if (where === null) return false;
  // `deletedAt: null` is redundant — every arm of `examAudienceWhere` already
  // constrains it — and it is written anyway, deliberately: this call site must
  // be safe on its own reading, not on a promise made one module over. The
  // structural guard is blunt for the same reason.
  return (
    (await prisma.user.count({
      where: { AND: [where, { id: studentId, deletedAt: null }] },
    })) > 0
  );
}

export interface StudentPaper {
  exam: AssessmentRow;
  questions: {
    id: string;
    displayOrder: number;
    kind: string;
    prompt: string;
    justification: string;
    options: { id: string; displayOrder: number; label: string }[];
  }[];
  submission: {
    id: string;
    state: string;
    submittedAt: Date | null;
    answers: {
      questionId: string;
      text: string | null;
      justification: string | null;
      optionIds: string[];
    }[];
  } | null;
}

/**
 * `GET /assessments/{id}/paper` — the paper as the student sees it.
 *
 * **A draft is invisible.** Not hidden by the client: an unpublished assessment
 * answers `404` here, the same answer an assessment she is not eligible for
 * gives, because distinguishing them would leak that a paper exists (§20 rule
 * 17).
 */
export async function studentPaper(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  studentId: string,
): Promise<StudentPaper> {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, deletedAt: null, mode: 'online', status: { in: ['published', 'closed'] } },
    select: ASSESSMENT_SELECT,
  });
  if (!exam) throw new AppError('NOT_FOUND', 'no such assessment');

  const submission = await prisma.studentExamSubmission.findFirst({
    where: { examId, studentId },
    select: {
      id: true,
      state: true,
      submittedAt: true,
      answers: {
        select: {
          questionId: true,
          text: true,
          justification: true,
          options: { select: { optionId: true } },
        },
      },
    },
  });

  /**
   * **A submission is its own permission to read.** She may no longer be
   * eligible — the period ended, she moved Level — and the paper she answered
   * must stay readable to her regardless. Eligibility decides *may I start*,
   * never *may I see what I wrote*.
   */
  if (submission === null && !(await eligible(prisma, exam, studentId))) {
    throw new AppError('NOT_FOUND', 'no such assessment');
  }

  const questions = await prisma.examQuestion.findMany({
    where: { examId, deletedAt: null },
    select: {
      id: true,
      displayOrder: true,
      kind: true,
      prompt: true,
      justification: true,
      options: {
        where: { deletedAt: null },
        select: { id: true, displayOrder: true, label: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
    orderBy: { displayOrder: 'asc' },
  });

  return {
    exam,
    questions,
    submission:
      submission === null
        ? null
        : {
            id: submission.id,
            state: submission.state,
            submittedAt: submission.submittedAt,
            answers: submission.answers.map((a) => ({
              questionId: a.questionId,
              text: a.text,
              justification: a.justification,
              optionIds: a.options.map((o) => o.optionId),
            })),
          },
  };
}

export interface AnswerInput {
  questionId: string;
  text?: string | null;
  justification?: string | null;
  optionIds?: string[];
}

/**
 * `PUT /assessments/{id}/responses` — **حفظ**, and `POST .../submit` — **إرسال**.
 *
 * One writer for both, because the difference between them is exactly one
 * thing: whether the state moves to `submitted` and the answers become
 * immutable. Two functions would have been two validation paths, and the second
 * one would eventually be the lenient one.
 *
 * **Nothing autosaves and nothing autosubmits.** A closed browser leaves a
 * draft, which is what the Owner asked for and what a person expects.
 */
export async function saveResponses(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  studentId: string,
  answers: AnswerInput[],
  options: { submit: boolean },
): Promise<{ state: string }> {
  /**
   * **She may write only her own.** The route takes no student id at all; this
   * is the backstop that makes the rule structural rather than a property of
   * one controller — the same discipline R123's self check-in uses.
   */
  if (studentId !== actor.userId) {
    throw new AppError('FORBIDDEN', 'a submission belongs to the person who wrote it', {
      reason: 'NOT_YOUR_SUBMISSION',
    });
  }

  return prisma.$transaction(async (tx) => {
    const exam = await tx.exam.findFirst({
      where: { id: examId, deletedAt: null, mode: 'online', status: 'published' },
      select: ASSESSMENT_SELECT,
    });
    // `closed` and `draft` both answer NOT_FOUND rather than a state error: one
    // is over and one never started, and neither is a paper she may write on.
    if (!exam) throw new AppError('NOT_FOUND', 'no such assessment');
    if (!(await eligible(tx, exam, studentId))) {
      throw new AppError('NOT_FOUND', 'no such assessment');
    }

    const existing = await tx.studentExamSubmission.findUnique({
      where: { examId_studentId: { examId, studentId } },
      select: { id: true, state: true },
    });
    if (existing && existing.state !== 'in_progress') {
      // **Submitted is final for the student.** Reopening is an explicit staff
      // act and does not exist in v1; a silent second submission would let the
      // answers a teacher already read change underneath her.
      throw new AppError('STATE_CONFLICT', 'these answers have already been submitted', {
        reason: 'ALREADY_SUBMITTED',
      });
    }

    const questions = await tx.examQuestion.findMany({
      where: { examId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        justification: true,
        options: { where: { deletedAt: null }, select: { id: true } },
      },
    });
    validateAnswers(questions, answers, options.submit);

    const submission =
      existing ??
      (await tx.studentExamSubmission.create({
        data: { examId, studentId },
        select: { id: true, state: true },
      }));

    for (const answer of answers) {
      const row = await tx.studentExamAnswer.upsert({
        where: {
          submissionId_questionId: { submissionId: submission.id, questionId: answer.questionId },
        },
        create: {
          submissionId: submission.id,
          questionId: answer.questionId,
          text: answer.text ?? null,
          justification: answer.justification ?? null,
        },
        update: { text: answer.text ?? null, justification: answer.justification ?? null },
        select: { id: true },
      });
      // Replaced as a whole set: a partial update would make *«I changed my
      // mind and chose only ب»* indistinguishable from *«I added ب»*.
      await tx.studentExamAnswerOption.deleteMany({ where: { answerId: row.id } });
      for (const optionId of answer.optionIds ?? []) {
        await tx.studentExamAnswerOption.create({ data: { answerId: row.id, optionId } });
      }
    }

    const state = options.submit ? 'submitted' : 'in_progress';
    await tx.studentExamSubmission.update({
      where: { id: submission.id },
      data: {
        state,
        ...(options.submit ? { submittedAt: new Date() } : {}),
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: options.submit ? 'assessment.submit' : 'assessment.save',
      targetEntity: 'StudentExamSubmission',
      targetId: submission.id,
      /**
       * **Ids and a count. No answer text, ever** (TD-14, §14 of the Owner's
       * brief). A student's answer is educational personal data and the audit
       * row exists to say *that* she answered, never *what* she said. The audit
       * repository's minimisation guard refuses a copied identity outright;
       * this is the same discipline applied to free text it cannot detect.
       */
      detail: { exam_id: examId, answer_count: answers.length },
    });

    return { state };
  });
}

/**
 * **Every response type is checked here, against the question's own kind.**
 *
 * The client is not trusted with any of it: a `single_choice` carrying two
 * options, a `multiple_choice` naming an option from another question, a text
 * answer on a choice question, a missing required justification. Each is a
 * different mistake and each gets its own reason, because *«invalid»* alone
 * leaves the student re-reading a form with nothing to correct.
 *
 * **Completeness is only required on SUBMIT.** A draft is a half-finished
 * paper by definition, and refusing to save one would defeat the point of
 * having a save at all.
 */
function validateAnswers(
  questions: { id: string; kind: string; justification: string; options: { id: string }[] }[],
  answers: AnswerInput[],
  submitting: boolean,
): void {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set<string>();

  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) {
      throw new AppError('VALIDATION_FAILED', 'that question is not on this paper', {
        reason: 'UNKNOWN_QUESTION',
      });
    }
    if (seen.has(answer.questionId)) {
      throw new AppError('VALIDATION_FAILED', 'one answer per question', {
        reason: 'DUPLICATE_ANSWER',
      });
    }
    seen.add(answer.questionId);

    const chosen = answer.optionIds ?? [];
    const isChoice = question.kind === 'single_choice' || question.kind === 'multiple_choice';

    if (!isChoice) {
      if (chosen.length > 0) {
        throw new AppError('VALIDATION_FAILED', 'that question has no options', {
          reason: 'OPTIONS_NOT_ALLOWED',
        });
      }
      if (answer.justification !== undefined && answer.justification !== null) {
        throw new AppError('VALIDATION_FAILED', 'that question asks for no justification', {
          reason: 'JUSTIFICATION_NOT_ALLOWED',
        });
      }
      if (submitting && (answer.text ?? '').trim() === '') {
        throw new AppError('VALIDATION_FAILED', 'this question needs an answer', {
          reason: 'ANSWER_REQUIRED',
        });
      }
      continue;
    }

    if (answer.text !== undefined && answer.text !== null && answer.text !== '') {
      throw new AppError('VALIDATION_FAILED', 'a choice question takes no written answer', {
        reason: 'TEXT_NOT_ALLOWED',
      });
    }
    const legal = new Set(question.options.map((o) => o.id));
    if (chosen.some((id) => !legal.has(id))) {
      // An option from another question would attach an answer to a choice the
      // student was never shown.
      throw new AppError('VALIDATION_FAILED', 'that option is not on this question', {
        reason: 'UNKNOWN_OPTION',
      });
    }
    if (new Set(chosen).size !== chosen.length) {
      throw new AppError('VALIDATION_FAILED', 'an option may be chosen once', {
        reason: 'DUPLICATE_OPTION',
      });
    }
    if (question.kind === 'single_choice' && chosen.length > 1) {
      throw new AppError('VALIDATION_FAILED', 'this question takes exactly one answer', {
        reason: 'SINGLE_CHOICE_ONLY',
      });
    }
    if (submitting && question.kind === 'single_choice' && chosen.length !== 1) {
      throw new AppError('VALIDATION_FAILED', 'this question takes exactly one answer', {
        reason: 'SINGLE_CHOICE_ONLY',
      });
    }
    if (
      question.justification === 'required' &&
      submitting &&
      (answer.justification ?? '').trim() === ''
    ) {
      throw new AppError('VALIDATION_FAILED', 'this question asks you to explain your choice', {
        reason: 'JUSTIFICATION_REQUIRED',
      });
    }
  }

  if (submitting && seen.size !== questions.length) {
    throw new AppError('VALIDATION_FAILED', 'every question needs an answer before sending', {
      reason: 'INCOMPLETE_SUBMISSION',
    });
  }
}

/* ── The author's inbox ───────────────────────────────────────────────────── */

/**
 * `GET /assessments/{id}/submissions` — who answered, and where their grade is.
 *
 * **Statuses, not analytics.** Submitted · graded · grade published, and the
 * eligible count for context. No percentages, no averages, no charts: this is
 * a list a person works through, and §10.1's reporting engine is a different
 * feature that has not been asked for.
 */
export async function listSubmissions(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
): Promise<{
  eligibleCount: number;
  rows: {
    studentId: string;
    name: string | null;
    state: string;
    submittedAt: Date | null;
    gradeStatus: string | null;
    score: string | null;
  }[];
}> {
  const exam = await loadForAuthor(prisma, actor, examId);

  const where = await examAudienceWhere(prisma, {
    targetKind: exam.targetKind,
    levelId: exam.levelId,
    branchId: exam.branchId,
    administrativeGroupId: exam.administrativeGroupId,
    sessionId: exam.sessionId,
    teachingGroupId: exam.teachingGroupId,
    studentId: exam.studentId,
    // The assessment's own date — R122's rule, so a paper read two years later
    // resolves to the students who were enrolled then.
    on: exam.date,
  });
  // Explicit for the reason above, though every arm already constrains it.
  const eligibleCount =
    where === null ? 0 : await prisma.user.count({ where: { AND: [where, { deletedAt: null }] } });

  const submissions = await prisma.studentExamSubmission.findMany({
    where: { examId },
    select: {
      studentId: true,
      state: true,
      submittedAt: true,
      student: { select: { nameArabic: true } },
    },
    orderBy: { student: { nameArabic: 'asc' } },
  });
  const grades = await prisma.grade.findMany({
    where: { examId },
    select: { studentId: true, status: true, score: true },
  });
  const byStudent = new Map(grades.map((g) => [g.studentId, g]));

  return {
    eligibleCount,
    rows: submissions.map((s) => {
      const grade = byStudent.get(s.studentId);
      return {
        studentId: s.studentId,
        name: s.student.nameArabic,
        state: s.state,
        submittedAt: s.submittedAt,
        gradeStatus: grade?.status ?? null,
        // The mark, for staff only. It reaches a student through the existing
        // grade surfaces and only once published — never from this list.
        score: grade === undefined ? null : grade.score.toString(),
      };
    }),
  };
}

/**
 * `GET /assessments/{id}/submissions/{studentId}` — one paper, answered.
 *
 * **A draft in progress is not readable.** The Owner allows showing
 * in-progress students *"only if existing privacy rules permit"*, and they do
 * not: a half-written answer is not something the student has handed in, and
 * reading it would be reading over her shoulder. The list above says she has
 * started; this refuses to open it.
 */
export async function readSubmission(
  prisma: PrismaClient,
  actor: Actor,
  examId: string,
  studentId: string,
): Promise<StudentPaper> {
  await loadForAuthor(prisma, actor, examId);

  const submission = await prisma.studentExamSubmission.findFirst({
    where: { examId, studentId, state: { not: 'in_progress' } },
    select: { id: true },
  });
  if (!submission) throw new AppError('NOT_FOUND', 'no submitted answers');

  // Through the student's own reader, so staff and the student see exactly the
  // same paper and the same answers — one projection, no second shape to drift.
  return readPaperFor(prisma, examId, studentId);
}

/** The paper plus one person's answers, with no permission check of its own —
 *  every caller above has already decided who may read it. */
async function readPaperFor(
  prisma: PrismaClient,
  examId: string,
  studentId: string,
): Promise<StudentPaper> {
  const exam = await prisma.exam.findFirstOrThrow({
    where: { id: examId },
    select: ASSESSMENT_SELECT,
  });
  const submission = await prisma.studentExamSubmission.findFirst({
    where: { examId, studentId },
    select: {
      id: true,
      state: true,
      submittedAt: true,
      answers: {
        select: {
          questionId: true,
          text: true,
          justification: true,
          options: { select: { optionId: true } },
        },
      },
    },
  });
  const questions = await prisma.examQuestion.findMany({
    where: { examId, deletedAt: null },
    select: {
      id: true,
      displayOrder: true,
      kind: true,
      prompt: true,
      justification: true,
      options: {
        where: { deletedAt: null },
        select: { id: true, displayOrder: true, label: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
    orderBy: { displayOrder: 'asc' },
  });
  return {
    exam,
    questions,
    submission:
      submission === null
        ? null
        : {
            id: submission.id,
            state: submission.state,
            submittedAt: submission.submittedAt,
            answers: submission.answers.map((a) => ({
              questionId: a.questionId,
              text: a.text,
              justification: a.justification,
              optionIds: a.options.map((o) => o.optionId),
            })),
          },
  };
}

/**
 * `GET /me/assessments` — what this beneficiary may open, and what she has done.
 *
 * Published and closed alike: a closed one she answered is her record, and a
 * closed one she did not is the honest answer *«انتهى»* rather than an item
 * that quietly vanishes.
 */
export async function assessmentsForStudent(
  prisma: PrismaClient,
  studentId: string,
): Promise<
  {
    id: string;
    title: string;
    status: string;
    date: Date;
    state: string | null;
    gradePublished: boolean;
  }[]
> {
  const candidates = await prisma.exam.findMany({
    where: { deletedAt: null, mode: 'online', status: { in: ['published', 'closed'] } },
    select: ASSESSMENT_SELECT,
    orderBy: { date: 'desc' },
  });

  const submissions = await prisma.studentExamSubmission.findMany({
    where: { studentId, examId: { in: candidates.map((c) => c.id) } },
    select: { examId: true, state: true },
  });
  const mine = new Map(submissions.map((s) => [s.examId, s.state]));
  const grades = await prisma.grade.findMany({
    where: { studentId, examId: { in: candidates.map((c) => c.id) }, status: 'published' },
    select: { examId: true },
  });
  const published = new Set(grades.map((g) => g.examId));

  const rows: {
    id: string;
    title: string;
    status: string;
    date: Date;
    state: string | null;
    gradePublished: boolean;
  }[] = [];
  for (const exam of candidates) {
    // **A submission keeps it on her list.** Eligibility can lapse; what she
    // answered is hers to see afterwards, which is the whole distinction
    // between *may start* and *has answered*.
    const answered = mine.get(exam.id) ?? null;
    if (answered === null && !(await eligible(prisma, exam, studentId))) continue;
    rows.push({
      id: exam.id,
      title: exam.title,
      status: exam.status,
      date: exam.date,
      state: answered,
      gradePublished: published.has(exam.id),
    });
  }
  return rows;
}

/* ── The target picker's candidates ───────────────────────────────────────── */

export type TargetKind =
  | 'level'
  | 'administrative_group'
  | 'session'
  | 'teaching_group'
  | 'student';

export interface TargetCandidate {
  id: string;
  /** What the author reads. Composed server-side, so no client re-derives a
   *  label — rule D's `{Category} — {Level}` among them. */
  label: string;
}

/**
 * **`GET /assessments/targets` — what THIS author may address** (R125).
 *
 * ## Why an endpoint rather than reusing the existing lists
 *
 * The builder needs four pickers, and the obvious sources are wrong for two of
 * them. `GET /admin/directory` is Admin and Super Admin only (TD-2), so a
 * مؤطِّرة could not populate a student picker at all; and none of the reference
 * lists answers *which of these may **I** address*, which after R125 is a
 * different question from *which exist*. **A smaller question, never a wider
 * permission** — the shape R123's attendance candidates set.
 *
 * ## The client is not the authorization boundary
 *
 * Every arm is scoped here, and `assertMayAuthor` refuses the same thing again
 * on the write. The picker exists so an author is not offered a target that
 * would be refused; it is not what makes the refusal true. Typing a UUID the
 * list never contained changes nothing.
 *
 * ## Staff only
 *
 * A beneficiary or a guardian has no business enumerating Levels, circles or
 * other beneficiaries, and this refuses them outright rather than returning an
 * empty list — an empty list is an answer, and *«you may not ask»* is a
 * different one.
 */
export async function targetCandidates(
  prisma: PrismaClient,
  actor: Actor,
  input: { kind: TargetKind; levelId?: string | undefined; query?: string | undefined },
): Promise<TargetCandidate[]> {
  const isSuper = scope.isSuperAdmin(actor.roleScopes);
  const isAdmin = scope.hasRole(actor.roleScopes, MANAGING_ROLE);
  const isTeacher = scope.hasRole(actor.roleScopes, 'teacher');
  if (!isSuper && !isAdmin && !isTeacher) {
    throw new AppError('FORBIDDEN', 'listing assessment targets requires staff (TD-2)');
  }

  /**
   * **Only an Admin has branches here.**
   *
   * `reachableBranches(scopes, ['admin'])` for a مؤطِّرة returns an **empty
   * array**, not `null` — she holds no admin assignment — and an empty array
   * used as a filter matches nobody, so every arm silently returned an empty
   * list. `null` is *every branch* (§7, R24) and `[]` is *none*; a caller who
   * has no branch scope of that kind at all must ask a different question, and
   * hers is `studentsTaughtBy` / `teacherEventScope` below.
   */
  const reachable = isSuper || !isAdmin
    ? null
    : scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);
  const q = (input.query ?? '').trim();
  const TAKE = 30;

  /**
   * **Levels a scoped Admin may address, in one query rather than N.**
   *
   * The rule is R125's: a Level is offerable when nobody it resolves to is
   * outside her branches. Asking that Level by Level would be an N+1 wearing a
   * picker's clothing, so the complement is asked instead — *which Levels hold
   * an enrolment at a branch she cannot reach* — and those are removed.
   */
  const levelsEscapingScope = async (): Promise<string[]> => {
    if (reachable === null) return [];
    const rows = await prisma.enrollment.findMany({
      where: { deletedAt: null, branchId: { notIn: reachable } },
      select: { levelId: true },
      distinct: ['levelId'],
    });
    return rows.map((r) => r.levelId);
  };

  if (input.kind === 'level') {
    // A مؤطِّرة is offered the Levels she actually teaches (§4.4c), and an Admin
    // the Levels that stay inside her branches.
    const taught = isSuper || isAdmin ? null : await teacherEventScope(prisma, actor.userId);
    const escaping = isAdmin && !isSuper ? await levelsEscapingScope() : [];
    const levels = await prisma.level.findMany({
      where: {
        deletedAt: null,
        ...(q === '' ? {} : { name: { contains: q } }),
        ...(taught === null ? {} : { id: { in: taught.levelIds } }),
        ...(escaping.length === 0 ? {} : { id: { notIn: escaping } }),
      },
      select: { id: true, name: true, category: { select: { name: true } } },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      take: TAKE,
    });
    // Rule D — a Level name is not unique across Categories (§4.4b), so a bare
    // one does not identify a Level.
    return levels.map((l) => ({ id: l.id, label: `${l.category.name} — ${l.name}` }));
  }

  if (input.kind === 'administrative_group') {
    const taught = isSuper || isAdmin ? null : await teacherEventScope(prisma, actor.userId);
    const groups = await prisma.administrativeGroup.findMany({
      where: {
        deletedAt: null,
        ...(input.levelId ? { levelId: input.levelId } : {}),
        ...(q === '' ? {} : { name: { contains: q } }),
        // A group IS at one branch (§7), so the branch bound is the group's own.
        ...(reachable === null ? {} : { branchId: { in: reachable } }),
        ...(taught === null ? {} : { id: { in: taught.administrativeGroupIds } }),
      },
      select: { id: true, name: true, branch: { select: { name: true } } },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      take: TAKE,
    });
    return groups.map((g) => ({ id: g.id, label: `${g.name} — ${g.branch.name}` }));
  }

  if (input.kind === 'teaching_group') {
    const taught = isSuper || isAdmin ? null : await teacherEventScope(prisma, actor.userId);
    const escaping = isAdmin && !isSuper ? await levelsEscapingScope() : [];
    const circles = await prisma.teachingGroup.findMany({
      where: {
        deletedAt: null,
        ...(input.levelId ? { levelId: input.levelId } : {}),
        ...(q === '' ? {} : { name: { contains: q } }),
        // A circle carries no branch of its own, so it is bounded by its Level:
        // the same rule the Level arm applies, not a second one.
        ...(escaping.length === 0 ? {} : { levelId: { notIn: escaping } }),
        ...(taught === null ? {} : { levelId: { in: taught.levelIds } }),
      },
      select: { id: true, name: true, subject: { select: { name: true } } },
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      take: TAKE,
    });
    return circles.map((c) => ({ id: c.id, label: `${c.name} — ${c.subject.name}` }));
  }

  if (input.kind === 'session') {
    const sessions = await prisma.session.findMany({
      where: {
        deletedAt: null,
        schedule: {
          deletedAt: null,
          ...(reachable === null ? {} : { branchId: { in: reachable } }),
          // A مؤطِّرة is offered the occurrences of classes she staffs — the
          // same `CourseScheduleStaff` fact §4.4c makes her scope everywhere.
          ...(isSuper || isAdmin
            ? {}
            : { staff: { some: { userId: actor.userId, deletedAt: null } } }),
          ...(input.levelId
            ? {
                OR: [
                  { levelId: input.levelId },
                  { administrativeGroup: { levelId: input.levelId } },
                  { teachingGroup: { levelId: input.levelId } },
                ],
              }
            : {}),
        },
        ...(q === '' ? {} : { schedule: { title: { contains: q } } }),
      },
      select: { id: true, date: true, schedule: { select: { title: true } } },
      orderBy: { date: 'desc' },
      take: TAKE,
    });
    return sessions.map((s) => ({
      id: s.id,
      // The date is half the identity of an occurrence, so it is half the label.
      label: `${s.schedule.title} — ${s.date.toISOString().slice(0, 10)}`,
    }));
  }

  /**
   * **The student arm, and the one that must not become a directory.**
   *
   * A مؤطِّرة is offered exactly `studentsTaughtBy` — the canonical §4.4c set,
   * reused rather than restated — so the picker cannot show her a beneficiary
   * she may not address, and R125's write check refuses the same person again.
   * An Admin is bounded by enrolment branch, which is the branch fact (§20 rule
   * 22). **Nobody gains association-wide beneficiary lookup.**
   */
  const taughtBy = isSuper || isAdmin ? null : await studentsTaughtBy(prisma, actor.userId);
  const students = await prisma.user.findMany({
    where: {
      AND: [
        ...(taughtBy === null ? [] : [taughtBy]),
        {
          deletedAt: null,
          isBeneficiary: true,
          ...(q === '' ? {} : { nameArabic: { contains: q } }),
          ...(reachable === null && input.levelId === undefined
            ? {}
            : {
                levelEnrollments: {
                  some: {
                    deletedAt: null,
                    ...(reachable === null ? {} : { branchId: { in: reachable } }),
                    ...(input.levelId ? { levelId: input.levelId } : {}),
                  },
                },
              }),
        },
      ],
    },
    select: { id: true, nameArabic: true },
    orderBy: { nameArabic: 'asc' },
    take: TAKE,
  });
  return students.map((s) => ({ id: s.id, label: s.nameArabic ?? '' }));
}
