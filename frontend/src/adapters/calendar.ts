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
}

export async function fetchOccurrences(query: CalendarQuery): Promise<Occurrence[]> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.branchId) params.set('branch_id', query.branchId);
  const page = await api<CalendarPage>(`/calendar?${params.toString()}`);
  return page.data;
}
