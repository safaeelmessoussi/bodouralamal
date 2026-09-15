import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  myAssessments,
  readPaper,
  saveResponses,
  submitResponses,
  type AssessmentPaper,
  type StudentAssessment,
} from '../../adapters/assessments.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column } from '../../components/ui/data-table.js';
import { ChoiceField, TextArea, TextField } from '../../components/ui/field.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { Feedback } from '../../components/ui/feedback.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * **اختباراتي — the beneficiary's own assessments** (SRS §4.6, R124).
 *
 * ## What she sees, and what she does not
 *
 * Her own papers and her own answers. **Never the roster, never another
 * student's response, never an answer key** — the server refuses all three, and
 * this screen has no route that could ask for them.
 *
 * ## Save is not Submit
 *
 * The distinction is the Owner's and it is the whole shape of this page. **حفظ**
 * leaves a draft she can come back to; **إرسال** is final and asks for
 * confirmation in Arabic first. **Nothing autosaves and nothing autosubmits** —
 * a closed browser leaves a draft, which is what a person expects, and an
 * assessment that submitted itself because a phone locked would be a mark
 * nobody chose to hand in.
 *
 * ## The grade is not here
 *
 * It reaches her through «نقاطي», the screen that already shows published
 * grades — and only once published. This page says whether it has been, and
 * nothing more.
 */
export function StudentAssessmentsPage(): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<StudentAssessment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  /** Kept rather than discarded: `ErrorState` turns the actual failure into the
   *  right sentence and the right next action — a 403 and a dropped connection
   *  need different words. Throwing it away forces one generic line on both. */
  const [failure, setFailure] = useState<unknown>(null);
  /**
   * **R136 — «بدء الاختبار» on the calendar occurrence dialog deep-links
   * here**, the same `?exam=` pattern بناء الاختبارات already uses. Read
   * once, on mount: a later render must not reopen a paper she has closed.
   */
  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('exam'),
  );

  const load = useCallback(async () => {
    setState('loading');
    setFailure(null);
    try {
      setRows(await myAssessments(accessToken));
      setState('ready');
    } catch (error) {
      setFailure(error);
      setState('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** «فتح» / «مراجعة إجاباتي» differ by row state — a `Column.cell` closure
   *  rather than `DataTable`'s `actions`, whose label is fixed per action. */
  const columns: Column<StudentAssessment>[] = [
    { key: 'title', header: t('assessments.name'), cell: (row) => row.title },
    {
      key: 'state',
      header: t('assessments.filterStatus'),
      cell: (row) => (
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
      key: 'grade',
      header: t('assessments.gradePublished'),
      cell: (row) => (row.grade_published ? <Badge tone="ok">{t('assessments.gradePublished')}</Badge> : null),
    },
    {
      key: 'action',
      header: t('common.actions'),
      cell: (row) => (
        <Button variant="secondary" onClick={() => setOpenId(row.id)}>
          {t(row.state === 'submitted' ? 'assessments.review' : 'assessments.open')}
        </Button>
      ),
    },
  ];

  return (
    /**
     * **Inside `StudentLayout`, like every one of her other screens.**
     *
     * It was the only student page that rendered a bare `<section>` with its own
     * `<h1>`: no header, no navigation, no shell — a route that looked
     * unfinished and, worse, gave her no way back to the rest of her portal.
     * The title and lede are the layout's props, so they are not stated twice.
     */
    <StudentLayout title={t('assessments.navStudent')} lede={t('assessments.studentLede')}>
      {/**
        * **The table stays, even with nothing in it** (Owner, 2026-09-15) —
        * the same rule `DataTable` already states for every admin list
        * (2026-08-30): a screen with zero rows should still show what it
        * would hold, not collapse to a bare paragraph. This page used to be
        * the one exception, with a hand-rolled `<ul>` and a separate
        * `EmptyState` that replaced the whole list instead of living inside
        * it — migrated to the shared component rather than teaching the same
        * rule a second time.
        */}
      <DataTable<StudentAssessment>
        caption={t('assessments.navStudent')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status={state}
        error={failure}
        onRetry={() => void load()}
      />
    </StudentLayout>
  );
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
