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
export interface Occurrence {
  kind: 'group' | 'event';
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
  category_id: string | null;
  category_name: string | null;
  level_id: string | null;
  level_name: string | null;
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

interface CalendarPage {
  data: Occurrence[];
}

export interface CalendarQuery {
  from: string;
  to: string;
  branchId?: string | null;
  categoryId?: string | null;
  levelId?: string | null;
}

export async function fetchOccurrences(query: CalendarQuery): Promise<Occurrence[]> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.branchId) params.set('branch_id', query.branchId);
  if (query.categoryId) params.set('category_id', query.categoryId);
  if (query.levelId) params.set('level_id', query.levelId);
  const page = await api<CalendarPage>(`/calendar?${params.toString()}`);
  return page.data;
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
