import { api } from '../lib/api.js';

/**
 * The calendar adapter — the page's single source of data.
 *
 * It reads the **public** `GET /calendar` (TD-3.4), which serves anonymous
 * visitors the public tier and widens automatically for a signed-in caller
 * (§4.4). No component fetches, and no component holds event data of its own.
 *
 * The shape is the contract's, so a field the API stops sending becomes a type
 * error here rather than a blank line on the page.
 */
/**
 * **What kind of thing an occurrence is.** R58 adds `exam` to the two: a
 * physical sitting is one dated occurrence on the same grid.
 */
export type OccurrenceKind = 'session' | 'event' | 'exam';

/**
 * How each kind is named and coloured — **declared once**, because the chip and
 * the details dialog were already carrying two copies of the same ternary and
 * the exam would have made it three. The badge modifier deliberately names the
 * *scheduling type* (`class`/`activity`/`exam`), so a kind wears the same colour
 * in the calendar as it does in the list.
 */
export const OCCURRENCE_KIND_LABEL: Record<OccurrenceKind, string> = {
  session: 'calendar.kindSession',
  event: 'calendar.kindEvent',
  exam: 'calendar.kindExam',
};

export const OCCURRENCE_KIND_BADGE: Record<OccurrenceKind, string> = {
  session: 'class',
  event: 'activity',
  exam: 'exam',
};

export interface Occurrence {
  /**
   * **`'session'`, not `'group'`** — Revision 43 replaced the retired Group with
   * a Session as the teaching occurrence, and this type went on declaring the
   * old name. Nothing failed: `api<T>()` is an unchecked cast, so the wrong
   * literal compiled, every `=== 'group'` comparison quietly returned false, and
   * **every session rendered as an Event** in the chip and the details dialog.
   */
  kind: OccurrenceKind;
  id: string;
  title: string;
  /** Local calendar date `YYYY-MM-DD` (TD-11) — never an instant. */
  date: string;
  start_time: string | null;
  end_time: string | null;
  visibility: string | null;
  branch_id: string | null;
  description: string | null;
  recurrence: string | null;
  branch_name: string | null;
  room_name: string | null;
  /**
   * **R97 — how the occurrence is delivered.** `'in_person' | 'online'` for a
   * class; **`null` for an Event and an Exam**, which have no delivery model —
   * `deliveryLabel` returns `null` for them rather than inventing a default.
   */
  delivery_mode: string | null;
  online_media_mode: string | null;
  category_id: string | null;
  category_name: string | null;
  level_id: string | null;
  level_name: string | null;
  /* Sessions only (TD-3.4, R43). An Event has no subject, no teaching mode and
     no lifecycle, so these are null for it rather than invented. */
  subject_id: string | null;
  subject_name: string | null;
  teaching_mode: string | null;
  /** Who the class is *for*: the group's name, or the Level's, by mode. */
  audience_label: string | null;
  /** TD-1 lifecycle. A cancelled occurrence still appears — the calendar's job
   *  is to say a class is not happening, not to hide that it was scheduled. */
  status: string | null;
  /**
   * `display_name` is **already resolved by the backend** — see §7's Public
   * display identity invariant, which is the single statement of that rule.
   *
   * **Render it verbatim** (§20 rule 21). This type deliberately does not
   * carry the inputs: a client that cannot see them cannot choose between
   * them, and the wrong choice publishes a legal name where a kunya was
   * asked for.
   */
  instructors: { id: string; display_name: string }[];
  /** The official Hijri overlay, or null when the month is not yet recorded. */
  hijri_date: string | null;
  hijri_month_ar: string | null;
}

/**
 * The filters a signed-in caller's screen opens on (TD-3.4, R43), derived
 * server-side from their profile and **freely changeable**.
 *
 * `null` for an anonymous or Pending caller — *there is nothing to prefill* and
 * *nothing was unambiguous* are different answers, and an object of nulls would
 * conflate them. A field is prefilled only when unambiguous: a student enrolled
 * in three Levels has no single "own Level", so it stays `null` rather than
 * opening their calendar on a third of their own timetable.
 */
export interface PrefilledFilters {
  academic_year_id: string | null;
  category_id: string | null;
  level_id: string | null;
  branch_id: string | null;
  subject_id: string | null;
  teacher_id: string | null;
}

interface CalendarPage {
  data: Occurrence[];
  prefilled_filters: PrefilledFilters | null;
}

export interface CalendarQuery {
  from: string;
  to: string;
  branchId?: string | null;
  categoryId?: string | null;
  /** R84 — the rest of the shared filter matrix, all server-side. */
  subjectId?: string | null;
  groupId?: string | null;
  circleId?: string | null;
  kind?: string | null;
  levelId?: string | null;
  /**
   * The caller's access token, when there is one (R62.10).
   *
   * `GET /calendar` is public and `optionalAuthenticate`d: it returns the
   * **caller's visibility tier**, so an anonymous request and a signed-in one
   * legitimately see different sets (§4.4). The public page passes nothing and
   * gets the public tier, which is correct for it; the Student Dashboard passes
   * the token, because a session restricted to the student's own Level is
   * exactly what that screen is for.
   */
  token?: string | null;
}

export interface CalendarResult {
  occurrences: Occurrence[];
  /** Present only for an authenticated, active caller. */
  prefilled: PrefilledFilters | null;
}

/**
 * `GET /me/calendar` — **the caller's own** (R82.8), as against `/calendar`'s
 * *what is on at the association*.
 *
 * The same `Occurrence` shape, so every shared calendar component renders it
 * unchanged: a personal calendar is a narrower READ, never a different screen.
 * Cancelled occurrences are absent here as everywhere (R83.1).
 */
export async function fetchMyOccurrences(query: CalendarQuery): Promise<Occurrence[]> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.branchId) params.set('branch_id', query.branchId);
  if (query.categoryId) params.set('category_id', query.categoryId);
  if (query.levelId) params.set('level_id', query.levelId);
  if (query.subjectId) params.set('subject_id', query.subjectId);
  if (query.groupId) params.set('administrative_group_id', query.groupId);
  if (query.circleId) params.set('teaching_group_id', query.circleId);
  if (query.kind) params.set('type', query.kind);
  if (query.subjectId) params.set('subject_id', query.subjectId);
  if (query.groupId) params.set('administrative_group_id', query.groupId);
  if (query.circleId) params.set('teaching_group_id', query.circleId);
  if (query.kind) params.set('type', query.kind);
  const page = await api<CalendarPage>(`/me/calendar?${params.toString()}`, {
    token: query.token ?? null,
  });
  return page.data;
}

export async function fetchOccurrences(query: CalendarQuery): Promise<CalendarResult> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.branchId) params.set('branch_id', query.branchId);
  if (query.categoryId) params.set('category_id', query.categoryId);
  if (query.levelId) params.set('level_id', query.levelId);
  const page = await api<CalendarPage>(`/calendar?${params.toString()}`, {
    token: query.token ?? null,
  });
  return { occurrences: page.data, prefilled: page.prefilled_filters ?? null };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * The bootstrap — everything the screen needs to draw its CHROME (TD-3.10).
 *
 * Two requests per screen, never a third: this for the chrome, `/calendar` for
 * the occurrences. Opening an event costs nothing further, because Revision 36
 * made each occurrence self-sufficient.
 *
 * **Every Hijri value here is recorded official data** (Revisions 31–32). A day
 * whose month the Ministry has not announced arrives with its `hijri_*` fields
 * null, and the interface then shows the Gregorian date alone — it never
 * computes a substitute (§20 rule 14).
 * ─────────────────────────────────────────────────────────────────────────── */

export interface HijriDay {
  date: string;
  hijri_date: string | null;
  hijri_day: number | null;
  hijri_month: number | null;
  hijri_month_ar: string | null;
  hijri_year: number | null;
}

export interface HijriMonthRef {
  hijri_month: number;
  hijri_month_ar: string;
  hijri_year: number;
}

export interface GregorianMonthRef {
  month: number;
  month_ar: string;
  year: number;
}

export interface CategoryRef {
  id: string;
  name: string;
  display_order: number | null;
}

export interface LevelRef {
  id: string;
  name: string;
  category_id: string;
  display_order: number | null;
}

export interface BranchRef {
  id: string;
  name: string;
  display_order: number | null;
}

export interface CalendarBootstrap {
  hijri: { days: HijriDay[]; months: HijriMonthRef[] };
  gregorian_months: GregorianMonthRef[];
  categories: CategoryRef[];
  levels: LevelRef[];
  branches: BranchRef[];
  /** R84 — the Subjects the public calendar filters by. */
  subjects: { id: string; name: string; display_order: number | null }[];
}

export interface BootstrapQuery {
  from: string;
  to: string;
  /**
   * Narrows the Level list. Sent to the server rather than applied here,
   * because §4.4 requires the restriction to happen server-side *"so the client
   * never filters a list it was handed"* — filtering `levels` locally would be
   * the obvious shortcut and is precisely what that clause forbids.
   */
  categoryId?: string | null;
}

export async function fetchCalendarBootstrap(query: BootstrapQuery): Promise<CalendarBootstrap> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.categoryId) params.set('category_id', query.categoryId);
  const body = await api<{ data: CalendarBootstrap }>(`/calendar/bootstrap?${params.toString()}`);
  return body.data;
}

/* ── The §5.2 Session page (TD-3.4 `GET /calendar/sessions/{id}`) ────────── */

/**
 * One item attached to a session — enough to open it **inside the Educational
 * Library** (§5.2: one reader, one permission path), and deliberately not the
 * object location, which only `GET /content/{id}/download-url` hands out after
 * its own §4.9 check.
 */
export interface SessionContentRef {
  id: string;
  title: string;
  subject_id: string;
  level_id: string;
}

export interface SessionPage {
  occurrence: Occurrence;
  /**
   * **Always `null` today, and the key is present on purpose.** TD-3.4 names it
   * and §5.2 lists notes on the page, but §7 gives `Session` no notes column —
   * a schema decision the Document Owner has not taken. The field ships so the
   * gap stays visible rather than silent.
   */
  notes: string | null;
  /** §4.9 recording resources — the audio items among the linked content. */
  recordings: SessionContentRef[];
  /** The materials — disjoint from `recordings`. */
  linked_content: SessionContentRef[];
}

/**
 * Public, at the caller's tier. An anonymous visitor sees a public session's
 * details and **never its private recordings** (§5.2) — the server decides that,
 * not this call.
 */
/**
 * The Session page (TD-3.4) — **public at the caller's TIER**, which is exactly
 * why the token is not optional in practice.
 *
 * Read anonymously, it returns the public tier and nothing else. A recording a
 * مؤطرة has just made is normally **private** (§4.9's consent gate and the
 * per-Category default), so a caller that omitted its token saw the session page
 * without the very content it had just attached — the materials dialog did, and
 * a teacher's recording appeared to vanish the moment it was saved.
 *
 * Passing the token widens nothing: the server still resolves the tier from the
 * caller's own roles, and an anonymous read still sees only the public tier.
 */
export async function fetchSessionPage(id: string, token?: string | null): Promise<SessionPage> {
  return api<SessionPage>(`/calendar/sessions/${id}`, { token: token ?? null });
}
