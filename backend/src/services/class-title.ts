import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { publicDisplayName } from '../lib/display-name.js';
import { arabicWeekday, audienceTitle, calendarDateIso, composeItemTitle, wallClockHHMM } from '../lib/item-title.js';

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
      // R178 §4 — the group or circle the class is for, for its title.
      administrativeGroup: { select: { name: true } },
      teachingGroup: { select: { name: true } },
      administrativeGroupScopes: { select: { administrativeGroup: { select: { name: true } } }, take: 1 },
      teachingGroupScopes: { select: { teachingGroup: { select: { name: true } } }, take: 1 },
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
          audienceName: scheduleAudience(row),
          leadName: lead === null ? null : publicDisplayName(lead),
          date: row.recurrence === 'none' ? calendarDateIso(row.anchorDate) : null,
          // R178 §4 — a repeating class names its first occurrence's weekday.
          weekday: row.recurrence === 'none' ? null : arabicWeekday(calendarDateIso(row.anchorDate)),
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
      subject: { select: { name: true, requiresSurahs: true } },
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
          subject: { select: { name: true, requiresSurahs: true } },
          surahs: SURAH_NAMES,
          // R178 §4 — the group or circle the class is for, for its title.
          administrativeGroup: { select: { name: true } },
          teachingGroup: { select: { name: true } },
          administrativeGroupScopes: { select: { administrativeGroup: { select: { name: true } } }, take: 1 },
          teachingGroupScopes: { select: { teachingGroup: { select: { name: true } } }, take: 1 },
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
          audienceName: scheduleAudience(row.schedule),
          // Codex review, 2026-09-22 — inherited only while the Subject taught
          // works by Surah (the same rule as `calendar.service.ts`).
          surahNames: (
            row.surahs.length > 0
              ? row.surahs
              : (row.subject ?? row.schedule.subject).requiresSurahs
                ? row.schedule.surahs
                : []
          ).map((s) => s.surah.nameArabic),
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
      // R178 §4 — a sitting names at most one group or circle (R58/R136).
      administrativeGroup: { select: { name: true } },
      teachingGroup: { select: { name: true } },
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
      audienceName: audienceTitle(exam.teachingGroup?.name ?? null, exam.administrativeGroup?.name ?? null),
      leadName: lead === null ? null : publicDisplayName(lead),
      date: calendarDateIso(exam.date),
      time: wallClockHHMM(exam.startTime),
    },
    EXAM_TITLE_LIMIT,
  );
}

/** R178 §4 — the title's audience word from a class's legacy target or its joins. */
function scheduleAudience(schedule: {
  administrativeGroup: { name: string } | null;
  teachingGroup: { name: string } | null;
  administrativeGroupScopes: { administrativeGroup: { name: string } }[];
  teachingGroupScopes: { teachingGroup: { name: string } }[];
}): string | null {
  return audienceTitle(
    schedule.teachingGroup?.name ?? schedule.teachingGroupScopes[0]?.teachingGroup.name ?? null,
    schedule.administrativeGroup?.name ?? schedule.administrativeGroupScopes[0]?.administrativeGroup.name ?? null,
  );
}
