import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { computeCoverage, type AyahInterval } from '../policies/quran-coverage.js';
import {
  assertCanManageQuranProgress,
  quranSubjectId,
  studentsTaughtBy,
} from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';

/**
 * **Quran memorization tracking (§4.5, BR-11, BR-13; M4a, SRS Revision 73).**
 *
 * ## Coverage is derived, never accumulated
 *
 * BR-13: coverage is *the union of non-overlapping logged intervals per Surah*.
 * It is recomputed from the committed rows on every mutation — never adjusted by
 * a delta, which is how a counter drifts from the rows it claims to summarise.
 * The arithmetic lives in `policies/quran-coverage.ts` and nowhere else.
 *
 * ## The recalculation is SYNCHRONOUS, and that is normative
 *
 * §4.5 (R6, R8, R10): creating, updating **or soft-deleting** a log recomputes
 * that student's coverage **for that Surah, inside the same request** — never in
 * a job. `jobs/runner.ts` records the same rule from the other side: *"Quran
 * coverage recalculation must never be moved into a job."* A مؤطرة correcting a
 * mis-logged range must see the corrected percentage immediately, and a stale
 * figure after a deletion could wrongly signal level completion (BR-11).
 *
 * **The mechanics R10 prescribes, followed exactly:** commit the log in a short
 * transaction — no aggregate computation inside it, so no long-held locks — then
 * **immediately after commit, in the same request**, recompute the union from
 * the committed rows and upsert the cache with a `last_log_id` / `last_log_at`
 * stamp of the newest governing log.
 *
 * ## The cache is self-healing, which is what makes staleness unobservable
 *
 * `StudentSurahProgress` is a cache for O(1) reads; **the logs are the source of
 * truth**. Every read compares the row's stamp against the student+surah's
 * latest log and, on mismatch — a crash in the window between commit and upsert
 * — recomputes and repairs in place before using the value. That is why TD-15
 * needs no `version` here (R73.5): a stale aggregate cannot be read, so there is
 * nothing to lock.
 *
 * **List reads run that guard as ONE joined query**, never per row: §4.5 calls
 * the alternative *"a stealth N+1 wearing a cache costume"*.
 *
 * ## Authorization
 *
 * `assertCanManageQuranProgress` (R73.3) — a مؤطرة reaches only the students
 * whose **Quran** she teaches, which §4.4c's subject-blind *own students* does
 * not express. Teaching and assisting count equally. Out of scope answers 404.
 */

export interface QuranLogInput {
  studentId: string;
  surahId: number;
  startAyah: number;
  endAyah: number;
  category: 'new_memorization' | 'revision';
}

export interface SurahCoverage {
  surah_id: number;
  name_arabic: string;
  total_ayahs: number;
  merged_ayah_count: number;
  coverage_percent: number;
  merged_intervals: AyahInterval[];
}

export interface QuranLogRow {
  id: string;
  surah_id: number;
  start_ayah: number;
  end_ayah: number;
  category: string;
  logged_at: string;
  logged_by_name: string | null;
}

/**
 * Recompute one student's coverage for one Surah from the committed logs, and
 * upsert the cache.
 *
 * Called after every mutation **and** by the read-side guard, which is the point:
 * one implementation means a repaired row and a freshly written one cannot
 * disagree.
 */
export async function recalculateFor(
  prisma: PrismaClient,
  studentId: string,
  surahId: number,
): Promise<SurahCoverage> {
  const [surah, logs] = await Promise.all([
    prisma.quranSurah.findUnique({ where: { surahId } }),
    prisma.quranProgressLog.findMany({
      where: { studentId, surahId, deletedAt: null },
      select: { id: true, startAyah: true, endAyah: true, loggedAt: true },
      orderBy: [{ loggedAt: 'desc' }, { id: 'desc' }],
    }),
  ]);
  if (!surah) throw new AppError('NOT_FOUND', 'no such surah');

  const { merged, mergedAyahCount, coveragePercent } = computeCoverage(
    logs.map((l) => ({ start: l.startAyah, end: l.endAyah })),
    surah.totalAyahs,
  );

  // The newest governing log — the stamp the read-side guard compares against.
  // `null` when every log has been deleted, which is a real state and must be
  // stored as one: a leftover stamp would make an empty coverage look fresh.
  const newest = logs[0] ?? null;

  const data = {
    mergedAyahCount,
    coveragePercent,
    mergedIntervals: merged as unknown as object,
    lastLogId: newest?.id ?? null,
    lastLogAt: newest?.loggedAt ?? null,
  };
  await prisma.studentSurahProgress.upsert({
    where: { studentId_surahId: { studentId, surahId } },
    create: { studentId, surahId, ...data },
    update: data,
  });

  return {
    surah_id: surahId,
    name_arabic: surah.nameArabic,
    total_ayahs: surah.totalAyahs,
    merged_ayah_count: mergedAyahCount,
    coverage_percent: coveragePercent,
    merged_intervals: merged,
  };
}

/**
 * `GET /students/{id}/quran` — every Surah this student has logs for, with the
 * **self-heal guard applied as one joined query** (§4.5).
 *
 * The cache rows and each pair's newest live log are read in two queries rather
 * than per row; any pair whose stamp disagrees is recomputed before its value is
 * used. A crash between commit and upsert is therefore invisible to the reader,
 * which is what BR-13's *"always current"* requires.
 */
export async function readStudentCoverage(
  prisma: PrismaClient,
  actor: Actor,
  studentId: string,
): Promise<{ surahs: SurahCoverage[]; logs: QuranLogRow[] }> {
  await assertCanManageQuranProgress(prisma, actor, studentId);
  return coverageFor(prisma, studentId);
}

/**
 * `GET /students/me/quran` — **the acting student's own progress** (§4.5, §5.3;
 * M4b).
 *
 * **This takes an already-VERIFIED student id and never resolves one**, exactly
 * as `getStudentIdentity` does and for the same reason: the subject comes from
 * `childContext`, which read it from an approved `FamilyLink` or from the JWT
 * `sub`. TD-12 forbids trusting a student identifier from the request, so the
 * route carries no `{id}` and there is nowhere for a caller to name somebody
 * else.
 *
 * **`assertCanManageQuranProgress` is deliberately NOT called here.** That
 * predicate answers *may this member of staff act on this student* and would
 * refuse a student reading her own progress — the identity has already been
 * established by the middleware, and asking a staff question about a student
 * would be the wrong question with a misleading answer.
 *
 * **The engine is not duplicated**: this is the same read the مؤطرة's screen
 * uses, including the self-heal guard, differing only in how the subject was
 * established.
 */
export async function readOwnCoverage(
  prisma: PrismaClient,
  studentId: string,
): Promise<{ surahs: SurahCoverage[]; logs: QuranLogRow[] }> {
  return coverageFor(prisma, studentId);
}

async function coverageFor(
  prisma: PrismaClient,
  studentId: string,
): Promise<{ surahs: SurahCoverage[]; logs: QuranLogRow[] }> {
  const logs = await prisma.quranProgressLog.findMany({
    where: { studentId, deletedAt: null },
    select: {
      id: true,
      surahId: true,
      startAyah: true,
      endAyah: true,
      category: true,
      loggedAt: true,
      loggedBy: { select: { nameArabic: true } },
      surah: { select: { nameArabic: true, totalAyahs: true } },
    },
    orderBy: [{ loggedAt: 'desc' }, { id: 'desc' }],
  });

  const cached = await prisma.studentSurahProgress.findMany({ where: { studentId } });
  const byId = new Map(cached.map((c) => [c.surahId, c]));

  // The newest live log per surah, from the rows already fetched — the guard's
  // comparison, computed here rather than in a query per surah.
  const newestBySurah = new Map<number, { id: string; loggedAt: Date }>();
  for (const log of logs) {
    if (!newestBySurah.has(log.surahId)) {
      newestBySurah.set(log.surahId, { id: log.id, loggedAt: log.loggedAt });
    }
  }

  const surahs: SurahCoverage[] = [];
  for (const [surahId, newest] of [...newestBySurah.entries()].sort((a, b) => a[0] - b[0])) {
    const row = byId.get(surahId);
    if (!row || row.lastLogId !== newest.id) {
      // **Self-heal.** The stamp disagrees with the logs, so the cache lost a
      // write; recompute and repair in place before the value is used.
      surahs.push(await recalculateFor(prisma, studentId, surahId));
      continue;
    }
    const meta = logs.find((l) => l.surahId === surahId)!.surah;
    surahs.push({
      surah_id: surahId,
      name_arabic: meta.nameArabic,
      total_ayahs: meta.totalAyahs,
      merged_ayah_count: row.mergedAyahCount,
      coverage_percent: Number(row.coveragePercent),
      merged_intervals: row.mergedIntervals as unknown as AyahInterval[],
    });
  }

  return {
    surahs,
    logs: logs.map((l) => ({
      id: l.id,
      surah_id: l.surahId,
      start_ayah: l.startAyah,
      end_ayah: l.endAyah,
      category: String(l.category),
      logged_at: l.loggedAt.toISOString(),
      logged_by_name: l.loggedBy?.nameArabic ?? null,
    })),
  };
}

/**
 * `GET /quran-students` — **the مستفيدات this caller may log Quran for**.
 *
 * The selector's source, so the screen cannot offer somebody the server would
 * refuse (R73.1). It is the *same* predicate the write path asserts, read as a
 * list instead of a yes/no — never a second definition of scope.
 *
 * An Admin gets their branches' students; a Super Admin everyone; a مؤطرة the
 * students whose Quran she teaches, which is **empty when no Subject is marked**
 * — the same fail-closed answer the write path gives.
 */
export async function listQuranStudents(
  prisma: PrismaClient,
  actor: Actor,
): Promise<{ id: string; name_arabic: string }[]> {
  const isSuper = actor.roles.includes('super_admin');
  const isAdmin = actor.roles.includes('admin');

  let where;
  if (isSuper) {
    where = { deletedAt: null };
  } else if (isAdmin) {
    const branches = actor.roleScopes.find((r) => r.role === 'admin')?.branches ?? null;
    where =
      branches === null
        ? { deletedAt: null }
        : { deletedAt: null, levelEnrollments: { some: { deletedAt: null, branchId: { in: branches } } } };
  } else {
    const subjectId = await quranSubjectId(prisma);
    if (subjectId === null) return [];
    where = await studentsTaughtBy(prisma, actor.userId, { subjectId });
  }

  const rows = await prisma.user.findMany({
    where,
    select: { id: true, nameArabic: true },
    orderBy: { nameArabic: 'asc' },
    take: 500,
  });
  return rows.map((r) => ({ id: r.id, name_arabic: r.nameArabic }));
}

/** `POST /quran-logs` — TD-8 `quranlog.create` (R73.2). */
export async function logProgress(
  prisma: PrismaClient,
  actor: Actor,
  input: QuranLogInput,
): Promise<SurahCoverage> {
  await assertCanManageQuranProgress(prisma, actor, input.studentId);

  // The upper bound against `total_ayahs` is enforced by the database trigger
  // (TD-6, since it crosses tables) — asserted here too so the caller receives a
  // coded refusal rather than a driver error.
  const surah = await prisma.quranSurah.findUnique({ where: { surahId: input.surahId } });
  if (!surah) throw new AppError('NOT_FOUND', 'no such surah');
  if (input.endAyah > surah.totalAyahs) {
    throw new AppError('VALIDATION_FAILED', 'that ayah is past the end of this surah', {
      reason: 'AYAH_OUT_OF_RANGE',
      total_ayahs: surah.totalAyahs,
    });
  }

  // R10: the log commits in a SHORT transaction with no aggregate computation
  // inside it, so no lock is held while the union is merged.
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.quranProgressLog.create({
      data: {
        studentId: input.studentId,
        surahId: input.surahId,
        startAyah: input.startAyah,
        endAyah: input.endAyah,
        category: input.category,
        loggedById: actor.userId,
      },
      select: { id: true },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'quranlog.create',
      targetEntity: 'QuranProgressLog',
      targetId: row.id,
      detail: {
        student_id: input.studentId,
        surah_id: input.surahId,
        range: [input.startAyah, input.endAyah],
        category: input.category,
      },
    });
    return row;
  });
  void created;

  // Immediately after commit, in the same request (§4.5, R10).
  return recalculateFor(prisma, input.studentId, input.surahId);
}

/** `PATCH /quran-logs/{id}` — a correction. TD-8 `quranlog.update`. */
export async function correctLog(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  patch: { startAyah?: number; endAyah?: number; category?: 'new_memorization' | 'revision' },
): Promise<SurahCoverage> {
  const existing = await prisma.quranProgressLog.findFirst({
    where: { id, deletedAt: null },
    select: { studentId: true, surahId: true, startAyah: true, endAyah: true },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such log');
  await assertCanManageQuranProgress(prisma, actor, existing.studentId);

  const startAyah = patch.startAyah ?? existing.startAyah;
  const endAyah = patch.endAyah ?? existing.endAyah;
  if (startAyah > endAyah) {
    throw new AppError('VALIDATION_FAILED', 'the range ends before it starts', {
      reason: 'INVALID_RANGE',
    });
  }
  const surah = await prisma.quranSurah.findUnique({ where: { surahId: existing.surahId } });
  if (surah && endAyah > surah.totalAyahs) {
    throw new AppError('VALIDATION_FAILED', 'that ayah is past the end of this surah', {
      reason: 'AYAH_OUT_OF_RANGE',
      total_ayahs: surah.totalAyahs,
    });
  }

  // **No `version` and no lock (TD-15.5, R73.5).** Two staff correcting the same
  // log is last-write-wins deliberately: BR-13 recomputes the union from
  // whatever rows exist, so a lost correction is re-correctable — unlike a lost
  // grade, which is why `Grade` carries a version and this does not.
  await prisma.$transaction(async (tx) => {
    await tx.quranProgressLog.update({
      where: { id },
      data: { startAyah, endAyah, ...(patch.category ? { category: patch.category } : {}) },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'quranlog.update',
      targetEntity: 'QuranProgressLog',
      targetId: id,
      detail: {
        student_id: existing.studentId,
        surah_id: existing.surahId,
        old_range: [existing.startAyah, existing.endAyah],
        new_range: [startAyah, endAyah],
      },
    });
  });

  return recalculateFor(prisma, existing.studentId, existing.surahId);
}

/** `DELETE /quran-logs/{id}` — TD-5 soft delete, TD-8 `quranlog.delete`. */
export async function deleteLog(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<SurahCoverage> {
  const existing = await prisma.quranProgressLog.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such log');
  await assertCanManageQuranProgress(prisma, actor, existing.studentId);

  await prisma.$transaction(async (tx) => {
    await tx.quranProgressLog.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    // **R59 — a deletion a person deliberately performed gets its own Trash
    // entry.** A مؤطرة removing a mis-logged range is exactly that, and §4.5
    // calls the range she removed a correction rather than a mistake to hide.
    await trash.snapshot(tx, {
      targetEntity: 'QuranProgressLog',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(existing)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'quranlog.delete',
      targetEntity: 'QuranProgressLog',
      targetId: id,
      detail: {
        student_id: existing.studentId,
        surah_id: existing.surahId,
        range: [existing.startAyah, existing.endAyah],
      },
    });
  });

  return recalculateFor(prisma, existing.studentId, existing.surahId);
}

/**
 * **BR-11 — Level completion (M4c).**
 *
 * > *"coverage 100% and, only if a final exam is configured for that level, that
 * > exam passed. If no final exam is configured, coverage alone suffices."*
 *
 * ## It reads the existing engine; it computes no new percentage
 *
 * Completion is *the configured Surahs* × *the coverage §4.5 already derives*.
 * `recalculateFor` is the same routine every mutation and every read uses, so a
 * completion figure and a dashboard figure cannot disagree — and the **self-heal
 * guard applies here too**, because a stale cache row would otherwise decide
 * whether somebody has finished a Level.
 *
 * ## Three states, not two
 *
 * A Level with **no configured Surahs** is `not_configured` — deliberately not
 * `complete`. Coverage of an empty syllabus is vacuously total, and reporting
 * that as completion would let a Level nobody has configured mark every
 * مستفيدة finished. BR-11 assumes a syllabus; where there is none the honest
 * answer is that the question cannot be asked yet.
 *
 * ## The final-exam condition is structurally absent, and that is faithful
 *
 * **Nothing in the model marks an exam as a Level's final one.** `Exam` carries
 * `round`, which §4.6 defines as *"an optional non-restricting selector used
 * solely for sorting"* — explicitly not a semantic marker. So BR-11's second
 * clause has no configuration to read, and the rule's own *"if no final exam is
 * configured, coverage alone suffices"* is the only reachable branch. It is
 * reported as `final_exam_configured: false` rather than silently omitted, so
 * the day a marker is introduced the gap is visible rather than assumed away.
 * **No marker was invented here.**
 */
export interface LevelCompletion {
  student_id: string;
  student_name: string;
  /** `null` when the Level configures no Surahs — see the docstring. */
  complete: boolean | null;
  configured_surahs: number;
  completed_surahs: number;
  /** Always `false` today: nothing in the model can configure one (§4.6). */
  final_exam_configured: boolean;
  surahs: { surah_id: number; name_arabic: string; coverage_percent: number }[];
}

export async function levelCompletion(
  prisma: PrismaClient,
  actor: Actor,
  levelId: string,
): Promise<LevelCompletion[]> {
  // Reading who has completed a Level is reading reference-adjacent operational
  // data about a whole Level, so it takes the same gate the roster does rather
  // than §4.5's per-student one.
  if (!scope.isSuperAdmin(actor.roleScopes) && !scope.hasRole(actor.roleScopes, 'admin')) {
    throw new AppError('FORBIDDEN', 'reading level completion requires admin (TD-2)');
  }

  const [configured, enrolments] = await Promise.all([
    prisma.levelSurah.findMany({
      where: { levelId, deletedAt: null },
      select: { surah: { select: { surahId: true, nameArabic: true } } },
      orderBy: { surahId: 'asc' },
    }),
    prisma.enrollment.findMany({
      where: {
        levelId,
        deletedAt: null,
        student: { deletedAt: null },
        // R66 — an enrolment may have no group, and a relation filter never
        // matches a NULL relation. The predicate `levelsForStudent` states.
        OR: [{ administrativeGroupId: null }, { administrativeGroup: { deletedAt: null } }],
        ...(scope.reachableBranches(actor.roleScopes, ['admin']) === null
          ? {}
          : { branchId: { in: scope.reachableBranches(actor.roleScopes, ['admin']) ?? [] } }),
      },
      select: { studentId: true, student: { select: { nameArabic: true } } },
      orderBy: { student: { nameArabic: 'asc' } },
    }),
  ]);

  const surahIds = configured.map((c) => c.surah.surahId);

  return Promise.all(
    enrolments.map(async (e) => {
      const perSurah = await Promise.all(
        surahIds.map(async (surahId) => {
          // The same routine every read and write uses, so completion and the
          // dashboard cannot disagree — and the R10 self-heal comes with it.
          const coverage = await recalculateFor(prisma, e.studentId, surahId);
          return {
            surah_id: surahId,
            name_arabic: coverage.name_arabic,
            coverage_percent: coverage.coverage_percent,
          };
        }),
      );
      const completed = perSurah.filter((x) => x.coverage_percent >= 100).length;

      return {
        student_id: e.studentId,
        student_name: e.student.nameArabic,
        // BR-11: 100% of the configured syllabus. `null` where none is
        // configured — the question cannot be asked yet.
        complete: surahIds.length === 0 ? null : completed === surahIds.length,
        configured_surahs: surahIds.length,
        completed_surahs: completed,
        final_exam_configured: false,
        surahs: perSurah,
      };
    }),
  );
}
