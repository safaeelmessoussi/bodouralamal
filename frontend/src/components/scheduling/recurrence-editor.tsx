import type { ReactNode } from 'react';

import { DateField, SelectField, TextField } from '../ui/field.js';
import { t } from '../../i18n/index.js';

/**
 * The recurrence control, **shared by every scheduled thing** — Events and
 * Course Schedules alike (§4.4).
 *
 * ## Why one component with two variants, and not one form
 *
 * The two are *not* the same shape, and §4.4 says so deliberately —
 * `lib/recurrence.ts` states it as an architectural decision on the backend:
 *
 * > **Two anchoring shapes, deliberately not merged:** *Anchored* (`Event`) — a
 * > start date plus a type. *Weekday-set* (`RecurringCourseSchedule`) — a set of
 * > weekdays plus, for the alternating pattern, an anchor week. **A class happens
 * > *on Tuesdays*, not *every 14 days from the 3rd*.** Collapsing them would mean
 * > one of the two lying about how it is specified.
 *
 * So a single set of fields would be wrong. What is genuinely shared — and what
 * an administrator actually notices — is **the control, its labels, its
 * ordering and its behaviour**. Those live here once. The *fields* differ
 * because the models differ, and that difference is real rather than an
 * inconsistency to paper over.
 *
 * **The vocabulary is one list.** `calendar.recurrence.*` labels every value for
 * both, so "أسبوع بأسبوع (بالتناوب)" reads identically on an event and on a
 * class — which was the point.
 */

/** §4.4's shared vocabulary. Each variant offers the subset its model accepts. */
const ANCHORED_TYPES = ['none', 'daily', 'weekly', 'biweekly_alternating', 'yearly'] as const;
/** `none` is refused on a schedule by the database — a non-recurring occurrence
 *  is an Event, not a class that happens once. */
const WEEKDAY_SET_TYPES = ['weekly', 'multiple_weekdays', 'biweekly_alternating'] as const;

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export interface AnchoredRecurrence {
  variant: 'anchored';
  type: string;
  /** The last date the pattern repeats to. Empty means open-ended. */
  endDate: string;
}

export interface WeekdaySetRecurrence {
  variant: 'weekday_set';
  type: string;
  weekdays: string[];
  /**
   * **When the series starts**, and — for `biweekly_alternating` — which week
   * counts as *on*. `anchor_date` in the contract.
   *
   * Without it, §7's own words: *"'week on' is undefined and the two halves of
   * the alternation are indistinguishable."* The form omitted it entirely, so a
   * fortnightly class had no way to say which fortnight it meant.
   */
  startDate: string;
  /**
   * **The last date the rule produces occurrences for** — `effective_until`
   * (R50). Empty is open-ended, which every schedule created before R50 is.
   *
   * The column has existed since R50 and no contract exposed it: it could only
   * be set as a side effect of splitting a schedule, so a class that runs for
   * one term could not be *described* as running for one term.
   */
  endDate: string;
}

export type RecurrenceValue = AnchoredRecurrence | WeekdaySetRecurrence;

/**
 * **Identical chrome, honest fields.**
 *
 * An administrator who has edited an event and then edits a class sees the same
 * control in the same place with the same words — which is the whole objective —
 * and is asked for the days of the week only where days of the week are what the
 * model stores.
 */
export function RecurrenceEditor({
  value,
  onChange,
  hint,
}: {
  value: RecurrenceValue;
  onChange: (next: RecurrenceValue) => void;
  hint?: string;
}): ReactNode {
  const types = value.variant === 'anchored' ? ANCHORED_TYPES : WEEKDAY_SET_TYPES;

  return (
    <>
      <SelectField
        label={t('scheduling.recurrence')}
        value={value.type}
        onChange={(type) => onChange({ ...value, type })}
        options={types.map((r) => ({ value: r, label: t(`calendar.recurrence.${r}`) }))}
        {...(hint !== undefined ? { hint } : {})}
      />

      {value.variant === 'anchored' ? (
        // An anchored pattern repeats from its own start date, so the only extra
        // question is when it stops. Hidden for `none`, where it would be a
        // control with nothing to bound.
        value.type === 'none' ? null : (
          <DateField
            label={t('scheduling.recurrenceEnd')}
            value={value.endDate}
            onChange={(endDate) => onChange({ ...value, endDate })}
            hint={t('scheduling.recurrenceEndHint')}
          />
        )
      ) : (
        // A weekday-set pattern is specified BY its weekdays — "on Tuesdays" —
        // so this is not an extra option, it is the rule itself.
        <fieldset className="field">
          <legend className="field__label">{t('scheduling.weekdays')}</legend>
          <div className="field__choices">
            {WEEKDAYS.map((day) => (
              <label key={day} className="field field--choice">
                <input
                  type="checkbox"
                  checked={value.weekdays.includes(day)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      weekdays: e.target.checked
                        ? [...value.weekdays, day]
                        : value.weekdays.filter((d) => d !== day),
                    })
                  }
                />
                <span>{t(`scheduling.weekday.${day}`)}</span>
              </label>
            ))}
          </div>
          <p className="field__hint">{t('scheduling.weekdaysHint')}</p>
        </fieldset>
      )}

      {/* **Both variants bound their series here, in the same place, with the
          same words.** A weekday set says *which days*; it still has to say
          *between which dates*, and asking that question in one form and not
          the other is what made the two scheduling screens feel unrelated. */}
      {value.variant === 'weekday_set' ? (
        <div className="form__row">
          <DateField
            label={t('scheduling.startDate')}
            value={value.startDate}
            onChange={(startDate) => onChange({ ...value, startDate })}
            hint={
              value.type === 'biweekly_alternating'
                ? t('scheduling.startDateAnchorHint')
                : t('scheduling.startDateHint')
            }
          />
          <DateField
            label={t('scheduling.recurrenceEnd')}
            value={value.endDate}
            onChange={(endDate) => onChange({ ...value, endDate })}
            hint={t('scheduling.recurrenceEndHint')}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * Date and time — the part that genuinely **is** identical.
 *
 * Both models store a calendar date and optional wall-clock times (TD-11), so
 * this renders the same fields for both and there is no variant.
 *
 * **Times are plain text, never a native time input.** A wall-clock value
 * travels as `HH:MM`, and a native control hands back a locale-dependent
 * rendering in some browsers — the one place this component could quietly
 * corrupt a value.
 */
export function SchedulingTimes({
  startTime,
  endTime,
  onStart,
  onEnd,
}: {
  startTime: string;
  endTime: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}): ReactNode {
  return (
    <div className="form__row">
      <TextField
        label={t('scheduling.startTime')}
        value={startTime}
        onChange={onStart}
        hint={t('scheduling.timeHint')}
      />
      <TextField label={t('scheduling.endTime')} value={endTime} onChange={onEnd} />
    </div>
  );
}
