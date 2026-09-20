import type { ReactNode } from 'react';

import { ScopeSelectors } from '../scope/scope-selectors.js';
import {
  DeliverySection,
  type DeliveryMode,
  type OnlineMediaMode,
} from './delivery.js';
import { CheckboxField } from '../ui/field.js';
import { Feedback } from '../ui/feedback.js';
import { MultiSelectField } from '../ui/multi-select.js';
import {
  AudienceFilters,
  type AudienceChoices,
  type AudienceSelection,
  type AudienceSetters,
} from './audience-filters.js';
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
  /**
   * **How the class's audience is STORED — never a choice on screen** (SRS
   * Revision 163 §5). «نمط التدريس» is gone: an administrator always builds a
   * class from the five filters below (`multi_dimension`), a self-service
   * مؤطِّرة always schedules one whole Level (`entire_level`, the only shape her
   * grant covers — `TEACHER_ENTIRE_LEVEL_ONLY`), and a row being edited keeps
   * the mode it was created with, which decides only how its locked target is
   * shown.
   */
  mode: string;
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
  /**
   * **SRS §2 — a مؤطِّرة scheduling her own class is its teacher, structurally,
   * not a choice offered and then defaulted.** The server refuses any other
   * `staff` shape from her (`TEACHER_MUST_SELF_STAFF`), so `StaffingPeriods`'s
   * own multi-row, multi-person editor — built for an Admin naming a
   * replacement mid-year — would offer a form of picking somebody else that
   * always fails. A static statement replaces it, exactly as `ActivitySection`
   * already replaces a picker with a fixed fact for a مؤطرة's own event
   * (`responsibleLocked`).
   */
  staffLocked?: boolean;
  /**
   * **The five audience filters** (SRS Revision 155; the ONLY way an
   * administrator targets a class since Revision 163 §5). State, narrowing and
   * rendering all live in `audience-filters.tsx`, shared with the «from this
   * date onward» editor. Absent for a self-service مؤطِّرة and for a locked row.
   */
  audience?: {
    selection: AudienceSelection;
    setters: AudienceSetters;
    choices: AudienceChoices;
  };
}

export function ClassSection({
  scope,
  locked,
  mode,
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
  staffLocked,
  audience,
}: ClassSectionProps): ReactNode {
  return (
    <>
      {/* **`multi_dimension` replaces the single branch/Level pair with five
          independent multi-selects** (SRS Revision 155) — the real target
          lives in `dimensions`, not in `scope.value.branchId`/`levelId`.
          Every other mode is unaffected: the pair below is exactly what it
          always was. */}
      {mode === 'multi_dimension' && locked ? (
        /**
         * **Never re-editable, on the SAME §4.4 rule `ActivitySection`'s own
         * locked scope already states** (Owner-reported, 2026-09-16): the
         * five arrays are never seeded from the row being edited (matching
         * `ActivitySection`'s own "never on edit" — R139's rule, restated
         * here rather than re-derived), so five empty, disabled pickers
         * would look exactly like an audience nobody chose. Stated
         * plainly instead — the identical sentence Event's own locked
         * scope already uses.
         */
        <p className="muted">{t('admin.calendar.scopeFixed')}</p>
      ) : mode === 'multi_dimension' && audience ? (
        <AudienceFilters
          scope={scope}
          selection={audience.selection}
          setters={audience.setters}
          choices={audience.choices}
        />
      ) : (
        <ScopeSelectors
          scope={scope}
          fields={['branchId', 'levelId']}
          mode="form"
          locked={locked ? ['branchId', 'levelId'] : []}
        />
      )}

      {/* Only ever a LOCKED row now: a class created for one Administrative
          Group before Revision 163 still shows which one. */}
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
      {staffLocked ? (
        <Feedback>{t('admin.schedules.staffLockedToSelf')}</Feedback>
      ) : (
        <StaffingPeriods
          staff={teachers}
          value={staffing}
          onChange={onStaffing}
          {...(appraisal ? { appraisal } : {})}
          /* The class's own life, so an assignment outside it is marked as it
             is typed — and re-marked the moment these dates are edited. */
          scheduleFrom={scheduleFrom}
          scheduleUntil={scheduleUntil}
        />
      )}
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
 * **Each dimension is its own independent, optional control** (Owner-reported,
 * 2026-09-14 — replacing the single "choose ONE kind" selector this file used
 * to have). `EventScopes` (`event.service.ts`) has always accepted an array
 * per dimension and the audience-matching read has always UNIONed them
 * (`OR`, `calendar.service.ts`) — an event reaches someone whose branch, OR
 * category, OR Level, OR group matches ANY chosen dimension. Only the form
 * ever forced a single choice, which is what made picking "this branch AND
 * that category" impossible to express, and — for a caller whose allowed
 * dimensions did not include the ONE kind the control defaulted to
 * (`'global'` regardless of type) — made the picker default to a value with
 * no matching `<option>`, silently showing nothing until the reader
 * happened to reselect it (the exact defect reported).
 */
export type ScopeDimensionKey = 'branch' | 'category' | 'level' | 'group';

const DIMENSION_LABEL_KEYS: Record<ScopeDimensionKey, string> = {
  branch: 'admin.calendar.scopeBranch',
  category: 'admin.calendar.scopeCategory',
  level: 'admin.calendar.scopeLevel',
  group: 'admin.calendar.scopeGroup',
};

/** §4.4's four scopes, all independently optional. */
export const ALL_SCOPE_DIMENSIONS: readonly ScopeDimensionKey[] = [
  'branch',
  'category',
  'level',
  'group',
];

/**
 * **A عطلة is scoped to الفرع and الفئة, and to nothing else** (Owner,
 * 2026-08-28). It is a period on which nothing is delivered, so «this Level» or
 * «this group» would be describing an audience a holiday does not have — and
 * the server refuses them (`HOLIDAY_SHAPE`), so this list is the affordance
 * agreeing with the rule rather than the rule itself.
 */
export const HOLIDAY_SCOPE_DIMENSIONS: readonly ScopeDimensionKey[] = ['branch', 'category'];

/** R72 — a Teacher may scope an event to their own Administrative Groups and
 *  to nothing else, so this is the whole list they are offered. */
export const TEACHER_SCOPE_DIMENSIONS: readonly ScopeDimensionKey[] = ['group'];

/** One dimension's own selection, options and setter — `ActivitySection`
 *  renders one independent `MultiSelectField` per entry in `dimensions`. */
export interface ScopeDimensionValue {
  selected: readonly string[];
  onChange: (next: string[]) => void;
  options: { id: string; name: string }[];
}

/**
 * **R109/NEW B §D — the tier moved OUT of this section.**
 *
 * It lived here because نشاط was the only kind that had one. R109 gave a حصة and
 * an امتحان a tier too, so it now renders once in `SchedulingForm` for every
 * kind — one control rather than three that would drift.
 */
export function ActivitySection({
  dimensions,
  values,
  allowGlobal,
  global,
  onGlobal,
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
  hideStaffing = false,
}: {
  /** R72 — the dimensions this caller may fill. A Teacher gets `group` and
   *  only `group`: §4.9 and TD-2 forbid them a branch, category or Level, so
   *  offering those would offer a refusal. */
  dimensions: readonly ScopeDimensionKey[];
  /** One entry per key in `dimensions` — a دimension absent from `dimensions`
   *  is never read, so a caller need not populate one it does not offer. */
  values: Record<ScopeDimensionKey, ScopeDimensionValue>;
  /** Whether "association-wide" is offered at all (Admin/Super Admin on a
   *  non-holiday item only — R139 defines it as every branch a scoped actor
   *  is permitted, never a wider reach than she already has). */
  allowGlobal: boolean;
  global: boolean;
  onGlobal: (v: boolean) => void;
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
  /**
   * **R137 — عطلة has no responsible/assistant staff at all** (Owner,
   * 2026-09-09): a holiday is not an activity somebody runs. Not merely
   * `disabled`, which would still submit whatever the control held —
   * removed from the tree entirely, so there is nothing to submit.
   */
  hideStaffing?: boolean;
}): ReactNode {
  return (
    <>
      {locked ? (
        <p className="muted">{t('admin.calendar.scopeFixed')}</p>
      ) : (
        <>
          {/* **"Platform-wide" and "all my branches" are one control**
              (R139), because the server already tells them apart correctly
              — a branch-scoped actor's own `global` choice never reaches
              further than her own branches (`resolveBranches`,
              `event.service.ts`). A checkbox rather than a fifth dimension:
              choosing it is mutually exclusive with every dimension below
              (the server refuses `global` alongside `branch_ids`), so it
              stands apart rather than beside them. */}
          {allowGlobal ? (
            <CheckboxField
              label={t('admin.calendar.scopeGlobal')}
              checked={global}
              onChange={onGlobal}
              hint={t('admin.calendar.scopeGlobalHint')}
            />
          ) : null}
          {global ? null : (
            <>
              {dimensions.map((key) => {
                const value = values[key];
                return (
                  <MultiSelectField
                    key={key}
                    label={t(DIMENSION_LABEL_KEYS[key])}
                    selected={value.selected}
                    onChange={value.onChange}
                    options={value.options.map((o) => ({ value: o.id, label: o.name }))}
                    emptyLabel={t('admin.calendar.scopeTargetEmpty')}
                  />
                );
              })}
              {/* **The "all Levels within these branches" reading, stated
                  rather than left implicit** (R139). True whenever branches
                  are chosen and shown once, beside the branch picker itself,
                  regardless of what any OTHER dimension separately carries —
                  every dimension here is UNIONed, never narrowed by another. */}
              {dimensions.includes('branch') && values.branch.selected.length > 0 ? (
                <Feedback>{t('admin.calendar.scopeAllLevelsHint')}</Feedback>
              ) : null}
            </>
          )}
        </>
      )}

      {/* R71 — who answers for it. Rendered on edit as well as creation,
          because staffing is a decision an Admin revisits: the responsible
          مؤطرة changes without the celebration changing.
          **R137 — never rendered for عطلة** (`hideStaffing`): a holiday has
          no responsible/assistant staff, and an admin filling this in only to
          be refused at save time (`HOLIDAY_SHAPE`) is the exact mismatch this
          closes. */}
      {hideStaffing ? null : (
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
      )}
    </>
  );
}
