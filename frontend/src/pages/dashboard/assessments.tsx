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
import { ChoiceField, TextArea, TextField } from '../../components/ui/field.js';
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
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setRows(await myAssessments(accessToken));
      setState('ready');
    } catch {
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

  return (
    <section>
      <h1>{t('assessments.navStudent')}</h1>
      <p>{t('assessments.studentLede')}</p>
      {state === 'loading' ? <p className="hint">{t('common.loading')}</p> : null}
      {state === 'error' ? <Feedback tone="warn">{t('assessments.loadFailed')}</Feedback> : null}
      {state === 'ready' && rows.length === 0 ? (
        <p className="hint">{t('assessments.emptyStudent')}</p>
      ) : null}

      <ul className="assessment-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span>{row.title}</span>
            <Badge tone={row.state === 'submitted' ? 'ok' : 'neutral'}>
              {t(
                row.state === 'submitted'
                  ? 'assessments.sent'
                  : row.state === 'in_progress'
                    ? 'assessments.saved'
                    : 'assessments.notStarted',
              )}
            </Badge>
            {row.grade_published ? (
              <Badge tone="ok">{t('assessments.gradePublished')}</Badge>
            ) : null}
            <Button variant="secondary" onClick={() => setOpenId(row.id)}>
              {t(row.state === 'submitted' ? 'assessments.review' : 'assessments.open')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
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

  if (state === 'loading') return <p className="hint">{t('common.loading')}</p>;
  if (state === 'error' || paper === null) {
    return <Feedback tone="warn">{t('assessments.loadFailed')}</Feedback>;
  }

  return (
    <section>
      <p>
        <Button variant="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
      </p>
      <h1>{paper.title}</h1>
      {paper.description ? <p>{paper.description}</p> : null}
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
    </section>
  );
}
