import { useEffect, useState, type ReactNode } from 'react';

import type { EnrollmentRowView } from '../../adapters/enrollments.js';
import {
  listLevelCompletions,
  type LevelCompletionRow,
} from '../../adapters/level-completions.js';
import { t } from '../../i18n/index.js';
import { levelLabel } from '../scope/level-select.js';
import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';
import { LevelCompletionPanel } from './level-completion-panel.js';

/**
 * **«إدارة التسجيلات» — every placement of ONE مستفيدة, in one dialog** (Owner,
 * 2026-09-21; SRS Revision 167 §3).
 *
 * It owns no rule and no write of its own. Editing and ending a placement and
 * placing her in another Level are the page's existing dialogs, opened ON TOP of
 * this one (a native `<dialog>` stacks in the top layer), so she comes back to
 * the same list with the change in it. «إتمام المستوى» sits under the Level it
 * is about, with what BR-11 reads said in words before anything is pressed.
 *
 * `student` is derived by the page from its loaded rows on every render, so
 * this never shows a snapshot; `refreshKey` re-reads the completion facts after
 * any change made from here.
 */
export function StudentEnrolmentsDialog({
  student,
  token,
  refreshKey,
  onClose,
  onEdit,
  onEnd,
  onAdd,
  onChanged,
}: {
  student: { id: string; name: string; enrolments: EnrollmentRowView[] };
  token: string | null;
  refreshKey: number;
  onClose: () => void;
  onEdit: (enrolment: EnrollmentRowView) => void;
  onEnd: (enrolment: EnrollmentRowView) => void;
  onAdd: () => void;
  onChanged: (message: string) => void;
}): ReactNode {
  const [completions, setCompletions] = useState<LevelCompletionRow[] | 'loading' | 'error'>('loading');
  const levelKey = student.enrolments.map((e) => e.level_id).join(',');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listLevelCompletions(student.id, token);
        if (!cancelled) setCompletions(rows);
      } catch {
        if (!cancelled) setCompletions('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // `levelKey`: a placement added or ended from here changes which Levels
    // there are to ask about.
  }, [student.id, token, refreshKey, levelKey]);

  const completionOf = (levelId: string): LevelCompletionRow | null =>
    Array.isArray(completions) ? (completions.find((row) => row.level_id === levelId) ?? null) : null;

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={t('admin.enrollments.placementsTitle').replace('{name}', student.name)}
    >
      <p className="field__hint">{t('admin.enrollments.manageLede')}</p>

      {student.enrolments.length === 0 ? (
        <p className="muted" data-no-enrolments>
          {t('admin.enrollments.manageEmpty')}
        </p>
      ) : (
        <ul className="enrolment-cards">
          {student.enrolments.map((enrolment) => {
            const completion = completionOf(enrolment.level_id);
            return (
              <li key={enrolment.id} className="enrolment-card" data-enrolment={enrolment.id}>
                <div className="enrolment-card__head">
                  <div>
                    <strong className="enrolment-card__level">
                      {levelLabel({
                        id: enrolment.level_id,
                        name: enrolment.level_name,
                        category_name: enrolment.category_name,
                      })}
                    </strong>
                    <span className="muted">
                      {[
                        enrolment.branch_name,
                        enrolment.administrative_group_name ?? t('admin.enrollments.noGroup'),
                        enrolment.academic_year_label,
                      ]
                        .filter((part): part is string => Boolean(part))
                        .join(' · ')}
                    </span>
                  </div>
                  <div className="enrolment-card__actions">
                    <Button variant="secondary" onClick={() => onEdit(enrolment)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="danger" onClick={() => onEnd(enrolment)}>
                      {t('admin.enrollments.end')}
                    </Button>
                  </div>
                </div>

                <div className="enrolment-card__completion">
                  <h3 className="enrolment-card__subtitle">
                    {t('admin.enrollments.completion.heading')}
                  </h3>
                  {completions === 'loading' ? (
                    <span className="skeleton skeleton--wide" />
                  ) : completions === 'error' ? (
                    <p className="field__error">{t('admin.enrollments.completionLoadFailed')}</p>
                  ) : completion ? (
                    <LevelCompletionPanel
                      studentId={student.id}
                      studentName={student.name}
                      row={completion}
                      token={token}
                      onChanged={onChanged}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="enrolment-cards__add">
        <Button variant="add" onClick={onAdd}>
          {student.enrolments.length === 0
            ? t('admin.enrollments.addFirst')
            : t('admin.enrollments.addAnother')}
        </Button>
      </div>
    </Dialog>
  );
}
