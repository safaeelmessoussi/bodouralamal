import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { moroccoDateIso } from '../lib/morocco-clock.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import {
  decideCompletion,
  examinedSurahs,
  levelsRequiringSurahExams,
  type CompletionVerdict,
} from '../policies/level-completion.js';
import * as audit from '../repositories/audit.repository.js';
import { recalculateFor } from './quran.service.js';

/**
 * **«إتمام المستوى» — the administration's attestation, and its certificate**
 * (Document Owner, 2026-09-21 — SRS Revision 167 §3).
 *
 * Two facts, deliberately kept apart:
 *
 * - **What BR-11 reads** — every Surah of the Level's «مقرر الحفظ» memorised,
 *   and an exam of each taken where the Level teaches تفسير. DERIVED, by the one
 *   rule in `policies/level-completion.ts`, and never stored (Revision 166 §1).
 * - **What the administration recorded** — that she completed the Level. STORED
 *   here. An Admin or Super Admin may record it while BR-11 is not yet met — the
 *   Owner's decision: a مستفيدة may have memorised before the platform existed,
 *   or been examined on paper — but never unknowingly: the write is refused
 *   until the caller says she has seen what is missing (`acknowledge_unmet`),
 *   and `requirements_met` keeps what BR-11 read at that moment, for ever.
 *
 * The certificate is a SECOND confirmation, separate on purpose: marking is a
 * record, showing a certificate in her dashboard is a publication. Its number
 * comes from a sequence at first issue; withdrawing hides the certificate and
 * keeps the number.
 *
 * Scope is the enrolment's: an Admin acts on a مستفيدة enrolled at this Level
 * in a branch she reaches (§7, R24); out of scope is `404`, never `403` (§20
 * rule 17).
 */
const MANAGING_ROLE = 'admin';

function assertCanManage(actor: Actor): void {
  if (!(scope.hasRole(actor.roleScopes, MANAGING_ROLE) || scope.isSuperAdmin(actor.roleScopes))) {
    throw new AppError('FORBIDDEN', 'level completion is recorded by an admin (TD-2)');
  }
}

/** BR-11 for ONE student at ONE Level — the same routine the per-Level list and
 *  «حفظي» use, so the three cannot disagree. */
export async function completionVerdictFor(
  prisma: PrismaClient,
  studentId: string,
  levelId: string,
): Promise<CompletionVerdict> {
  const configured = await prisma.levelSurah.findMany({
    where: { levelId, deletedAt: null },
    select: { surahId: true },
    orderBy: { surahId: 'asc' },
  });
  const surahIds = configured.map((row) => row.surahId);
  const [requiring, examined, coverage] = await Promise.all([
    levelsRequiringSurahExams(prisma, [levelId]),
    examinedSurahs(prisma, [studentId], surahIds),
    Promise.all(surahIds.map((surahId) => recalculateFor(prisma, studentId, surahId))),
  ]);
  return decideCompletion({
    configuredSurahIds: surahIds,
    memorisedSurahIds: new Set(
      surahIds.filter((_, index) => (coverage[index]?.coverage_percent ?? 0) >= 100),
    ),
    examinedSurahIds: examined.get(studentId) ?? new Set(),
    examsRequired: requiring.has(levelId),
  });
}

/** Her live enrolment at this Level that THIS caller reaches — or `404`. */
async function reachableEnrolment(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
  levelId: string,
): Promise<{ branchId: string }> {
  const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);
  const enrolment = await prisma.enrollment.findFirst({
    where: {
      studentId,
      levelId,
      deletedAt: null,
      student: { deletedAt: null },
      ...(reachable === null ? {} : { branchId: { in: reachable } }),
    },
    orderBy: { enrolledAt: 'desc' },
    select: { branchId: true },
  });
  if (!enrolment) throw new AppError('NOT_FOUND', 'no such enrolment');
  return enrolment;
}

export interface StudentLevelCompletionView {
  level_id: string;
  level_name: string;
  category_name: string;
  /** BR-11, read now. `complete: null` — the Level has no «مقرر الحفظ». */
  requirements: {
    complete: boolean | null;
    configured_surahs: number;
    memorised_surahs: number;
    examined_surahs: number;
    exams_required: boolean;
  };
  mark: {
    completed_on: string;
    completed_by_name: string;
    requirements_met: boolean;
    certificate_number: number | null;
    certificate_issued_on: string | null;
  } | null;
}

function requirementsOf(verdict: CompletionVerdict): StudentLevelCompletionView['requirements'] {
  return {
    complete: verdict.complete,
    configured_surahs: verdict.configuredSurahs,
    memorised_surahs: verdict.memorisedSurahs,
    examined_surahs: verdict.examinedSurahs,
    exams_required: verdict.examsRequired,
  };
}

/** `GET /admin/students/{id}/level-completions` — one row per Level she is
 *  enrolled at within the caller's reach. */
export async function listForStudent(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
): Promise<StudentLevelCompletionView[]> {
  assertCanManage(actor);
  const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);
  const enrolments = await prisma.enrollment.findMany({
    where: {
      studentId,
      deletedAt: null,
      student: { deletedAt: null },
      ...(reachable === null ? {} : { branchId: { in: reachable } }),
    },
    distinct: ['levelId'],
    select: {
      levelId: true,
      level: { select: { name: true, displayOrder: true, category: { select: { name: true } } } },
    },
  });
  const marks = await prisma.levelCompletionMark.findMany({
    where: { studentId, levelId: { in: enrolments.map((e) => e.levelId) } },
    select: {
      levelId: true,
      completedAt: true,
      requirementsMet: true,
      certificateNumber: true,
      certificateIssuedAt: true,
      completedBy: { select: { nameArabic: true } },
    },
  });
  const markOf = new Map(marks.map((mark) => [mark.levelId, mark]));

  const rows = await Promise.all(
    enrolments.map(async (enrolment) => {
      const mark = markOf.get(enrolment.levelId) ?? null;
      return {
        order: enrolment.level.displayOrder ?? Number.MAX_SAFE_INTEGER,
        view: {
          level_id: enrolment.levelId,
          level_name: enrolment.level.name,
          category_name: enrolment.level.category.name,
          requirements: requirementsOf(
            await completionVerdictFor(prisma, studentId, enrolment.levelId),
          ),
          mark:
            mark === null
              ? null
              : {
                  completed_on: moroccoDateIso(mark.completedAt),
                  completed_by_name: mark.completedBy.nameArabic,
                  requirements_met: mark.requirementsMet,
                  certificate_number: mark.certificateNumber,
                  certificate_issued_on:
                    mark.certificateIssuedAt === null
                      ? null
                      : moroccoDateIso(mark.certificateIssuedAt),
                },
        } satisfies StudentLevelCompletionView,
      };
    }),
  );
  return rows
    .sort((a, b) => a.order - b.order || a.view.level_name.localeCompare(b.view.level_name, 'ar'))
    .map((row) => row.view);
}

/** `PUT …/level-completions/{levelId}` — record that she completed the Level. */
export async function markCompleted(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
  levelId: string,
  input: { acknowledgeUnmet: boolean },
): Promise<void> {
  assertCanManage(actor);
  const enrolment = await reachableEnrolment(prisma, actor, studentId, levelId);
  const verdict = await completionVerdictFor(prisma, studentId, levelId);
  const met = verdict.complete === true;

  // She may be marked anyway — but never by somebody who was not told.
  if (!met && !input.acknowledgeUnmet) {
    throw new AppError('STATE_CONFLICT', 'BR-11 is not met for this level', {
      reason: 'REQUIREMENTS_NOT_MET',
      ...requirementsOf(verdict),
    });
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.levelCompletionMark.findUnique({
      where: { studentId_levelId: { studentId, levelId } },
      select: { id: true },
    });
    // Idempotent: saying it twice records it once, and keeps the first date.
    if (existing) return;
    const created = await tx.levelCompletionMark.create({
      data: {
        studentId,
        levelId,
        branchId: enrolment.branchId,
        requirementsMet: met,
        completedById: actor.userId,
      },
      select: { id: true },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'level_completion.mark',
      targetEntity: 'LevelCompletionMark',
      targetId: created.id,
      detail: {
        student_id: studentId,
        level_id: levelId,
        requirements_met: met,
        acknowledged_unmet: !met,
        ...requirementsOf(verdict),
      },
    });
  });
}

/** `DELETE …/level-completions/{levelId}` — a mark made in error. */
export async function unmarkCompleted(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
  levelId: string,
): Promise<void> {
  assertCanManage(actor);
  await reachableEnrolment(prisma, actor, studentId, levelId);
  await prisma.$transaction(async (tx) => {
    const mark = await tx.levelCompletionMark.findUnique({
      where: { studentId_levelId: { studentId, levelId } },
      select: { id: true, certificateIssuedAt: true, certificateNumber: true },
    });
    if (!mark) return;
    // A certificate she can see and print is withdrawn first, deliberately.
    if (mark.certificateIssuedAt !== null) {
      throw new AppError('STATE_CONFLICT', 'withdraw the certificate first', {
        reason: 'CERTIFICATE_ISSUED',
      });
    }
    await tx.levelCompletionMark.delete({ where: { id: mark.id } });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'level_completion.unmark',
      targetEntity: 'LevelCompletionMark',
      targetId: mark.id,
      detail: {
        student_id: studentId,
        level_id: levelId,
        certificate_number: mark.certificateNumber,
      },
    });
  });
}

/** `PUT …/level-completions/{levelId}/certificate` — show it in her dashboard. */
export async function issueCertificate(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
  levelId: string,
): Promise<void> {
  assertCanManage(actor);
  await reachableEnrolment(prisma, actor, studentId, levelId);
  await prisma.$transaction(async (tx) => {
    const mark = await tx.levelCompletionMark.findUnique({
      where: { studentId_levelId: { studentId, levelId } },
      select: { id: true, certificateIssuedAt: true, certificateNumber: true },
    });
    if (!mark) {
      throw new AppError('STATE_CONFLICT', 'the level is not marked completed', {
        reason: 'LEVEL_NOT_COMPLETED',
      });
    }
    if (mark.certificateIssuedAt !== null) return;
    // A number is drawn ONCE per mark: re-issuing after a withdrawal reuses it,
    // so a copy printed before the withdrawal names the same certificate.
    const number =
      mark.certificateNumber ??
      Number(
        (
          await tx.$queryRaw<{ n: number }[]>`
            SELECT nextval('level_certificate_number_seq')::int AS n`
        )[0]!.n,
      );
    await tx.levelCompletionMark.update({
      where: { id: mark.id },
      data: {
        certificateNumber: number,
        certificateIssuedAt: new Date(),
        certificateIssuedById: actor.userId,
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'level_completion.certificate_issue',
      targetEntity: 'LevelCompletionMark',
      targetId: mark.id,
      detail: { student_id: studentId, level_id: levelId, certificate_number: number },
    });
  });
}

/** `DELETE …/level-completions/{levelId}/certificate` — stop showing it. */
export async function withdrawCertificate(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
  levelId: string,
): Promise<void> {
  assertCanManage(actor);
  await reachableEnrolment(prisma, actor, studentId, levelId);
  await prisma.$transaction(async (tx) => {
    const mark = await tx.levelCompletionMark.findUnique({
      where: { studentId_levelId: { studentId, levelId } },
      select: { id: true, certificateIssuedAt: true, certificateNumber: true },
    });
    if (!mark || mark.certificateIssuedAt === null) return;
    await tx.levelCompletionMark.update({
      where: { id: mark.id },
      data: { certificateIssuedAt: null, certificateIssuedById: null },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'level_completion.certificate_withdraw',
      targetEntity: 'LevelCompletionMark',
      targetId: mark.id,
      detail: {
        student_id: studentId,
        level_id: levelId,
        certificate_number: mark.certificateNumber,
      },
    });
  });
}

export interface CertificateView {
  certificate_number: number;
  /** Her name as the association records it — this is HER document, shown to
   *  her (or to her parent in child context), never a public surface. */
  student_name: string;
  level_name: string;
  category_name: string;
  branch_name: string;
  /** Morocco calendar dates (TD-11): a certificate names a day, not an instant. */
  completed_on: string;
  issued_on: string;
}

/**
 * `GET /students/me/certificates` — the certificates the administration has
 * confirmed, for the مستفيدة herself or the child a parent is acting for (the
 * controller resolves and verifies that; this takes the resolved id).
 */
export async function certificatesOf(
  prisma: PrismaClient,
  studentId: string,
): Promise<CertificateView[]> {
  const marks = await prisma.levelCompletionMark.findMany({
    where: {
      studentId,
      certificateIssuedAt: { not: null },
      student: { deletedAt: null },
    },
    orderBy: { completedAt: 'asc' },
    select: {
      certificateNumber: true,
      completedAt: true,
      certificateIssuedAt: true,
      student: { select: { nameArabic: true } },
      level: { select: { name: true, category: { select: { name: true } } } },
      branch: { select: { name: true } },
    },
  });
  return marks.map((mark) => ({
    certificate_number: mark.certificateNumber!,
    student_name: mark.student.nameArabic,
    level_name: mark.level.name,
    category_name: mark.level.category.name,
    branch_name: mark.branch.name,
    completed_on: moroccoDateIso(mark.completedAt),
    issued_on: moroccoDateIso(mark.certificateIssuedAt!),
  }));
}
