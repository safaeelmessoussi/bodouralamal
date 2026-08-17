import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import {
  listSessionsForContent,
  prefilledFilters,
  readCalendar,
  readSessionPage,
  type CalendarActor,
  type Occurrence,
  type SessionPageContent,
} from '../services/calendar.service.js';

/**
 * `GET /calendar` (TD-3.4) — the one **public** read in the system.
 *
 * §4.4: *"public sees public tier only"*. An anonymous visitor gets the public
 * tier; everything above it is resolved server-side from the caller's live
 * roles, never from a query parameter.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const querySchema = z.object({
  from: calendarDate,
  to: calendarDate,
  branch_id: z.uuid().optional(),
  level_id: z.uuid().optional(),
  category_id: z.uuid().optional(),
  // TD-3.4 spells this `administrative_group_id`. It shipped as `group_id` —
  // a paraphrase of a key the specification states, which is the same class of
  // defect as CHANGES.log M3b-14b and is corrected here.
  administrative_group_id: z.uuid().optional(),
  academic_year_id: z.uuid().optional(),
  subject_id: z.uuid().optional(),
  teacher_id: z.uuid().optional(),
});

/**
 * `req.actor` is absent for an anonymous caller and present-but-possibly-Pending
 * otherwise; the service decides what each may see.
 */
function calendarActor(req: Request): CalendarActor | null {
  const a = req.actor;
  if (!a) return null;
  return {
    userId: a.userId,
    roles: a.roles,
    roleScopes: a.roleScopes,
    accountStatus: a.accountStatus ?? 'active',
  };
}

export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'from and to are required as YYYY-MM-DD');
    }
    const q = parsed.data;

    const actor = calendarActor(req);
    const [occurrences, prefilled] = await Promise.all([
      readCalendar(prisma, actor, {
        from: q.from,
        to: q.to,
        ...(q.branch_id ? { branchId: q.branch_id } : {}),
        ...(q.level_id ? { levelId: q.level_id } : {}),
        ...(q.category_id ? { categoryId: q.category_id } : {}),
        ...(q.administrative_group_id
          ? { administrativeGroupId: q.administrative_group_id }
          : {}),
        ...(q.academic_year_id ? { academicYearId: q.academic_year_id } : {}),
        ...(q.subject_id ? { subjectId: q.subject_id } : {}),
        ...(q.teacher_id ? { teacherId: q.teacher_id } : {}),
      }),
      prefilledFilters(prisma, actor),
    ]);

    res.json({
      // Absent for an anonymous caller: *there is nothing to prefill* and
      // *nothing was unambiguous* are different answers, and an object of nulls
      // would conflate them (TD-3.4, R43).
      prefilled_filters: prefilled
        ? {
            academic_year_id: prefilled.academicYearId,
            category_id: prefilled.categoryId,
            level_id: prefilled.levelId,
            branch_id: prefilled.branchId,
            subject_id: prefilled.subjectId,
            teacher_id: prefilled.teacherId,
          }
        : null,
      data: occurrences.map(occurrenceDto),
    });
  };
}

/** The wire shape of one occurrence — shared by the grid and the Session page. */
function occurrenceDto(o: Occurrence): Record<string, unknown> {
  return {
    kind: o.kind,
    id: o.id,
    title: o.title,
    date: o.date,
    start_time: o.startTime,
    end_time: o.endTime,
    visibility: o.visibility,
    branch_id: o.branchId,
    description: o.description,
    recurrence: o.recurrence,
    branch_name: o.branchName,
    room_name: o.roomName,
    category_id: o.categoryId,
    category_name: o.categoryName,
    level_id: o.levelId,
    level_name: o.levelName,
    subject_id: o.subjectId,
    subject_name: o.subjectName,
    teaching_mode: o.teachingMode,
    audience_label: o.audienceLabel,
    status: o.status,
    instructors: o.instructors.map((i) => ({ id: i.id, display_name: i.displayName })),
    hijri_date: o.hijriDate,
    hijri_month_ar: o.hijriMonthArabic,
  };
}

const contentDto = (c: SessionPageContent): Record<string, unknown> => ({
  id: c.id,
  title: c.title,
  subject_id: c.subjectId,
  level_id: c.levelId,
});

/**
 * `GET /library/{id}/sessions` — **which class sessions reference this content.**
 *
 * `SessionContent` read backwards. Mounted beside the library rather than the
 * calendar because the **subject** of the question is the content: a reader is
 * looking at an item and asking where it is used.
 *
 * **The content gates and the sessions do not** — the item passes §4.9's tiers
 * (a caller who may not see it gets `404`, never an empty list, so the id is not
 * confirmed), while the occurrences are the public timetable R43 made browsable
 * and are returned through the very projection `GET /calendar` uses.
 */
export function contentSessions(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = z.uuid().safeParse(req.params['id']);
    if (!id.success) throw new AppError('VALIDATION_FAILED', 'id must be a uuid');

    const sessions = await listSessionsForContent(prisma, calendarActor(req), id.data);
    res.json({ data: sessions.map(occurrenceDto) });
  };
}

/**
 * `GET /calendar/sessions/{id}` (TD-3.4) — the §5.2 Session page.
 *
 * Public, at the caller's tier, and mounted beside `/calendar` for that reason.
 * An unknown session and one whose schedule is deleted answer the same `404`.
 */
export function readSession(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = z.uuid().safeParse(req.params['id']);
    if (!id.success) throw new AppError('VALIDATION_FAILED', 'id must be a uuid');

    const page = await readSessionPage(prisma, calendarActor(req), id.data);
    res.json({
      // The occurrence exactly as the grid renders it — TD-3.4 says "the
      // occurrence above, plus …", and one mapper serves both.
      occurrence: occurrenceDto(page.occurrence),
      notes: page.notes,
      recordings: page.recordings.map(contentDto),
      linked_content: page.linkedContent.map(contentDto),
    });
  };
}
