import type { ReactNode } from 'react';

import { ScopeSelectors } from '../scope/scope-selectors.js';
import {
  DeliverySection,
  type DeliveryMode,
  type OnlineMediaMode,
} from './delivery.js';
import { SelectField } from '../ui/field.js';
import { StaffPicker } from './staff-picker.js';
import { StaffingPeriods, type StaffingPeriod } from './staffing-periods.js';
import { t } from '../../i18n/index.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import type { TeachingCandidate } from '../../adapters/teaching-candidates.js';
// The narrow directory entry — these render names, never account fields.
import type { DirectoryEntry } from '../../adapters/users.js';

/**
 * The fields a **class** needs and nothing else needs (§4.4c).
 *
 * Composed into `SchedulingForm` as a child rather than branched on inside it —
 * which is what keeps that shell generic and makes Exams a new section rather
 * than a new `if`.
 *
 * **Every selector here is dependent** (R55): Branch and Level narrow the
 * groups, and the Level decides which Subjects exist at all (`LevelSubject`,
 * R43). The server refuses a pair the curriculum does not contain, so a form
 * offering every Subject would be offering combinations that can only be
 * rejected.
 */
export interface ClassSectionProps {
  scope: ScopeOptions;
  /** Locked after creation: subject, target, branch and year decide *what is
   *  taught, to whom and where*, and changing them would re-point Sessions
   *  already materialized against the old answer (§4.4). */
  locked: boolean;
  mode: string;
  onMode: (v: string) => void;
  modes: readonly string[];
  rooms: { id: string; name: string; capacity: number | null }[];
  roomId: string;
  onRoom: (v: string) => void;
  /**
   * **R97 — طريقة الحضور.** The room control moved INTO `DeliverySection` with
   * these, because a room is only meaningful for an in-person class and the
   * three fields are one decision (`policies/delivery.ts` states the same rule
   * server-side).
   */
  delivery: DeliveryMode;
  onDelivery: (v: DeliveryMode) => void;
  mediaMode: OnlineMediaMode;
  onMediaMode: (v: OnlineMediaMode) => void;
  teachers: DirectoryEntry[];
  /** R91 — one row per assignment, each with its own effective period. */
  staffing: StaffingPeriod[];
  onStaffing: (next: StaffingPeriod[]) => void;
  /**
   * The schedule's start date and R50 series end, `''` for open — the bounds
   * every staffing period must overlap (§5). Owned by the form above, not
   * re-derived here: they are the same two values the payload sends.
   */
  scheduleFrom: string;
  scheduleUntil: string;
  /** R90's planning appraisal for the class being planned, keyed by user id.
   *  Absent while the form has no time yet — there is nothing to appraise
   *  against, and an appraisal of a blank class would be noise. */
  appraisal?: Record<string, TeachingCandidate>;
}

export function ClassSection({
  scope,
  locked,
  mode,
  onMode,
  modes,
  rooms,
  roomId,
  onRoom,
  delivery,
  onDelivery,
  mediaMode,
  onMediaMode,
  teachers,
  staffing,
  onStaffing,
  appraisal,
  scheduleFrom,
  scheduleUntil,
}: ClassSectionProps): ReactNode {
  return (
    <>
      <ScopeSelectors
        scope={scope}
        fields={['branchId', 'levelId']}
        mode="form"
        locked={locked ? ['branchId', 'levelId'] : []}
      />

      <SelectField
        label={t('admin.schedules.mode')}
        value={mode}
        onChange={onMode}
        disabled={locked}
        options={modes.map((m) => ({ value: m, label: t(`admin.schedules.mode_${m}`) }))}
      />

      {/* The target IS one of the scope values, chosen by the mode (§4.4c):
          *entire level* delivers to the Level already selected, so it asks
          nothing further; *administrative group* asks which roster at that
          Level and Branch. A generic "target" list of mixed entity kinds is
          what once let a group from another branch be chosen. */}
      {mode === 'administrative_group' ? (
        <ScopeSelectors
          scope={scope}
          fields={['groupId']}
          mode="form"
          locked={locked ? ['groupId'] : []}
        />
      ) : null}

      <ScopeSelectors
        scope={scope}
        fields={['subjectId', 'academicYearId']}
        mode="form"
        locked={locked ? ['subjectId', 'academicYearId'] : []}
      />

      {/* **R97 — delivery, and the room that only an in-person class has.**
          One section, shared with the occurrence editor: a class scheduled
          عن بُعد and an occurrence moved عن بُعد must offer the same choices and
          call them the same things. */}
      <DeliverySection
        mode={delivery}
        onMode={onDelivery}
        mediaMode={mediaMode}
        onMediaMode={onMediaMode}
        rooms={rooms}
        roomId={roomId}
        onRoom={onRoom}
      />

      {/* **§4.4c staffing, with its EFFECTIVE PERIODS** (R91).

          The lead-plus-assistants control moved out: it expresses *one lead and
          any number of assistants*, which a class only had while an assignment
          carried no period. A temporary replacement is Safa → 30 Nov, Amina
          1–30 Nov, Safa 1 Dec → open — **two rows for Safa**, which a single
          «المؤطّرة» selector cannot say.

          `StaffPicker` is unchanged and still serves the exam sitting and the
          celebration, which staff a single dated thing. R90's warnings ride on
          each row here through the same appraisal. */}
      <StaffingPeriods
        staff={teachers}
        value={staffing}
        onChange={onStaffing}
        {...(appraisal ? { appraisal } : {})}
        /* The class's own life, so an assignment outside it is marked as it is
           typed — and re-marked the moment these dates are edited. */
        scheduleFrom={scheduleFrom}
        scheduleUntil={scheduleUntil}
      />
    </>
  );
}

/**
 * The fields an **activity** needs (§4.4, extended by R71).
 *
 * Deliberately small: an Event has no room and no subject, and §4.4 calls it
 * *"the non-teaching activity layer"*.
 *
 * **R71 gave it staff.** An event had an audience and nobody answerable for it,
 * so *a main responsible مؤطرة and her assistants* — the association's own way
 * of running a celebration — could not be recorded, and a مؤطرة responsible for
 * one who teaches nothing could not manage it at all.
 *
 * **The control is `StaffPicker`, shared with the exam section**; only the
 * words differ, because a مؤطرة responsible for a celebration is neither
 * teaching it nor supervising a paper (§20 rule 22).
 *
 * **Assigning is Admin and above (R71.4)** — the picker renders disabled for
 * anyone else, and the server refuses regardless: hiding is not enforcement.
 */
/**
 * §4.4's four scopes plus **`group`, which R72 added**: the join table
 * `EventAdministrativeGroup` has existed since R43 and the server has always
 * accepted `group_ids`, but no form ever offered it — so the one scope a
 * Teacher is permitted (TD-2, §4.9) could not be expressed at all.
 */
const ALL_SCOPE_KINDS = [
  { value: 'global', labelKey: 'admin.calendar.scopeGlobal' },
  { value: 'branch', labelKey: 'admin.calendar.scopeBranch' },
  { value: 'category', labelKey: 'admin.calendar.scopeCategory' },
  { value: 'level', labelKey: 'admin.calendar.scopeLevel' },
  { value: 'group', labelKey: 'admin.calendar.scopeGroup' },
] as const;

/**
 * **A عطلة is scoped to الفرع and الفئة, and to nothing else** (Owner,
 * 2026-08-28). It is a period on which nothing is delivered, so «this Level» or
 * «this group» would be describing an audience a holiday does not have — and
 * the server refuses them (`HOLIDAY_SHAPE`), so this list is the affordance
 * agreeing with the rule rather than the rule itself.
 */
export const HOLIDAY_SCOPE_KINDS = [
  { value: 'branch', labelKey: 'admin.calendar.scopeBranch' },
  { value: 'category', labelKey: 'admin.calendar.scopeCategory' },
] as const;

/** R72 — a Teacher may scope an event to their own Administrative Groups and
 *  to nothing else, so this is the whole list they are offered. */
export const TEACHER_SCOPE_KINDS = [
  { value: 'group', labelKey: 'admin.calendar.scopeGroup' },
] as const;

/**
 * **R109/NEW B §D — the tier moved OUT of this section.**
 *
 * It lived here because نشاط was the only kind that had one. R109 gave a حصة and
 * an امتحان a tier too, so it now renders once in `SchedulingForm` for every
 * kind — one control rather than three that would drift.
 */
export function ActivitySection({
  scopeKind,
  onScopeKind,
  scopeId,
  onScopeId,
  scopeOptions,
  locked,
  staff,
  leadStaff,
  responsibleLocked = false,
  responsibleId,
  onResponsible,
  assistantIds,
  onAssistants,
  canAssignStaff,
  disabled,
  scopeKinds = ALL_SCOPE_KINDS,
}: {
  scopeKind: string;
  onScopeKind: (v: string) => void;
  scopeId: string;
  onScopeId: (v: string) => void;
  scopeOptions: { id: string; name: string }[];
  /** Scope is set at creation and refused on edit — §4.4 populates the four-way
   *  joins explicitly, and re-pointing them later would silently change who has
   *  been seeing the event. */
  locked: boolean;
  staff: DirectoryEntry[];
  responsibleId: string;
  onResponsible: (v: string) => void;
  assistantIds: string[];
  onAssistants: (ids: string[]) => void;
  /** R71.4 — assigning staff is Admin and above. */
  canAssignStaff: boolean;
  /** Read-only for a caller who may not staff this event at all. Distinct from
   *  `responsibleLocked`, which fixes only the lead. */
  disabled?: boolean;
  /**
   * **Who may be named responsible**, which is not always everyone staffable.
   * A مؤطرة is offered exactly herself: she may staff her own event and may not
   * hand it to somebody else. Absent, it is `staff` — the Admin's case.
   */
  leadStaff?: DirectoryEntry[];
  /** True when the lead is fixed and only the assistants are hers to choose. */
  responsibleLocked?: boolean;
  /** R72 — the scope kinds this caller may choose. A Teacher gets `group` and
   *  only `group`: §4.9 and TD-2 forbid them a branch, category, level or the
   *  Global scope, so offering those would offer a refusal. */
  scopeKinds?: readonly { value: string; labelKey: string }[];
}): ReactNode {
  return (
    <>
      {locked ? (
        <p className="muted">{t('admin.calendar.scopeFixed')}</p>
      ) : (
        <>
          <SelectField
            label={t('admin.calendar.scopeLabel')}
            value={scopeKind}
            onChange={onScopeKind}
            options={scopeKinds.map((k) => ({ value: k.value, label: t(k.labelKey) }))}
          />
          {scopeKind === 'global' ? null : (
            <SelectField
              label={t('admin.calendar.scopeTargetLabel')}
              value={scopeId}
              onChange={onScopeId}
              options={[
                { value: '', label: t('common.choose') },
                ...scopeOptions.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          )}
        </>
      )}

      {/* R71 — who answers for it. Rendered on edit as well as creation,
          because staffing is a decision an Admin revisits: the responsible
          مؤطرة changes without the celebration changing. */}
      <StaffPicker
        staff={staff}
        leadStaff={leadStaff ?? staff}
        leadLocked={responsibleLocked}
        leadLabel={t('admin.calendar.responsible')}
        leadId={responsibleId}
        onLead={onResponsible}
        assistantsLabel={t('admin.calendar.eventAssistants')}
        assistantsHint={
          canAssignStaff
            ? t('admin.calendar.eventAssistantsHint')
            : t('admin.calendar.staffAdminOnly')
        }
        assistantIds={assistantIds}
        onAssistants={onAssistants}
        /**
         * **Not disabled for a مؤطرة any more** (2026-08-20).
         *
         * R71.4 kept all event staffing with Admins, so this control was
         * read-only for her — and when she was granted her own event's
         * assistants, the grant was unreachable: the `＋` registered nothing and
         * the event saved with no assistants at all, looking exactly like a
         * click that had not landed.
         *
         * **The lead is locked separately** (`leadLocked`), which is the part
         * that must not move; the assistants are the part this grant is for.
         * The server refuses anything else regardless — it is the authority,
         * and this control is not.
         */
        disabled={disabled ?? false}
      />
    </>
  );
}
