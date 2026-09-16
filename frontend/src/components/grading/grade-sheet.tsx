import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { readSubmission, type AssessmentPaper } from '../../adapters/assessments.js';
import {
  fetchGradeSheet,
  publishGrades,
  saveGrades,
  type GradeEntryInput,
  type GradeSheet,
  type GradeSheetRow,
} from '../../adapters/grades.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { CheckboxField, NumberField } from '../ui/field.js';
import { FormDialog } from '../ui/form-dialog.js';
import { Feedback } from '../ui/feedback.js';

/**
 * **The grade sheet — one component, reached from two places** (§4.6, SRS
 * Revision 70.1).
 *
 * `/admin/exam-grades?exam=` and the teacher portal's exam list both render
 * *this*. R70.1 states the requirement in one line — *"one grade sheet with two
 * ways in, never two implementations"* — and this project has paid for the
 * alternative often enough that R69 spent a whole revision undoing borrowed
 * entry points.
 *
 * **The server is the authority and this screen renders its answers.** It
 * performs no scope check of its own: a Teacher outside §4.4c receives a coded
 * refusal from `GET /exams/{id}/grades` and sees it, rather than being handed a
 * hidden button. Hiding is not enforcement (TD-2).
 *
 * ## Empty is not zero, and the input says so
 *
 * A student with no row yet renders an **empty** field. A student marked zero
 * renders `0`. Those are different facts (§4.6, BR-7) and the control never
 * collapses them — which is why the local state holds `string`, not `number`:
 * `''` is a state `0` cannot represent.
 *
 * ## Marks are on the association's scale
 *
 * The field takes **the exam's own maximum** (R81): «النقطة (من 20)» on one
 * exam and «النقطة (من 10)» on the next, from `sheet.max_grade`. There is no
 * conversion in either direction and no platform-wide scale to consult — the
 * number typed is the number stored.
 */

interface Draft {
  /** `''` is **unmarked**. Deliberately a string; see the module docstring. */
  score: string;
  absent: boolean;
  /**
   * **Owner-reported, 2026-09-15 — per-question grading, keyed by question
   * id.** `''` is *not yet scored*, on the identical convention `score`
   * above already uses — a PARTIAL set is a legal draft (see
   * `saveGradeDraft`'s own docstring). Present only while `sheet.questions`
   * is; the plain `score` field above is then read-only, derived from this.
   */
  questionScores: Record<string, string>;
}

function draftFrom(row: GradeSheetRow): Draft {
  return {
    score: row.score === null ? '' : String(row.score),
    absent: row.absent,
    questionScores: Object.fromEntries(
      (row.question_scores ?? []).map((qs) => [qs.question_id, String(qs.score)]),
    ),
  };
}

/** The live total from whatever has been entered so far — the same sum the
 *  server itself computes on save, shown before saving so a marker sees
 *  what she is about to submit. */
function questionScoresTotal(draft: Draft): number {
  return Object.values(draft.questionScores).reduce(
    (total, v) => total + (v.trim() === '' ? 0 : Number(v)),
    0,
  );
}

/**
 * **One row's wire entry, built from its draft — the ONE place this shape is
 * assembled** (Owner-reported, 2026-09-16: extracted so the bulk «حفظ» below
 * and the per-student «عرض الإجابات» dialog's own save build the identical
 * payload, never two implementations that could quietly disagree).
 *
 * `sheet.questions` decides whether `question_scores` exists to send at all
 * — `undefined` on `sheet`, not merely absent from the entry, refuses it
 * outright rather than silently ignoring typed values (`saveGradeDraft`'s
 * own `QUESTIONS_HAVE_NO_POINTS`).
 */
function entryPayload(
  studentId: string,
  version: number | null,
  draft: Draft,
  hasQuestions: boolean,
): GradeEntryInput {
  const entered = hasQuestions
    ? Object.entries(draft.questionScores)
        .filter(([, v]) => v.trim() !== '')
        .map(([question_id, v]) => ({ question_id, score: Number(v) }))
    : [];
  const questionScores = entered.length > 0 && !draft.absent ? entered : null;
  return {
    student_id: studentId,
    // `''` stays null all the way to the server: unmarked is not zero, and
    // BR-7 is what decides what becomes of it.
    score:
      questionScores !== null
        ? null
        : draft.absent || draft.score.trim() === ''
          ? null
          : Number(draft.score),
    absent: draft.absent,
    ...(questionScores !== null ? { question_scores: questionScores } : {}),
    ...(version === null ? {} : { version }),
  };
}

export function GradeSheetView({
  examId,
  onMaxGrade,
  responsesBasePath,
}: {
  examId: string;
  /** Reports **this exam's** maximum (R81) so a surrounding frame can name it
   *  without fetching the sheet a second time. */
  onMaxGrade?: (maxGrade: number) => void;
  /**
   * **«فتح في بناء الاختبارات» — a bulk, side-by-side browse of every
   * submission**, reaching the same builder screen بناء الاختبارات already
   * opens on (`/admin/assessments`'s `OnePaper`, R70.1's one-implementation
   * rule applied again rather than a new viewer). Distinct since
   * 2026-09-16 from the per-row «عرض الإجابات» dialog below, which is where
   * grading actually happens now — this link is for reading many answers
   * at once, not for marking one student. **Each portal's own path**, on
   * the exact reasoning `TeacherAssessmentsPage`'s docstring states for why
   * a teaching-portal screen may never link to the admin one:
   * `/admin/assessments` for the back office, `/teacher/assessments` for
   * the teaching portal. Omitted entirely (this component has no portal of
   * its own to guess one from, rule O) hides the link rather than guessing
   * wrong.
   */
  responsesBasePath?: '/admin/assessments' | '/teacher/assessments';
}): ReactNode {
  const { accessToken } = useSession();

  const [sheet, setSheet] = useState<GradeSheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * **Why the sheet could not be opened, when the server said why**
   * (2026-08-30). `EXAM_INCOMPLETE` — a pre-R58 sitting naming no branch and no
   * subject — was mapped nowhere on the client, so the one refusal that has a
   * concrete cause and a concrete fix arrived as «تعذّر التحميل». The reader saw
   * an empty screen and no student, and nothing said the exam itself was the
   * problem rather than her scope or the data.
   */
  const [reason, setReason] = useState<string | null>(null);
  /**
   * **Owner-reported, 2026-09-16 — per-row «عرض الإجابات».** Which student's
   * responses-and-grading dialog is open, or `null` for none. Physical-only
   * exams never offer the button at all (no submission to open), so this is
   * meaningful only alongside `sheet.exam.mode === 'online'`.
   */
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const next = await fetchGradeSheet(examId, accessToken);
      setSheet(next);
      onMaxGrade?.(next.max_grade);
      setDrafts(Object.fromEntries(next.rows.map((r) => [r.student_id, draftFrom(r)])));
      setState('ready');
    } catch (error) {
      // The server's refusal is rendered as a refusal — §4.4c is enforced there
      // and this screen reports it rather than pre-empting it.
      setReason(
        error instanceof ApiError && error.details['reason'] === 'EXAM_INCOMPLETE'
          ? t('admin.grades.examIncomplete')
          : null,
      );
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error');
    }
  }, [examId, accessToken, onMaxGrade]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    if (!sheet) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveGrades(
        examId,
        sheet.rows.map((row) => {
          const draft = drafts[row.student_id] ?? { score: '', absent: false, questionScores: {} };
          return entryPayload(row.student_id, row.version, draft, sheet.questions !== undefined);
        }),
        accessToken,
      );
      setNotice(
        result.initialised > 0
          ? t('admin.grades.savedWithAbsent').replace('{n}', String(result.initialised))
          : t('admin.grades.saved'),
      );
      await load();
    } catch (error) {
      setNotice(refusalText(error));
    } finally {
      setBusy(false);
    }
  }

  /**
   * **Owner-reported, 2026-09-16 — the per-student «عرض الإجابات» dialog
   * saves ITS student alone, immediately, as a draft** — not a staged
   * change waiting for the bulk «حفظ» above. Reuses the identical
   * `entryPayload` the bulk save builds from, sent as a one-entry array;
   * `saveGradeDraft` already upserts whichever entries it is given and
   * leaves every other student's row untouched (`grade.service.ts`).
   */
  async function saveOne(studentId: string): Promise<void> {
    if (!sheet) return;
    const row = sheet.rows.find((r) => r.student_id === studentId);
    if (!row) return;
    const draft = drafts[studentId] ?? { score: '', absent: false, questionScores: {} };
    setBusy(true);
    setNotice(null);
    try {
      await saveGrades(
        examId,
        [entryPayload(studentId, row.version, draft, sheet.questions !== undefined)],
        accessToken,
      );
      setNotice(t('admin.grades.saved'));
      setOpenStudentId(null);
      await load();
    } catch (error) {
      setNotice(refusalText(error));
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const result = await publishGrades(examId, accessToken);
      setNotice(
        t(result.republished ? 'admin.grades.republished' : 'admin.grades.published').replace(
          '{n}',
          String(result.published),
        ),
      );
      await load();
    } catch (error) {
      setNotice(refusalText(error));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <p className="state">{t('common.loading')}</p>;
  if (state === 'forbidden') {
    return (
      <p className="state" role="alert">
        {t('admin.grades.outOfScope')}
      </p>
    );
  }
  if (state === 'error' || !sheet) {
    return (
      <p className="state" role="alert">
        {reason ?? t('common.loadFailed')}
      </p>
    );
  }

  const maxGrade = sheet.max_grade;

  return (
    <>
      {/* **The exam is named ONCE on this screen.**
          It used to be the page's `<h1>` *and* the first line of this block, so
          «سواعد» appeared twice, three lines apart. The frame now keeps
          «نقاط الامتحانات» as its title — the page is about grades whichever
          exam is open — and the exam's identity is context, which is what this
          block is for. */}
      <section className="admin-notice" aria-label={t('admin.grades.examSummary')}>
        <strong>{sheet.exam.title}</strong>
        {' — '}
        {sheet.exam.level_name}
        {sheet.exam.subject_name ? ` · ${sheet.exam.subject_name}` : ''}
        {sheet.exam.administrative_group_name
          ? ` · ${sheet.exam.administrative_group_name}`
          : ` · ${t('admin.grades.wholeLevel')}`}
        {' · '}
        {sheet.exam.date}
        {/* R70.5 — derived from `created_at > date` by the server, stored
            nowhere. A sitting recorded after the fact is a legitimate record,
            and saying so is honest rather than a warning. */}
        {sheet.exam.recorded_late ? (
          <>
            {' '}
            <Badge tone="neutral">{t('admin.grades.recordedLate')}</Badge>
          </>
        ) : null}
      </section>

      {/**
       * **Owner-reported, 2026-09-16 — the exam-WIDE link now says where it
       * actually goes, distinct from the per-row «عرض الإجابات» below.**
       * The two are not the same capability any more: this one still opens
       * بناء الاختبارات's own submissions inbox (`OnePaper`) for a bulk,
       * side-by-side browse of every free-text answer; the per-row dialog
       * is where grading actually happens now. Kept rather than removed —
       * §20 rule 16 cuts both ways, and browsing many answers at once is a
       * real capability the per-row dialog does not replace. Physical-only
       * exception unchanged: a physical sitting has no submission to open.
       */}
      {responsesBasePath && sheet.exam.mode === 'online' ? (
        <p>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = `${responsesBasePath}?exam=${encodeURIComponent(examId)}`;
            }}
          >
            {t('admin.grades.openInBuilder')}
          </Button>
        </p>
      ) : null}

      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      {sheet.rows.length === 0 ? (
        // Not an error: an exam whose audience is empty has nobody to mark, and
        // saying which is what stops it being read as a failed load.
        <p className="state" role="status">
          {/* **Not a defect, and the wording says so.** The audience is R58's:
              the named group, or the Level's students at the exam's branch
              (`Enrollment.branch_id`, R66). An empty sheet means nobody is
              enrolled there — which is a fact about enrolment, not about this
              screen, so it names where enrolment is managed. */}
          {t('admin.grades.noStudents')}{' '}
          <a href="/admin/groups">{t('admin.grades.noStudentsAction')}</a>
        </p>
      ) : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.grades.student')}</th>
                {/* **Owner-reported, 2026-09-16 — one row, one dialog.**
                    Physical-only condition matches the exam-wide link
                    above: a physical sitting has no submission to open. */}
                {sheet.exam.mode === 'online' ? <th scope="col" /> : null}
                {/* **Owner-reported, 2026-09-15 — per-question grading, one
                    column per question, where the exam uses R137's
                    points.** Replaces nothing: the total column stays,
                    read-only, derived from these. */}
                {sheet.questions?.map((q, i) => (
                  <th key={q.id} scope="col">
                    {t('assessments.question').replace('{n}', String(i + 1))}
                    {' — '}
                    {t('assessments.questionPointsOf').replace('{points}', String(q.points))}
                  </th>
                ))}
                <th scope="col">{t('admin.grades.mark').replace('{scale}', String(maxGrade))}</th>
                <th scope="col">{t('admin.grades.absent')}</th>
                {/* **No النتيجة column** (Owner decision, 2026-08-17). See the
                    note on the status cell below for what changed and what
                    deliberately did not. */}
                <th scope="col">{t('admin.grades.status')}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => {
                const draft = drafts[row.student_id] ?? { score: '', absent: false, questionScores: {} };
                return (
                  <tr key={row.student_id}>
                    <td>{row.student_name}</td>
                    {sheet.exam.mode === 'online' ? (
                      <td>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setOpenStudentId(row.student_id)}
                        >
                          {t('admin.grades.viewResponses')}
                        </Button>
                      </td>
                    ) : null}
                    {sheet.questions?.map((q) => (
                      <td key={q.id}>
                        <input
                          className="field__input"
                          type="number"
                          min={0}
                          max={q.points}
                          step="0.01"
                          inputMode="decimal"
                          disabled={draft.absent || busy}
                          value={draft.questionScores[q.id] ?? ''}
                          aria-label={`${t('assessments.questionPointsOf').replace('{points}', String(q.points))} — ${row.student_name}`}
                          onChange={(event) =>
                            setDrafts((d) => ({
                              ...d,
                              [row.student_id]: {
                                ...draft,
                                questionScores: { ...draft.questionScores, [q.id]: event.target.value },
                              },
                            }))
                          }
                        />
                      </td>
                    ))}
                    <td>
                      {sheet.questions ? (
                        // **Derived, never typed directly** — the sum of the
                        // per-question inputs beside it, exactly what the
                        // server itself computes on save.
                        <span aria-label={t('admin.grades.mark').replace('{scale}', String(maxGrade))}>
                          {draft.absent ? 0 : questionScoresTotal(draft)}
                        </span>
                      ) : (
                        <input
                          className="field__input"
                          type="number"
                          min={0}
                          max={maxGrade}
                          // Two decimals is what the column stores, so it is what
                          // the field offers — a finer step would be rounded on
                          // the way in and read back as a different number.
                          step="0.01"
                          inputMode="decimal"
                          // An absent student holds no mark to type (BR-7).
                          disabled={draft.absent || busy}
                          value={draft.score}
                          aria-label={`${t('admin.grades.mark').replace('{scale}', String(maxGrade))} — ${row.student_name}`}
                          onChange={(event) =>
                            setDrafts((d) => ({
                              ...d,
                              [row.student_id]: { ...draft, score: event.target.value },
                            }))
                          }
                        />
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={draft.absent}
                        disabled={busy}
                        aria-label={`${t('admin.grades.absent')} — ${row.student_name}`}
                        onChange={(event) =>
                          setDrafts((d) => ({
                            ...d,
                            [row.student_id]: {
                              ...draft,
                              score: event.target.checked ? '' : draft.score,
                              absent: event.target.checked,
                            },
                          }))
                        }
                      />
                    </td>
                    {/* **No verdict, and now nothing to compute one from**
                        (R81). The badge was removed first, on the Owner's
                        decision that a mark is a fact and «راسبة» is a verdict
                        about a person; the threshold, the computed `passed` and
                        BR-12's manual override have now been retired with it.
                        The MVP publishes a score out of a maximum and derives
                        nothing else — so there is no rule left here to
                        accidentally reimplement from the mark. */}
                    <td>
                      <Badge tone={row.status === 'published' ? 'ok' : 'neutral'}>
                        {t(
                          row.status === 'published'
                            ? 'admin.grades.statusPublished'
                            : 'admin.grades.statusDraft',
                        )}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="form__actions">
            <Button variant="secondary" disabled={busy} onClick={() => void save()}>
              {t('admin.grades.save')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void publish()}>
              {/* BR-8 — the same action, named for what it actually does this
                  time. A separate "re-publish" control would be a second verb
                  for one server operation. */}
              {t(sheet.has_published ? 'admin.grades.republish' : 'admin.grades.publish')}
            </Button>
          </div>
        </>
      )}

      {openStudentId ? (
        <ResponsesDialog
          examId={examId}
          accessToken={accessToken}
          studentId={openStudentId}
          studentName={sheet.rows.find((r) => r.student_id === openStudentId)?.student_name ?? ''}
          maxGrade={maxGrade}
          hasQuestions={sheet.questions !== undefined}
          questions={sheet.questions ?? []}
          draft={
            drafts[openStudentId] ?? { score: '', absent: false, questionScores: {} }
          }
          onDraft={(next) =>
            setDrafts((d) => ({ ...d, [openStudentId]: next }))
          }
          busy={busy}
          onSave={() => void saveOne(openStudentId)}
          onClose={() => setOpenStudentId(null)}
        />
      ) : null}
    </>
  );
}

/**
 * **Owner-reported, 2026-09-16 — one student's responses, beside her grading,
 * in one dialog.** Answers come from her own submission
 * (`GET /assessments/{id}/submissions/{studentId}`, R148's supervisor-widened
 * read) — `sheet.questions` alone carries no option labels or answer text,
 * only `{id, prompt, points}` (R137), so a marker who needed to see WHAT she
 * wrote had to leave for بناء الاختبارات's own read-only `SubmissionDialog`.
 * This is not a second implementation of that dialog: the question+answer
 * rendering mirrors it exactly (same fields, same layout), with editable
 * per-question grade inputs added beside each one.
 *
 * **Two ways to mark her, both legal, the SAME rule `entryPayload` already
 * applies**: a per-question score in every filled box sums to her total
 * automatically; leaving them all empty and typing directly into
 * «النقطة الإجمالية» sends that instead — `question_scores` only travels
 * when at least one is filled (BR-7's *unmarked ≠ zero* rule, restated
 * here so the choice is visible rather than a fact the marker has to infer).
 */
function ResponsesDialog({
  examId,
  accessToken,
  studentId,
  studentName,
  maxGrade,
  hasQuestions,
  questions,
  draft,
  onDraft,
  busy,
  onSave,
  onClose,
}: {
  examId: string;
  accessToken: string | null;
  studentId: string;
  studentName: string;
  maxGrade: number;
  hasQuestions: boolean;
  questions: { id: string; prompt: string; points: number }[];
  draft: Draft;
  onDraft: (next: Draft) => void;
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}): ReactNode {
  const [paper, setPaper] = useState<AssessmentPaper | null>(null);
  const [paperState, setPaperState] = useState<'loading' | 'ready' | 'error'>('loading');
  /**
   * **Whether THIS dialog has changed anything, since it opened** — the
   * `dirty` every `FormDialog` caller must report (the guard `Dialog`'s own
   * backdrop-dismiss/close-confirmation reads). Reset whenever a different
   * student's dialog opens; set the moment any field inside it is touched,
   * through `handleDraft` below rather than `onDraft` directly.
   */
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPaperState('loading');
    setDirty(false);
    void readSubmission(examId, studentId, accessToken)
      .then((next) => {
        if (!cancelled) {
          setPaper(next);
          setPaperState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setPaperState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [examId, studentId, accessToken]);

  function handleDraft(next: Draft): void {
    setDirty(true);
    onDraft(next);
  }

  // The full question, matched to her answer by id — `paper.questions` is
  // the SAME set `sheet.questions` names, plus the options/text this dialog
  // exists to show.
  const byQuestion = new Map((paper?.submission?.answers ?? []).map((a) => [a.question_id, a]));

  return (
    <FormDialog
      open
      wide
      title={`${t('assessments.openSubmission')} — ${studentName}`}
      busy={busy}
      dirty={dirty}
      submitLabel={t('admin.grades.save')}
      onSubmit={onSave}
      onCancel={onClose}
    >
      {paperState === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
      {paperState === 'error' ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : null}

      {paperState === 'ready' && !paper?.submission ? (
        <Feedback tone="warn">{t('admin.grades.noSubmissionYet')}</Feedback>
      ) : null}

      {paperState === 'ready' && paper ? (
        <ol className="assessment-questions">
          {paper.questions.map((q, index) => {
            const answer = byQuestion.get(q.id);
            const chosen = q.options.filter((o) => answer?.option_ids.includes(o.id));
            // `sheet.questions` (R137 points) and `paper.questions` (this
            // read's own list) name the SAME questions; matched by id since
            // one is the exam's grading view and the other its authoring one.
            const points = questions.find((sq) => sq.id === q.id)?.points;
            return (
              <li key={q.id}>
                <p>
                  <strong>{t('assessments.question').replace('{n}', String(index + 1))}</strong>{' '}
                  {q.prompt}
                  {points !== undefined ? (
                    <>
                      {' — '}
                      {t('assessments.questionPointsOf').replace('{points}', String(points))}
                    </>
                  ) : null}
                </p>
                {answer?.text ? <p>{answer.text}</p> : null}
                {chosen.length > 0 ? <p>{chosen.map((o) => o.label).join('، ')}</p> : null}
                {answer?.justification ? (
                  <p className="hint">
                    {t('assessments.yourJustification')}: {answer.justification}
                  </p>
                ) : null}
                {answer === undefined ? (
                  <p className="hint">{t('admin.grades.noAnswerYet')}</p>
                ) : null}
                {hasQuestions && points !== undefined ? (
                  <NumberField
                    label={t('admin.grades.mark').replace('{scale}', String(points))}
                    min={0}
                    max={points}
                    step="0.01"
                    disabled={draft.absent || busy}
                    value={draft.questionScores[q.id] ?? ''}
                    onChange={(next) =>
                      handleDraft({
                        ...draft,
                        questionScores: { ...draft.questionScores, [q.id]: next },
                      })
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {hasQuestions ? (
        <p aria-label={t('admin.grades.mark').replace('{scale}', String(maxGrade))}>
          <strong>{t('admin.grades.mark').replace('{scale}', String(maxGrade))}</strong>{' '}
          {draft.absent ? 0 : questionScoresTotal(draft)}
        </p>
      ) : null}

      {/* **Owner-reported, 2026-09-16 — reviewing without grading per
          question is a legal path, not a fallback.** Typed here, it wins
          over the per-question boxes above only when EVERY one of them is
          left empty — filling in even one sends `question_scores` instead
          (`entryPayload`'s own rule, stated so the choice is visible). */}
      <NumberField
        label={t('admin.grades.totalOverride')}
        hint={hasQuestions ? t('admin.grades.totalOverrideHint') : null}
        min={0}
        max={maxGrade}
        step="0.01"
        disabled={draft.absent || busy}
        value={draft.score}
        onChange={(next) => handleDraft({ ...draft, score: next })}
      />

      <CheckboxField
        label={t('admin.grades.absent')}
        checked={draft.absent}
        disabled={busy}
        onChange={(checked) =>
          handleDraft({ ...draft, score: checked ? '' : draft.score, absent: checked })
        }
      />
    </FormDialog>
  );
}

/** The server's own reason where it gave one — never a generic failure. */
function refusalText(error: unknown): string {
  if (!(error instanceof ApiError)) return t('common.saveFailed');
  const reason = error.details['reason'];
  if (reason === 'NOT_IN_AUDIENCE') return t('admin.grades.notInAudience');
  if (reason === 'NOTHING_TO_PUBLISH') return t('admin.grades.nothingToPublish');
  if (error.status === 409) return t('admin.grades.versionConflict');
  if (error.status === 403) return t('admin.grades.outOfScope');
  return t('common.saveFailed');
}
