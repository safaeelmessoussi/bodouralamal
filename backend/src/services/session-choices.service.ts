import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { moroccoDateIso } from '../lib/morocco-clock.js';
import { AppError } from '../lib/errors.js';
import { arabicCalendarDate, calendarDateIso, wallClockHHMM } from '../lib/item-title.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { staffsSession } from '../policies/roster-resolution.js';
import { sessionTitles } from './class-title.js';

/**
 * **R265 — the class sessions a content item may be attached to, from its own
 * form** (the Owner, 2026-11-12: «I want to be able to select the session from
 * a drop down, the elements in that drop down gets filtered based on the rest
 * of the elements chosen in the other drop downs in the form»).
 *
 * `GET /content/session-choices` — the live, not cancelled occurrences of the
 * form's academic year that teach its Level (named directly, through one of
 * its groups, or through its Category), narrowed by Subject, Surah and branch
 * when the form names them, upcoming ones included (the Owner): today and the
 * past newest first — the class just recorded leads — then the upcoming ones,
 * soonest first.
 * Only what the caller may attach content to (`POST /sessions/{id}/content`):
 * an administrator's branches, a teacher's own occurrences.
 */

export interface SessionChoiceInput {
  levelId: string;
  academicYearId: string;
  subjectId?: string | undefined;
  surahId?: number | undefined;
  branchId?: string | undefined;
}

export interface SessionChoice {
  id: string;
  date: string;
  startTime: string | null;
  title: string;
  /** «الاثنين 9 نونبر 2026» — what a title built for this session ends with. */
  dateLabel: string;
}

/** More than a year of one class's weekly sessions; the list is a picker, not an export. */
export const MAX_SESSION_CHOICES = 300;

const MANAGING_ROLE = 'admin';

export async function listSessionChoices(
  prisma: PrismaClient,
  actor: Actor,
  input: SessionChoiceInput,
): Promise<SessionChoice[]> {
  const admin = scope.hasRole(actor.roleScopes, MANAGING_ROLE) || scope.isSuperAdmin(actor.roleScopes);
  const teacher = scope.hasRole(actor.roleScopes, 'teacher');
  if (!admin && !teacher) {
    throw new AppError('FORBIDDEN', 'attaching content to a session requires admin or the teaching staff');
  }
  const level = await prisma.level.findFirst({
    where: { id: input.levelId, deletedAt: null },
    select: { id: true, categoryId: true },
  });
  if (!level) throw new AppError('NOT_FOUND', 'no such level');

  const today = new Date(`${moroccoDateIso()}T00:00:00.000Z`);
  const where = {
    deletedAt: null,
    status: { not: 'cancelled' as const },
    ...(input.subjectId
      ? { OR: [{ subjectId: input.subjectId }, { subjectId: null, schedule: { subjectId: input.subjectId } }] }
      : {}),
    AND: [
      ...(input.surahId === undefined
        ? []
        : [
            {
              OR: [
                { surahs: { some: { surahId: input.surahId } } },
                { surahs: { none: {} }, schedule: { surahs: { some: { surahId: input.surahId } } } },
              ],
            },
          ]),
    ],
    schedule: {
      deletedAt: null,
      academicYearId: input.academicYearId,
      ...(input.branchId
        ? { OR: [{ branchId: input.branchId }, { branchScopes: { some: { branchId: input.branchId } } }] }
        : {}),
      AND: [
        {
          OR: [
            { levelId: level.id },
            { levelScopes: { some: { levelId: level.id } } },
            { categoryScopes: { some: { categoryId: level.categoryId } } },
            { administrativeGroup: { levelId: level.id } },
            { teachingGroup: { levelId: level.id } },
            { administrativeGroupScopes: { some: { administrativeGroup: { levelId: level.id } } } },
            { teachingGroupScopes: { some: { teachingGroup: { levelId: level.id } } } },
          ],
        },
      ],
    },
  } satisfies Prisma.SessionWhereInput;
  const select = { id: true, date: true, startTime: true, schedule: { select: { branchId: true } } } as const;
  const rows = [
    ...(await prisma.session.findMany({
      where: { ...where, date: { lte: today } },
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
      take: MAX_SESSION_CHOICES,
      select,
    })),
    ...(await prisma.session.findMany({
      where: { ...where, date: { gt: today } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: MAX_SESSION_CHOICES,
      select,
    })),
  ];

  const allowed: typeof rows = [];
  for (const row of rows) {
    if (admin && scope.canActOnBranch(actor.roleScopes, MANAGING_ROLE, row.schedule.branchId)) {
      allowed.push(row);
    } else if (teacher && (await staffsSession(prisma, actor.userId, row.id))) {
      allowed.push(row);
    }
  }
  const titles = await sessionTitles(prisma, allowed.map((row) => row.id));
  return allowed.map((row) => {
    const date = calendarDateIso(row.date) ?? '';
    return {
      id: row.id,
      date,
      startTime: wallClockHHMM(row.startTime),
      title: titles.get(row.id) ?? '',
      dateLabel: arabicCalendarDate(date),
    };
  });
}
