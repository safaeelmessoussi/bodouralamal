import type { ReactNode } from 'react';

import { ScopeSelectors } from '../scope/scope-selectors.js';
import { SelectField } from '../ui/field.js';
import { t } from '../../i18n/index.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import type { ExamMode, ExamStaffRef } from '../../adapters/exams.js';
import type { UserSummary } from '../../adapters/users.js';

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
  rooms: { id: string; name: string }[];
  roomId: string;
  onRoom: (v: string) => void;
  staff: UserSummary[];
  supervisorId: string;
  onSupervisor: (v: string) => void;
  assistantIds: string[];
  onAssistants: (ids: string[]) => void;
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
  rooms,
  roomId,
  onRoom,
  staff,
  supervisorId,
  onSupervisor,
  assistantIds,
  onAssistants,
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
        <p className="admin-notice" role="status">
          {t('scheduling.exam.onlineSoon')}
        </p>
      ) : (
        <>
          <ScopeSelectors
            scope={scope}
            fields={['branchId', 'levelId', 'subjectId', 'academicYearId']}
            mode="form"
            locked={locked ? ['branchId', 'levelId', 'subjectId', 'academicYearId'] : []}
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

          {/* §4.6 exam staff **supervise**; they do not teach. The vocabulary is
              deliberately different from a class's teacher and assistants,
              because the roles are different facts about a different event. */}
          <SelectField
            label={t('scheduling.exam.supervisor')}
            value={supervisorId}
            onChange={onSupervisor}
            options={[
              { value: '', label: t('common.choose') },
              ...staff.map((x) => ({ value: x.id, label: x.name_arabic })),
            ]}
          />

          <fieldset className="field">
            <legend className="field__label">{t('scheduling.exam.assistants')}</legend>
            <div className="field__choices">
              {staff
                // One person holds one position on one exam; the server refuses
                // the pair as a duplicate assignment.
                .filter((x) => x.id !== supervisorId)
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
            <p className="field__hint">{t('scheduling.exam.assistantsHint')}</p>
          </fieldset>
        </>
      )}
    </>
  );
}
