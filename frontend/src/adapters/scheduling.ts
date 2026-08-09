import { api } from '../lib/api.js';
import {
  createCourseSchedule,
  deleteCourseSchedule,
  listCourseSchedules,
  updateCourseSchedule,
  type CourseSchedule,
} from './course-schedules.js';
import { createEvent, deleteEvent, updateEvent, type EventInput } from './events.js';
import { WEEKDAYS } from '../components/scheduling/recurrence-editor.js';
import { SCHEDULING_TYPE_SPECS } from './scheduling-types.js';

/**
 * **The one place that knows there are separate models** (SRS Revision 56).
 *
 * ## What this is for
 *
 * An administrator schedules *something*. Whether that something is stored as a
 * `RecurringCourseSchedule` or an `Event` is a fact about the platform, and R56
 * decided they should never have to know it: the type is a field on one form,
 * not a choice between two screens.
 *
 * **The models genuinely differ and are not merged** (§20 rule 22): Events are
 * computed on read (`expandEvent`) while Sessions are materialized as rows
 * (TD-4.6c), which is what lets §4.4 compute conflicts against real occurrences
 * and lets R50 split a schedule. Merging would force one behaviour onto both.
 *
 * So the divergence lives **here, in one module**, behind one vocabulary. Every
 * screen above this line deals in `SchedulingItem` and `SchedulingType`.
 *
 * ## Adding Exams later is one arm, not a new experience
 *
 * §4.6's `Exam` is a first-class entity with its own date, level, questions and
 * grading, and TD-3.6 gives it `POST /exams`. When M5 ships, `exam` becomes a
 * third branch of `saveSchedulingItem` and a third source in
 * `listSchedulingItems` — the form, the recurrence editor, the list and the
 * calendar are untouched. That is the extensibility R56 asks for, and it works
 * precisely *because* the models were never merged.
 */

/** What an administrator is scheduling. **Not** a stored column — it is which
 *  entity the item is, which the SRS already distinguishes (§4.4). */
export type SchedulingType = 'class' | 'activity' | 'exam';

export const SCHEDULING_TYPES: readonly SchedulingType[] = ['class', 'activity', 'exam'];

/** Derived from the registry, so a kind becomes available by flipping one flag
 *  beside its declaration rather than by editing a second list here. */
export const AVAILABLE_TYPES: readonly SchedulingType[] = SCHEDULING_TYPES.filter(
  (k) => SCHEDULING_TYPE_SPECS[k].available,
);

/**
 * One scheduled thing, as every screen above this module sees it.
 *
 * **Fields a kind has no source for are `null`, never invented** — the rule
 * TD-3.4 already applies to calendar occurrences. An Event has no subject, room
 * or staff, and showing an empty cell is the truth about it.
 */
export interface SchedulingItem {
  type: SchedulingType;
  id: string;
  /** What the item is CALLED — its own stored name for both kinds (R57). */
  title: string;
  description: string | null;
  /** TD-11 calendar dates and wall-clock times; `null` times mean all-day. */
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  recurrence: string;
  weekdays: string[];
  /** `recurrence_end_date` for an activity, `effective_until` for a class — one
   *  concept, two column names, reconciled here rather than on six screens. */
  repeatUntil: string | null;
  branchName: string | null;
  roomName: string | null;
  audienceLabel: string | null;
  staffCount: number | null;
  version: number;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

interface EventDefinitionWire {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  recurrence: string;
  recurrence_end_date: string | null;
  branch_ids: string[];
  version: number;
}

function fromSchedule(row: CourseSchedule): SchedulingItem {
  return {
    type: 'class',
    id: row.id,
    // R57 — the schedule's own name. The Subject is still shown, in its own
    // column: it identifies the class, the title names it.
    title: row.title,
    description: row.description,
    startDate: row.anchor_date,
    endDate: null,
    startTime: row.start_time,
    endTime: row.end_time,
    recurrence: row.recurrence,
    weekdays: row.weekdays,
    repeatUntil: row.effective_until,
    branchName: row.branch_name,
    roomName: row.room_name,
    audienceLabel: row.target_name,
    staffCount: row.staff.length,
    version: row.version,
  };
}

function fromEvent(row: EventDefinitionWire): SchedulingItem {
  return {
    type: 'activity',
    id: row.id,
    title: row.title,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    recurrence: row.recurrence,
    // An Event's rule is anchored on its start date and has no weekday set —
    // absent rather than an empty list pretending to be a choice.
    weekdays: [],
    repeatUntil: row.recurrence_end_date,
    branchName: null,
    roomName: null,
    audienceLabel: null,
    staffCount: null,
    version: row.version,
  };
}

export interface SchedulingFilters {
  type?: SchedulingType | '';
  branchId?: string;
  subjectId?: string;
  academicYearId?: string;
}

/**
 * Both sources, merged and ordered as one list.
 *
 * **Bounded at 100 per source, deliberately and visibly.** TD-10 caps a page at
 * 100, and merging two independently-paginated lists cannot produce a correct
 * combined page without reading both — so a combined view reads one full page of
 * each and says so. Filtering by type pages against that one endpoint natively,
 * which is the path an administrator working through a long list will take. The
 * same bound and the same reasoning as `fetchLevelContent` in `content.ts`.
 */
export const MERGED_SOURCE_LIMIT = 100;

export async function listSchedulingItems(
  token: string | null,
  filters: SchedulingFilters = {},
): Promise<{ items: SchedulingItem[]; truncated: boolean }> {
  const wantsClasses = filters.type === '' || filters.type === undefined || filters.type === 'class';
  const wantsActivities =
    filters.type === '' || filters.type === undefined || filters.type === 'activity';

  const [classes, activities] = await Promise.all([
    wantsClasses
      ? listCourseSchedules(token, 1, {
          ...(filters.branchId ? { branch_id: filters.branchId } : {}),
          ...(filters.subjectId ? { subject_id: filters.subjectId } : {}),
          ...(filters.academicYearId ? { academic_year_id: filters.academicYearId } : {}),
        })
      : Promise.resolve({ data: [], meta: { page: 1, page_size: 0, total: 0 } }),
    wantsActivities
      ? api<{ data: EventDefinitionWire[]; meta: { total: number } }>(
          // Subject and academic year are class-only concepts; an Event has
          // neither, so those filters simply do not narrow this source rather
          // than emptying it (§4.4).
          `/events?page_size=${MERGED_SOURCE_LIMIT}${
            filters.branchId ? `&branch_id=${encodeURIComponent(filters.branchId)}` : ''
          }`,
          { token },
        )
      : Promise.resolve({ data: [], meta: { total: 0 } }),
  ]);

  // A class filtered by subject or year excludes activities entirely — the
  // filter is about something an Event does not have, so an Event cannot match.
  const activityRows =
    filters.subjectId || filters.academicYearId ? [] : activities.data.map(fromEvent);

  const items = [...classes.data.map(fromSchedule), ...activityRows].sort((a, b) =>
    // Soonest first, then by clock — a scheduling list is read forwards.
    (a.startDate ?? '').localeCompare(b.startDate ?? '') ||
    (a.startTime ?? '').localeCompare(b.startTime ?? ''),
  );

  return {
    items,
    truncated:
      classes.data.length >= MERGED_SOURCE_LIMIT ||
      activities.data.length >= MERGED_SOURCE_LIMIT,
  };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

/**
 * What the shared form collects. **The class-only fields are optional here and
 * required by the branch that uses them** — the alternative, two payload types,
 * would put the fork back in every caller.
 */
export interface SchedulingInput {
  type: SchedulingType;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  recurrence: string;
  weekdays: string[];
  repeatUntil: string | null;
  /** Activity only. */
  visibility?: string;
  scope?: { global?: boolean; branchIds?: string[]; categoryIds?: string[]; levelIds?: string[] };
  /** Class only (§4.4c). */
  subjectId?: string;
  teachingMode?: string;
  targetId?: string;
  branchId?: string;
  roomId?: string | null;
  academicYearId?: string;
  staff?: { user_id: string; position: 'teacher' | 'assistant' }[];
}

/**
 * **Makes "weekly" mean one thing.**
 *
 * `expandEvent` reads plain `weekly` as *every seven days from the start date*
 * and ignores weekdays; `expandSchedule` reads it as *on the weekdays listed*.
 * The two agree exactly when the set is the start date's own weekday — so a
 * class scheduled with a non-weekday-based pattern gets that set filled in here,
 * and the editor above can offer one vocabulary without either expander lying.
 *
 * Returns the set unchanged when the pattern is weekday-based: there the person
 * chose the days and their choice is the rule.
 */
export function weekdaysForClass(recurrence: string, weekdays: string[], startDate: string): string[] {
  if (weekdays.length > 0) return weekdays;
  if (recurrence === 'daily' || recurrence === 'monthly' || recurrence === 'yearly') return [];
  if (startDate === '') return [];
  // `getUTCDay()` is 0=Sunday; `WEEKDAYS` is Monday-first (BR-17).
  const day = new Date(`${startDate}T00:00:00Z`).getUTCDay();
  const name = WEEKDAYS[(day + 6) % 7];
  return name ? [name] : [];
}

export async function saveSchedulingItem(
  input: SchedulingInput,
  existing: { id: string; version: number } | null,
  token: string | null,
): Promise<unknown> {
  if (input.type === 'class') {
    if (existing) {
      // §4.4: subject, target, branch and year are not editable — changing what
      // is taught, to whom or where would re-point sessions already materialized
      // against the old answer. The form locks them; the server refuses them.
      return updateCourseSchedule(
        existing.id,
        existing.version,
        {
          title: input.title,
          description: input.description,
          start_time: input.startTime ?? '',
          end_time: input.endTime ?? '',
          recurrence: input.recurrence,
          weekdays: weekdaysForClass(input.recurrence, input.weekdays, input.startDate),
          anchor_date: input.startDate || null,
          effective_until: input.repeatUntil,
          ...(input.roomId !== undefined ? { room_id: input.roomId } : {}),
        },
        token,
      );
    }
    return createCourseSchedule(
      {
        title: input.title,
        description: input.description,
        subject_id: input.subjectId!,
        teaching_mode: input.teachingMode!,
        target_id: input.targetId!,
        branch_id: input.branchId!,
        academic_year_id: input.academicYearId!,
        start_time: input.startTime ?? '',
        end_time: input.endTime ?? '',
        recurrence: input.recurrence,
        weekdays: weekdaysForClass(input.recurrence, input.weekdays, input.startDate),
        anchor_date: input.startDate || null,
        effective_until: input.repeatUntil,
        ...(input.roomId ? { room_id: input.roomId } : {}),
        ...(input.staff ? { staff: input.staff } : {}),
      },
      token,
    );
  }

  if (input.type === 'exam') {
    // §4.6's Exam ships with M5 (TD-3.6). The type is offered and disabled, so
    // this is unreachable from the interface; throwing rather than silently
    // doing nothing is what keeps it that way.
    throw new Error('exam scheduling arrives with M5');
  }

  const payload: EventInput = {
    title: input.title,
    description: input.description,
    visibility: (input.visibility ?? 'public') as EventInput['visibility'],
    start_date: input.startDate,
    end_date: input.endDate,
    start_time: input.startTime,
    end_time: input.endTime,
    recurrence_type: input.recurrence as EventInput['recurrence_type'],
    recurrence_end_date: input.repeatUntil,
    ...(existing ? {} : (input.scope ?? { global: true })),
  };
  return existing
    ? updateEvent(existing.id, existing.version, payload, token)
    : createEvent(payload, token);
}

export async function deleteSchedulingItem(
  item: Pick<SchedulingItem, 'type' | 'id'>,
  token: string | null,
): Promise<unknown> {
  return item.type === 'class'
    ? deleteCourseSchedule(item.id, token)
    : deleteEvent(item.id, token);
}
