import { api } from '../lib/api.js';

/**
 * Events — the **non-teaching activity layer** (§4.4, Revision 43): holidays,
 * vacations, ceremonies, exams, one-off activities.
 *
 * **An Event never generates Sessions**, and a teaching occurrence is never an
 * Event. The two are separate models on one calendar, which is why this adapter
 * exists beside `course-schedules.ts` rather than inside it.
 *
 * **There is no `GET /events`, and none is invented here.** `GET /calendar`
 * already returns every event the caller may see, as **occurrences** carrying
 * the event's own id — so the admin list is those occurrences deduplicated by
 * id. A recurring event appears once per date on the calendar and once in the
 * list, which is the correct reading of each surface: the calendar shows *when
 * it happens*, this screen shows *what was created*.
 */

/** §4.4's shared recurrence vocabulary. `none` is permitted here, unlike on a
 *  Course Schedule — a non-recurring occurrence **is** an Event. */
export type EventRecurrence = 'none' | 'daily' | 'weekly' | 'biweekly_alternating' | 'yearly';

/** §4.4's three-tier visibility, stored as an enum and never a boolean. */
export type EventVisibility = 'public' | 'private' | 'hidden';

export interface EventInput {
  title: string;
  description?: string | null;
  visibility: EventVisibility;
  /** TD-11 calendar dates and wall-clock times, never instants. */
  start_date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  recurrence_type: EventRecurrence;
  recurrence_end_date?: string | null;
  /**
   * Scope, materialised by the server into join rows at creation (§4.4).
   *
   * **Only accepted on create.** `PATCH /events/{id}` edits the event's own
   * attributes and **refuses** scope keys rather than ignoring them — changing
   * who an event applies to is a re-scoping, not an edit, and a client that
   * sent one and received `200` would believe the audience had changed.
   */
  global?: boolean;
  branch_ids?: string[];
  category_ids?: string[];
  level_ids?: string[];
  group_ids?: string[];
}

export interface EventRow {
  id: string;
  title: string;
  visibility: EventVisibility;
  recurrence_type: EventRecurrence;
}

export async function createEvent(input: EventInput, token: string | null): Promise<EventRow> {
  return api<EventRow>('/events', { method: 'POST', token, body: input });
}

/**
 * Edits the event's **own attributes**. Scope is deliberately not among them —
 * see `EventInput`.
 */
export async function updateEvent(
  id: string,
  /**
   * **TD-15's version, and it was missing.** The server has always required it
   * on this route, and this adapter had no parameter for it — so **every edit
   * from the admin calendar returned `400 VALIDATION_FAILED`.** The cause was
   * structural rather than an oversight: that page listed calendar
   * *occurrences*, and an occurrence carries no `version` because it is not a
   * row. There was nothing to send. R56's definitions list publishes it, which
   * is what makes editing possible at all.
   */
  version: number,
  input: Omit<EventInput, 'global' | 'branch_ids' | 'category_ids' | 'level_ids' | 'group_ids'> & {
    visibility?: EventVisibility;
    recurrence_type?: EventRecurrence;
    start_date?: string;
  },
  token: string | null,
): Promise<EventRow> {
  return api<EventRow>(`/events/${id}`, { method: 'PATCH', token, body: { version, ...input } });
}

/** TD-5 soft delete. Its occurrences leave the calendar on the next read. */
export async function deleteEvent(id: string, token: string | null): Promise<void> {
  await api<void>(`/events/${id}`, { method: 'DELETE', token });
}

/**
 * `PUT /events/{id}/staff` — **who answers for this event** (§4.4, R71).
 *
 * **Admin and above**, which the server enforces: being responsible for an
 * event is not authority to decide who else answers for it (R71.4). The one
 * structural exception happens server-side — creating an event records the
 * creating مؤطرة `responsible` in the same transaction.
 *
 * Replaced, not merged: one call is one decision, and the server tombstones what
 * is no longer wanted and revives what returns (R59).
 */
export async function setEventStaff(
  id: string,
  staff: { user_id: string; position: 'responsible' | 'assistant' }[],
  token: string | null,
): Promise<void> {
  await api<void>(`/events/${id}/staff`, { method: 'PUT', token, body: { staff } });
}

/**
 * `POST /events/{id}/notify` — **the optional send, after the save** (R82.5).
 *
 * The client says *which change happened* and never *who to tell*: recipients
 * are resolved on the server from the event's own scope rows, and a body that
 * tried to name them is refused by the `.strict()` schema. That is what makes
 * *"do not invent recipient lists in the frontend"* a property of the contract
 * rather than a convention somebody has to remember.
 */
export async function notifyEventChange(
  eventId: string,
  change: 'created' | 'rescheduled' | 'cancelled',
  token: string | null,
): Promise<{ notified: number }> {
  const body = await api<{ data: { notified: number } }>(`/events/${eventId}/notify`, {
    method: 'POST',
    token,
    body: { change },
  });
  return body.data;
}
