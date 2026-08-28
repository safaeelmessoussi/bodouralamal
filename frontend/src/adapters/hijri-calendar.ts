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

/**
 * One row of `GET /admin/hijri-calendar?year=`.
 *
 * **These names are the CONTRACT's, not this file's invention.** The previous
 * declaration named three fields that the API has never sent —
 * `hijri_year`/`months`/`hijri_month_ar` against the real
 * `year`/`data`/`month_name_ar` — so `data.months` was `undefined`, `.filter()`
 * on it threw, React unmounted the tree and the page rendered **blank white**.
 *
 * `api<T>()` is an **unchecked cast**: the generic asserts a shape and nothing
 * verifies it, so a wrong type here compiles perfectly and fails only in a
 * browser. The backend contract is the source of truth (§16.2, R38), and the
 * exact key set is now pinned by an HTTP test on the server side.
 */
export interface HijriMonthRow {
  /** 1–12. */
  hijri_month: number;
  month_name_ar: string;
  /** `YYYY-MM-DD`, or `null` for a month the Ministry has not announced yet. */
  gregorian_start_date: string | null;
  status: 'draft' | 'published' | null;
  /** TD-15 optimistic locking — send back what you loaded, or a concurrent
   *  correction is silently clobbered. `null` for a month with no row yet. */
  version: number | null;
  /** How the row was recorded; `null` for a month with no row yet. */
  source: string | null;
}

export interface HijriYear {
  year: number;
  /** Always twelve rows: a month with no announcement is a blank to fill, not a
   *  missing entry. */
  data: HijriMonthRow[];
}

/**
 * What `PUT /admin/hijri-calendar/{year}/{month}` returns.
 *
 * **Deliberately a separate type**: the write response carries `hijri_year` and
 * omits `month_name_ar`, so it is not the same shape as a list row. Declaring
 * one type for both is what let the mismatch hide.
 */
export interface HijriMonthRecorded {
  hijri_year: number;
  hijri_month: number;
  gregorian_start_date: string | null;
  status: 'draft' | 'published' | null;
  version: number | null;
  source: string | null;
}

export interface HijriHistoryEntry {
  created_at: string;
  action_type: string;
  actor_user_id: string | null;
  detail: Record<string, unknown>;
}

/**
 * The year's twelve months, recorded or not.
 *
 * **Takes the token.** It shipped without one — the only function in this file
 * that did — so every read answered `401` and the whole screen rendered its
 * error state. The page was unusable from the day it was written: an
 * administrator could never see a month, let alone record one.
 *
 * `/admin/*` is authenticated (TD-12); nothing about this endpoint is public.
 */
export async function fetchHijriYear(year: number, token: string | null): Promise<HijriYear> {
  return api<HijriYear>(`/admin/hijri-calendar?year=${year}`, { token });
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
): Promise<HijriMonthRecorded> {
  return api<HijriMonthRecorded>(`/admin/hijri-calendar/${year}/${month}`, {
    method: 'PUT',
    token,
    body: {
      gregorian_start_date: gregorianStartDate,
      ...(version !== null ? { version } : {}),
    },
  });
}

/**
 * **Prefills the year from the Umm al-Qura baseline** (Owner, 2026-08-30).
 *
 * A starting point, never an authority. The server inserts only the months that
 * have no row at all, so a date the Super Admin has already corrected is never
 * touched — running it twice changes nothing the second time. Imported months
 * arrive as `draft`: Umm al-Qura is calculated, Morocco announces by sighting,
 * and the difference is exactly what she is being asked to review.
 */
export async function importYearBaseline(
  year: number,
  token: string | null,
): Promise<{ imported: number; skipped: number; source: string }> {
  const body = await api<{ data: { imported: number; skipped: number; source: string } }>(
    `/admin/hijri-calendar/${year}/import`,
    { method: 'POST', token },
  );
  return body.data;
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
