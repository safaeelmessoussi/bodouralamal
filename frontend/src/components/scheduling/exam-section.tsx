import { useEffect, useState, type ReactNode } from 'react';

import { listAssessments, type AssessmentSummary, type TargetKind } from '../../adapters/assessments.js';
import { ScopeSelectors } from '../scope/scope-selectors.js';
import { DateField, NumberField, SearchInput, SelectField, TextField } from '../ui/field.js';
import { StaffPicker } from './staff-picker.js';
import { TARGET_LABELS, TargetPicker } from './target-picker.js';
import { t } from '../../i18n/index.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import type { ExamMode, ExamStaffRef } from '../../adapters/exams.js';
// The narrow directory entry — these render names, never account fields.
import type { DirectoryEntry } from '../../adapters/users.js';
import { Feedback } from '../ui/feedback.js';

/**
 * The fields a scheduled exam OCCURRENCE needs, physical or remote (§4.6 as
 * amended by R58, then unified by R136).
 *
 * Composed into `SchedulingForm` as a child, exactly as `ClassSection` and
 * `ActivitySection` are — which is the whole point of R56's shell: a third kind
 * contributes a section and nothing in the form, the recurrence editor, the list
 * or the calendar moves.
 *
 * ## `نوع الامتحان` is the first question, and now both answers stay here
 *
 * **R136 replaces the "عن بُعد يُبنى في بناء الاختبارات" pointer** with an
 * inline flow: pick an authored draft paper, its audience (R125's five
 * arms), and — remote only — when it opens to students. الجدولة's one حفظ
 * (`scheduleExam`, in `adapters/scheduling.ts`) assigns all of it and
 * schedules atomically; there is no separate "go build it, then come back
 * and publish" sequence any more.
 *
 * **Physical keeps its existing simple/grade-only workflow, unchanged.** An
 * authored physical source is optional per R136 and this section does not
 * yet offer one — every physical sitting created here is content-free, the
 * room/clock-window/supervisors arrangement R58 always was.
 *
 * ## The selectors are the shared dependent ones (R55)
 *
 * Branch → Level → Subject, with the room narrowed to the chosen branch and the
 * group to that Level at that branch. The server refuses every combination this
 * does not offer, so the form cannot express one it will be refused for.
 */
export type ExamAvailabilityChoice = 'manual' | 'at_start' | 'offset_minutes' | 'custom';

export interface OnlineExamState {
  sourceId: string;
  sourceTitle: string;
  sourceLevelId: string;
  targetKind: TargetKind;
  targetId: string;
  availabilityChoice: ExamAvailabilityChoice;
  offsetMinutes: '5' | '10' | '15';
  /** Wall-clock date/time as typed — الجدولة converts these to one ISO
   *  instant (the browser's own local clock) only for `policy: 'custom'`. */
  customDate: string;
  customTime: string;
}

export const ONLINE_EXAM_INITIAL: OnlineExamState = {
  sourceId: '',
  sourceTitle: '',
  sourceLevelId: '',
  targetKind: 'level',
  targetId: '',
  availabilityChoice: 'manual',
  offsetMinutes: '5',
  customDate: '',
  customTime: '',
};

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
  leadStaff?: DirectoryEntry[];
  leadLocked?: boolean;
  rooms: { id: string; name: string }[];
  roomId: string;
  onRoom: (v: string) => void;
  staff: DirectoryEntry[];
  supervisorId: string;
  onSupervisor: (v: string) => void;
  assistantIds: string[];
  onAssistants: (ids: string[]) => void;
  /** R81 — this exam's maximum grade, as typed. A string because the field is
   *  a text input: an empty one is *not yet answered*, which `0` is not.
   *  Physical only — a remote occurrence's maximum is the authored source's
   *  own, set once in بناء الاختبارات. */
  maxGrade: string;
  onMaxGrade: (v: string) => void;
  /** R136 — remote-only state: the authored source, its audience and its
   *  availability. One object, not eight prop pairs, because the fields are
   *  genuinely one cohesive group that only ever changes together. */
  online: OnlineExamState;
  onOnlineChange: (patch: Partial<OnlineExamState>) => void;
}

/** The staff array the API takes — one supervisor, any number of assistants. */
export function examStaffOf(supervisorId: string, assistantIds: string[]): ExamStaffRef[] {
  return [
    ...(supervisorId ? [{ user_id: supervisorId, position: 'supervisor' as const }] : []),
    ...assistantIds.map((id) => ({ user_id: id, position: 'assistant' as const })),
  ];
}

/**
 * **The remote paper selector** (R136) — search bounded to بناء الاختبارات's
 * own draft library, `mode: 'online'` only: a physical source has no
 * questions an occurrence would sit, and a paper already scheduled
 * (`status` past `draft`) is not offered again — the server's own
 * `SOURCE_ALREADY_SCHEDULED` refusal exists for exactly the id this list
 * never contains.
 */
function PaperPicker({
  value,
  onSelect,
}: {
  value: OnlineExamState;
  onSelect: (row: AssessmentSummary) => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<AssessmentSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    void listAssessments({ mode: 'online', ...(query ? { q: query } : {}), page_size: 20 }, null)
      .then((result) => {
        if (!live) return;
        setOptions(result.data);
        setState('ready');
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [query]);

  return (
    <>
      <SearchInput label={t('scheduling.exam.paperSearch')} value={query} onChange={setQuery} />
      <SelectField
        label={t('scheduling.exam.paper')}
        value={value.sourceId}
        onChange={(id) => {
          const row = options.find((o) => o.id === id);
          if (row) onSelect(row);
        }}
        required
        hint={
          state === 'ready' && options.length === 0
            ? t('scheduling.exam.paperNone')
            : t('scheduling.exam.paperHint')
        }
        options={[
          { value: '', label: t('common.choose') },
          ...(value.sourceId !== '' && !options.some((o) => o.id === value.sourceId)
            ? // The prefilled/currently-chosen paper may be outside this page's
              // 20 results (or off the current search term) — kept visible
              // rather than silently vanishing from the control.
              [{ value: value.sourceId, label: value.sourceTitle }]
            : []),
          ...options.map((o) => ({ value: o.id, label: o.title })),
        ]}
      />
    </>
  );
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
  online,
  onOnlineChange,
}: ExamSectionProps): ReactNode {
  const needsTargetId = online.targetKind !== 'level';
  const needsDate = online.targetKind !== 'session';

  return (
    <>
      <SelectField
        label={t('scheduling.exam.mode')}
        value={mode}
        onChange={(v) => onMode(v as ExamMode)}
        disabled={locked}
        options={[
          { value: 'physical', label: t('scheduling.exam.physical') },
          { value: 'online', label: t('scheduling.exam.online') },
        ]}
      />

      {mode === 'online' ? (
        <>
          {/* **R136 — content lives in بناء الاختبارات; this only SCHEDULES
              it.** A paper with no questions cannot be scheduled
              (`NO_QUESTIONS`) — written once here rather than duplicated as a
              client-side check that could disagree with the server's. */}
          <Feedback>
            {t('scheduling.exam.onlineHint')}{' '}
            <a href="/admin/assessments">{t('scheduling.exam.onlineGoToBuilder')}</a>
          </Feedback>
          <PaperPicker
            value={online}
            onSelect={(row) =>
              onOnlineChange({
                sourceId: row.id,
                sourceTitle: row.title,
                sourceLevelId: row.level_id,
                // A fresh pick starts the audience over — a stale target from
                // a PREVIOUSLY selected paper (a different Level, most often)
                // is not carried across.
                targetKind: 'level',
                targetId: '',
              })
            }
          />
          {online.sourceId !== '' ? (
            <>
              <SelectField
                label={t('assessments.target')}
                value={online.targetKind}
                onChange={(v) =>
                  onOnlineChange({ targetKind: v as TargetKind, targetId: '' })
                }
                options={(Object.keys(TARGET_LABELS) as TargetKind[]).map((k) => ({
                  value: k,
                  label: t(TARGET_LABELS[k]),
                }))}
              />
              {needsTargetId ? (
                <TargetPicker
                  kind={online.targetKind}
                  levelId={online.sourceLevelId}
                  value={online.targetId}
                  onChange={(id) => onOnlineChange({ targetId: id })}
                  error={null}
                />
              ) : null}
              {needsDate ? (
                // **The shared form's own date field, above, IS this
                // occurrence's date** (R136) — the same `startDate` a
                // physical sitting already uses, rendered by
                // `SchedulingForm` around this section rather than
                // duplicated here.
                <Feedback>{t('scheduling.exam.dateIsFormDate')}</Feedback>
              ) : (
                // A `session` target takes the occurrence's OWN date (R122):
                // asking for a second one would let the two disagree about
                // which day the audience is resolved for.
                <Feedback>{t('scheduling.exam.dateIsSessionDate')}</Feedback>
              )}
              <SelectField
                label={t('scheduling.exam.availability')}
                value={online.availabilityChoice}
                onChange={(v) => onOnlineChange({ availabilityChoice: v as ExamAvailabilityChoice })}
                hint={t('scheduling.exam.availabilityHint')}
                options={[
                  { value: 'manual', label: t('scheduling.exam.availabilityManual') },
                  { value: 'at_start', label: t('scheduling.exam.availabilityAtStart') },
                  { value: 'offset_minutes', label: t('scheduling.exam.availabilityOffset') },
                  { value: 'custom', label: t('scheduling.exam.availabilityCustom') },
                ]}
              />
              {online.availabilityChoice === 'offset_minutes' ? (
                <SelectField
                  label={t('scheduling.exam.offsetMinutes')}
                  value={online.offsetMinutes}
                  onChange={(v) => onOnlineChange({ offsetMinutes: v as '5' | '10' | '15' })}
                  options={[
                    { value: '5', label: t('scheduling.exam.offset5') },
                    { value: '10', label: t('scheduling.exam.offset10') },
                    { value: '15', label: t('scheduling.exam.offset15') },
                  ]}
                />
              ) : null}
              {online.availabilityChoice === 'custom' ? (
                <>
                  <DateField
                    label={t('scheduling.exam.customDate')}
                    value={online.customDate}
                    onChange={(v) => onOnlineChange({ customDate: v })}
                    required
                  />
                  <TextField
                    label={t('scheduling.exam.customTime')}
                    value={online.customTime}
                    onChange={(v) => onOnlineChange({ customTime: v })}
                    hint={t('scheduling.timeHint')}
                    required
                  />
                </>
              ) : null}
            </>
          ) : null}
        </>
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
