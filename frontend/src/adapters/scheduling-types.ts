import type { SchedulingType } from './scheduling.js';

/**
 * **What each schedulable kind is, declared once** (SRS Revision 56).
 *
 * ## Why a registry rather than conditions
 *
 * R56 promised that adding Exams would be *"a third arm, not a second
 * scheduling experience"*. That promise is only as good as the number of places
 * that have to learn the new kind — and a `type === 'class'` test scattered
 * across a page, a form and an adapter is exactly how a third type turns into a
 * week of archaeology.
 *
 * So every question the interface asks about a kind is answered **here**:
 *
 * * is it available yet, and if not, why;
 * * which of the shared fields apply to it;
 * * whether it has occurrences to drill into (R50's scopes);
 * * which entity it routes to.
 *
 * Adding `exam` is then **one entry plus one section component**. Nothing in
 * `SchedulingForm`, the list, the calendar view or the recurrence editor moves,
 * which is what makes the claim testable rather than aspirational — and
 * `scheduling-parity.test.tsx` asserts the form branches on no type at all.
 *
 * ## The fields are declared, not inferred
 *
 * `allDay` is offered only where the model can express it: an `Event`'s times
 * are nullable, a class's are not, because a lesson that happens at no
 * particular time is not a lesson. `once` is refused for a class because the
 * database refuses `none` on a schedule — a non-recurring occurrence *is* an
 * Event (§4.4). Each of these is a fact about the entity, and stating it beside
 * the entity is what keeps the form from having to know it.
 */
export interface SchedulingTypeSpec {
  /** Offered in the picker but refused until its milestone ships. §14.4: a
   *  blocked capability states its reason rather than vanishing. */
  available: boolean;
  /** Why it is unavailable — rendered beside the option. */
  unavailableReasonKey?: string;
  /** A free-text name of its own. False only where the entity has no such
   *  column and borrowing one would be a second way to say the same thing. */
  hasTitle: boolean;
  hasDescription: boolean;
  /** Whether the item can span a whole day with no clock times. */
  hasAllDay: boolean;
  /** Whether a one-off span (start → end date) is meaningful, as opposed to a
   *  bound expressed by *repeat until*. */
  hasEndDate: boolean;
  /** Whether `once` is a legal recurrence for it. */
  allowsOnce: boolean;
  /**
   * Whether its occurrences are **materialized rows** you can drill into and
   * edit one at a time (TD-4.6c) — which is what R50's three scopes act on.
   * An Event's occurrences are computed on read, so there is nothing to open.
   */
  hasOccurrences: boolean;
}

export const SCHEDULING_TYPE_SPECS: Record<SchedulingType, SchedulingTypeSpec> = {
  class: {
    available: true,
    hasTitle: true,
    hasDescription: true,
    // A lesson that happens at no particular time is not a lesson (§4.4).
    hasAllDay: false,
    // A class is bounded by `effective_until` (R50), not by an end date.
    hasEndDate: false,
    // The database refuses `none` on a schedule: a non-recurring occurrence is
    // an Event, not a class that happens once.
    allowsOnce: false,
    hasOccurrences: true,
  },
  activity: {
    available: true,
    hasTitle: true,
    hasDescription: true,
    hasAllDay: true,
    hasEndDate: true,
    allowsOnce: true,
    // Computed on read by `expandEvent` — there is no row to open (§4.4).
    hasOccurrences: false,
  },
  exam: {
    // R58 — the **physical** sitting is built. The `عن بُعد` mode is offered
    // inside the exam section, disabled, with its reason stated (§14.4); the
    // server refuses it too, so the block is not merely a client courtesy.
    available: true,
    hasTitle: true,
    hasDescription: true,
    // A sitting happens at a time — an exam with no clock window is one nobody
    // can attend, which is why the database refuses a half-specified place.
    hasAllDay: false,
    // One dated sitting: bounded by nothing, because it does not repeat.
    hasEndDate: false,
    // `once` is the ONLY honest pattern here. An exam produces no Sessions and
    // follows no rule; offering *weekly* would describe something the model
    // cannot represent.
    allowsOnce: true,
    // No materialized rows to drill into — R50's scopes have nothing to act on.
    hasOccurrences: false,
  },
};

/** The kinds an administrator can actually create today, in picker order.
 *  Derived, so a filter or a picker can never fall behind the registry. */
export const AVAILABLE_TYPES: SchedulingType[] = (
  Object.keys(SCHEDULING_TYPE_SPECS) as SchedulingType[]
).filter((k) => SCHEDULING_TYPE_SPECS[k].available);

export function specOfType(type: SchedulingType): SchedulingTypeSpec {
  return SCHEDULING_TYPE_SPECS[type];
}
