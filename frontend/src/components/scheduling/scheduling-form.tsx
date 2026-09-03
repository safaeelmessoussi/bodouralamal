import type { ReactNode } from 'react';

import { RecurrenceEditor, SchedulingTimes, type RecurrenceValue } from './recurrence-editor.js';
import { SelectField, TextArea, TextField } from '../ui/field.js';
import { DateField } from '../ui/field.js';
import { t } from '../../i18n/index.js';
import { SCHEDULING_TYPES, type SchedulingType } from '../../adapters/scheduling.js';
import type { SchedulingTypeRow } from '../../adapters/scheduling-catalogue.js';
import type { AttendanceMarking } from '../../adapters/attendance.js';
import { Feedback } from '../ui/feedback.js';
import { VisibilityField } from './visibility-field.js';

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

  /**
   * **R110 — the type picker's options, from the server** (NEW H).
   *
   * The five named types are reference data an administrator manages, so this
   * component renders what it is handed and decides nothing about the list.
   * Narrowed by `types` above: a caller who may author only activities is
   * offered only the catalogue rows delivered as activities, which is the same
   * rule the old picker applied to structural kinds.
   *
   * **Rule O:** the caller passes the permitted set, this renders it, and the
   * server is the authority — a forged `scheduling_type_id` is refused there.
   */
  catalogue?: readonly SchedulingTypeRow[];

  /**
   * **R109 (NEW B §D) — the visibility tier, for EVERY kind.**
   *
   * It used to be a field of `ActivitySection`, because نشاط was the only kind
   * that had one. R109 gave a حصة and an امتحان a tier of their own, so it
   * belongs to the generic shell: one control, rendered once, rather than three
   * sections each growing their own copy of the same three options.
   */
  visibility: string;
  onVisibility: (v: string) => void;
  /** Which catalogue row is chosen. `null` on a legacy activity, whose type was
   *  never recorded (R56 told administrators to write it in the title). */
  schedulingTypeId?: string | null;
  onSchedulingTypeChange?: (row: SchedulingTypeRow) => void;
  /**
   * **R123 — who may record presence at this item's occurrences.**
   *
   * A property of the class or activity, not of its type: حصة دراسية is the
   * type of both a women's class each woman signs herself into and a
   * children's class only the مؤطِّرة may mark. Absent `onAttendanceMarkingChange`
   * means this caller does not configure it, and the control is not rendered —
   * the value is still the row's, and the server still decides who may act.
   */
  attendanceMarking?: AttendanceMarking;
  onAttendanceMarkingChange?: (next: AttendanceMarking) => void;
  /**
   * **R123 — whether the chosen population may self-mark at all.**
   *
   * `true` offers both settings; `false` offers **only** `staff_only` and says
   * why — اليافعات and الطفل are always staff-recorded, and a control whose
   * every use the server refuses is worse than no control. `null` is *not yet
   * known* (no Level chosen, or the lists still arriving) and is treated as
   * `false`, because guessing *allowed* is the one direction that ships the
   * misleading option.
   *
   * Structural: the caller resolves it from the Level's Category flag, and
   * **no client compares a Category's Arabic name** (§4.4b).
   */
  selfAttendanceAllowed?: boolean | null;

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
  catalogue = [],
  schedulingTypeId = null,
  onSchedulingTypeChange,
  attendanceMarking = 'staff_only',
  onAttendanceMarkingChange,
  selfAttendanceAllowed = null,
  visibility,
  onVisibility,
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
      <TypePicker
        type={type}
        typeLocked={typeLocked}
        kinds={types}
        catalogue={catalogue}
        schedulingTypeId={schedulingTypeId}
        onTypeChange={onTypeChange}
        {...(onSchedulingTypeChange ? { onSchedulingTypeChange } : {})}
        attendanceMarking={attendanceMarking}
        {...(onAttendanceMarkingChange ? { onAttendanceMarkingChange } : {})}
        selfAttendanceAllowed={selfAttendanceAllowed}
      />

      {/* Beside the type, because both answer *what is this and who sees it* —
          and before the details, so the decision is taken rather than met at
          the bottom of a long form. */}
      <VisibilityField value={visibility} onChange={onVisibility} />

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


/**
 * **The type picker — one option per CATALOGUE row** (R110, NEW H).
 *
 * ## Why this is not the old picker with a longer list
 *
 * The old one offered three options because the frontend registry had three
 * entries, and those three were the *entities*. An administrator does not think
 * *«I am creating an Event»*; she thinks *«I am scheduling a حفل»* — and حفل,
 * محاضرة and عطلة were indistinguishable, because the only place the difference
 * lived was whatever she typed in the title (R56).
 *
 * So the options are the catalogue's rows, and the entity is **derived** from
 * the chosen row's `structural_kind`. Both callbacks fire: the page needs the
 * row (to send `scheduling_type_id`) and the kind (to shape the rest of the
 * form).
 *
 * ## The legacy row, and why there is no invented option
 *
 * An activity created before R110 has no type. The picker is locked on edit
 * anyway — the kind decides which entity stores the item, so it is a
 * creation-time decision — and where the row names no catalogue entry it falls
 * back to the entity's own label rather than guessing which of محاضرة, حفل or
 * عطلة it was. Guessing from the title is exactly the name-matching §4.4b
 * forbids.
 *
 * ## Attendance (R123)
 *
 * `attendance_mode` is a fact about the TYPE, so it is stated where the type is
 * chosen (OD-03). **Who may mark is a fact about this class or activity**, not
 * about its type — حصة دراسية is the type of both a women's class each woman
 * signs herself into and a children's class only the مؤطِّرة may mark — so the
 * marking selector is the one attendance control that lives on the item, and it
 * renders only where the type has a sheet at all. On عطلة and حفل there is
 * nothing to configure and the form says so instead of offering a setting whose
 * every value would be refused.
 */
function TypePicker({
  type,
  typeLocked,
  kinds,
  catalogue,
  schedulingTypeId,
  onTypeChange,
  onSchedulingTypeChange,
  attendanceMarking,
  onAttendanceMarkingChange,
  selfAttendanceAllowed,
}: {
  type: SchedulingType;
  typeLocked: boolean;
  kinds: readonly SchedulingType[];
  catalogue: readonly SchedulingTypeRow[];
  schedulingTypeId: string | null;
  onTypeChange: (next: SchedulingType) => void;
  onSchedulingTypeChange?: (row: SchedulingTypeRow) => void;
  attendanceMarking: AttendanceMarking;
  onAttendanceMarkingChange?: (next: AttendanceMarking) => void;
  selfAttendanceAllowed: boolean | null;
}): ReactNode {
  // Narrowed to what this caller may author (R72). A مؤطِّرة is offered the
  // activity rows and nothing else, because that is what the server grants her.
  const offered = catalogue.filter((r) => kinds.includes(r.structural_kind));
  const selected = offered.find((r) => r.id === schedulingTypeId) ?? null;

  /**
   * **The fallback is the entity's label, never a guessed catalogue name.**
   *
   * Reached in two states, both real: the catalogue has not loaded yet, and a
   * legacy activity whose type nobody recorded.
   */
  if (offered.length === 0 || (typeLocked && selected === null)) {
    return (
      <SelectField
        label={t('scheduling.itemType')}
        value={type}
        onChange={(v) => onTypeChange(v as SchedulingType)}
        disabled={typeLocked}
        hint={typeLocked ? t('scheduling.typeFixed') : undefined}
        options={kinds.map((k) => ({ value: k, label: t(`scheduling.type.${k}`) }))}
      />
    );
  }

  return (
    <>
      <SelectField
        label={t('scheduling.itemType')}
        value={selected?.id ?? ''}
        onChange={(v) => {
          const row = offered.find((r) => r.id === v);
          if (!row) return;
          onSchedulingTypeChange?.(row);
          // The entity follows the row — derived, never chosen twice.
          onTypeChange(row.structural_kind);
        }}
        // §4.4: the kind decides which entity stores the item, so changing it
        // after creation would mean moving a row between tables. It is a
        // creation-time decision, and the form says so rather than failing.
        disabled={typeLocked}
        hint={typeLocked ? t('scheduling.typeFixed') : undefined}
        options={offered.map((r) => ({ value: r.id, label: r.name }))}
      />
      {selected === null ? null : selected.attendance_mode === 'disabled' ? (
        <Feedback>{t('scheduling.attendanceNone')}</Feedback>
      ) : (
        <>
          <Feedback>
            {t(
              selected.attendance_mode === 'required'
                ? 'scheduling.attendanceRequired'
                : 'scheduling.attendanceOptional',
            )}
          </Feedback>
          {onAttendanceMarkingChange ? (
            <SelectField
              label={t('scheduling.attendanceMarking')}
              value={attendanceMarking}
              onChange={(v) => onAttendanceMarkingChange(v as AttendanceMarking)}
              /**
               * **The option is withheld, not disabled** where the population
               * may never self-mark — and the hint says which it is, so the
               * absence reads as a rule rather than as a missing feature.
               */
              hint={t(
                selfAttendanceAllowed === true
                  ? 'scheduling.attendanceMarkingHint'
                  : 'scheduling.attendanceMarkingStaffOnlyHint',
              )}
              options={
                /**
                 * Both offered where the population may self-mark — **and also
                 * where the row already says `self_or_staff`**, so an existing
                 * configuration is never rendered as a value the select does
                 * not contain. The caller resets it when the Category actually
                 * forbids it; a select silently showing the wrong option is how
                 * a save would change a setting nobody touched.
                 */
                selfAttendanceAllowed === true || attendanceMarking === 'self_or_staff'
                  ? [
                      { value: 'staff_only', label: t('scheduling.markingStaffOnly') },
                      { value: 'self_or_staff', label: t('scheduling.markingSelfOrStaff') },
                    ]
                  : [{ value: 'staff_only', label: t('scheduling.markingStaffOnly') }]
              }
            />
          ) : null}
        </>
      )}
    </>
  );
}
