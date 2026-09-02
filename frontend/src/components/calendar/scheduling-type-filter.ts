import type { CalendarBootstrap, CalendarQuery } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';

/**
 * **The النوع filter, stated once for every calendar surface** (R110, Owner
 * 2026-09-02).
 *
 * ## What it replaces
 *
 * Both calendars offered a hard-coded `session | event | exam` list — the
 * platform's *storage* taxonomy, not the association's vocabulary. Two of the
 * association's own words for what it schedules cannot be told apart in it:
 * «نشاط» and «عطلة» are both stored as an `Event`, so `type=event` returned
 * both and a holiday could not be filtered for at all, while «محاضرة» and «حصة
 * دراسية» are both `class`.
 *
 * The catalogue is the vocabulary, and it is **the administration's to change**
 * (§4.4b, R110): a hard-coded list is wrong the day someone adds a type. The
 * options therefore come from `GET /calendar/bootstrap`, which the every
 * calendar already fetches for its Hijri overlay — no second request.
 *
 * ## Why the two surfaces share this file
 *
 * They had two copies of the same three-item array, and rule C is the reason
 * this is one module: a second implementation of one concept is the shape every
 * drift on this project has started from.
 */
export type SchedulingTypeOption = { value: string; label: string };

export function schedulingTypeOptions(
  bootstrap: CalendarBootstrap | null,
): SchedulingTypeOption[] {
  return (bootstrap?.scheduling_types ?? []).map((type) => ({
    value: type.id,
    label: type.name,
  }));
}

/**
 * **Turns the filter's stored value into the query the server understands.**
 *
 * A catalogue id goes out as `scheduling_type_id`. Anything else is one of the
 * three storage words, and goes out as `type` — **a link somebody sent in
 * August still works**, which is the whole reason the older parameter is still
 * accepted. Both narrow server-side; neither is interpreted here.
 */
export function schedulingTypeQuery(
  value: string | null,
): Pick<CalendarQuery, 'kind' | 'schedulingTypeId'> {
  if (!value) return {};
  return LEGACY_KINDS.has(value) ? { kind: value } : { schedulingTypeId: value };
}

/**
 * **The label for a saved filter the catalogue no longer offers.**
 *
 * A retired type still names the rows that used it (the FK is `RESTRICT`), so a
 * deep link to one must not render as a control with no selected option — which
 * silently reads as *no filter* while the results are in fact narrowed.
 */
export function withUnlistedValue(
  options: SchedulingTypeOption[],
  value: string | null,
): SchedulingTypeOption[] {
  if (!value || LEGACY_KINDS.has(value) || options.some((o) => o.value === value)) {
    return options;
  }
  return [...options, { value, label: t('calendar.filters.retiredType') }];
}

/** The pre-R110 values, still honoured on the wire and in a saved link. */
const LEGACY_KINDS = new Set(['session', 'event', 'exam']);
