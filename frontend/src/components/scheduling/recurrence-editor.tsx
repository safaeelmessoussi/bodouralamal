import type { ReactNode } from 'react';

import { CheckboxField, DateField, SelectField, TextField } from '../ui/field.js';
import { t } from '../../i18n/index.js';

/**
 * **The single source of truth for recurrence across the platform** (§4.4,
 * SRS Revision 56).
 *
 * ## Why there is now one shape where there were two
 *
 * This component used to carry two variants, because the two expanders read
 * `weekly` differently: `expandEvent` repeats **every seven days from the start
 * date** and ignores weekdays, while `expandSchedule` repeats **on the weekdays
 * listed** and uses the start date only as the alternation anchor. The backend
 * called them *"two anchoring shapes, deliberately not merged"*.
 *
 * **They describe the same rule** whenever `weekdays = [the start date's
 * weekday]`. The divergence was never in the domain — it was in what each
 * caller happened to send. One editor therefore emits one meaning: *every week
 * on the same day as the start date*, and the scheduling adapter fills the
 * weekday set for a class. **No backend change**: the schedule expander already
 * produces exactly the event's behaviour given that set.
 *
 * ## The pattern list is the vocabulary
 *
 * Eight patterns, mapped here **and nowhere else** onto the `RecurrenceType`
 * enum. *Every two weeks* and *every two weeks on chosen days* are one enum
 * value distinguished by whether a weekday set was given — a distinction the
 * interface must make, because they are different questions to a person, and
 * the database need not, because they are one rule with a fuller argument.
 *
 * Adding a pattern is a change to `PATTERNS` alone. No form knows what
 * `biweekly_alternating` means, which is the property that makes this a single
 * source of truth rather than merely a shared component.
 */

/** What a person picks. The stored pair each maps to is below. */
export type RecurrencePattern =
  | 'once'
  | 'daily'
  | 'weekly'
  | 'weekly_days'
  | 'biweekly'
  | 'biweekly_days'
  | 'monthly'
  | 'yearly';

interface PatternSpec {
  /** The stored `RecurrenceType`. */
  type: string;
  /** Whether the pattern is specified BY a weekday set — the only case where
   *  the checkboxes are the rule itself rather than an extra option. */
  usesWeekdays: boolean;
}

const PATTERNS: Record<RecurrencePattern, PatternSpec> = {
  once: { type: 'none', usesWeekdays: false },
  daily: { type: 'daily', usesWeekdays: false },
  weekly: { type: 'weekly', usesWeekdays: false },
  weekly_days: { type: 'multiple_weekdays', usesWeekdays: true },
  biweekly: { type: 'biweekly_alternating', usesWeekdays: false },
  biweekly_days: { type: 'biweekly_alternating', usesWeekdays: true },
  monthly: { type: 'monthly', usesWeekdays: false },
  yearly: { type: 'yearly', usesWeekdays: false },
};

const ORDER: readonly RecurrencePattern[] = [
  'once',
  'daily',
  'weekly',
  'weekly_days',
  'biweekly',
  'biweekly_days',
  'monthly',
  'yearly',
];

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** One shape, for every schedulable item. */
export interface RecurrenceValue {
  type: string;
  /** Meaningful only for a weekday-based pattern; carried always, so switching
   *  patterns does not discard a set the person already chose. */
  weekdays: string[];
  /** The series' first date. For an alternating pattern it also fixes **which**
   *  fortnight is *on* — without it the two halves are indistinguishable (§7). */
  startDate: string;
  /** *Repeat until*. Empty is open-ended. */
  endDate: string;
}

/** Reads the stored pair back into the pattern a person chose. */
export function patternOf(value: Pick<RecurrenceValue, 'type' | 'weekdays'>): RecurrencePattern {
  const hasDays = value.weekdays.length > 0;
  for (const key of ORDER) {
    const spec = PATTERNS[key];
    if (spec.type !== value.type) continue;
    // The one ambiguous enum value: biweekly with days and without share a
    // `type`, so the weekday set is what decides which was meant.
    if (spec.type === 'biweekly_alternating' && spec.usesWeekdays !== hasDays) continue;
    return key;
  }
  return 'once';
}

/** The stored pair for a pattern — used by the adapter to normalise a plain
 *  weekly class into the weekday set its expander reads. */
export function specOf(pattern: RecurrencePattern): PatternSpec {
  return PATTERNS[pattern];
}

export function RecurrenceEditor({
  value,
  onChange,
  /**
   * A course schedule refuses `none` at the database level — a non-recurring
   * occurrence **is** an Event (§4.4). Offering *once* there would offer
   * something the platform will always refuse.
   */
  allowOnce = true,
  hint,
}: {
  value: RecurrenceValue;
  onChange: (next: RecurrenceValue) => void;
  allowOnce?: boolean;
  hint?: string;
}): ReactNode {
  const pattern = patternOf(value);
  const spec = PATTERNS[pattern];
  const patterns = allowOnce ? ORDER : ORDER.filter((p) => p !== 'once');

  function choose(next: RecurrencePattern): void {
    const chosen = PATTERNS[next];
    onChange({
      ...value,
      type: chosen.type,
      // Dropping the set when the pattern does not use one is what keeps
      // `patternOf` able to tell the two biweekly patterns apart on the way back.
      weekdays: chosen.usesWeekdays ? value.weekdays : [],
    });
  }

  return (
    <>
      <SelectField
        label={t('scheduling.recurrence')}
        value={pattern}
        onChange={(v) => choose(v as RecurrencePattern)}
        options={patterns.map((p) => ({ value: p, label: t(`scheduling.pattern.${p}`) }))}
        {...(hint !== undefined ? { hint } : {})}
      />

      {spec.usesWeekdays ? (
        <fieldset className="field">
          <legend className="field__label">{t('scheduling.weekdays')}</legend>
          <div className="field__choices">
            {WEEKDAYS.map((day) => (
              // The `fieldset`/`legend` grouping stays here — it is this
              // editor's structure. Only the tick itself is the shared atom.
              <CheckboxField
                key={day}
                label={t(`scheduling.weekday.${day}`)}
                checked={value.weekdays.includes(day)}
                onChange={(ticked) =>
                  onChange({
                    ...value,
                    weekdays: ticked
                      ? [...value.weekdays, day]
                      : value.weekdays.filter((d) => d !== day),
                  })
                }
              />
            ))}
          </div>
          <p className="field__hint">{t('scheduling.weekdaysHint')}</p>
        </fieldset>
      ) : null}

      <div className="form__row">
        <DateField
          label={t('scheduling.startDate')}
          value={value.startDate}
          onChange={(startDate) => onChange({ ...value, startDate })}
          hint={
            spec.type === 'biweekly_alternating'
              ? t('scheduling.startDateAnchorHint')
              : t('scheduling.startDateHint')
          }
        />
        {/* **Shown only when there is something to bound.** A one-off has no
            *repeat until*, and a control asking when a single occurrence stops
            recurring would ask about a rule that does not exist. */}
        {pattern === 'once' ? null : (
          <DateField
            label={t('scheduling.recurrenceEnd')}
            value={value.endDate}
            onChange={(endDate) => onChange({ ...value, endDate })}
            hint={t('scheduling.recurrenceEndHint')}
          />
        )}
      </div>
    </>
  );
}

/**
 * Date and time — the part that genuinely **is** identical across every
 * schedulable item.
 *
 * **Times are plain text, never a native time input.** A wall-clock value
 * travels as `HH:MM` (TD-11), and a native control hands back a locale-dependent
 * rendering in some browsers — the one place this could quietly corrupt a value.
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
