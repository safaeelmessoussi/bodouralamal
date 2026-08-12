import type { ReactNode } from 'react';

import { ScopeSelectors } from '../scope/scope-selectors.js';
import { SelectField } from '../ui/field.js';
import { StaffPicker } from './staff-picker.js';
import { t } from '../../i18n/index.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import type { UserSummary } from '../../adapters/users.js';

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
  teachers: UserSummary[];
  teacherId: string;
  onTeacher: (v: string) => void;
  assistantIds: string[];
  onAssistants: (ids: string[]) => void;
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
  teachers,
  teacherId,
  onTeacher,
  assistantIds,
  onAssistants,
}: ClassSectionProps): ReactNode {
  const chosenRoom = rooms.find((r) => r.id === roomId);

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

      <SelectField
        label={t('admin.schedules.room')}
        value={roomId}
        onChange={onRoom}
        // BR-23 and §20 rule 22: capacity **informs and refuses nothing**. It is
        // shown as a hint beside the choice rather than enforced as a limit —
        // the Owner asked for a capacity field, and this is the honest form of
        // it, because the platform must never refuse a booking on this number.
        hint={
          chosenRoom?.capacity != null
            ? t('admin.schedules.roomCapacityHint').replace(
                '{n}',
                String(chosenRoom.capacity),
              )
            : undefined
        }
        options={[
          { value: '', label: t('admin.schedules.noRoom') },
          ...rooms.map((r) => ({ value: r.id, label: r.name })),
        ]}
      />

      {/* §4.4c — one primary teacher and zero or more assistants. Both are
          `CourseScheduleStaff` rows differing only in `position`, and both reach
          the schedule's students identically; the distinction records which of
          them the class is *taught by*. */}
      <SelectField
        label={t('admin.schedules.teacher')}
        value={teacherId}
        onChange={onTeacher}
        options={[
          { value: '', label: t('common.choose') },
          ...teachers.map((x) => ({ value: x.id, label: x.name_arabic })),
        ]}
      />

      <fieldset className="field">
        <legend className="field__label">{t('admin.schedules.assistants')}</legend>
        <div className="field__choices">
          {teachers
            // The primary teacher is not offered as their own assistant: one
            // person holds one position on one schedule, and the pair would be
            // refused by the server as a duplicate assignment.
            .filter((x) => x.id !== teacherId)
            .map((x) => (
              <label key={x.id} className="field field--choice">
                <input
                  type="checkbox"
                  checked={assistantIds.includes(x.id)}
                  onChange={(e) =>
                    onAssistants(
                      e.target.checked
                        ? [...assistantIds, x.id]
                        : assistantIds.filter((id) => id !== x.id),
                    )
                  }
                />
                <span>{x.name_arabic}</span>
              </label>
            ))}
        </div>
        <p className="field__hint">{t('admin.schedules.assistantsHint')}</p>
      </fieldset>
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

/** R72 — a Teacher may scope an event to their own Administrative Groups and
 *  to nothing else, so this is the whole list they are offered. */
export const TEACHER_SCOPE_KINDS = [
  { value: 'group', labelKey: 'admin.calendar.scopeGroup' },
] as const;

export function ActivitySection({
  visibility,
  onVisibility,
  scopeKind,
  onScopeKind,
  scopeId,
  onScopeId,
  scopeOptions,
  locked,
  staff,
  responsibleId,
  onResponsible,
  assistantIds,
  onAssistants,
  canAssignStaff,
  scopeKinds = ALL_SCOPE_KINDS,
}: {
  visibility: string;
  onVisibility: (v: string) => void;
  scopeKind: string;
  onScopeKind: (v: string) => void;
  scopeId: string;
  onScopeId: (v: string) => void;
  scopeOptions: { id: string; name: string }[];
  /** Scope is set at creation and refused on edit — §4.4 populates the four-way
   *  joins explicitly, and re-pointing them later would silently change who has
   *  been seeing the event. */
  locked: boolean;
  staff: UserSummary[];
  responsibleId: string;
  onResponsible: (v: string) => void;
  assistantIds: string[];
  onAssistants: (ids: string[]) => void;
  /** R71.4 — assigning staff is Admin and above. */
  canAssignStaff: boolean;
  /** R72 — the scope kinds this caller may choose. A Teacher gets `group` and
   *  only `group`: §4.9 and TD-2 forbid them a branch, category, level or the
   *  Global scope, so offering those would offer a refusal. */
  scopeKinds?: readonly { value: string; labelKey: string }[];
}): ReactNode {
  return (
    <>
      <SelectField
        label={t('admin.calendar.colVisibility')}
        value={visibility}
        onChange={onVisibility}
        hint={t('admin.calendar.visibilityHint')}
        // The catalog the events screen already uses — one word per tier
        // platform-wide, rather than a second set of labels for one concept.
        options={[
          { value: 'public', label: t('calendar.visibilityPublic') },
          { value: 'private', label: t('calendar.visibilityPrivate') },
          { value: 'hidden', label: t('calendar.visibilityHidden') },
        ]}
      />

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
        disabled={!canAssignStaff}
      />
    </>
  );
}
