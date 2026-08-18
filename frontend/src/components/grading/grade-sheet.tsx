import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchGradeSheet,
  publishGrades,
  saveGrades,
  type GradeSheet,
  type GradeSheetRow,
} from '../../adapters/grades.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
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
}

function draftFrom(row: GradeSheetRow): Draft {
  return {
    score: row.score === null ? '' : String(row.score),
    absent: row.absent,
  };
}

export function GradeSheetView({
  examId,
  onMaxGrade,
}: {
  examId: string;
  /** Reports **this exam's** maximum (R81) so a surrounding frame can name it
   *  without fetching the sheet a second time. */
  onMaxGrade?: (maxGrade: number) => void;
}): ReactNode {
  const { accessToken } = useSession();

  const [sheet, setSheet] = useState<GradeSheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          const draft = drafts[row.student_id] ?? { score: '', absent: false };
          return {
            student_id: row.student_id,
            // `''` stays null all the way to the server: unmarked is not zero,
            // and BR-7 is what decides what becomes of it.
            score: draft.absent || draft.score.trim() === '' ? null : Number(draft.score),
            absent: draft.absent,
            ...(row.version === null ? {} : { version: row.version }),
          };
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
        {t('common.loadFailed')}
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
                const draft = drafts[row.student_id] ?? { score: '', absent: false };
                return (
                  <tr key={row.student_id}>
                    <td>{row.student_name}</td>
                    <td>
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
    </>
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
