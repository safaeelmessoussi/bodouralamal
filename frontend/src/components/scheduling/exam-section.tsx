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
 * ## `نوع الامتحان` is the first question, and both delivery modes stay here
 *
 * **R136 replaces the "عن بُعد يُبنى في بناء الاختبارات" pointer** with an
 * inline flow: pick an authored draft paper, its audience (R125's five
 * arms, remote only), and — remote only — when it opens to students.
 * الجدولة's one حفظ (`scheduleExam`, in `adapters/scheduling.ts`) assigns
 * all of it and schedules atomically; there is no separate "go build it,
 * then come back and publish" sequence any more.
 *
 * **Physical keeps BOTH its workflows** (R136, frontend-completion pass —
 * ratified and completed here). An authored physical source is optional:
 * omitted, the sitting stays exactly the content-free, grade-only
 * arrangement R58 always was; chosen, الجدولة copies it into the occurrence
 * exactly as a remote source is copied, and the source's own title,
 * description, maximum, Level, Subject and Year travel with it — a physical
 * sitting scheduled from authored content is not independently re-classified
 * by this form. Copying questions onto a physical occurrence creates no
 * Student-facing interactive submission lifecycle; a physical sitting is
 * still marked the way §4.6 always marked one, from the paper as printed.
 *
 * ## The selectors are the shared dependent ones (R55)
 *
 * Branch → Room, independent of any source (a physical sitting always
 * happens somewhere real); Level → Subject → Year come from the source when
 * one is chosen, and from the ordinary curriculum chain otherwise.
 */
export type ExamAvailabilityChoice = 'manual' | 'at_start' | 'offset_minutes' | 'custom';

export interface ExamSourceState {
  sourceId: string;
  sourceTitle: string;
  sourceLevelId: string;
  /** Remote only — see the arm-by-arm reasoning on `ExamSection` itself. */
  targetKind: TargetKind;
  targetId: string;
  availabilityChoice: ExamAvailabilityChoice;
  offsetMinutes: '5' | '10' | '15';
  /** Wall-clock date/time as typed — الجدولة converts these to one ISO
   *  instant (the browser's own local clock) only for `policy: 'custom'`. */
  customDate: string;
  customTime: string;
}

export const EXAM_SOURCE_INITIAL: ExamSourceState = {
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
  /** **Found by real-browser verification** (`verify-exam-scheduling.mjs`,
   *  frontend-completion pass): `PaperPicker`'s own search hard-coded a
   *  `null` token, so `GET /assessments` — an authenticated, per-author-
   *  scoped endpoint — answered `401` for every fresh search and the picker
   *  showed nothing beyond whatever a `?source=&mode=` URL prefill had
   *  already resolved through the unrelated `readAuthorPaper` call. Choosing
   *  ANY paper by typing, remote or physical, was unreachable. */
  token: string | null;
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
   *  Read only while an authored source (either mode) is chosen — the
   *  maximum is then the source's own, copied with it. */
  maxGrade: string;
  onMaxGrade: (v: string) => void;
  /** R136 — the authored source, its audience and its availability. One
   *  object, not eight prop pairs, because the fields are genuinely one
   *  cohesive group that only ever changes together. Shared by both
   *  delivery modes; a physical source uses only `sourceId`/`sourceTitle`/
   *  `sourceLevelId` and leaves the remote-only fields at their initial
   *  values. */
  source: ExamSourceState;
  onSourceChange: (patch: Partial<ExamSourceState>) => void;
}

/** The staff array the API takes — one supervisor, any number of assistants. */
export function examStaffOf(supervisorId: string, assistantIds: string[]): ExamStaffRef[] {
  return [
    ...(supervisorId ? [{ user_id: supervisorId, position: 'supervisor' as const }] : []),
    ...assistantIds.map((id) => ({ user_id: id, position: 'assistant' as const })),
  ];
}

/**
 * **The authored paper selector** (R136) — search bounded to بناء
 * الاختبارات's own draft library, scoped to the mode being scheduled: a
 * physical sitting cannot copy a remote paper's questions into a room, and
 * an online occurrence always needs authored content (R136 clause 11/14).
 * A paper already scheduled (`status` past `draft`) is never offered again —
 * the server's own `SOURCE_ALREADY_SCHEDULED` refusal exists for exactly
 * the id this list never contains.
 *
 * **Optional for a physical sitting, required for a remote one** — `clear`
 * offers the content-free physical path back once a source was chosen and
 * then reconsidered; it renders only where clearing makes sense.
 */
function PaperPicker({
  mode,
  token,
  value,
  onSelect,
  onClear,
  required,
}: {
  mode: ExamMode;
  token: string | null;
  value: ExamSourceState;
  onSelect: (row: AssessmentSummary) => void;
  onClear?: () => void;
  required: boolean;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<AssessmentSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    void listAssessments({ mode, ...(query ? { q: query } : {}), page_size: 20 }, token)
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
  }, [mode, query, token]);

  return (
    <>
      <SearchInput label={t('scheduling.exam.paperSearch')} value={query} onChange={setQuery} />
      <SelectField
        label={t('scheduling.exam.paper')}
        value={value.sourceId}
        onChange={(id) => {
          if (id === '') {
            onClear?.();
            return;
          }
          const row = options.find((o) => o.id === id);
          if (row) onSelect(row);
        }}
        required={required}
        hint={
          state === 'ready' && options.length === 0
            ? t('scheduling.exam.paperNone')
            : required
              ? t('scheduling.exam.paperHint')
              : t('scheduling.exam.paperHintOptional')
        }
        options={[
          {
            value: '',
            label: required ? t('common.choose') : t('scheduling.exam.paperNoneOption'),
          },
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
  token,
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
  source,
  onSourceChange,
}: ExamSectionProps): ReactNode {
  const needsTargetId = source.targetKind !== 'level';
  const needsDate = source.targetKind !== 'session';
  const hasSource = source.sourceId !== '';

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
            mode="online"
            token={token}
            required
            value={source}
            onSelect={(row) =>
              onSourceChange({
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
          {hasSource ? (
            <>
              <SelectField
                label={t('assessments.target')}
                value={source.targetKind}
                onChange={(v) =>
                  onSourceChange({ targetKind: v as TargetKind, targetId: '' })
                }
                options={(Object.keys(TARGET_LABELS) as TargetKind[]).map((k) => ({
                  value: k,
                  label: t(TARGET_LABELS[k]),
                }))}
              />
              {needsTargetId ? (
                <TargetPicker
                  kind={source.targetKind}
                  levelId={source.sourceLevelId}
                  value={source.targetId}
                  onChange={(id) => onSourceChange({ targetId: id })}
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
                value={source.availabilityChoice}
                onChange={(v) => onSourceChange({ availabilityChoice: v as ExamAvailabilityChoice })}
                hint={t('scheduling.exam.availabilityHint')}
                options={[
                  { value: 'manual', label: t('scheduling.exam.availabilityManual') },
                  { value: 'at_start', label: t('scheduling.exam.availabilityAtStart') },
                  { value: 'offset_minutes', label: t('scheduling.exam.availabilityOffset') },
                  { value: 'custom', label: t('scheduling.exam.availabilityCustom') },
                ]}
              />
              {source.availabilityChoice === 'offset_minutes' ? (
                <SelectField
                  label={t('scheduling.exam.offsetMinutes')}
                  value={source.offsetMinutes}
                  onChange={(v) => onSourceChange({ offsetMinutes: v as '5' | '10' | '15' })}
                  options={[
                    { value: '5', label: t('scheduling.exam.offset5') },
                    { value: '10', label: t('scheduling.exam.offset10') },
                    { value: '15', label: t('scheduling.exam.offset15') },
                  ]}
                />
              ) : null}
              {source.availabilityChoice === 'custom' ? (
                <>
                  <DateField
                    label={t('scheduling.exam.customDate')}
                    value={source.customDate}
                    onChange={(v) => onSourceChange({ customDate: v })}
                    required
                  />
                  <TextField
                    label={t('scheduling.exam.customTime')}
                    value={source.customTime}
                    onChange={(v) => onSourceChange({ customTime: v })}
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
          {/**
           * **R136 (frontend-completion pass) — an authored physical source
           * is optional, and BOTH physical workflows stay real.** Chosen,
           * its title/description/maximum/Level/Subject/Year travel to the
           * occurrence with it (`scheduleExam`'s copy, unchanged from the
           * remote path) — so those fields become the source's own, shown
           * rather than re-asked, and only Branch/Room/staff/times/audience
           * stay independently chosen here, exactly as they always were.
           * Left empty, nothing changes from the sitting R58 always built.
           */}
          <PaperPicker
            mode="physical"
            token={token}
            required={false}
            value={source}
            onSelect={(row) => {
              onSourceChange({
                sourceId: row.id,
                sourceTitle: row.title,
                sourceLevelId: row.level_id,
              });
              // The audience picker below is scoped by `scope.value.levelId`
              // (unchanged mechanism); a chosen source's own Level is what
              // that audience must now be drawn from.
              scope.set('levelId', row.level_id);
            }}
            onClear={() => {
              onSourceChange({ sourceId: '', sourceTitle: '', sourceLevelId: '' });
              scope.set('levelId', '');
            }}
          />

          {hasSource ? (
            <p className="hint">
              {t('scheduling.exam.sourceSummary')
                .replace('{title}', source.sourceTitle)}
            </p>
          ) : null}

          {/* **Hidden when the caller named a class instead** (R94): the chain
              below reads `/admin/levels`, which answers 403 for a مؤطرة, so
              rendering it for her would be four selectors that cannot fill.
              **Level/Subject/Year are hidden once a source is chosen** — they
              travel with the copied content and are no longer independently
              set here (Branch is not: a physical sitting always needs a real
              place, source or not). */}
          {hideScope ? null : (
            <ScopeSelectors
              scope={scope}
              fields={
                hasSource
                  ? ['branchId']
                  : ['branchId', 'levelId', 'subjectId', 'academicYearId']
              }
              mode="form"
              locked={
                locked
                  ? hasSource
                    ? ['branchId']
                    : ['branchId', 'levelId', 'subjectId', 'academicYearId']
                  : []
              }
            />
          )}

          {/* **R81 — every exam states what its marks are out of.** Required,
              because a sitting whose maximum is unknown cannot be marked at
              all; editable afterwards, because a typo here would otherwise
              strand every score on the exam — and the server refuses a maximum
              below a mark already recorded rather than clamping anybody's
              result. Not locked with the identity fields: the maximum does not
              change *what is examined, for whom, or where*. **Hidden with a
              source chosen** — the maximum is then the source's own paper's,
              copied with it, not independently set here. */}
          {hasSource ? null : (
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
          )}

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
