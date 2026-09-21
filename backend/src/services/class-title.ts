import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { publicDisplayName } from '../lib/display-name.js';
import { calendarDateIso, composeItemTitle, wallClockHHMM } from '../lib/item-title.js';

/**
 * **What a class and each of its occurrences is CALLED, read from what the rows
 * say now** (SRS Revision 166 §3). The wording is `composeItemTitle`'s; this
 * module only knows where each part lives.
 *
 * Two loaders rather than a `select` every caller must remember to widen: a
 * list asks once for the page it is about to return, and a write asks for the
 * one row it is about to answer with. The calendar composes inline from the
 * include it already has — it may hold a month of occurrences, and a second
 * query per page there would be a second pass over the same rows.
 *
 * The main teacher is named by her PUBLIC display name (§20 rule 12): this text
 * reaches the public calendar.
 */
type Db = PrismaClient | Prisma.TransactionClient;

const PERSON = { select: { nameArabic: true, publicDisplayName: true } } as const;
const SURAH_NAMES = {
  select: { surah: { select: { nameArabic: true } } },
  orderBy: { surahId: 'asc' },
} as const;

/** One class's own row. A repeating class spans dates, so it carries its time
 *  and no date; a one-off carries both. Its main teacher is whoever holds the
 *  position ON `today` (R91's periods), else the first ever assigned. */
export async function scheduleTitles(
  db: Db,
  ids: readonly string[],
  today: Date = new Date(),
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.recurringCourseSchedule.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      startTime: true,
      recurrence: true,
      anchorDate: true,
      schedulingType: { select: { name: true } },
      subject: { select: { name: true } },
      surahs: SURAH_NAMES,
      staff: {
        where: { deletedAt: null, position: 'teacher' },
        select: { effectiveFrom: true, effectiveUntil: true, user: PERSON },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  const day = today.toISOString().slice(0, 10);
  return new Map(
    rows.map((row) => {
      const onDuty = row.staff.find(
        (s) =>
          (s.effectiveFrom === null || s.effectiveFrom.toISOString().slice(0, 10) <= day) &&
          (s.effectiveUntil === null || s.effectiveUntil.toISOString().slice(0, 10) >= day),
      );
      const lead = (onDuty ?? row.staff[0])?.user ?? null;
      return [
        row.id,
        composeItemTitle({
          typeName: row.schedulingType?.name ?? null,
          subjectName: row.subject.name,
          surahNames: row.surahs.map((s) => s.surah.nameArabic),
          leadName: lead === null ? null : publicDisplayName(lead),
          date: row.recurrence === 'none' ? calendarDateIso(row.anchorDate) : null,
          time: wallClockHHMM(row.startTime),
        }),
      ];
    }),
  );
}

/** One occurrence: ITS Subject and Surahs where it has its own (else the
 *  class's), whoever leads THAT date, and that date and time. */
export async function sessionTitles(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.session.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      date: true,
      startTime: true,
      subject: { select: { name: true } },
      surahs: SURAH_NAMES,
      staff: {
        where: { deletedAt: null, position: 'teacher' },
        select: { user: PERSON },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
      schedule: {
        select: {
          schedulingType: { select: { name: true } },
          subject: { select: { name: true } },
          surahs: SURAH_NAMES,
        },
      },
    },
  });
  return new Map(
    rows.map((row) => {
      const lead = row.staff[0]?.user ?? null;
      return [
        row.id,
        composeItemTitle({
          typeName: row.schedule.schedulingType?.name ?? null,
          subjectName: (row.subject ?? row.schedule.subject).name,
          surahNames: (row.surahs.length > 0 ? row.surahs : row.schedule.surahs).map(
            (s) => s.surah.nameArabic,
          ),
          leadName: lead === null ? null : publicDisplayName(lead),
          date: calendarDateIso(row.date),
          time: wallClockHHMM(row.startTime),
        }),
      ];
    }),
  );
}

/** `Exam.title` is `VARCHAR(120)`; an overflow would refuse the sitting. */
const EXAM_TITLE_LIMIT = 120;

/**
 * **A BARE sitting's title** — one scheduled with no authored paper behind it,
 * which therefore has nothing to take a title from. A sitting scheduled FROM a
 * paper keeps the paper's own title: that one is somebody's words, and it is
 * the paper's identity in «بناء الاختبارات».
 *
 * Unlike a class's, this text is STORED, because the column is shared with
 * those authored titles and is read in a dozen places that must not each learn
 * to tell the two apart. It is written by exactly two functions —
 * `scheduleExam` and `updatePhysicalExam` — and the second recomposes it only
 * while it is still the composed one (`isComposedExamTitle`), so a title
 * somebody typed is never overwritten.
 */
export async function examTitle(db: Db, examId: string): Promise<string> {
  const exam = await db.exam.findUniqueOrThrow({
    where: { id: examId },
    select: {
      date: true,
      startTime: true,
      schedulingType: { select: { name: true } },
      subject: { select: { name: true } },
      surah: { select: { nameArabic: true } },
      staff: {
        where: { deletedAt: null, position: 'supervisor' },
        select: { user: PERSON },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });
  const lead = exam.staff[0]?.user ?? null;
  return composeItemTitle(
    {
      typeName: exam.schedulingType?.name ?? null,
      subjectName: exam.subject?.name ?? null,
      surahNames: exam.surah ? [exam.surah.nameArabic] : [],
      leadName: lead === null ? null : publicDisplayName(lead),
      date: calendarDateIso(exam.date),
      time: wallClockHHMM(exam.startTime),
    },
    EXAM_TITLE_LIMIT,
  );
}
