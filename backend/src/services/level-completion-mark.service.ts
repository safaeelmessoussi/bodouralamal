import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
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
import { forPart, recalculateFor } from './quran.service.js';
import { syllabusName, type SurahPart } from '../policies/surah-parts.js';

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
    select: { surahId: true, part: true },
    orderBy: { surahId: 'asc' },
  });
  const surahIds = configured.map((row) => row.surahId);
  const [requiring, examined, coverage] = await Promise.all([
    levelsRequiringSurahExams(prisma, [levelId]),
    examinedSurahs(prisma, [studentId], surahIds),
    // R232 — each read against the part the Level teaches.
    Promise.all(
      configured.map(async (row) =>
        forPart(await recalculateFor(prisma, studentId, row.surahId), row.part as SurahPart | null),
      ),
    ),
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

/**
 * **Codex review, 2026-09-22 — the mark's transitions are check-then-write.**
 * Issue reads «no number yet» and draws one; withdraw reads «issued» and
 * clears it; unmark reads «not issued» and deletes. Two of them racing on one
 * row under READ COMMITTED each saw the state before the other committed: two
 * issues drew TWO sequence numbers and the later write won (a printed copy
 * naming a number the row no longer carries), and an unmark racing an issue
 * deleted the row from under the update (a P2025 → 500). §16.2 sanctioned
 * raw-SQL exception (a): the row lock serialises them (TD-15.2), and every
 * statement after it reads the state the winner committed.
 */
async function lockMark(
  tx: Prisma.TransactionClient,
  studentId: string,
  levelId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM "level_completion_mark"
    WHERE student_id = ${studentId}::uuid AND level_id = ${levelId}::uuid
    FOR UPDATE`;
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

  try {
    await markCompletedTx(prisma, actor, studentId, levelId, enrolment.branchId, met, verdict);
  } catch (error) {
    // The losing side of a double-tap lost a race against an identical mark,
    // not sent a bad request: the unique index kept the DATA to one row, and
    // this keeps the ANSWER idempotent too (the attendance rule).
    if ((error as { code?: unknown } | null)?.code === 'P2002') return;
    throw error;
  }
}

async function markCompletedTx(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
  levelId: string,
  branchId: string,
  met: boolean,
  verdict: Awaited<ReturnType<typeof completionVerdictFor>>,
): Promise<void> {
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
        branchId,
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
    await lockMark(tx, studentId, levelId);
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
    await lockMark(tx, studentId, levelId);
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
    await lockMark(tx, studentId, levelId);
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
  /** R221 — the certificate is worded in its holder's gender («أتمّت» /
   *  «أتمّ»). */
  student_sex: 'female' | 'male';
  level_name: string;
  category_name: string;
  branch_name: string;
  /** Morocco calendar dates (TD-11): a certificate names a day, not an instant. */
  completed_on: string;
  issued_on: string;
  /**
   * **R228 — what the association's printed certificate states**: the Level's
   * place among its Category's steps («المستوى الثاني»; `0` a preparatory
   * Level), what it covers (its «مقرر الحفظ», in Mushaf order, and whether a
   * tafsir Subject is taught there — «حفظ وتفسير»), and the school year the
   * completion falls in (`null` when no period of any year holds that day).
   */
  level_position: number;
  syllabus_surahs: string[];
  teaches_tafsir: boolean;
  academic_year_label: string | null;
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
      levelId: true,
      completedAt: true,
      certificateIssuedAt: true,
      student: { select: { nameArabic: true, sex: true } },
      level: { select: { name: true, category: { select: { name: true } } } },
      branch: { select: { name: true } },
    },
  });
  const levelIds = [...new Set(marks.map((m) => m.levelId))];
  const [levels, syllabus, tafsir] = await Promise.all([
    prisma.level.findMany({
      where: { id: { in: levelIds }, deletedAt: null },
      select: { id: true, categoryId: true, journeyRole: true, track: true },
    }),
    prisma.levelSurah.findMany({
      where: { levelId: { in: levelIds }, deletedAt: null },
      select: { levelId: true, surahId: true, part: true, surah: { select: { nameArabic: true } } },
      orderBy: { surahId: 'asc' },
    }),
    levelsRequiringSurahExams(prisma, levelIds),
  ]);
  const steps = await prisma.level.findMany({
    where: { categoryId: { in: [...new Set(levels.map((l) => l.categoryId))] }, deletedAt: null, journeyRole: 'step' },
    select: { id: true, categoryId: true, track: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });
  // R233 — «المستوى الثاني» within its own track («صغار»/«كبار»).
  const positionOf = (levelId: string): number => {
    const level = levels.find((l) => l.id === levelId);
    if (!level || level.journeyRole !== 'step') return 0;
    return (
      steps
        .filter((s) => s.categoryId === level.categoryId && s.track === level.track)
        .findIndex((s) => s.id === levelId) + 1
    );
  };
  const yearOf = async (day: Date): Promise<string | null> =>
    (
      await prisma.academicPeriod.findFirst({
        where: { startDate: { lte: day }, endDate: { gte: day } },
        select: { academicYear: { select: { label: true } } },
      })
    )?.academicYear.label ?? null;

  return Promise.all(marks.map(async (mark) => ({
    certificate_number: mark.certificateNumber!,
    student_name: mark.student.nameArabic,
    student_sex: mark.student.sex,
    level_name: mark.level.name,
    category_name: mark.level.category.name,
    branch_name: mark.branch.name,
    completed_on: moroccoDateIso(mark.completedAt),
    issued_on: moroccoDateIso(mark.certificateIssuedAt!),
    level_position: positionOf(mark.levelId),
    // R232 — «البقرة الجزء الثاني (…)» where the Level teaches a part.
    syllabus_surahs: syllabus
      .filter((r) => r.levelId === mark.levelId)
      .map((r) => syllabusName(r.surah.nameArabic, r.surahId, r.part as SurahPart | null)),
    teaches_tafsir: tafsir.has(mark.levelId),
    academic_year_label: await yearOf(new Date(`${moroccoDateIso(mark.completedAt)}T00:00:00.000Z`)),
  })));
}
