import { api } from '../lib/api.js';

/**
 * Hijri Calendar Management (§5.7, TD-3.4, Revisions 31–32).
 *
 * **The Super Admin RECORDS the Ministry of Habous's official announcement; they
 * do not decide it.** Revision 32 makes that a vocabulary rule binding on this
 * code as well as on the interface: *record*, *publish official month*, *official
 * announcement* — never *choose*, *define* or *set*. Wording that reads as a
 * choice invites treating the value as editorial judgement, and the platform's
 * whole claim is that it reproduces an external authority.
 *
 * Unlike the content adapter, this one is **real**: all four endpoints exist.
 */

export interface HijriMonthRow {
  hijri_year: number;
  /** 1–12. */
  hijri_month: number;
  hijri_month_ar: string;
  /** `YYYY-MM-DD`, or `null` for a month the Ministry has not announced yet. */
  gregorian_start_date: string | null;
  status: 'draft' | 'published' | null;
  /** TD-15 optimistic locking — send back what you loaded, or a concurrent
   *  correction is silently clobbered. `null` for a month with no row yet. */
  version: number | null;
}

export interface HijriYear {
  hijri_year: number;
  /** Always twelve rows: a month with no announcement is a blank to fill, not a
   *  missing entry. */
  months: HijriMonthRow[];
}

export interface HijriHistoryEntry {
  created_at: string;
  action_type: string;
  actor_user_id: string | null;
  detail: Record<string, unknown>;
}

export async function fetchHijriYear(year: number): Promise<HijriYear> {
  return api<HijriYear>(`/admin/hijri-calendar?year=${year}`);
}

/**
 * Records one month's official start date.
 *
 * `version` is required when correcting a month that already has a row; a stale
 * one is refused with `409 VERSION_CONFLICT` rather than overwriting a
 * colleague's correction (TD-15).
 *
 * **A correction returns the month to `draft`**, so a change to live data must be
 * reviewed and republished deliberately rather than going straight out.
 */
export async function recordMonthStart(
  year: number,
  month: number,
  gregorianStartDate: string,
  version: number | null,
  token: string | null,
): Promise<HijriMonthRow> {
  return api<HijriMonthRow>(`/admin/hijri-calendar/${year}/${month}`, {
    method: 'PUT',
    token,
    body: {
      gregorian_start_date: gregorianStartDate,
      ...(version !== null ? { version } : {}),
    },
  });
}

/** Publishes the year's draft months. **Only published months render anywhere**,
 *  so this is the act that makes a recording visible platform-wide. */
export async function publishYear(
  year: number,
  token: string | null,
): Promise<{ published: number }> {
  return api<{ published: number }>(`/admin/hijri-calendar/${year}/publish`, {
    method: 'POST',
    token,
  });
}

/** The audit trail, which **is** the history — TD-8 rows are append-only and
 *  already record the previous and new start date on every change, so a separate
 *  history table would duplicate them and could drift. */
export async function fetchHijriHistory(
  year: number,
  token: string | null,
): Promise<HijriHistoryEntry[]> {
  const body = await api<{ data: HijriHistoryEntry[] }>(
    `/admin/hijri-calendar/${year}/history`,
    { token },
  );
  return body.data;
}
