import { useState, type ReactNode } from 'react';

import {
  issueLevelCertificate,
  markLevelCompleted,
  unmarkLevelCompleted,
  withdrawLevelCertificate,
  type LevelCompletionRow,
} from '../../adapters/level-completions.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { formatDate } from '../../lib/format-date.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';

/**
 * **«إتمام المستوى», under one Level of one مستفيدة** (SRS Revision 167 §3).
 *
 * It says two different things and never blurs them: what BR-11 reads today
 * (الحفظ، واختبارات التفسير where the Level has them), and what the
 * administration recorded. Where BR-11 is not met the panel SAYS so, under the
 * Level, before anything is pressed — and marking anyway asks her to confirm she
 * has read it. The server enforces the same thing (`REQUIREMENTS_NOT_MET`); this
 * is the courtesy of being told first, never the rule.
 */
type Ask = 'mark' | 'unmark' | 'issue' | 'withdraw';

/** What is missing, in words — or `null` when nothing is. Pure, and tested. */
export function unmetSummary(requirements: LevelCompletionRow['requirements']): string | null {
  if (requirements.complete === true) return null;
  if (requirements.complete === null) return t('admin.enrollments.completion.noSyllabus');
  const parts: string[] = [];
  if (requirements.memorised_surahs < requirements.configured_surahs) {
    parts.push(
      t('admin.enrollments.completion.unmetMemorisation')
        .replace('{done}', String(requirements.memorised_surahs))
        .replace('{total}', String(requirements.configured_surahs)),
    );
  }
  if (requirements.exams_required && requirements.examined_surahs < requirements.configured_surahs) {
    parts.push(
      t('admin.enrollments.completion.unmetExams')
        .replace('{done}', String(requirements.examined_surahs))
        .replace('{total}', String(requirements.configured_surahs)),
    );
  }
  return `${t('admin.enrollments.completion.unmetLead')} ${parts.join('، ')}.`;
}

export function LevelCompletionPanel({
  studentId,
  studentName,
  row,
  token,
  onChanged,
}: {
  studentId: string;
  studentName: string;
  row: LevelCompletionRow;
  token: string | null;
  onChanged: (message: string) => void;
}): ReactNode {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unmet = unmetSummary(row.requirements);
  const mark = row.mark;
  const issued = mark !== null && mark.certificate_issued_on !== null;

  async function run(): Promise<void> {
    if (ask === null) return;
    setBusy(true);
    setError(null);
    try {
      if (ask === 'mark') {
        // She has just read what is missing, in the confirmation itself.
        await markLevelCompleted(studentId, row.level_id, unmet !== null, token);
        onChanged(t('admin.enrollments.completion.marked'));
      } else if (ask === 'unmark') {
        await unmarkLevelCompleted(studentId, row.level_id, token);
        onChanged(t('admin.enrollments.completion.unmarked'));
      } else if (ask === 'issue') {
        await issueLevelCertificate(studentId, row.level_id, token);
        onChanged(t('admin.enrollments.completion.issued'));
      } else {
        await withdrawLevelCertificate(studentId, row.level_id, token);
        onChanged(t('admin.enrollments.completion.withdrawn'));
      }
    } catch (failure) {
      const reason =
        failure instanceof ApiError ? (failure.details?.['reason'] as string | undefined) : undefined;
      setError(
        reason === 'CERTIFICATE_ISSUED'
          ? t('admin.enrollments.completion.refusedCertificateIssued')
          : t('common.saveFailed'),
      );
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  const confirmCopy: Record<Ask, { title: string; body: string; label: string; danger: boolean }> = {
    mark: {
      title: t('admin.enrollments.completion.markTitle'),
      body:
        unmet === null
          ? t('admin.enrollments.completion.markBodyMet').replace('{name}', studentName)
          : t('admin.enrollments.completion.markBodyUnmet').replace('{name}', studentName),
      label: t('admin.enrollments.completion.mark'),
      danger: unmet !== null,
    },
    unmark: {
      title: t('admin.enrollments.completion.unmarkTitle'),
      body: t('admin.enrollments.completion.unmarkBody'),
      label: t('admin.enrollments.completion.unmark'),
      danger: true,
    },
    issue: {
      title: t('admin.enrollments.completion.issueTitle'),
      body: t('admin.enrollments.completion.issueBody').replace('{name}', studentName),
      label: t('admin.enrollments.completion.issue'),
      danger: false,
    },
    withdraw: {
      title: t('admin.enrollments.completion.withdrawTitle'),
      body: t('admin.enrollments.completion.withdrawBody'),
      label: t('admin.enrollments.completion.withdraw'),
      danger: true,
    },
  };

  return (
    <div className="completion-panel" data-level-completion={row.level_id}>
      {mark === null ? (
        <>
          {unmet === null ? (
            <p className="completion-panel__status">
              <Badge tone="ok">{t('admin.enrollments.completion.met')}</Badge>
            </p>
          ) : (
            // Under the Level, before anything is pressed (the Owner's words).
            <p className="completion-panel__warning" role="note" data-unmet>
              {unmet}
            </p>
          )}
          <div className="completion-panel__actions">
            <Button variant="secondary" onClick={() => setAsk('mark')}>
              {t('admin.enrollments.completion.mark')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="completion-panel__status">
            <Badge tone="ok">{t('admin.enrollments.completion.completed')}</Badge>{' '}
            {t('admin.enrollments.completion.completedOn')
              .replace('{date}', formatDate(mark.completed_on))
              .replace('{by}', mark.completed_by_name)}
          </p>
          {!mark.requirements_met ? (
            <p className="field__hint">{t('admin.enrollments.completion.markedWhileUnmet')}</p>
          ) : null}
          {unmet !== null ? (
            <p className="completion-panel__warning" role="note" data-unmet>
              {unmet}
            </p>
          ) : null}
          <p className="completion-panel__status">
            {issued
              ? t('admin.enrollments.completion.certificateShown')
                  .replace('{number}', String(mark.certificate_number))
                  .replace('{date}', formatDate(mark.certificate_issued_on))
              : t('admin.enrollments.completion.certificateHidden')}
          </p>
          <div className="completion-panel__actions">
            {issued ? (
              <Button variant="secondary" onClick={() => setAsk('withdraw')}>
                {t('admin.enrollments.completion.withdraw')}
              </Button>
            ) : (
              <>
                <Button variant="primary" onClick={() => setAsk('issue')}>
                  {t('admin.enrollments.completion.issue')}
                </Button>
                <Button variant="ghost" onClick={() => setAsk('unmark')}>
                  {t('admin.enrollments.completion.unmark')}
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={ask !== null}
        title={ask ? confirmCopy[ask].title : ''}
        body={ask ? confirmCopy[ask].body : ''}
        details={ask === 'mark' && unmet !== null ? <p className="completion-panel__warning">{unmet}</p> : undefined}
        confirmLabel={ask ? confirmCopy[ask].label : ''}
        danger={ask ? confirmCopy[ask].danger : false}
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setAsk(null)}
      />
    </div>
  );
}
