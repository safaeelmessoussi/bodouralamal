import { api } from '../lib/api.js';
import {
  createCourseSchedule,
  deleteCourseSchedule,
  listCourseSchedules,
  updateCourseSchedule,
  type CourseSchedule,
} from './course-schedules.js';
import {
  createEvent,
  deleteEvent,
  setEventStaff,
  updateEvent,
  type EventInput,
} from './events.js';
import { createExam, deleteExam, listExams, updateExam, type Exam } from './exams.js';
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
  /**
   * **The stored visibility tier, carried so Edit can hydrate it** (NEW B §A).
   *
   * **`null` here now means *not yet SURFACED*, not *no tier*.** R109 (NEW B §C)
   * gave a class and a sitting a real tier on the server; **NEW B §D** is what
   * maps it here and adds the control. Until then `null` is still the honest
   * value for those two kinds, and it is safe: `saveSchedulingItem` sends
   * `visibility` on the **Event payload only**, so a class or an exam cannot be
   * republished by an edit that never mentioned its tier — which is precisely
   * the widening §A found on the نشاط form.
   */
  visibility: string | null;
  staffCount: number | null;
  version: number;
  /** @see SchedulingIds */
  ids: SchedulingIds;
}

/**
 * **The identifiers behind the names.**
 *
 * The list shows names because a timetable cannot be read from ids; the *edit
 * form* needs the ids, and re-fetching the row it already has in hand would be
 * a second round trip for data that travelled with the first. `null` where the
 * kind has no such column, on the same rule as the names above: an Event has no
 * room and no subject, and an invented id is worse than an empty select.
 *
 * This is what stops an edit from **silently clearing** what it did not show —
 * `PATCH /exams` sends the group and the staff unconditionally, so a form that
 * opened with them blank would erase them on save.
 */
export interface SchedulingIds {
  branchId: string | null;
  roomId: string | null;
  /** **R97 — طريقة الحضور**, so an edit form opens on what the class IS. `null`
   *  for kinds that have no delivery model (an Event, an Exam sitting). */
  deliveryMode: string | null;
  onlineMediaMode: string | null;
  /**
   * **The Level the item is for**, not merely the Level where it is the target.
   *
   * A class taught to an Administrative Group has no `level_id` of its own —
   * the CHECK behind §4.4c allows exactly one target per mode — so this is the
   * server's resolved answer. A form that seeded only `groupId` had no Level,
   * and the Group list, narrowed by Level **and** Branch together (§4.4c), then
   * came back empty and dropped the Group the class already had.
   */
  levelId: string | null;
  subjectId: string | null;
  academicYearId: string | null;
  /** The narrower audience where one was chosen; `null` is the whole Level. */
  groupId: string | null;
  /**
   * **The item's own teaching mode**, so an edit form opens on the mode the row
   * actually has. Without it the form defaulted to `administrative_group` for
   * every class — which read the wrong target on validation and, worse, would
   * have SENT that mode back and rewritten an `entire_level` class's audience.
   */
  teachingMode: string | null;
  /** R91 — each assignment with its inclusive effective period; `null` at
   *  either end is open-ended there. */
  staff: {
    user_id: string;
    position: string;
    effective_from?: string | null;
    effective_until?: string | null;
  }[];
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
  /** R71 — who answers for it. Empty for events created before R71. */
  /** R91 — each assignment with its inclusive effective period; `null` at
   *  either end is open-ended there. */
  staff: {
    user_id: string;
    position: string;
    effective_from?: string | null;
    effective_until?: string | null;
  }[];
  version: number;
}

const EMPTY_IDS: SchedulingIds = {
  branchId: null,
  roomId: null,
  deliveryMode: null,
  onlineMediaMode: null,
  levelId: null,
  groupId: null,
  teachingMode: null,
  subjectId: null,
  academicYearId: null,
  staff: [],
};

/**
 * Exported so the mapping can be tested directly, by the same rule
 * `assertExactSet` is: the interesting part is the *decisions* — which id is the
 * Level, which is the target, what the mode is — and each was wrong once.
 */
export function fromSchedule(row: CourseSchedule): SchedulingItem {
  return {
    type: 'class',
    id: row.id,
    // R57 — the schedule's own name. The Subject is still shown, in its own
    // column: it identifies the class, the title names it.
    title: row.title,
    // R109 gave the schedule and its Sessions a real tier; **NEW B §D** maps it
    // and adds the control. `null` is «not surfaced here yet», and the write path
    // omits the key for this kind, so nothing is silently republished meanwhile.
    visibility: null,
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
    ids: {
      branchId: row.branch_id,
      roomId: row.room_id,
      deliveryMode: row.delivery_mode,
      onlineMediaMode: row.online_media_mode,
      // The Level comes from the server's resolved field, never from
      // `target_id`: in every mode but `entire_level` the target is not a Level.
      levelId: row.level_id,
      // §4.4c — ONE target of the kind the mode names, so reading the group
      // from `target_id` is right only when the mode says it is a group.
      groupId: row.teaching_mode === 'administrative_group' ? row.target_id : null,
      teachingMode: row.teaching_mode,
      subjectId: row.subject_id,
      academicYearId: row.academic_year_id,
      staff: row.staff.map((x) => ({
        user_id: x.user_id,
        position: x.position,
        effective_from: x.effective_from ?? null,
        effective_until: x.effective_until ?? null,
      })),
    },
  };
}

/**
 * **Exported for its own test.** The mapping is pure and it is where a stored
 * `visibility` either reaches the edit form or is silently dropped — which it
 * was, turning every edit of a private نشاط into a widening (NEW B §A).
 */
export function fromEvent(row: EventDefinitionWire): SchedulingItem {
  return {
    type: 'activity',
    id: row.id,
    title: row.title,
    visibility: row.visibility,
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
    // An Event genuinely has none of these columns (§4.4). Null is the truth
    // about it, not a gap waiting to be filled — **except `staff`, which R71
    // gave it**: an event now has somebody answerable for it.
    ids: {
      ...EMPTY_IDS,
      staff: row.staff.map((x) => ({
        user_id: x.user_id,
        position: x.position,
        effective_from: x.effective_from ?? null,
        effective_until: x.effective_until ?? null,
      })),
    },
  };
}

/**
 * A physical exam as the unified list sees it (§4.6, R58).
 *
 * **`repeatUntil` is null and `recurrence` is `none`, and both are facts.** An
 * exam is one dated sitting, not a rule that repeats — so there is nothing to
 * bound, and saying so is more honest than omitting the fields and letting a
 * reader wonder.
 */
function fromExam(row: Exam): SchedulingItem {
  return {
    type: 'exam',
    id: row.id,
    title: row.title,
    // R109 gave a sitting a tier of its own, superseding §4.6; **NEW B §D** maps
    // it and adds the control. Same reasoning as the class above.
    visibility: null,
    description: row.description,
    startDate: row.date,
    endDate: null,
    startTime: row.start_time,
    endTime: row.end_time,
    recurrence: 'none',
    weekdays: [],
    repeatUntil: null,
    branchName: row.branch_name,
    roomName: row.room_name,
    // Who sits it: the narrower group where one was chosen, the Level otherwise.
    audienceLabel: row.administrative_group_name ?? row.level_name,
    staffCount: row.staff.length,
    version: row.version,
    ids: {
      branchId: row.branch_id,
      roomId: row.room_id,
      // R97 — an Exam sitting is physical by §4.6 and carries no delivery
      // model; `null` says so rather than defaulting it to in-person.
      deliveryMode: null,
      onlineMediaMode: null,
      levelId: row.level_id,
      groupId: row.administrative_group_id,
      // An exam is not a course schedule: §4.4c's teaching mode is a property
      // of a recurring class, and an exam carries both ids directly.
      teachingMode: null,
      subjectId: row.subject_id,
      academicYearId: row.academic_year_id,
      // **An exam sitting has no staffing PERIOD** (R91): it happens on one
      // date, so a period would be a field with one possible value.
      staff: row.staff.map((x) => ({ user_id: x.user_id, position: x.position })),
    },
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
  const all = filters.type === '' || filters.type === undefined;
  const wantsClasses = all || filters.type === 'class';
  const wantsActivities = all || filters.type === 'activity';
  const wantsExams = all || filters.type === 'exam';

  const [classes, activities, exams] = await Promise.all([
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
    wantsExams
      ? listExams(token, {
          ...(filters.branchId ? { branch_id: filters.branchId } : {}),
        })
      : Promise.resolve({ data: [] as Exam[], meta: { total: 0 } }),
  ]);

  // A class filtered by subject or year excludes activities entirely — the
  // filter is about something an Event does not have, so an Event cannot match.
  const activityRows =
    filters.subjectId || filters.academicYearId ? [] : activities.data.map(fromEvent);

  // An exam carries a subject and a year, so those filters narrow it honestly
  // rather than excluding it the way they must exclude an activity.
  const examRows = exams.data
    .filter((e) => !filters.subjectId || e.subject_id === filters.subjectId)
    .filter((e) => !filters.academicYearId || e.academic_year_id === filters.academicYearId)
    .map(fromExam);

  const items = [...classes.data.map(fromSchedule), ...activityRows, ...examRows].sort((a, b) =>
    // Soonest first, then by clock — a scheduling list is read forwards.
    (a.startDate ?? '').localeCompare(b.startDate ?? '') ||
    (a.startTime ?? '').localeCompare(b.startTime ?? ''),
  );

  return {
    items,
    truncated:
      classes.data.length >= MERGED_SOURCE_LIMIT ||
      activities.data.length >= MERGED_SOURCE_LIMIT ||
      exams.data.length >= MERGED_SOURCE_LIMIT,
  };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

/**
 * What the shared form collects. **The class-only fields are optional here and
 * required by the branch that uses them** — the alternative, two payload types,
 * would put the fork back in every caller.
 */
export interface SchedulingInput {
  /** R71 — who answers for an EVENT. Sent through its own route after the
   *  event exists, because assigning staff is its own capability (R71.4). */
  eventStaff?: { user_id: string; position: 'responsible' | 'assistant' }[];
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
  /** §4.4's four-way scope. **`groupIds` was missing until R72**, and it is the
   *  ONLY kind a Teacher may use (TD-2, §4.9) — so the form could offer them
   *  nothing the server would accept. */
  scope?: {
    global?: boolean;
    branchIds?: string[];
    categoryIds?: string[];
    levelIds?: string[];
    groupIds?: string[];
  };
  /** Exam only (§4.6, R58) — the Level it examines, and who sits it. */
  levelId?: string;
  /** `null` is the whole Level, never "no target". */
  examGroupId?: string | null;
  examStaff?: { user_id: string; position: 'supervisor' | 'assistant' }[];
  /** R81 — the exam's own maximum grade. `null` only while the form is empty;
   *  the server requires it on create and refuses the request without it. */
  examMaxGrade?: number | null;

  /** Class only (§4.4c). */
  subjectId?: string;
  teachingMode?: string;
  targetId?: string;
  branchId?: string;
  roomId?: string | null;
  /** R97 — sent as a unit with `onlineMediaMode`; the server refuses a
   *  combination it cannot store rather than dropping the odd field. */
  deliveryMode?: 'in_person' | 'online';
  onlineMediaMode?: 'audio_video' | 'audio_only' | null;
  academicYearId?: string;
  staff?: {
    user_id: string;
    position: 'teacher' | 'assistant';
    /** R91 — `null` is open-ended at that end. */
    effective_from?: string | null;
    effective_until?: string | null;
  }[];
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

/**
 * What a save reports back, so the caller can offer R82.5's optional notice.
 *
 * The **id and whether it was a creation** are what the confirmation needs, and
 * neither is knowable from the input alone: a creation returns a new id, and
 * *which change happened* decides which notification type the send would write.
 */
export interface SavedSchedulingItem {
  id: string | null;
  created: boolean;
}

/**
 * **Only an EVENT save reports an id here**, and that is the domain speaking
 * rather than an omission: R82.5's optional notice is about Events. Session
 * occurrence changes use their separate R83 confirmation flow, and an exam
 * sitting notifies at publication (R82.4).
 */
const NOT_AN_EVENT: SavedSchedulingItem = { id: null, created: false };

export async function saveSchedulingItem(
  input: SchedulingInput,
  existing: { id: string; version: number } | null,
  token: string | null,
): Promise<SavedSchedulingItem> {
  if (input.type === 'class') {
    if (existing) {
      // §4.4: subject, target, branch and year are not editable — changing what
      // is taught, to whom or where would re-point sessions already materialized
      // against the old answer. The form locks them; the server refuses them.
      await updateCourseSchedule(
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
          // **R97 — delivery travels whole.** Sending the mode without the
          // media mode is exactly what the server refuses, and sending neither
          // leaves the class delivered as it was.
          ...(input.deliveryMode !== undefined
            ? {
                delivery_mode: input.deliveryMode,
                online_media_mode: input.onlineMediaMode ?? null,
              }
            : {}),
          // **Staffing, which was silently absent here** (R90). The form has
          // always rendered the مؤطِّرة and her assistants on edit; the payload
          // omitted them and the server refused the key, so reassigning an
          // existing class was impossible through the only screen that offers
          // it. Past occurrences are not rewritten — the server resyncs future
          // un-overridden sessions only (R43.4).
          ...(input.staff ? { staff: input.staff } : {}),
        },
        token,
      );
      return NOT_AN_EVENT;
    }
    await createCourseSchedule(
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
        ...(input.deliveryMode !== undefined
          ? {
              delivery_mode: input.deliveryMode,
              online_media_mode: input.onlineMediaMode ?? null,
            }
          : {}),
        ...(input.staff ? { staff: input.staff } : {}),
      },
      token,
    );
    return NOT_AN_EVENT;
  }

  if (input.type === 'exam') {
    if (existing) {
      // **Arrangements only.** The server refuses the identity fields rather
      // than dropping them, so they are not sent — see `updateExam`.
      await updateExam(
        existing.id,
        existing.version,
        {
          title: input.title,
          description: input.description,
          date: input.startDate,
          start_time: input.startTime ?? '',
          end_time: input.endTime ?? '',
          ...(input.roomId ? { room_id: input.roomId } : {}),
          administrative_group_id: input.examGroupId ?? null,
          ...(input.examStaff ? { staff: input.examStaff } : {}),
          // Editable after creation, unlike the identity fields: the server
          // refuses a maximum below a mark already recorded (R81).
          ...(input.examMaxGrade == null ? {} : { max_grade: input.examMaxGrade }),
        },
        token,
      );
      return NOT_AN_EVENT;
    }
    await createExam(
      {
        // Sent explicitly: `online` must be refused by the SERVER with a coded
        // reason, not silently prevented here, so a client learns which
        // capability is missing rather than why a button did nothing.
        mode: 'physical',
        title: input.title,
        description: input.description,
        date: input.startDate,
        start_time: input.startTime ?? '',
        end_time: input.endTime ?? '',
        level_id: input.levelId!,
        subject_id: input.subjectId!,
        academic_year_id: input.academicYearId!,
        branch_id: input.branchId!,
        room_id: input.roomId!,
        administrative_group_id: input.examGroupId ?? null,
        ...(input.examStaff ? { staff: input.examStaff } : {}),
        max_grade: input.examMaxGrade!,
      },
      token,
    );
    return NOT_AN_EVENT;
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
    ...(existing
      ? {}
      : {
          ...(input.scope?.global ? { global: true } : {}),
          ...(input.scope?.branchIds ? { branch_ids: input.scope.branchIds } : {}),
          ...(input.scope?.categoryIds ? { category_ids: input.scope.categoryIds } : {}),
          ...(input.scope?.levelIds ? { level_ids: input.scope.levelIds } : {}),
          ...(input.scope?.groupIds ? { group_ids: input.scope.groupIds } : {}),
        }),
  };
  // **Two calls, and deliberately so.** R71 made assigning staff its own
  // capability with its own audit action — *who answers for this celebration*
  // is not an attribute edit — so it is a separate route rather than a key on
  // the event payload.
  //
  // **A failed second call degrades to today's behaviour, not to corruption:**
  // an event with nobody assigned is the ordinary state of every event created
  // before R71, so the worst case is an event an Admin must staff again.
  const saved = existing
    ? await updateEvent(existing.id, existing.version, payload, token)
    : await createEvent(payload, token);

  const eventId = existing?.id ?? (saved as { id: string }).id;
  if (input.eventStaff) {
    await setEventStaff(eventId, input.eventStaff, token);
  }
  return { id: eventId, created: existing === null };
}

export async function deleteSchedulingItem(
  item: Pick<SchedulingItem, 'type' | 'id'>,
  token: string | null,
): Promise<unknown> {
  if (item.type === 'class') return deleteCourseSchedule(item.id, token);
  if (item.type === 'exam') return deleteExam(item.id, token);
  return deleteEvent(item.id, token);
}
