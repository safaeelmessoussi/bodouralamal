import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  addQuestion,
  closeAssessment,
  copyAssessment,
  createAssessment,
  listAssessments,
  listSubmissions,
  openAssessment,
  readAuthorPaper,
  removeQuestion,
  reorderQuestions,
  updateQuestion,
  type AssessmentPaper,
  type AssessmentQuestion,
  type AssessmentSummary,
  type JustificationRule,
  type QuestionKind,
  type SubmissionRow,
} from '../../adapters/assessments.js';
import { deleteExam } from '../../adapters/exams.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ScopeSelectors } from '../../components/scope/scope-selectors.js';
import { TARGET_LABELS } from '../../components/scheduling/target-picker.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type TableStatus } from '../../components/ui/data-table.js';
import { NumberField, SearchInput, SelectField, TextArea, TextField } from '../../components/ui/field.js';
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

const SCOPE_FIELDS = ['levelId', 'subjectId', 'academicYearId'] as const;
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
  /** R172 §6 — deleting a paper that was sat is the administration's to acknowledge. */
  const isAdminish = activeRoles.some((r) => ['admin', 'super_admin'].includes(r));

  if (examId !== null) {
    return <OnePaper examId={examId} token={accessToken} canWrite={canWrite} layout={layout} />;
  }
  return <Library token={accessToken} canWrite={canWrite} isAdminish={isAdminish} layout={layout} />;
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

/**
 * **The library** — the papers that exist, and the way back to any of them.
 *
 * ## The defect this screen is
 *
 * This view used to be the create form and nothing else: a title, a hint and
 * «اختبار جديد». An author built a paper, navigated away, and had **no route
 * back to it** — every assessment endpoint addressed one paper by id and none
 * answered *which papers exist*. `GET /exams` had even recorded the intention,
 * excluding online papers with the note that they are *"listed by their own
 * screen, `/admin/assessments`"*, and this was that screen. Nothing was lost;
 * it was unreachable, which to the person who wrote the paper is the same thing.
 *
 * ## Why a table and not cards
 *
 * The reader's question is comparative — *which of these is still a draft, which
 * has answers waiting* — and `DataTable` already carries the search/filter
 * toolbar, the filtered-vs-empty distinction (§14.4), pagination, the error
 * state and the row-action order (rule AC). A card grid would be a second list
 * idiom for one screen.
 */
function Library({
  token,
  canWrite,
  isAdminish,
  layout,
}: {
  token: string | null;
  canWrite: boolean;
  isAdminish: boolean;
  layout: PortalLayout;
}): ReactNode {
  const scope = useScopeOptions({ token, fields: SCOPE_FIELDS, mode: 'form' });
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [rows, setRows] = useState<AssessmentSummary[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [failure, setFailure] = useState<unknown>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  /**
   * **«إنشاء نسخة» stays a pure content operation** (R136). `POST
   * /assessments/{id}/copy` produces an independent draft — its own empty
   * target, submissions, grades and notifications — and this dialog is the
   * only thing that ever calls it from here. Scheduling a paper, reused or
   * not, is a السد navigation to الجدولة with the source pre-filled
   * (`onSelect` below); it makes no request of its own, so there is nothing
   * left to confirm.
   */
  const [copying, setCopying] = useState<AssessmentSummary | null>(null);
  /**
   * **R172 §7 — a paper can be deleted from here.** «الاختبارات» could build,
   * copy and reuse a paper and never remove one; the Owner's three test papers
   * had to be deleted from الجدولة. The same `DELETE /exams/{id}`, the same
   * Trash, and the same second question when it holds student work (§6).
   */
  const [deleting, setDeleting] = useState<AssessmentSummary | null>(null);
  const [deleteEvidence, setDeleteEvidence] = useState<{ submissions: number; grades: number } | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteExam(deleting.id, token, { acknowledgeEvidence: deleteEvidence !== null });
      setDeleting(null);
      setDeleteEvidence(null);
      setNotice(t('common.deleted'));
      await load();
    } catch (error) {
      const details = error instanceof ApiError ? error.details : undefined;
      if (details?.['reason'] === 'STUDENT_EVIDENCE_EXISTS') {
        const counts = {
          submissions: Number(details['submissions'] ?? 0),
          grades: Number(details['grades'] ?? 0),
        };
        if (deleteEvidence === null && isAdminish) setDeleteEvidence(counts);
        else {
          setDeleteBlocked(
            t('scheduling.deleteBlockedEvidence')
              .replace('{submissions}', String(counts.submissions))
              .replace('{grades}', String(counts.grades)),
          );
        }
      } else {
        setDeleting(null);
        setDeleteEvidence(null);
        setNotice(t('assessments.deleteFailed'));
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  const filtered = query.trim() !== '' || modeFilter !== '' || levelFilter !== '';

  const load = useCallback(async () => {
    setStatus('loading');
    setFailure(null);
    try {
      const result = await listAssessments(
        {
          page,
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(modeFilter ? { mode: modeFilter as 'physical' | 'online' } : {}),
          ...(levelFilter ? { level_id: levelFilter } : {}),
        },
        token,
      );
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch (error) {
      setFailure(error);
      setStatus('error');
    }
  }, [token, page, query, modeFilter, levelFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<AssessmentSummary>[] = [
    {
      key: 'title',
      header: t('assessments.name'),
      cell: (row) => <a href={`?exam=${encodeURIComponent(row.id)}`}>{row.title}</a>,
    },
    {
      key: 'status',
      header: t('assessments.filterStatus'),
      /**
       * **مسودة, always** (R136) — this library is `status = 'draft'`-only
       * by construction, so the badge renders the one status a row here can
       * ever carry rather than a live server field with nowhere else to go.
       */
      cell: () => <Badge tone="neutral">{t('assessments.statusDraft')}</Badge>,
    },
    {
      key: 'mode',
      header: t('assessments.mode'),
      secondary: true,
      cell: (row) => t(row.mode === 'online' ? 'assessments.modeOnline' : 'assessments.modePhysical'),
    },
    {
      key: 'level',
      header: t('assessments.level'),
      secondary: true,
      cell: (row) => row.level_name,
    },
    {
      key: 'subject',
      header: t('assessments.subject'),
      secondary: true,
      cell: (row) => row.subject_name ?? '—',
    },
    { key: 'date', header: t('assessments.date'), secondary: true, cell: (row) => row.date },
    {
      key: 'questions',
      header: t('assessments.colQuestions'),
      numeric: true,
      secondary: true,
      cell: (row) => row.question_count,
    },
    {
      key: 'submissions',
      header: t('assessments.colSubmissions'),
      numeric: true,
      cell: (row) => row.submission_count,
    },
    {
      key: 'scale',
      header: t('assessments.colScale'),
      numeric: true,
      secondary: true,
      cell: (row) => row.max_grade,
    },
  ];

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
        <DataTable
          caption={t('assessments.libraryCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          status={status}
          error={failure}
          onRetry={() => void load()}
          filtered={filtered}
          onClearFilters={() => {
            setQuery('');
            setModeFilter('');
            setLevelFilter('');
            setPage(1);
          }}
          toolbar={
            <>
              <SearchInput
                label={t('assessments.searchLabel')}
                value={query}
                onChange={(next) => {
                  setQuery(next);
                  setPage(1);
                }}
              />
              <SelectField
                label={t('assessments.mode')}
                value={modeFilter}
                onChange={(next) => {
                  setModeFilter(next);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('assessments.filterAll') },
                  { value: 'online', label: t('assessments.modeOnline') },
                  { value: 'physical', label: t('assessments.modePhysical') },
                ]}
              />
              <SelectField
                label={t('assessments.filterLevel')}
                value={levelFilter}
                onChange={(next) => {
                  setLevelFilter(next);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('assessments.filterAll') },
                  ...scope.options.levelId,
                ]}
              />
            </>
          }
          pagination={{ page, pageSize: 20, total, onPage: setPage }}
          actions={
            canWrite
              ? [
                  {
                    label: t('assessments.openPaper'),
                    onSelect: (row) => {
                      window.location.href = `?exam=${encodeURIComponent(row.id)}`;
                    },
                  },
                  {
                    // **R136 — «استخدام مرة أخرى» is now a الجدولة navigation
                    // action, not a request from this screen.** الجدولة
                    // re-reads the source fresh (safe, server-revalidated
                    // prefill) and is the ONE place scheduling happens; a
                    // copy is never made merely to schedule.
                    label: t('assessments.reusePaper'),
                    onSelect: (row) => {
                      window.location.href = `/admin/schedules?kind=exam&new=1&source=${encodeURIComponent(row.id)}&mode=${row.mode}`;
                    },
                  },
                  {
                    label: t('assessments.copyPaper'),
                    onSelect: (row) => setCopying(row),
                  },
                  {
                    label: t('common.delete'),
                    danger: true,
                    onSelect: (row) => {
                      setDeleteBlocked(null);
                      setDeleteEvidence(null);
                      setDeleting(row);
                    },
                  },
                ]
              : []
          }
        />
        <ConfirmDialog
          open={deleting !== null}
          {...(deleteBlocked ? { blocked: deleteBlocked } : {})}
          title={t('assessments.deleteTitle')}
          body={
            deleteEvidence === null
              ? t('assessments.deleteBody').replace('{title}', deleting?.title ?? '')
              : t('scheduling.deleteWithEvidenceBody')
                  .replace('{title}', deleting?.title ?? '')
                  .replace('{submissions}', String(deleteEvidence.submissions))
                  .replace('{grades}', String(deleteEvidence.grades))
          }
          confirmLabel={deleteEvidence === null ? t('common.delete') : t('scheduling.deleteWithEvidence')}
          danger
          busy={deleteBusy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setDeleting(null);
            setDeleteEvidence(null);
            setDeleteBlocked(null);
          }}
        />
        {copying ? (
          <ConfirmDialog
            open
            title={t('assessments.copyConfirmTitle')}
            body={t('assessments.copyConfirmBody')}
            confirmLabel={t('assessments.copyPaper')}
            onCancel={() => setCopying(null)}
            onConfirm={async () => {
              const row = copying;
              setCopying(null);
              try {
                const created = await copyAssessment(row.id, token);
                window.location.href = `?exam=${encodeURIComponent(created.id)}`;
              } catch {
                setNotice(t('assessments.copyFailed'));
              }
            }}
          />
        ) : null}
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
 * **بناء الاختبارات creates content, and only content** (R136, frontend-
 * completion pass). WHO it is for and WHEN are الجدولة's decisions, made
 * once, at scheduling — this dialog no longer asks for them.
 *
 * **The defect this closes.** Asking for «موجَّه إلى» and «التاريخ» here was
 * the two-act flow R136 was ratified to retire, one screen over: an author
 * committed to an audience before writing a single question, and the target
 * she picked was never authoritative anyway — الجدولة always resolves a
 * fresh one at scheduling (R136 clause 3). Removing the fields is not a
 * simplification of the form; it is the form finally asking only the
 * question بناء الاختبارات actually owns.
 *
 * **No `target`/`date` is sent.** `createAssessment` accepts both as
 * optional now and stores a `level`-shaped placeholder nobody ever reads as
 * a real commitment — see the backend's own `AssessmentInput.target`
 * docstring.
 */
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
  const [mode, setMode] = useState<'physical' | 'online'>('online');
  const [maxGrade, setMaxGrade] = useState('20');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const error =
    title.trim() === '' || scope.value.levelId === '' ? t('common.required') : null;

  const dirty = isDirty(
    { title, description, mode, maxGrade },
    { title: '', description: '', mode: 'online', maxGrade: '20' },
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
          mode,
          max_grade: Number(maxGrade),
          level_id: scope.value.levelId,
          ...(scope.value.subjectId ? { subject_id: scope.value.subjectId } : {}),
          ...(scope.value.academicYearId ? { academic_year_id: scope.value.academicYearId } : {}),
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
      {/* R136 clause 2 — بناء الاختبارات authors content for either delivery
          mode now; الجدولة decides how it is actually sat. */}
      <SelectField
        label={t('assessments.mode')}
        value={mode}
        onChange={(v) => setMode(v as 'physical' | 'online')}
        options={[
          { value: 'online', label: t('assessments.modeOnline') },
          { value: 'physical', label: t('assessments.modePhysical') },
        ]}
      />
      <TextField label={t('assessments.maxGrade')} value={maxGrade} onChange={setMaxGrade} required />
      <ScopeSelectors scope={scope} fields={SCOPE_FIELDS} mode="form" />
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
  // `rows` still feeds `frozen` below (whether ANYONE has answered) even
  // though the table it used to render — the students-and-answers inbox,
  // removed 2026-09-16 now that نقاط الاختبارات lists the same students
  // with their submission status AND their grade — is gone.
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // R137 — a question already written may be reopened for editing; `null`
  // means the dialog is closed, `AssessmentQuestion` means it is open on
  // that row.
  const [editingQuestion, setEditingQuestion] = useState<AssessmentQuestion | null>(null);
  const [confirm, setConfirm] = useState<'close' | 'open' | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setPaper(await readAuthorPaper(examId, token));
      setRows((await listSubmissions(examId, token)).data);
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
  // H3 (Owner decision 2026-09-13) — a manual remote exam only, still
  // unopened. Client-side only for display (rule O — the calendar's own
  // `ExamAccessAction` discipline): the server's `assertMayAuthor` remains
  // the actual authority check, so hiding this button is never the boundary.
  const openable =
    canWrite && paper?.mode === 'online' && paper.status === 'published' && paper.available_from === null;

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

  return layout({
    title: paper?.title ?? t('assessments.title'),
    actions: (
        canWrite && paper ? (
          <>
            {editable ? (
              // **R136 — the retired «مراجعة الجمهور والتاريخ»/publish pair
              // is replaced by ONE navigation to الجدولة**, which assigns
              // the target/date and schedules atomically in a single حفظ.
              // This button makes no request of its own; the paper's
              // fresh, server-revalidated content is what الجدولة reads.
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  window.location.href = `/admin/schedules?kind=exam&new=1&source=${encodeURIComponent(examId)}&mode=${paper.mode}`;
                }}
              >
                {t('assessments.scheduleAction')}
              </Button>
            ) : null}
            {openable ? (
              <Button variant="primary" disabled={busy} onClick={() => setConfirm('open')}>
                {t('assessments.openExam')}
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
            {paper.mode === 'online' && paper.status === 'published' && paper.available_from === null ? (
              <Badge tone="neutral">{t('assessments.notYetOpen')}</Badge>
            ) : null}{' '}
            <span className="muted">{t(TARGET_LABELS[paper.target_kind])}</span>
          </p>
          {paper.source_exam_id ? (
            <p className="hint">
              {t('assessments.copiedFrom').replace('{title}', paper.source_exam_title ?? '')}
            </p>
          ) : null}
          {paper.reused_count ? (
            <p className="hint">
              {t('assessments.reusedCount').replace('{n}', String(paper.reused_count))}
            </p>
          ) : null}
          {paper.description ? <p>{paper.description}</p> : null}
          {frozen ? <Feedback>{t('assessments.frozen')}</Feedback> : null}

          <ol className="assessment-questions">
            {paper.questions.map((q, index) => (
              <li key={q.id}>
                <p className="assessment-questions__prompt">
                  <strong>{t('assessments.question').replace('{n}', String(index + 1))}</strong>
                  <Badge tone="neutral">{t(KIND_LABELS[q.kind])}</Badge>
                  {/* R137 — shown to author and student alike (per-surface
                      wiring below); a maximum, never the mark earned. */}
                  {q.points !== null ? (
                    <Badge tone="neutral">
                      {t('assessments.questionPointsOf').replace('{points}', q.points)}
                    </Badge>
                  ) : null}
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
                  <div className="assessment-questions__actions">
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
                      onClick={() => setEditingQuestion(q)}
                    >
                      {t('common.edit')}
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
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          {editable ? (
            <Button variant="add" onClick={() => setAdding(true)}>
              {t('assessments.addQuestion')}
            </Button>
          ) : null}

          {/**
            * **Owner-reported, 2026-09-16 — the students-and-answers inbox
            * table is REMOVED from here.** نقاط الاختبارات
            * (`/admin/exam-grades` and `/teacher/exams`, `GradeSheetView`)
            * now lists every eligible student with her submission status
            * AND her grade in one table, so this screen showing the same
            * students a second time — with grading nowhere on it — was a
            * second, poorer answer to the same question.
            *
            * `rows`/`eligible`/`load()` above are KEPT: `frozen`
            * (defined near the top of this component) still needs to know
            * whether anybody has answered, to freeze question editing —
            * the `assessments.frozen` notice rendered further up this page.
            */}
        </>
      ) : null}

      {adding ? (
        <QuestionDialog
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={(input) => {
            setAdding(false);
            // Never `null` here — `QuestionDialog`'s own submit() only sends
            // `null` when editing an existing question (`initial` set).
            const { points, ...rest } = input;
            void act(
              () =>
                addQuestion(
                  examId,
                  { ...rest, ...(points === null || points === undefined ? {} : { points }) },
                  token,
                ).then(() => undefined),
              t('assessments.saveFailed'),
            );
          }}
        />
      ) : null}

      {editingQuestion ? (
        <QuestionDialog
          initial={editingQuestion}
          busy={busy}
          onCancel={() => setEditingQuestion(null)}
          onSave={(input) => {
            const version = editingQuestion.version;
            setEditingQuestion(null);
            void act(
              () => updateQuestion(examId, editingQuestion.id, version, input, token),
              t('assessments.saveFailed'),
            );
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirm === 'close'}
        title={t('assessments.close')}
        body={t('assessments.closeConfirm')}
        confirmLabel={t('assessments.close')}
        busy={busy}
        onConfirm={() => void act(() => closeAssessment(examId, token), t('assessments.saveFailed'))}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'open'}
        title={t('assessments.openExam')}
        body={t('assessments.openExamConfirm')}
        confirmLabel={t('assessments.openExam')}
        busy={busy}
        onConfirm={() => void act(() => openAssessment(examId, token), t('assessments.saveFailed'))}
        onCancel={() => setConfirm(null)}
      />
      </>
    ),
  });
}

function QuestionDialog({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  /** R137 — present on تعديل, absent on إضافة سؤال. `kind` is fixed at
   *  creation and stays read-only here: a new kind is a new question. */
  initial?: AssessmentQuestion;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    kind: QuestionKind;
    prompt: string;
    justification?: JustificationRule;
    options?: string[];
    /** `undefined` leaves an existing allocation untouched on تعديل and is
     *  simply omitted on إضافة; `null` explicitly clears one on تعديل. */
    points?: number | null;
  }) => void;
}): ReactNode {
  const [kind, setKind] = useState<QuestionKind>(initial?.kind ?? 'short_text');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [justification, setJustification] = useState<JustificationRule>(
    initial?.justification ?? 'none',
  );
  const [options, setOptions] = useState<string[]>(
    initial ? initial.options.map((o) => o.label) : ['', ''],
  );
  const [points, setPoints] = useState(initial?.points ?? '');
  const [touched, setTouched] = useState(false);

  const isChoice = kind === 'single_choice' || kind === 'multiple_choice';
  const filled = options.map((o) => o.trim()).filter((o) => o !== '');
  const pointsError =
    points.trim() !== '' && (!Number.isFinite(Number(points)) || Number(points) <= 0)
      ? t('assessments.questionPointsInvalid')
      : null;
  const error =
    prompt.trim() === ''
      ? t('common.required')
      : isChoice && filled.length < 2
        ? t('common.required')
        : pointsError;

  const dirty = isDirty(
    { kind, prompt, justification, options, points },
    {
      kind: initial?.kind ?? 'short_text',
      prompt: initial?.prompt ?? '',
      justification: initial?.justification ?? 'none',
      options: initial ? initial.options.map((o) => o.label) : ['', ''],
      points: initial?.points ?? '',
    },
  );

  function submit(): void {
    setTouched(true);
    if (error) return;
    const pointsValue = points.trim() === '' ? null : Number(points);
    onSave({
      kind,
      prompt: prompt.trim(),
      // **Only where the kind allows it.** The server refuses the other
      // combinations rather than dropping them, and the form does not send one.
      ...(isChoice ? { justification, options: filled } : {}),
      // On إضافة a `null` (never chosen) is simply omitted — nothing to
      // clear yet; on تعديل it is sent through so a cleared field actually
      // clears a previously-set allocation rather than leaving it stale.
      ...(initial ? { points: pointsValue } : pointsValue === null ? {} : { points: pointsValue }),
    });
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={submit}
      title={t(initial ? 'assessments.editQuestion' : 'assessments.addQuestion')}
      busy={busy}
      dirty={dirty}
    >
      <SelectField
        label={t('assessments.questionType')}
        value={kind}
        onChange={(v) => setKind(v as QuestionKind)}
        disabled={initial !== undefined}
        hint={initial ? t('assessments.questionTypeFixed') : undefined}
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

      {/* R137 — optional on every kind alike; never awarded automatically
          (§4.6 manual grading, unchanged). Consistency against the paper's
          own max_grade is checked once, at scheduling — never here. */}
      <NumberField
        label={t('assessments.questionPoints')}
        value={points}
        onChange={setPoints}
        min={0.01}
        max={9999.99}
        step="0.01"
        hint={t('assessments.questionPointsHint')}
        error={touched ? pointsError : null}
      />

      {isChoice ? (
        <>
          {options.map((value, index) => (
            <div className="form__row" key={index}>
              <TextField
                label={t('assessments.option').replace('{n}', String(index + 1))}
                value={value}
                onChange={(next) =>
                  setOptions(options.map((o, i) => (i === index ? next : o)))
                }
              />
              {/* **A real remove, not a blank-and-hope** (R137): the option
                  leaves the array outright, so the count driving `error`
                  above reflects what will actually be saved. */}
              <Button
                variant="ghost"
                disabled={options.length <= 2}
                onClick={() => setOptions(options.filter((_, i) => i !== index))}
              >
                {t('assessments.removeOption')}
              </Button>
            </div>
          ))}
          <Button variant="add" onClick={() => setOptions([...options, ''])}>
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
