import type { ReactNode } from 'react';

import { RecurrenceEditor, SchedulingTimes, type RecurrenceValue } from './recurrence-editor.js';
import { SelectField, TextArea, TextField } from '../ui/field.js';
import { DateField } from '../ui/field.js';
import { t } from '../../i18n/index.js';
import { AVAILABLE_TYPES, SCHEDULING_TYPES, type SchedulingType } from '../../adapters/scheduling.js';

/**
 * **The generic scheduling shell** (SRS Revision 56).
 *
 * ## What it is
 *
 * Everything that appears on the calendar is scheduled here: an administrator
 * picks *what kind of thing* they are scheduling and the form adapts. R56's
 * words — they should think *"I am scheduling something"*, not *"I am creating
 * an Event"*.
 *
 * ## The composition rule
 *
 * This component owns **only what every schedulable item has**: a name, an
 * optional description, when it starts and ends, whether it is all-day, and how
 * it repeats. Everything else arrives as `children` — the type-specific section,
 * rendered by the caller.
 *
 * That split is what makes Exams a one-arm change later (§4.6, M5): a new type
 * contributes a section and nothing here moves. It is also what stops this file
 * growing a `type === 'class'` ladder, which is how a "generic" form becomes
 * three forms sharing a wrapper.
 *
 * ## Recurrence and times are NOT reimplemented here
 *
 * `RecurrenceEditor` is the single source of truth for recurrence across the
 * platform and `SchedulingTimes` for wall-clock fields (TD-11). This component
 * renders them; it does not know what `biweekly_alternating` means, and adding
 * a pattern must never require touching this file.
 */
export interface SchedulingFormProps {
  /** Locked once created: an item's kind is not an editable attribute — it
   *  decides which entity stores it (§4.4). */
  type: SchedulingType;
  onTypeChange: (next: SchedulingType) => void;
  typeLocked: boolean;
  /** R72 — which kinds this caller may author. The teacher view passes the one
   *  kind TD-2 grants them, so the form offers no option the server refuses;
   *  the back office passes nothing and gets §4.4's full set. */
  types?: readonly SchedulingType[];

  title: string;
  onTitle: (v: string) => void;
  /** Hidden where the kind names itself — a class is named by its Subject
   *  (§4.4c), and a free-text title would be a second way to say the same thing. */
  showTitle: boolean;
  titleLabel?: string;

  description: string;
  onDescription: (v: string) => void;
  showDescription: boolean;

  /**
   * All-day is offered only where the model can express it. An Event's times
   * are nullable; a class always has them, because a lesson that happens at no
   * particular time is not a lesson.
   */
  showAllDay: boolean;
  allDay: boolean;
  onAllDay: (v: boolean) => void;

  startTime: string;
  endTime: string;
  onStartTime: (v: string) => void;
  onEndTime: (v: string) => void;

  /** The one-off span. A recurring item is bounded by *repeat until* instead,
   *  which the recurrence editor owns. */
  showEndDate: boolean;
  endDate: string;
  onEndDate: (v: string) => void;

  recurrence: RecurrenceValue;
  onRecurrence: (next: RecurrenceValue) => void;
  /** Declared per kind in `scheduling-types.ts`, never inferred here — the
   *  database refuses `none` on a schedule, and that is a fact about the
   *  entity rather than something this form should know (§4.4). */
  allowOnce: boolean;

  /** The type-specific section. Composed in, never branched on here. */
  children?: ReactNode;
}

export function SchedulingForm({
  type,
  onTypeChange,
  typeLocked,
  types = SCHEDULING_TYPES,
  title,
  onTitle,
  showTitle,
  titleLabel,
  description,
  onDescription,
  showDescription,
  showAllDay,
  allDay,
  onAllDay,
  startTime,
  endTime,
  onStartTime,
  onEndTime,
  showEndDate,
  endDate,
  onEndDate,
  recurrence,
  onRecurrence,
  allowOnce,
  children,
}: SchedulingFormProps): ReactNode {
  return (
    <>
      <SelectField
        label={t('scheduling.itemType')}
        value={type}
        onChange={(v) => onTypeChange(v as SchedulingType)}
        // §4.4: the kind decides which entity stores the item, so changing it
        // after creation would mean moving a row between tables. It is a
        // creation-time decision, and the form says so rather than failing.
        disabled={typeLocked}
        hint={typeLocked ? t('scheduling.typeFixed') : undefined}
        options={types.map((k) => ({
          value: k,
          // §14.4: a blocked capability states its reason instead of vanishing.
          // `exam` is real (§4.6) and arrives with M5, and hiding it would make
          // the roadmap invisible exactly where somebody looks for it.
          label: AVAILABLE_TYPES.includes(k)
            ? t(`scheduling.type.${k}`)
            : `${t(`scheduling.type.${k}`)} — ${t('scheduling.typeSoon')}`,
        }))}
      />

      {showTitle ? (
        <TextField
          label={titleLabel ?? t('scheduling.title')}
          value={title}
          onChange={onTitle}
          required
        />
      ) : null}

      {showDescription ? (
        <TextArea
          label={t('scheduling.description')}
          value={description}
          onChange={onDescription}
          rows={3}
        />
      ) : null}

      {showAllDay ? (
        <label className="field field--choice">
          <input type="checkbox" checked={allDay} onChange={(e) => onAllDay(e.target.checked)} />
          <span>{t('scheduling.allDay')}</span>
        </label>
      ) : null}

      {/* Wall-clock `HH:MM`, never a native time input (TD-11) — the one place
          this form could silently corrupt a value. Hidden, not disabled, when
          the item is all-day: there are no times to show. */}
      {allDay && showAllDay ? null : (
        <SchedulingTimes
          startTime={startTime}
          endTime={endTime}
          onStart={onStartTime}
          onEnd={onEndTime}
        />
      )}

      {/* The start date lives in the recurrence editor, beside *repeat until* —
          the two bounds of one rule belong together, and for an alternating
          pattern the start date IS part of the rule (§7). */}
      <RecurrenceEditor value={recurrence} onChange={onRecurrence} allowOnce={allowOnce} />

      {showEndDate && recurrence.type === 'none' ? (
        <DateField
          label={t('scheduling.endDate')}
          value={endDate}
          onChange={onEndDate}
          hint={t('scheduling.endDateHint')}
        />
      ) : null}

      {children}
    </>
  );
}
