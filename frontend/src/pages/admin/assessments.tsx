import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  addQuestion,
  closeAssessment,
  createAssessment,
  listAssessmentTargets,
  listSubmissions,
  publishAssessment,
  readAuthorPaper,
  readSubmission,
  removeQuestion,
  reorderQuestions,
  type AssessmentPaper,
  type JustificationRule,
  type QuestionKind,
  type SubmissionRow,
  type TargetKind,
} from '../../adapters/assessments.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ScopeSelectors } from '../../components/scope/scope-selectors.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type TableStatus } from '../../components/ui/data-table.js';
import {
  DateField,
  SearchInput,
  SelectField,
  TextArea,
  TextField,
} from '../../components/ui/field.js';
import { Feedback } from '../../components/ui/feedback.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { useScopeOptions } from '../../hooks/use-scope-options.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { isDirty } from '../../lib/form-dirty.js';

/**
 * **بناء الاختبارات — the question builder** (SRS §4.6, R124).
 *
 * ## One builder, two products
 *
 * A formal online exam and a quick test on one class are the same paper with a
 * different **target**; there is no second builder and no second table. The
 * distinction the Owner asked about is `target_kind`, resolved server-side
 * through the one definition of *who is this for* (§4.4c).
 *
 * ## Deliberately not a form designer
 *
 * Four question kinds, up/down reordering, and no drag-and-drop — the platform
 * has no reusable drag component, and adding a library for one screen is the
 * kind of dependency this project does not take (§14.3). No rich text, no
 * images, no branching, no timers: v1 is a paper, not Google Forms.
 *
 * ## Grading is elsewhere, on purpose
 *
 * The mark is entered on «نقاط الامتحانات» — the same sheet every other exam
 * uses — because `Grade` is keyed to this row and already carries the scale,
 * the draft/published split and the student's results screen. A second grading
 * surface here would be a second answer to *what did she score*.
 */
const KIND_LABELS: Record<QuestionKind, string> = {
  short_text: 'assessments.kindShortText',
  long_text: 'assessments.kindLongText',
  single_choice: 'assessments.kindSingleChoice',
  multiple_choice: 'assessments.kindMultipleChoice',
};

const JUSTIFICATION_LABELS: Record<JustificationRule, string> = {
  none: 'assessments.justificationNone',
  optional: 'assessments.justificationOptional',
  required: 'assessments.justificationRequired',
};

const TARGET_LABELS: Record<TargetKind, string> = {
  level: 'assessments.targetLevel',
  administrative_group: 'assessments.targetGroup',
  session: 'assessments.targetSession',
  teaching_group: 'assessments.targetTeachingGroup',
  student: 'assessments.targetStudent',
};

const SCOPE_FIELDS = ['levelId', 'subjectId', 'academicYearId'] as const;
/**
 * **Everything but the Level, for a `level` target.**
 *
 * R125 withholds a Level whose audience escapes a branch-scoped Admin's
 * branches — and the ordinary scope selector lists every Level, so leaving it in
 * charge would offer her one and refuse it at save. On the other arms the Level
 * is not the audience (a group at her own branch inside a Level that spans two
 * is perfectly legitimate), so it stays the ordinary selector there.
 */
const SCOPE_FIELDS_WITHOUT_LEVEL = ['subjectId', 'academicYearId'] as const;

/**
 * **The builder's body, without a frame** (R124).
 *
 * `/admin/assessments` and `/teacher/assessments` render THIS, each inside its
 * own portal chrome — the `GradeSheetView` pattern R70.1 established, and for
 * the reason it gives: one implementation, two ways in. The first version of the
 * teacher route reused the whole page, which dragged `AdminLayout` — and with it
 * the back-office sidebar — into the teaching portal. A browser check caught it;
 * a unit test could not have, because both frames render.
 */
export function AssessmentsView({
  examId,
  layout,
}: {
  examId: string | null;
  /** The portal's own chrome. Each caller passes its own; this component has none. */
  layout: (props: { title: string; actions: ReactNode; children: ReactNode }) => ReactNode;
}): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  const canWrite = activeRoles.some((r) => ['admin', 'super_admin', 'teacher'].includes(r));

  if (examId !== null) {
    return <OnePaper examId={examId} token={accessToken} canWrite={canWrite} layout={layout} />;
  }
  return <NewPaper token={accessToken} canWrite={canWrite} layout={layout} />;
}

/** `/admin/assessments` — the builder in the back-office chrome. */
export function AssessmentsPage({ examId }: { examId: string | null }): ReactNode {
  return (
    <AssessmentsView
      examId={examId}
      layout={({ title, actions, children }) => (
        <AdminLayout title={title} lede={t('assessments.lede')} actions={actions}>
          {children}
        </AdminLayout>
      )}
    />
  );
}

type PortalLayout = (props: {
  title: string;
  actions: ReactNode;
  children: ReactNode;
}) => ReactNode;

/** The create form. Once it saves, the page moves to `?exam=` and the builder. */
function NewPaper({
  token,
  canWrite,
  layout,
}: {
  token: string | null;
  canWrite: boolean;
  layout: PortalLayout;
}): ReactNode {
  const scope = useScopeOptions({ token, fields: SCOPE_FIELDS, mode: 'form' });
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return layout({
    title: t('assessments.title'),
    actions: canWrite ? (
      <Button variant="add" onClick={() => setOpen(true)}>
        {t('assessments.create')}
      </Button>
    ) : null,
    children: (
      <>
        {notice ? <Feedback tone="warn">{notice}</Feedback> : null}
        <p className="hint">{t('assessments.grading')}</p>
        {open ? (
          <CreateDialog
            scope={scope}
            token={token}
            onCancel={() => setOpen(false)}
            onFailed={() => setNotice(t('assessments.createFailed'))}
          />
        ) : null}
      </>
    ),
  });
}

/**
 * **The target picker** (R125) — one control set for all four arms.
 *
 * **Composed from the shared primitives**, not a new picker: `SearchInput` to
 * narrow and `SelectField` to choose, which is the pair `attendance-panel`
 * already uses to add a beneficiary. A bespoke combobox would be a second
 * generic picker for the platform to keep in step.
 *
 * **The list is server-scoped and is not the boundary.** A مؤطِّرة is offered the
 * students she teaches and the occurrences she staffs; an Admin what stays
 * inside her branches. Naming an id the list never contained is refused again on
 * the write — this exists so an author is not shown a target that would be
 * refused, which is the opposite of deciding the permission here (rule O).
 */
function TargetPicker({
  kind,
  levelId,
  value,
  onChange,
  error,
}: {
  kind: TargetKind;
  levelId: string;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
}): ReactNode {
  const { accessToken } = useSession();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    void listAssessmentTargets(
      kind,
      { ...(levelId ? { levelId } : {}), ...(query ? { q: query } : {}) },
      accessToken,
    )
      .then((rows) => {
        if (!live) return;
        setOptions(rows);
        setState('ready');
        // A chosen id that the narrowed list no longer offers is cleared rather
        // than left behind — a stale selection is what reaches the server as a
        // target the author can no longer see.
        if (value !== '' && !rows.some((r) => r.id === value)) onChange('');
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
    // `onChange` and `value` are deliberately absent from the dependency list:
    // this reloads when the QUESTION changes, not when the answer does. Adding
    // them would refetch on every keystroke of a selection.
  }, [kind, levelId, query, accessToken]);

  return (
    <>
      <SearchInput label={t('assessments.targetSearch')} value={query} onChange={setQuery} />
      <SelectField
        label={t('assessments.targetPick')}
        value={value}
        onChange={onChange}
        required
        error={error}
        hint={
          state === 'ready' && options.length === 0
            ? t('assessments.targetNone')
            : t('assessments.targetHint')
        }
        options={[
          { value: '', label: t('common.notSet') },
          ...options.map((o) => ({ value: o.id, label: o.label })),
        ]}
      />
    </>
  );
}

function CreateDialog({
  scope,
  token,
  onCancel,
  onFailed,
}: {
  scope: ReturnType<typeof useScopeOptions>;
  token: string | null;
  onCancel: () => void;
  onFailed: () => void;
}): ReactNode {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [maxGrade, setMaxGrade] = useState('20');
  const [targetKind, setTargetKind] = useState<TargetKind>('level');
  const [targetId, setTargetId] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  // A `session` target takes the occurrence's own date; asking for a second one
  // would let the two disagree about which day the audience is resolved for.
  const needsDate = targetKind !== 'session';
  const needsId = targetKind !== 'level';
  const error =
    title.trim() === '' || scope.value.levelId === ''
      ? t('common.required')
      : needsDate && date === ''
        ? t('common.required')
        : needsId && targetId.trim() === ''
          ? t('common.required')
          : null;

  const dirty = isDirty(
    { title, description, maxGrade, targetKind, targetId, date },
    { title: '', description: '', maxGrade: '20', targetKind: 'level', targetId: '', date: '' },
  );

  async function submit(): Promise<void> {
    setTouched(true);
    if (error) return;
    setBusy(true);
    try {
      const created = await createAssessment(
        {
          title: title.trim(),
          description: description.trim() || null,
          max_grade: Number(maxGrade),
          level_id: scope.value.levelId,
          ...(scope.value.subjectId ? { subject_id: scope.value.subjectId } : {}),
          ...(scope.value.academicYearId ? { academic_year_id: scope.value.academicYearId } : {}),
          target: { kind: targetKind, ...(needsId ? { id: targetId.trim() } : {}) },
          ...(needsDate ? { date } : {}),
        },
        token,
      );
      // The builder is the same page with the id in the URL — the `?exam=`
      // pattern «نقاط الامتحانات» already uses.
      window.location.assign(`/admin/assessments?exam=${created.id}`);
    } catch {
      onFailed();
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={() => void submit()}
      title={t('assessments.create')}
      busy={busy}
      dirty={dirty}
    >
      <TextField
        label={t('assessments.name')}
        value={title}
        onChange={setTitle}
        required
        error={touched && title.trim() === '' ? t('common.required') : null}
      />
      <TextArea
        label={t('assessments.description')}
        value={description}
        onChange={setDescription}
      />
      <TextField label={t('assessments.maxGrade')} value={maxGrade} onChange={setMaxGrade} required />

      {targetKind === 'level' ? (
        <>
          {/* The Level IS the audience here, so it comes from the scoped list
              rather than from the full curriculum (R125). */}
          <TargetPicker
            kind="level"
            levelId=""
            value={scope.value.levelId}
            onChange={(next) => scope.set('levelId', next)}
            error={touched && scope.value.levelId === '' ? t('common.required') : null}
          />
          <ScopeSelectors scope={scope} fields={SCOPE_FIELDS_WITHOUT_LEVEL} mode="form" />
        </>
      ) : (
        <ScopeSelectors scope={scope} fields={SCOPE_FIELDS} mode="form" />
      )}

      <SelectField
        label={t('assessments.target')}
        value={targetKind}
        onChange={(v) => {
          setTargetKind(v as TargetKind);
          setTargetId('');
        }}
        options={(Object.keys(TARGET_LABELS) as TargetKind[]).map((k) => ({
          value: k,
          label: t(TARGET_LABELS[k]),
        }))}
      />
      {needsId ? (
        <TargetPicker
          kind={targetKind}
          levelId={scope.value.levelId}
          value={targetId}
          onChange={setTargetId}
          error={touched && targetId.trim() === '' ? t('common.required') : null}
        />
      ) : null}

      {needsDate ? (
        <DateField
          label={t('assessments.date')}
          value={date}
          onChange={setDate}
          required
          hint={t('assessments.dateHint')}
          error={touched && date === '' ? t('common.required') : null}
        />
      ) : null}
    </FormDialog>
  );
}

/** The builder and the inbox for one paper. */
function OnePaper({
  examId,
  token,
  canWrite,
  layout,
}: {
  examId: string;
  token: string | null;
  canWrite: boolean;
  layout: PortalLayout;
}): ReactNode {
  const [paper, setPaper] = useState<AssessmentPaper | null>(null);
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [eligible, setEligible] = useState(0);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'close' | null>(null);
  const [viewing, setViewing] = useState<AssessmentPaper | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setPaper(await readAuthorPaper(examId, token));
      const inbox = await listSubmissions(examId, token);
      setRows(inbox.data);
      setEligible(inbox.eligible_count);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [examId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * **The freeze, said once.** Once anybody has submitted, the paper is fixed;
   * the server refuses every edit and the interface says why rather than
   * offering controls that answer `409`.
   */
  const frozen = rows.some((r) => r.state !== 'in_progress');
  const editable = canWrite && paper?.status === 'draft' && !frozen;

  async function act(action: () => Promise<void>, failure: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (error) {
      const reason =
        error instanceof ApiError
          ? (error.details as { reason?: string } | undefined)?.reason
          : undefined;
      setNotice(reason === 'NO_QUESTIONS' ? t('assessments.noQuestions') : failure);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function move(index: number, delta: number): Promise<void> {
    if (!paper) return;
    const ids = paper.questions.map((q) => q.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
    await act(() => reorderQuestions(examId, ids, token), t('assessments.saveFailed'));
  }

  const columns: Column<SubmissionRow>[] = [
    { key: 'name', header: t('common.name'), cell: (r) => r.name },
    {
      key: 'state',
      header: t('common.status'),
      cell: (r) => (
        <Badge tone={r.state === 'in_progress' ? 'neutral' : 'ok'}>
          {t(r.state === 'in_progress' ? 'assessments.stateInProgress' : 'assessments.stateSubmitted')}
        </Badge>
      ),
    },
    {
      key: 'grade_status',
      header: t('assessments.gradePublished'),
      cell: (r) => (
        <Badge tone={r.grade_status === 'published' ? 'ok' : 'neutral'}>
          {t(
            r.grade_status === null
              ? 'assessments.gradeNone'
              : r.grade_status === 'published'
                ? 'assessments.gradePublished'
                : 'assessments.gradeDraft',
          )}
        </Badge>
      ),
    },
  ];

  return layout({
    title: paper?.title ?? t('assessments.title'),
    actions: (
        canWrite && paper ? (
          <>
            {paper.status === 'draft' ? (
              <Button variant="primary" disabled={busy} onClick={() => setConfirm('publish')}>
                {t('assessments.publish')}
              </Button>
            ) : null}
            {paper.status === 'published' ? (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm('close')}>
                {t('assessments.close')}
              </Button>
            ) : null}
          </>
        ) : null
    ),
    children: (
      <>
      {notice ? <Feedback tone="warn">{notice}</Feedback> : null}
      {status === 'loading' ? <p className="hint">{t('common.loading')}</p> : null}
      {status === 'error' ? <Feedback tone="warn">{t('assessments.loadFailed')}</Feedback> : null}

      {paper ? (
        <>
          <p>
            <Badge tone={paper.status === 'published' ? 'ok' : 'neutral'}>
              {t(`assessments.${paper.status}`)}
            </Badge>{' '}
            <span className="muted">{t(TARGET_LABELS[paper.target_kind])}</span>
          </p>
          {paper.description ? <p>{paper.description}</p> : null}
          {frozen ? <Feedback>{t('assessments.frozen')}</Feedback> : null}

          <ol className="assessment-questions">
            {paper.questions.map((q, index) => (
              <li key={q.id}>
                <p className="assessment-questions__prompt">
                  <strong>{t('assessments.question').replace('{n}', String(index + 1))}</strong>{' '}
                  <span className="muted">{t(KIND_LABELS[q.kind])}</span>
                </p>
                <p>{q.prompt}</p>
                {q.options.length > 0 ? (
                  <ul>
                    {q.options.map((o) => (
                      <li key={o.id}>{o.label}</li>
                    ))}
                  </ul>
                ) : null}
                {q.justification !== 'none' ? (
                  <p className="hint">{t(JUSTIFICATION_LABELS[q.justification])}</p>
                ) : null}
                {editable ? (
                  <p>
                    {/* Up/down, not drag-and-drop: no reusable drag component
                        exists here, and one screen is not a reason to add a
                        library (§14.3). */}
                    <Button variant="ghost" disabled={busy} onClick={() => void move(index, -1)}>
                      {t('assessments.moveUp')}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => void move(index, 1)}>
                      {t('assessments.moveDown')}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => removeQuestion(examId, q.id, token),
                          t('assessments.saveFailed'),
                        )
                      }
                    >
                      {t('assessments.removeQuestion')}
                    </Button>
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          {editable ? (
            <Button variant="add" onClick={() => setAdding(true)}>
              {t('assessments.addQuestion')}
            </Button>
          ) : null}

          <h3>{t('assessments.inbox')}</h3>
          <p className="hint">
            {t('assessments.eligible')}: {eligible}
          </p>
          <DataTable
            caption={t('assessments.inbox')}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.student_id}
            status={status}
            onRetry={() => void load()}
            actions={[
              {
                label: t('assessments.openSubmission'),
                onSelect: (r) => {
                  if (r.state === 'in_progress') {
                    // Not readable, and the reason is a rule rather than a fault.
                    setNotice(t('assessments.inProgressNotReadable'));
                    return;
                  }
                  void readSubmission(examId, r.student_id, token).then(setViewing).catch(() => {
                    setNotice(t('assessments.loadFailed'));
                  });
                },
              },
            ]}
          />
          <p className="hint">{t('assessments.grading')}</p>
        </>
      ) : null}

      {adding ? (
        <QuestionDialog
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={(input) => {
            setAdding(false);
            void act(() => addQuestion(examId, input, token).then(() => undefined), t('assessments.saveFailed'));
          }}
        />
      ) : null}

      {viewing ? <SubmissionDialog paper={viewing} onClose={() => setViewing(null)} /> : null}

      <ConfirmDialog
        open={confirm !== null}
        title={t(confirm === 'close' ? 'assessments.close' : 'assessments.publish')}
        body={t(confirm === 'close' ? 'assessments.closeConfirm' : 'assessments.publishConfirm')}
        confirmLabel={t(confirm === 'close' ? 'assessments.close' : 'assessments.publish')}
        busy={busy}
        onConfirm={() =>
          void act(
            () =>
              confirm === 'close'
                ? closeAssessment(examId, token)
                : publishAssessment(examId, token),
            t('assessments.saveFailed'),
          )
        }
        onCancel={() => setConfirm(null)}
      />
      </>
    ),
  });
}

function QuestionDialog({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    kind: QuestionKind;
    prompt: string;
    justification?: JustificationRule;
    options?: string[];
  }) => void;
}): ReactNode {
  const [kind, setKind] = useState<QuestionKind>('short_text');
  const [prompt, setPrompt] = useState('');
  const [justification, setJustification] = useState<JustificationRule>('none');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [touched, setTouched] = useState(false);

  const isChoice = kind === 'single_choice' || kind === 'multiple_choice';
  const filled = options.map((o) => o.trim()).filter((o) => o !== '');
  const error =
    prompt.trim() === ''
      ? t('common.required')
      : isChoice && filled.length < 2
        ? t('common.required')
        : null;

  const dirty = isDirty({ kind, prompt, justification, options }, {
    kind: 'short_text',
    prompt: '',
    justification: 'none',
    options: ['', ''],
  });

  function submit(): void {
    setTouched(true);
    if (error) return;
    onSave({
      kind,
      prompt: prompt.trim(),
      // **Only where the kind allows it.** The server refuses the other
      // combinations rather than dropping them, and the form does not send one.
      ...(isChoice ? { justification, options: filled } : {}),
    });
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={submit}
      title={t('assessments.addQuestion')}
      busy={busy}
      dirty={dirty}
    >
      <SelectField
        label={t('assessments.questionType')}
        value={kind}
        onChange={(v) => setKind(v as QuestionKind)}
        options={(Object.keys(KIND_LABELS) as QuestionKind[]).map((k) => ({
          value: k,
          label: t(KIND_LABELS[k]),
        }))}
      />
      <TextArea
        label={t('assessments.questionPrompt')}
        value={prompt}
        onChange={setPrompt}
        required
        error={touched && prompt.trim() === '' ? t('common.required') : null}
      />

      {isChoice ? (
        <>
          {options.map((value, index) => (
            <TextField
              key={index}
              label={t('assessments.option').replace('{n}', String(index + 1))}
              value={value}
              onChange={(next) =>
                setOptions(options.map((o, i) => (i === index ? next : o)))
              }
            />
          ))}
          <Button variant="ghost" onClick={() => setOptions([...options, ''])}>
            {t('assessments.addOption')}
          </Button>
          <SelectField
            label={t('assessments.justification')}
            value={justification}
            onChange={(v) => setJustification(v as JustificationRule)}
            options={(Object.keys(JUSTIFICATION_LABELS) as JustificationRule[]).map((j) => ({
              value: j,
              label: t(JUSTIFICATION_LABELS[j]),
            }))}
          />
        </>
      ) : null}
    </FormDialog>
  );
}

/** One student's submitted paper. Read-only — the mark is entered on the sheet. */
function SubmissionDialog({
  paper,
  onClose,
}: {
  paper: AssessmentPaper;
  onClose: () => void;
}): ReactNode {
  const byQuestion = new Map((paper.submission?.answers ?? []).map((a) => [a.question_id, a]));
  return (
    <FormDialog
      open
      onCancel={onClose}
      onSubmit={onClose}
      title={t('assessments.openSubmission')}
      busy={false}
      dirty={false}
    >
      <ol className="assessment-questions">
        {paper.questions.map((q, index) => {
          const answer = byQuestion.get(q.id);
          const chosen = q.options.filter((o) => answer?.option_ids.includes(o.id));
          return (
            <li key={q.id}>
              <p>
                <strong>{t('assessments.question').replace('{n}', String(index + 1))}</strong>{' '}
                {q.prompt}
              </p>
              {answer?.text ? <p>{answer.text}</p> : null}
              {chosen.length > 0 ? <p>{chosen.map((o) => o.label).join('، ')}</p> : null}
              {answer?.justification ? (
                <p className="hint">
                  {t('assessments.yourJustification')}: {answer.justification}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="hint">{t('assessments.grading')}</p>
    </FormDialog>
  );
}
