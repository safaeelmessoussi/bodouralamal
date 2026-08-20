import type { ReactNode } from 'react';

import { ScopeSelectors } from '../scope/scope-selectors.js';
import { NumberField, SelectField } from '../ui/field.js';
import { StaffPicker } from './staff-picker.js';
import { t } from '../../i18n/index.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import type { ExamMode, ExamStaffRef } from '../../adapters/exams.js';
import type { UserSummary } from '../../adapters/users.js';
import { Feedback } from '../ui/feedback.js';

/**
 * The fields a **physical exam sitting** needs (§4.6 as amended by R58).
 *
 * Composed into `SchedulingForm` as a child, exactly as `ClassSection` and
 * `ActivitySection` are — which is the whole point of R56's shell: a third kind
 * contributes a section and nothing in the form, the recurrence editor, the list
 * or the calendar moves.
 *
 * ## `نوع الامتحان` is the first question
 *
 * `حضوري` is built; `عن بُعد` is **offered and disabled, with its reason
 * stated** (§14.4 — a blocked capability says why rather than vanishing). An
 * administrator can see that online exams are planned and cannot create one,
 * which is precisely the state the platform is in.
 *
 * **No online field appears here at all.** When that mode arrives it needs an
 * exam link, a selected-student audience, an opening and closing window, access
 * rules and submission settings — and rendering any of them now, disabled, would
 * promise a shape nobody has decided.
 *
 * ## The selectors are the shared dependent ones (R55)
 *
 * Branch → Level → Subject, with the room narrowed to the chosen branch and the
 * group to that Level at that branch. The server refuses every combination this
 * does not offer, so the form cannot express one it will be refused for.
 */
export interface ExamSectionProps {
  mode: ExamMode;
  onMode: (next: ExamMode) => void;
  scope: ScopeOptions;
  /** The identity fields are set at creation and refused on edit: each would
   *  change *what is examined, for whom, or where* while keeping the grades
   *  already recorded against the old answer (§4.4's reasoning). */
  locked: boolean;
  /** True when the scope came from elsewhere — a مؤطرة names one of her own
   *  classes, which already states the Level, Subject, Branch and Year. */
  hideScope?: boolean;
  /** Narrower than `staff` when the caller may only supervise her own sitting. */
  leadStaff?: UserSummary[];
  leadLocked?: boolean;
  rooms: { id: string; name: string }[];
  roomId: string;
  onRoom: (v: string) => void;
  staff: UserSummary[];
  supervisorId: string;
  onSupervisor: (v: string) => void;
  assistantIds: string[];
  onAssistants: (ids: string[]) => void;
  /** R81 — this exam's maximum grade, as typed. A string because the field is
   *  a text input: an empty one is *not yet answered*, which `0` is not. */
  maxGrade: string;
  onMaxGrade: (v: string) => void;
}

/** The staff array the API takes — one supervisor, any number of assistants. */
export function examStaffOf(supervisorId: string, assistantIds: string[]): ExamStaffRef[] {
  return [
    ...(supervisorId ? [{ user_id: supervisorId, position: 'supervisor' as const }] : []),
    ...assistantIds.map((id) => ({ user_id: id, position: 'assistant' as const })),
  ];
}

export function ExamSection({
  mode,
  onMode,
  scope,
  locked,
  hideScope = false,
  leadStaff,
  leadLocked = false,
  rooms,
  roomId,
  onRoom,
  staff,
  supervisorId,
  onSupervisor,
  assistantIds,
  onAssistants,
  maxGrade,
  onMaxGrade,
}: ExamSectionProps): ReactNode {
  return (
    <>
      <SelectField
        label={t('scheduling.exam.mode')}
        value={mode}
        onChange={(v) => onMode(v as ExamMode)}
        disabled={locked}
        hint={mode === 'online' ? t('scheduling.exam.onlineSoon') : undefined}
        options={[
          { value: 'physical', label: t('scheduling.exam.physical') },
          // Visible so the roadmap is legible exactly where somebody looks for
          // it; the option is never selectable, and the server refuses it too.
          { value: 'online', label: `${t('scheduling.exam.online')} — ${t('scheduling.exam.soon')}` },
        ]}
      />

      {/* Nothing online is rendered, disabled or otherwise: an exam link, a
          student audience, an open/close window and submission settings are a
          shape nobody has decided yet, and showing them would promise it. */}
      {mode === 'online' ? (
        <Feedback>
          {t('scheduling.exam.onlineSoon')}
        </Feedback>
      ) : (
        <>
          {/* **Hidden when the caller named a class instead** (R94): the chain
              below reads `/admin/levels`, which answers 403 for a مؤطرة, so
              rendering it for her would be four selectors that cannot fill. */}
          {hideScope ? null : (
            <ScopeSelectors
              scope={scope}
              fields={['branchId', 'levelId', 'subjectId', 'academicYearId']}
              mode="form"
              locked={locked ? ['branchId', 'levelId', 'subjectId', 'academicYearId'] : []}
            />
          )}

          {/* **R81 — every exam states what its marks are out of.** Required,
              because a sitting whose maximum is unknown cannot be marked at
              all; editable afterwards, because a typo here would otherwise
              strand every score on the exam — and the server refuses a maximum
              below a mark already recorded rather than clamping anybody's
              result. Not locked with the identity fields: the maximum does not
              change *what is examined, for whom, or where*. */}
          <NumberField
            label={t('scheduling.exam.maxGrade')}
            hint={t('scheduling.exam.maxGradeHint')}
            required
            min={0.01}
            max={9999.99}
            step="0.01"
            value={maxGrade}
            onChange={onMaxGrade}
          />

          {/* **Optional, and its emptiness means something**: no group is the
              whole Level sitting together (R58), not a missing answer. */}
          <ScopeSelectors scope={scope} fields={['groupId']} mode="filter" />

          <SelectField
            label={t('admin.schedules.room')}
            value={roomId}
            onChange={onRoom}
            disabled={scope.value.branchId === ''}
            options={[
              {
                value: '',
                label:
                  scope.value.branchId === ''
                    ? t('scheduling.exam.chooseBranchFirst')
                    : t('common.choose'),
              },
              ...rooms.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />

          {/* §4.6 exam staff **supervise**; they do not teach. The vocabulary
              is deliberately different from a class's teacher and assistants,
              because the roles are different facts about a different event —
              which is why `StaffPicker` takes the words and owns only the
              control (R71's extraction). */}
          <StaffPicker
            staff={staff}
            /**
             * **A مؤطرة supervises her own sitting** (R94), for the same reason
             * she answers for her own event: the list she is offered is the
             * list the server accepts, and `assertExamInTeacherScope` refuses
             * anything else regardless.
             */
            {...(leadStaff ? { leadStaff } : {})}
            leadLocked={leadLocked}
            leadLabel={t('scheduling.exam.supervisor')}
            leadId={supervisorId}
            onLead={onSupervisor}
            assistantsLabel={t('scheduling.exam.assistants')}
            assistantsHint={t('scheduling.exam.assistantsHint')}
            assistantIds={assistantIds}
            onAssistants={onAssistants}
          />
        </>
      )}
    </>
  );
}
