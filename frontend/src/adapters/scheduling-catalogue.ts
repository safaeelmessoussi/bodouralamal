import { api } from '../lib/api.js';

import { reorderResource } from './reorder.js';
import type { SchedulingType } from './scheduling.js';

/**
 * **R123 — what attendance means for a scheduling type.**
 *
 * Replaces the `attendance_required` boolean, which collapsed two questions
 * into one: *may presence be recorded at all* and *are people expected*. A
 * vacation and an optional activity were both "not required" and must behave
 * completely differently — one has no sheet, the other has an empty one.
 */
export type AttendanceMode = 'disabled' | 'optional' | 'required';

/**
 * **The scheduling-type catalogue — server data since R110** (NEW H).
 *
 * ## What this module ends
 *
 * The five types an administrator picks from — حصة دراسية, اختبار, محاضرة, حفل,
 * عطلة — were a **hardcoded frontend constant**. Nobody could add one, rename
 * one, reorder them, or record which of them takes attendance, and the Owner
 * calls that order canonical. *Seeded does not mean immutable*: the seed is the
 * initial state, never a whitelist.
 *
 * ## The line between this and `scheduling-types.ts`
 *
 * Two different things share a name, and keeping them apart is the whole design:
 *
 * | | lives where | why |
 * |---|---|---|
 * | **The catalogue** — which types exist, their names, their order, whether each takes attendance | **here, from the server** | reference data an administrator manages |
 * | **The structural spec** — what an entity can express: all-day, an end date, `once`, drillable occurrences | `scheduling-types.ts`, in code | facts about `RecurringCourseSchedule`, `Event` and `Exam` themselves; no administrator can make an `Event` have materialized occurrences |
 *
 * A row's `structural_kind` is the join between them: it names which of the
 * three entities the type is delivered by, so the form reads the catalogue for
 * *what may I create* and the spec for *what can that entity express*.
 */

export interface SchedulingTypeRow {
  id: string;
  /** The administrator-facing label. Rendered verbatim — never re-derived from
   *  `structural_kind`, which would put the catalogue back in the client. */
  name: string;
  /** Which entity it routes to (R56's three branches, stored by R110). */
  structural_kind: SchedulingType;
  /**
   * **Whether attendance is taken for this type** (OD-03).
   *
   * The form presents attendance-specific controls only where this is true. It
   * is read from the row and **never inferred from the name** — اختبار takes
   * attendance and محاضرة does not, and nothing about either word says so.
   */
  attendance_mode: AttendanceMode;
  display_order: number;
  /** Live activities using it — what makes a blocked deletion legible before an
   *  administrator meets it (rule AZ.1). */
  event_count: number;
  /** TD-15: the editor sends it back; a stale one is a `409`. */
  version: number;
}

export interface SchedulingTypeInput {
  name: string;
  structural_kind: SchedulingType;
  attendance_mode: AttendanceMode;
}

/**
 * The whole live catalogue, in the Owner's order.
 *
 * Readable by anyone who may schedule — a مؤطِّرة included (R93/R94), or the
 * activity form would be one she cannot open. The server decides that; this
 * client asks the question.
 */
export async function listSchedulingTypes(token: string | null): Promise<SchedulingTypeRow[]> {
  const body = await api<{ data: SchedulingTypeRow[] }>('/admin/scheduling-types', { token });
  return body.data;
}

export async function createSchedulingType(
  input: SchedulingTypeInput,
  token: string | null,
): Promise<SchedulingTypeRow> {
  return api<SchedulingTypeRow>('/admin/scheduling-types', {
    method: 'POST',
    token,
    body: input,
  });
}

/**
 * **`structural_kind` is deliberately absent from the patch.**
 *
 * It decides which entity the type routes to, so changing it would re-point
 * every activity already recorded against the row at a model that cannot
 * represent them. The server's `.strict()` schema refuses the key outright, so
 * this is not a control hidden by the form (rule AF) — it is a field the API
 * does not accept.
 */
export async function updateSchedulingType(
  id: string,
  version: number,
  input: { name?: string; attendance_mode?: AttendanceMode },
  token: string | null,
): Promise<SchedulingTypeRow> {
  return api<SchedulingTypeRow>(`/admin/scheduling-types/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
}

export async function deleteSchedulingType(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/scheduling-types/${id}`, { method: 'DELETE', token });
}

/** R76.4 — the catalogue, in the order given. */
export async function reorderSchedulingTypes(
  ids: readonly string[],
  token: string | null,
): Promise<string[]> {
  return reorderResource('scheduling-types', ids, token);
}
