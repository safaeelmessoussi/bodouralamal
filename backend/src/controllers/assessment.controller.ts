import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { resolveActingStudent } from '../middleware/child-context.js';
import {
  addQuestion,
  assessmentsForStudent,
  closeAssessment,
  createAssessment,
  listSubmissions,
  publishAssessment,
  readSubmission,
  removeQuestion,
  reorderQuestions,
  saveResponses,
  authorPaper,
  studentPaper,
  targetCandidates,
  updateQuestion,
} from '../services/assessment.service.js';
import {
  createAssessmentSchema,
  targetCandidatesSchema,
  questionPatchSchema,
  questionSchema,
  reorderQuestionsSchema,
  responsesSchema,
} from '../validators/assessment.validators.js';
import { assessmentPaperDto, assessmentSubmissionListDto, studentAssessmentDto } from './dto.js';
import { idParam, parse } from './parse.js';

/**
 * **The assessment builder** (§4.6, R124) — the online half of `Exam`, which
 * R58 declared and deliberately refused.
 *
 * Routes are rooted at `/assessments` rather than `/exams` because the two ask
 * different things of a caller: `/exams` schedules a **sitting** — a room, a
 * clock window, supervisors — and `/assessments` writes a **paper**. They are
 * one table and one grade sheet; the write boundaries are not the same shape,
 * and one endpoint accepting either would be a schema with two disjoint halves.
 */

/* ── Authoring ────────────────────────────────────────────────────────────── */

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(createAssessmentSchema, req.body ?? {});
    const created = await createAssessment(prisma, requireActor(req), {
      title: b.title,
      ...(b.description === undefined ? {} : { description: b.description }),
      maxGrade: b.max_grade,
      levelId: b.level_id,
      ...(b.subject_id === undefined ? {} : { subjectId: b.subject_id }),
      ...(b.academic_year_id === undefined ? {} : { academicYearId: b.academic_year_id }),
      target: { kind: b.target.kind, ...(b.target.id === undefined ? {} : { id: b.target.id }) },
      ...(b.date === undefined ? {} : { date: b.date }),
    });
    res.status(201).json({ id: created.id });
  };
}

export function addQuestionHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(questionSchema, req.body ?? {});
    const created = await addQuestion(prisma, requireActor(req), idParam(req, 'id'), {
      kind: b.kind,
      prompt: b.prompt,
      ...(b.justification === undefined ? {} : { justification: b.justification }),
      ...(b.options === undefined ? {} : { options: b.options }),
    });
    res.status(201).json({ id: created.id });
  };
}

export function patchQuestion(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(questionPatchSchema, req.body ?? {});
    await updateQuestion(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'questionId'),
      b.version,
      {
        ...(b.prompt === undefined ? {} : { prompt: b.prompt }),
        ...(b.justification === undefined ? {} : { justification: b.justification }),
        ...(b.options === undefined ? {} : { options: b.options }),
      },
    );
    res.status(204).end();
  };
}

export function deleteQuestion(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await removeQuestion(prisma, requireActor(req), idParam(req, 'id'), idParam(req, 'questionId'));
    res.status(204).end();
  };
}

export function reorder(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(reorderQuestionsSchema, req.body ?? {});
    await reorderQuestions(prisma, requireActor(req), idParam(req, 'id'), b.ids);
    res.status(204).end();
  };
}

export function publish(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await publishAssessment(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}

export function close(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await closeAssessment(prisma, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}

/**
 * `GET /assessments/targets` — what THIS author may address (R125).
 *
 * **A picker, never the boundary.** Every arm is scoped in the service and
 * `assertMayAuthor` refuses the same thing again on the write, so a UUID typed
 * by hand buys nothing. Staff only: a beneficiary or a guardian is refused
 * outright rather than handed an empty list, because an empty list is an answer
 * and *«you may not ask»* is a different one.
 */
export function targets(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(targetCandidatesSchema, req.query ?? {});
    const rows = await targetCandidates(prisma, requireActor(req), {
      kind: q.kind,
      ...(q.level_id === undefined ? {} : { levelId: q.level_id }),
      ...(q.q === undefined ? {} : { query: q.q }),
    });
    res.json({ data: rows });
  };
}

/* ── The author's inbox ───────────────────────────────────────────────────── */

export function submissions(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const data = await listSubmissions(prisma, requireActor(req), idParam(req, 'id'));
    res.json(assessmentSubmissionListDto(data));
  };
}

export function submission(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const paper = await readSubmission(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'studentId'),
    );
    res.json(assessmentPaperDto(paper));
  };
}

/* ── The student ──────────────────────────────────────────────────────────── */

/**
 * **The subject is resolved, never named by the caller** (§20 rule 6).
 *
 * `resolveActingStudent` is the same middleware the dashboard and the Quran
 * screens use: a Student acting on her own data is her JWT `sub`, and a Parent
 * must present an approved `FamilyLink` through `X-Active-Child-ID`. There is
 * nowhere in any of these routes for a student id to arrive from a body.
 */
export function myAssessments(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const acting = await resolveActingStudent(prisma, actor, req.header('x-active-child-id'));
    const rows = await assessmentsForStudent(prisma, acting.studentId);
    res.json({ data: rows.map(studentAssessmentDto) });
  };
}

/**
 * `GET /assessments/{id}` — **the paper as its author sees it.**
 *
 * Separate from `/paper` because the audiences differ: that one is the
 * beneficiary's, sits behind `resolveActingStudent`, and shows only a published
 * or closed paper. A **teacher-only** author therefore got `400` from the child
 * guard, and a **draft** — which every paper being written is — got `404`. The
 * builder could not open what it exists to edit.
 */
export function authorRead(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const data = await authorPaper(prisma, requireActor(req), idParam(req, 'id'));
    res.json(assessmentPaperDto(data));
  };
}

export function paper(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const acting = await resolveActingStudent(prisma, actor, req.header('x-active-child-id'));
    const data = await studentPaper(prisma, actor, idParam(req, 'id'), acting.studentId);
    res.json(assessmentPaperDto(data));
  };
}

/** `PUT …/responses` — **حفظ**. `POST …/submit` — **إرسال**. One writer. */
export function saveDraft(prisma: PrismaClient) {
  return respond(prisma, false);
}
export function submit(prisma: PrismaClient) {
  return respond(prisma, true);
}

function respond(prisma: PrismaClient, isSubmit: boolean) {
  return async (req: Request, res: Response): Promise<void> => {
    const b = parse(responsesSchema, req.body ?? {});
    const actor = requireActor(req);
    /**
     * **A parent may read a child's paper and may not write one.**
     * `resolveActingStudent` would hand back the child for a guardian, and an
     * answer is the student's own act — so the writer is the authenticated
     * caller, full stop, and the service refuses any mismatch.
     */
    const result = await saveResponses(
      prisma,
      actor,
      idParam(req, 'id'),
      actor.userId,
      b.answers.map((a) => ({
        questionId: a.question_id,
        ...(a.text === undefined ? {} : { text: a.text }),
        ...(a.justification === undefined ? {} : { justification: a.justification }),
        ...(a.option_ids === undefined ? {} : { optionIds: a.option_ids }),
      })),
      { submit: isSubmit },
    );
    res.json({ state: result.state });
  };
}
