import { patternOf } from './recurrence-editor.js';
import { t } from '../../i18n/index.js';

/**
 * How a scheduling rule reads in a table — **in Arabic, always** (§6).
 *
 * Extracted from the admin schedules page when R56 retired it: the teacher's own
 * schedule list renders the same two facts, and a copy per screen is how one of
 * them ends up showing `monday` from the wire while the other shows الاثنين.
 *
 * The enum values are the contract's vocabulary and are never what a reader
 * sees; the catalog used here is the one the recurrence editor's own controls
 * use, so a table and a form cannot disagree about what Tuesday is called.
 */
export function timeLabel(schedule: { start_time: string; end_time: string }): string {
  // Wall-clock, rendered exactly as the API sends it (TD-11). Reformatting
  // through a `Date` is how a 15:00 class becomes 14:00 for a reader elsewhere.
  return `${schedule.start_time} – ${schedule.end_time}`;
}

export function recurrenceLabel(schedule: { weekdays: string[]; recurrence: string }): string {
  // The days when the rule is specified BY them; otherwise the pattern's own
  // name, resolved through the single mapping in `recurrence-editor.ts`.
  return schedule.weekdays.length > 0
    ? schedule.weekdays.map((d) => t(`scheduling.weekday.${d}`)).join('، ')
    : t(`scheduling.pattern.${patternOf({ type: schedule.recurrence, weekdays: [] })}`);
}
