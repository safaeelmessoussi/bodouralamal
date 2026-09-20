import type { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';

/**
 * **What a Level teaches** — the `LevelSubject` rule, stated once (§4.4b, R43).
 *
 * ## Why this is a policy and not three checks
 *
 * A Subject reaches a Level only through `LevelSubject`. Three surfaces depend
 * on that — splitting a Subject into Teaching Groups, scheduling a class, and
 * attaching educational content — and until this module existed, **two of them
 * enforced it and one did not**:
 *
 * | Surface | Before |
 * |---|---|
 * | `teaching-group.service.ts` | refused, `SUBJECT_NOT_IN_LEVEL` |
 * | `content.service.ts` | refused, `SUBJECT_NOT_AT_LEVEL` — *a second spelling of the same rule* |
 * | `course-schedule.service.ts` | **did not check at all** |
 *
 * The consequence was visible in the live database: three Course Schedules
 * existed while `level_subject` held **zero rows**, so the platform was
 * delivering Subjects at Levels that officially teach nothing — and then
 * refusing to attach content to those very classes. One rule, enforced in two
 * places out of three, with two different names, is the shape of drift this
 * project has been bitten by repeatedly.
 *
 * ## The reason code
 *
 * `SUBJECT_NOT_IN_LEVEL`, which predates the other spelling. It is a **stable
 * code**: clients render it, so the older name wins over the one that reads
 * marginally better.
 */

/** Accepts a transaction client so the check joins the caller's transaction —
 *  a pairing verified outside it could be revoked before the write lands. */
type Db = Pick<Prisma.TransactionClient, 'levelSubject'>;

export async function assertSubjectTaughtAtLevel(
  db: Db,
  levelId: string,
  subjectId: string,
): Promise<void> {
  const assigned = await db.levelSubject.findFirst({
    where: {
      levelId,
      subjectId,
      deletedAt: null,
      // A Level or Subject that is itself deleted teaches nothing: the join row
      // can outlive either, and treating a dangling assignment as valid is how
      // a deleted Subject keeps appearing on a form.
      level: { deletedAt: null },
      subject: { deletedAt: null },
    },
    select: { id: true },
  });

  if (!assigned) {
    throw new AppError('STATE_CONFLICT', 'subject is not assigned to this level', {
      reason: 'SUBJECT_NOT_IN_LEVEL',
      level_id: levelId,
      subject_id: subjectId,
    });
  }
}

/**
 * **Which Surahs a class, an occurrence or an exam is about** — the
 * `LevelSurah` rule, stated once (SRS Revision 165 §2).
 *
 * Each Level's Surahs are set in «مقرر الحفظ»; حفظ القرآن memorises them and
 * تفسير القرآن studies the same ones. Whether a Subject works by Surah is its
 * own `requires_surahs` marker — never its name (R27, §4.4b). Three surfaces
 * ask this (scheduling a class, editing one occurrence, scheduling an exam),
 * which is exactly the count at which `assertSubjectTaughtAtLevel` above was
 * found enforced in two places out of three; so it has one home from the start.
 *
 * - The Subject works by Surah and none is named → `SURAHS_REQUIRED`.
 * - It does not, and one is named → `SURAHS_NOT_APPLICABLE` (a Surah on a fiqh
 *   class is an invented value, not a harmless extra).
 * - A Surah outside the «مقرر الحفظ» of EVERY Level addressed →
 *   `SURAH_NOT_IN_SYLLABUS`. One Level is enough: a class for two Levels may
 *   study a Surah only one of them has reached.
 *
 * Returns the Surahs to store — deduplicated, in Mushaf order.
 */
type SurahDb = Pick<Prisma.TransactionClient, 'subject' | 'levelSurah'>;

export async function resolveSurahs(
  db: SurahDb,
  input: { subjectId: string | null; levelIds: readonly string[]; surahIds: readonly number[] },
): Promise<number[]> {
  const requested = [...new Set(input.surahIds)].sort((a, b) => a - b);
  const subject =
    input.subjectId === null
      ? null
      : await db.subject.findFirst({
          where: { id: input.subjectId, deletedAt: null },
          select: { requiresSurahs: true },
        });

  if (subject?.requiresSurahs !== true) {
    if (requested.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'this subject is not taught by surah', {
        reason: 'SURAHS_NOT_APPLICABLE',
      });
    }
    return [];
  }

  if (requested.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'this subject needs at least one surah', {
      reason: 'SURAHS_REQUIRED',
    });
  }

  const inSyllabus = await db.levelSurah.findMany({
    where: {
      deletedAt: null,
      levelId: { in: [...input.levelIds] },
      surahId: { in: requested },
      level: { deletedAt: null },
    },
    select: { surahId: true },
  });
  const allowed = new Set(inSyllabus.map((row) => row.surahId));
  const outside = requested.filter((id) => !allowed.has(id));
  if (outside.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'surah is not in the syllabus of these levels', {
      reason: 'SURAH_NOT_IN_SYLLABUS',
      surah_ids: outside,
    });
  }
  return requested;
}

/** Whether the Subject works by Surah — for a path that must decide whether to
 *  carry inherited Surahs forward or drop them (a split that changes Subject). */
export async function subjectRequiresSurahs(
  db: Pick<Prisma.TransactionClient, 'subject'>,
  subjectId: string,
): Promise<boolean> {
  const subject = await db.subject.findFirst({
    where: { id: subjectId, deletedAt: null },
    select: { requiresSurahs: true },
  });
  return subject?.requiresSurahs === true;
}
