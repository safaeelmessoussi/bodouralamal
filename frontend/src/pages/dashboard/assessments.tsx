import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  myAssessments,
  readPaper,
  saveResponses,
  submitResponses,
  type AssessmentPaper,
  type StudentAssessment,
} from '../../adapters/assessments.js';
import { fetchMyGrades, type PublishedGrade } from '../../adapters/grades.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type SortState } from '../../components/ui/data-table.js';
import { ChoiceField, TextArea, TextField } from '../../components/ui/field.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { Feedback } from '../../components/ui/feedback.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { sortRows } from '../../lib/sort-rows.js';

/**
 * **اختباراتي — the beneficiary's exams AND grades, one table** (Owner-reported,
 * 2026-09-16, merging the separate «نقاطي» screen into this one).
 *
 * ## Why one table, not two screens
 *
 * The two screens answered the same underlying question — *what exams concern
 * me, and where do things stand* — from two disjoint sources: `/me/assessments`
 * (every ONLINE exam she may open, whether or not it is graded yet) and
 * `/students/me/grades` (every PUBLISHED grade, on EITHER mode). Neither alone
 * was the whole picture: an online exam with no grade yet was invisible on
 * «نقاطي», and a physical sitting was invisible on «اختباراتي» — it has no paper
 * to open here at all. Both reads are kept exactly as they were (§5.3's
 * "published only" rule for a grade is untouched); this page merges their two
 * row sets by exam id instead of building a third read.
 *
 * ## طريقة الحضور decides what a row offers
 *
 * «مراجعة إجاباتي»/«فتح» and «الحالة» exist only because an ONLINE exam is
 * answered through this platform — a physical sitting is not, so neither has
 * anything to show for it. Every row still carries `طريقة الحضور` and, once
 * published, её grade — the two facts that apply regardless of mode.
 *
 * ## Fixed alongside the merge: a parent acting for a child could not open this
 * page at all
 *
 * `myAssessments` never sent `X-Active-Child-ID`, so a parent viewing her
 * child's اختباراتي got a `400` from `resolveActingStudent` (§4.3) — the same
 * middleware `/students/me/grades` already satisfies correctly. Both reads now
 * carry the active-child header identically.
 *
 * ## Save is not Submit
 *
 * Unchanged from before the merge: **حفظ** leaves a draft; **إرسال** is final
 * and asks for confirmation first. Nothing autosaves and nothing autosubmits.
 */
export function StudentAssessmentsPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeRole } = useActiveRole();
  const { activeChild, activeChildId } = useActiveChild();

  const [assessmentRows, setAssessmentRows] = useState<StudentAssessment[]>([]);
  const [gradeRows, setGradeRows] = useState<PublishedGrade[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  /** Kept rather than discarded: `ErrorState` turns the actual failure into the
   *  right sentence and the right next action — a 403 and a dropped connection
   *  need different words. Throwing it away forces one generic line on both. */
  const [failure, setFailure] = useState<unknown>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  /**
   * **R136 — «بدء الاختبار» on the calendar occurrence dialog deep-links
   * here**, the same `?exam=` pattern بناء الاختبارات already uses. Read
   * once, on mount: a later render must not reopen a paper she has closed.
   */
  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('exam'),
  );

  const asParent = activeRole === 'parent';
  const childHeader = asParent ? activeChildId : null;
  const awaitingChild = asParent && activeChildId === null;

  const load = useCallback(async () => {
    // A parent who has not chosen a child yet has no subject to ask about —
    // both reads would 400 on the missing header, and it is not sent because
    // there is genuinely nothing to name.
    if (awaitingChild) {
      setAssessmentRows([]);
      setGradeRows([]);
      setState('ready');
      return;
    }
    setState('loading');
    setFailure(null);
    try {
      const [assessments, grades] = await Promise.all([
        myAssessments(accessToken, childHeader),
        fetchMyGrades(accessToken, childHeader),
      ]);
      setAssessmentRows(assessments);
      setGradeRows(grades);
      setState('ready');
    } catch (error) {
      setFailure(error);
      setState('error');
    }
  }, [accessToken, childHeader, awaitingChild]);

  useEffect(() => {
    void load();
  }, [load]);

  const merged = useMemo(() => mergeRows(assessmentRows, gradeRows), [assessmentRows, gradeRows]);
  const sorted = sortRows(merged, sort, {
    title: (r) => r.title,
    date: (r) => r.date,
    subject: (r) => r.subjectName ?? r.levelName,
    mode: (r) => r.mode,
    state: (r) => r.state,
    score: (r) => r.score,
  });

  if (openId !== null) {
    return (
      <Paper
        examId={openId}
        token={accessToken}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  const columns: Column<MergedExamRow>[] = [
    { key: 'title', sortKey: 'title', header: t('assessments.name'), cell: (row) => row.title },
    {
      key: 'date',
      sortKey: 'date',
      header: t('assessments.date'),
      cell: (row) => formatDate(row.date),
    },
    {
      key: 'subject',
      sortKey: 'subject',
      header: t('student.grades.subject'),
      secondary: true,
      cell: (row) => row.subjectName ?? row.levelName ?? <span className="muted">—</span>,
    },
    {
      // طريقة الحضور — every row states it, whatever else it does or does not offer.
      key: 'mode',
      sortKey: 'mode',
      header: t('assessments.attendanceMethod'),
      cell: (row) => t(row.mode === 'online' ? 'assessments.modeOnline' : 'assessments.modePhysical'),
    },
    {
      // الحالة — only a remote exam has an interaction of hers to report.
      key: 'state',
      sortKey: 'state',
      header: t('assessments.filterStatus'),
      cell: (row) =>
        row.mode !== 'online' ? (
          <span className="muted">—</span>
        ) : (
          <Badge tone={row.state === 'submitted' ? 'ok' : 'neutral'}>
            {t(
              row.state === 'submitted'
                ? 'assessments.sent'
                : row.state === 'in_progress'
                  ? 'assessments.saved'
                  : 'assessments.notStarted',
            )}
          </Badge>
        ),
    },
    {
      key: 'score',
      sortKey: 'score',
      header: t('student.grades.score'),
      numeric: true,
      cell: (row) =>
        !row.gradePublished ? (
          <span className="muted">—</span>
        ) : row.absent ? (
          // BR-7's absent-zero is a `0` in the data, and rendering it as a mark
          // would report a score for a sitting she did not attend.
          <Badge tone="neutral">{t('student.grades.absent')}</Badge>
        ) : (
          `${row.score} / ${row.maxGrade}`
        ),
    },
    {
      // مراجعة إجاباتي / فتح — only a remote exam is answered through this platform.
      key: 'action',
      header: t('common.actions'),
      cell: (row) =>
        row.mode === 'online' ? (
          <Button variant="secondary" onClick={() => setOpenId(row.id)}>
            {t(row.state === 'submitted' ? 'assessments.review' : 'assessments.open')}
          </Button>
        ) : null,
    },
  ];

  return (
    <StudentLayout title={t('assessments.navStudent')} lede={t('assessments.studentLede')}>
      {/* R62.10 — persistent, and the first thing under the heading. A parent
          looking at the wrong child's exams must find that out by reading the
          screen. */}
      {asParent ? (
        <p className="state" role="status">
          {activeChild
            ? t('studentDashboard.viewingChild').replace('{name}', activeChild.label)
            : t('studentDashboard.chooseChild')}
        </p>
      ) : null}

      {/**
        * **The table stays, even with nothing in it** (Owner, 2026-09-15) —
        * the same rule `DataTable` already states for every admin list.
        */}
      <DataTable<MergedExamRow>
        caption={t('assessments.navStudent')}
        columns={columns}
        rows={sorted}
        sort={sort}
        onSort={setSort}
        rowKey={(row) => row.id}
        status={state}
        error={failure}
        onRetry={() => void load()}
      />
    </StudentLayout>
  );
}

interface MergedExamRow {
  id: string;
  title: string;
  date: string;
  mode: 'online' | 'physical';
  subjectName: string | null;
  levelName: string;
  /** `null` for a physical row — she has no interaction with it here. */
  state: string | null;
  gradePublished: boolean;
  score: number | null;
  maxGrade: number | null;
  absent: boolean;
}

/**
 * `/me/assessments` (online exams she may open, graded or not) and
 * `/students/me/grades` (published grades, either mode) merged by exam id.
 * An id absent from the grade list is simply not yet published — the online
 * row alone still carries title/date/state. An id absent from the assessment
 * list is a physical sitting, or an online exam graded without ever gaining a
 * submission row; either way `mode` on the grade row itself (not an
 * assumption) says which.
 */
function mergeRows(assessments: StudentAssessment[], grades: PublishedGrade[]): MergedExamRow[] {
  const gradeById = new Map(grades.map((g) => [g.exam_id, g]));
  const assessmentById = new Map(assessments.map((a) => [a.id, a]));
  const ids = new Set<string>([...assessmentById.keys(), ...gradeById.keys()]);
  return [...ids].map((id) => {
    const a = assessmentById.get(id) ?? null;
    const g = gradeById.get(id) ?? null;
    return {
      id,
      title: a?.title ?? g!.exam_title,
      date: a?.date ?? g!.date,
      mode: g?.mode ?? 'online',
      subjectName: a?.subject_name ?? g?.subject_name ?? null,
      levelName: a?.level_name ?? g?.level_name ?? '',
      state: a?.state ?? null,
      gradePublished: g !== null,
      score: g?.score ?? null,
      maxGrade: g?.max_grade ?? null,
      absent: g?.absent ?? false,
    };
  });
}

interface Draft {
  text: string;
  justification: string;
  optionIds: string[];
}

function Paper({
  examId,
  token,
  onBack,
}: {
  examId: string;
  token: string | null;
  onBack: () => void;
}): ReactNode {
  const [paper, setPaper] = useState<AssessmentPaper | null>(null);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    void readPaper(examId, token)
      .then((loaded) => {
        if (!live) return;
        setPaper(loaded);
        const seeded: Record<string, Draft> = {};
        for (const question of loaded.questions) {
          const answer = loaded.submission?.answers.find((a) => a.question_id === question.id);
          seeded[question.id] = {
            text: answer?.text ?? '',
            justification: answer?.justification ?? '',
            optionIds: answer?.option_ids ?? [],
          };
        }
        setDraft(seeded);
        setState('ready');
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [examId, token]);

  const sent = paper?.submission?.state === 'submitted';

  function payload(): Parameters<typeof saveResponses>[1] {
    if (!paper) return [];
    return paper.questions.map((q) => {
      const value = draft[q.id] ?? { text: '', justification: '', optionIds: [] };
      const isChoice = q.kind === 'single_choice' || q.kind === 'multiple_choice';
      return {
        question_id: q.id,
        // Shaped by the question's kind — the server refuses the wrong shape
        // rather than dropping it, so sending one would be a refusal she could
        // not act on.
        ...(isChoice
          ? {
              option_ids: value.optionIds,
              ...(q.justification === 'none' ? {} : { justification: value.justification }),
            }
          : { text: value.text }),
      };
    });
  }

  async function run(final: boolean): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const result = final
        ? await submitResponses(examId, payload(), token)
        : await saveResponses(examId, payload(), token);
      if (result.state === 'submitted') {
        setPaper((p) => (p === null ? p : { ...p, submission: { ...(p.submission ?? { answers: [], submitted_at: null }), state: 'submitted', submitted_at: null, answers: p.submission?.answers ?? [] } }));
        setNotice(t('assessments.submittedNotice'));
      } else {
        setNotice(t('assessments.saved'));
      }
    } catch {
      setNotice(t(final ? 'assessments.submitFailed' : 'assessments.saveFailed'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  function toggle(question: AssessmentPaper['questions'][number], optionId: string): void {
    const current = draft[question.id] ?? { text: '', justification: '', optionIds: [] };
    const next =
      question.kind === 'single_choice'
        ? [optionId]
        : current.optionIds.includes(optionId)
          ? current.optionIds.filter((id) => id !== optionId)
          : [...current.optionIds, optionId];
    setDraft({ ...draft, [question.id]: { ...current, optionIds: next } });
  }

  // R146 — every page renders inside the platform's chrome, no exceptions
  // (Owner, 2026-09-15): this sub-component used to return bare content for
  // all three states, escaping `StudentAssessmentsPage`'s `StudentLayout`
  // entirely once a paper was open. `title`/`lede` are stated once here since
  // `paper` is only available in the ready state.
  if (state === 'loading') {
    return (
      <StudentLayout title={t('assessments.navStudent')}>
        <p className="hint">{t('common.loading')}</p>
      </StudentLayout>
    );
  }
  if (state === 'error' || paper === null) {
    return (
      <StudentLayout title={t('assessments.navStudent')}>
        <p>
          <Button variant="ghost" onClick={onBack}>
            {t('common.back')}
          </Button>
        </p>
        <Feedback tone="warn">{t('assessments.loadFailed')}</Feedback>
      </StudentLayout>
    );
  }

  return (
    <StudentLayout title={paper.title} lede={paper.description ?? null}>
      <p>
        <Button variant="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
      </p>
      {notice ? <Feedback>{notice}</Feedback> : null}
      {sent ? <Feedback>{t('assessments.submittedNotice')}</Feedback> : null}

      <ol className="assessment-questions">
        {paper.questions.map((q, index) => {
          const value = draft[q.id] ?? { text: '', justification: '', optionIds: [] };
          return (
            <li key={q.id}>
              <p>
                <strong>{t('assessments.question').replace('{n}', String(index + 1))}</strong>{' '}
                {q.prompt}
              </p>

              {q.kind === 'short_text' ? (
                <TextField
                  label={t('assessments.yourAnswer')}
                  value={value.text}
                  onChange={(next) => setDraft({ ...draft, [q.id]: { ...value, text: next } })}
                  disabled={sent}
                />
              ) : null}
              {q.kind === 'long_text' ? (
                <TextArea
                  label={t('assessments.yourAnswer')}
                  value={value.text}
                  onChange={(next) => setDraft({ ...draft, [q.id]: { ...value, text: next } })}
                  disabled={sent}
                />
              ) : null}

              {q.options.length > 0 ? (
                <ul className="assessment-options">
                  {q.options.map((option) => (
                    <li key={option.id}>
                      {/* `radio` for one choice and `checkbox` for many — the
                          control itself says how many answers are allowed,
                          which is the rule the server enforces anyway. */}
                      {q.kind === 'single_choice' ? (
                        <ChoiceField
                          type="radio"
                          name={q.id}
                          label={option.label}
                          checked={value.optionIds.includes(option.id)}
                          disabled={sent}
                          onChange={() => toggle(q, option.id)}
                        />
                      ) : (
                        <ChoiceField
                          label={option.label}
                          checked={value.optionIds.includes(option.id)}
                          disabled={sent}
                          onChange={() => toggle(q, option.id)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              {q.justification !== 'none' ? (
                <TextArea
                  label={t('assessments.yourJustification')}
                  value={value.justification}
                  onChange={(next) =>
                    setDraft({ ...draft, [q.id]: { ...value, justification: next } })
                  }
                  disabled={sent}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {sent ? (
        <p className="hint">{t('assessments.gradeWithheld')}</p>
      ) : (
        <p>
          {/* Two buttons, and only one of them cannot be undone. */}
          <Button variant="secondary" disabled={busy} onClick={() => void run(false)}>
            {t('assessments.save')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>
            {t('assessments.submit')}
          </Button>
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title={t('assessments.submit')}
        body={t('assessments.submitConfirm')}
        confirmLabel={t('assessments.submit')}
        busy={busy}
        onConfirm={() => void run(true)}
        onCancel={() => setConfirming(false)}
      />
    </StudentLayout>
  );
}
