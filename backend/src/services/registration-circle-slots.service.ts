import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { wallClockHHMM } from '../lib/item-title.js';
import { moroccoDateIso } from '../lib/morocco-clock.js';

/**
 * **The memorisation circles a first-time مستفيدة may choose between** (SRS
 * Revision 168 §1).
 *
 * The Owner's example: المرأة · المستوى الأول · مقر تاركة has three حلقات —
 * الثلاثاء 15:00–20:00, الخميس 09:00–12:00, السبت 15:00–20:00 — and a new
 * مستفيدة orders the ones that suit her; تفسير is الأربعاء 09:00–12:00 for
 * everybody and is no choice; other Levels offer none; أمرشيش will be given
 * later.
 *
 * ## Nothing here is typed into a form, a seed or a constant
 *
 * A slot is a class that EXISTS: a live weekly class of the memorisation Subject
 * (`tracks_quran_progress` — by its column, never its name) addressed to a حلقة
 * of her Category's FIRST Level, at the branch she asked for. Its days and times
 * are the schedule's own. So the Owner's Targa data is entered once, as three
 * scheduled classes, and the registration form, the calendar and the approver
 * read one truth; «other Levels have no choice» and «أمرشيش later» need no list
 * of exceptions — a Level/branch with no such classes simply offers nothing, and
 * starts offering them the day they are scheduled.
 *
 * The branch is the CLASS's; since R172 §15 a حلقة also records the branch it
 * was created in, and one placed at ANOTHER branch is not offered here even if
 * a class of it meets at this one — «each branch has its list of circles». A
 * حلقة from before the column (`null`) is placed by its classes alone.
 *
 * ## What is published
 *
 * This read is anonymous — the applicant has no account yet — so it carries the
 * least that lets her choose: the حلقة's name, its days and its times. No staff,
 * no room, no member count; a class whose visibility is «مخفي» is never offered.
 */
export interface CircleSlot {
  teaching_group_id: string;
  name: string;
  meetings: { weekdays: string[]; start_time: string; end_time: string }[];
}

export interface CircleSlotsView {
  /** The Level a first-time مستفيدة of this Category joins, or `null`. */
  level: { id: string; name: string } | null;
  /** The حلقات she may order. Fewer than two is not a choice, and the form asks
   *  nothing then. */
  circles: CircleSlot[];
  /** The Level's classes that are NOT a choice (تفسير «للجميع»), for information. */
  fixed: { subject_name: string; weekdays: string[]; start_time: string; end_time: string }[];
}

type Reader = PrismaClient | Prisma.TransactionClient;

export async function offeredCircleSlots(
  prisma: Reader,
  categoryId: string,
  branchId: string,
  now: Date = new Date(),
): Promise<CircleSlotsView> {
  const level = await prisma.level.findFirst({
    where: { categoryId, deletedAt: null },
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true },
  });
  if (!level) return { level: null, circles: [], fixed: [] };

  const today = new Date(`${moroccoDateIso(now)}T00:00:00.000Z`);
  const live = {
    deletedAt: null,
    visibility: { not: 'hidden' as const },
    OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: today } }],
    AND: [{ OR: [{ branchId }, { branchScopes: { some: { branchId } } }] }],
  };

  const circles = await prisma.teachingGroup.findMany({
    where: {
      levelId: level.id,
      deletedAt: null,
      subject: { tracksQuranProgress: true, deletedAt: null },
      OR: [{ branchId: null }, { branchId }],
    },
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    select: { id: true, name: true },
  });
  const circleIds = circles.map((circle) => circle.id);

  const classes =
    circleIds.length === 0
      ? []
      : await prisma.recurringCourseSchedule.findMany({
          where: {
            ...live,
            deletedAt: null,
            subject: { tracksQuranProgress: true },
            AND: [
              ...live.AND,
              {
                OR: [
                  { teachingGroupId: { in: circleIds } },
                  { teachingGroupScopes: { some: { teachingGroupId: { in: circleIds } } } },
                ],
              },
            ],
          },
          orderBy: [{ startTime: 'asc' }],
          select: {
            teachingGroupId: true,
            teachingGroupScopes: { select: { teachingGroupId: true } },
            weekdays: true,
            startTime: true,
            endTime: true,
          },
        });

  const meetingsOf = new Map<string, CircleSlot['meetings']>();
  for (const row of classes) {
    const meeting = {
      weekdays: row.weekdays.map(String),
      start_time: wallClockHHMM(row.startTime) ?? '',
      end_time: wallClockHHMM(row.endTime) ?? '',
    };
    const addressed = new Set(
      [row.teachingGroupId, ...row.teachingGroupScopes.map((scope) => scope.teachingGroupId)].filter(
        (id): id is string => id !== null && circleIds.includes(id),
      ),
    );
    for (const id of addressed) meetingsOf.set(id, [...(meetingsOf.get(id) ?? []), meeting]);
  }

  // The Level's own classes that address everybody in it — no choice to make.
  const wholeLevel = await prisma.recurringCourseSchedule.findMany({
    where: {
      ...live,
      // Already in `live`; restated where the read is, because a soft-delete
      // filter that lives forty lines away is one refactor from being lost
      // (`trash-coverage` asks for it here, and is right to).
      deletedAt: null,
      subject: { tracksQuranProgress: false },
      teachingGroupId: null,
      teachingGroupScopes: { none: {} },
      AND: [...live.AND, { OR: [{ levelId: level.id }, { levelScopes: { some: { levelId: level.id } } }] }],
    },
    orderBy: [{ startTime: 'asc' }],
    select: { weekdays: true, startTime: true, endTime: true, subject: { select: { name: true } } },
    take: 20,
  });

  return {
    level,
    // A حلقة with no scheduled class has no time to offer, so it is not a slot.
    circles: circles
      .filter((circle) => (meetingsOf.get(circle.id) ?? []).length > 0)
      .map((circle) => ({
        teaching_group_id: circle.id,
        name: circle.name,
        meetings: meetingsOf.get(circle.id)!,
      })),
    fixed: wholeLevel.map((row) => ({
      subject_name: row.subject.name,
      weekdays: row.weekdays.map(String),
      start_time: wallClockHHMM(row.startTime) ?? '',
      end_time: wallClockHHMM(row.endTime) ?? '',
    })),
  };
}

/**
 * **Writes her ranked circles — and only circles that are really on offer.**
 *
 * One implementation for the two places a مستفيدة is asked: the registration
 * form, and «طلب صفة إضافية» from an account that already exists (R169 §1). It
 * REPLACES what she ranked before: a wish is what she says now.
 */
export async function replaceCirclePreferences(
  tx: Prisma.TransactionClient,
  userId: string,
  student: { categoryId: string; branchId: string; circlePreferences: string[] },
  now: Date,
): Promise<number> {
  const ranked = student.circlePreferences;
  await tx.circlePreference.deleteMany({ where: { userId } });
  if (ranked.length === 0) return 0;
  const offered = await offeredCircleSlots(tx, student.categoryId, student.branchId, now);
  const onOffer = new Set(offered.circles.map((circle) => circle.teaching_group_id));
  const stranger = ranked.find((id) => !onOffer.has(id));
  if (stranger !== undefined) {
    throw new AppError('VALIDATION_FAILED', 'a ranked circle is not on offer', {
      reason: 'CIRCLE_NOT_OFFERED',
      teaching_group_id: stranger,
    });
  }
  await tx.circlePreference.createMany({
    data: ranked.map((teachingGroupId, index) => ({ userId, teachingGroupId, rank: index + 1 })),
  });
  return ranked.length;
}
