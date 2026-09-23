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

/**
 * ## Two sources, one answer (SRS Revision 172 §1)
 *
 * A Subject reaches a Level through `LevelSubject` (what the Level teaches on
 * its own) OR through `CategorySubject` (a Subject taught to the Level's WHOLE
 * Category — الفقه to every Level of «المرأة», present and future). Every
 * reader that asks «what does this Level teach» or «which Levels teach this
 * Subject» asks HERE — `subjectsTaughtAt`, `levelsTeaching` — so the second
 * source cannot be forgotten by one surface and remembered by another.
 */

/** Accepts a transaction client so the check joins the caller's transaction —
 *  a pairing verified outside it could be revoked before the write lands. */
type Db = Pick<Prisma.TransactionClient, 'levelSubject' | 'categorySubject' | 'level' | 'subject'>;

/** Every Subject each of these Levels teaches — on its own or through its
 *  Category. Live rows only: a deleted Level, Subject or Category teaches nothing. */
export async function subjectsTaughtAt(
  db: Pick<Prisma.TransactionClient, 'levelSubject' | 'categorySubject' | 'level'>,
  levelIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (levelIds.length === 0) return out;
  const ids = [...new Set(levelIds)];
  const [own, levels] = await Promise.all([
    db.levelSubject.findMany({
      where: { levelId: { in: ids }, deletedAt: null, level: { deletedAt: null }, subject: { deletedAt: null } },
      select: { levelId: true, subjectId: true },
    }),
    db.level.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, categoryId: true },
    }),
  ]);
  const categoryIds = [...new Set(levels.map((level) => level.categoryId))];
  const whole =
    categoryIds.length === 0
      ? []
      : await db.categorySubject.findMany({
          where: {
            categoryId: { in: categoryIds },
            deletedAt: null,
            category: { deletedAt: null },
            subject: { deletedAt: null },
          },
          select: { categoryId: true, subjectId: true },
        });
  const byCategory = new Map<string, string[]>();
  for (const row of whole) byCategory.set(row.categoryId, [...(byCategory.get(row.categoryId) ?? []), row.subjectId]);
  for (const level of levels) {
    out.set(level.id, new Set(byCategory.get(level.categoryId) ?? []));
  }
  for (const row of own) {
    const set = out.get(row.levelId) ?? new Set<string>();
    set.add(row.subjectId);
    out.set(row.levelId, set);
  }
  return out;
}

/** Every live Level that teaches this Subject — on its own or through its
 *  Category — narrowed to these Categories when any are named. */
export async function levelsTeaching(
  db: Pick<Prisma.TransactionClient, 'levelSubject' | 'categorySubject' | 'level'>,
  subjectId: string,
  categoryIds: readonly string[] = [],
): Promise<string[]> {
  const narrowed = categoryIds.length > 0;
  const [own, whole] = await Promise.all([
    db.levelSubject.findMany({
      where: {
        subjectId,
        deletedAt: null,
        subject: { deletedAt: null },
        level: { deletedAt: null, ...(narrowed ? { categoryId: { in: [...categoryIds] } } : {}) },
      },
      select: { levelId: true },
    }),
    db.categorySubject.findMany({
      where: {
        subjectId,
        deletedAt: null,
        subject: { deletedAt: null },
        ...(narrowed ? { categoryId: { in: [...categoryIds] } } : {}),
        category: { deletedAt: null },
      },
      select: { categoryId: true },
    }),
  ]);
  const ids = new Set(own.map((row) => row.levelId));
  if (whole.length > 0) {
    const levels = await db.level.findMany({
      where: { deletedAt: null, categoryId: { in: whole.map((row) => row.categoryId) } },
      select: { id: true },
    });
    for (const level of levels) ids.add(level.id);
  }
  return [...ids];
}

export async function assertSubjectTaughtAtLevel(
  db: Db,
  levelId: string,
  subjectId: string,
): Promise<void> {
  const taught = await subjectsTaughtAt(db, [levelId]);
  const assigned = taught.get(levelId)?.has(subjectId) === true;

  if (!assigned) {
    // Named, so the screen can say WHICH Level (the Owner met this as the
    // concurrency sentence on 2026-09-22 — a class for six Levels of which five
    // do not teach the Subject). Reference-data names, never a person's.
    const [level, subject] = await Promise.all([
      db.level.findUnique({ where: { id: levelId }, select: { name: true, category: { select: { name: true } } } }),
      db.subject.findUnique({ where: { id: subjectId }, select: { name: true } }),
    ]);
    throw new AppError('STATE_CONFLICT', 'subject is not assigned to this level', {
      reason: 'SUBJECT_NOT_IN_LEVEL',
      level_id: levelId,
      subject_id: subjectId,
      level_name: level ? `${level.category.name} — ${level.name}` : null,
      subject_name: subject?.name ?? null,
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
