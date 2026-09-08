import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { copyAssessment } from '../../adapters/assessments.js';
import { examAudienceLabel, listExams, type Exam } from '../../adapters/exams.js';
import { GradeSheetView } from '../../components/grading/grade-sheet.js';
import { Feedback } from '../../components/ui/feedback.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { Button } from '../../components/ui/button.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { SearchInput } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';

/**
 * `/teacher/exams` — **الامتحانات** (§14.1, §4.6, SRS Revision 70, unified by
 * R136).
 *
 * Blocked until R70 with *"the exam-building and marking interfaces are not
 * available yet"*. R70 unblocked the marking half; R124 built the online
 * paper (authored on `/teacher/assessments`, one of her three roles); R136
 * (Codex H1) widened `GET /exams` so this list surfaces a scheduled online
 * occurrence exactly as it does a physical one — a مؤطِّرة's grading no
 * longer has a mode this screen cannot reach.
 *
 * **The sheet is `GradeSheetView`, the very component `/admin/exam-grades`
 * renders.** R70.1 requires one implementation with two ways in, and a teacher
 * portal that grew its own copy is precisely the drift R69 spent a revision
 * removing elsewhere.
 *
 * **The list is the same role-scoped endpoint the back office uses.** A teacher
 * receives the exams their §4.4c scope reaches, because `GET /exams` filters
 * server-side — there is no teacher-specific route returning an identical
 * representation, which is the decision already taken for course schedules.
 *
 * **The list is the shared `DataTable` now** (2026-08-17). It was hand-rolled
 * `<table className="admin-table">` with its own loading, error and empty
 * paragraphs — so the same list rendered differently here and in the back
 * office, and none of the difference was a decision anyone took. This screen and
 * `/admin/exam-grades` are now the same table with the same columns, which is
 * what R70.1's *"one screen, two ways in"* should have meant for the list as well
 * as for the sheet.
 *
 * **No add button, and that is TD-2 rather than an omission.** R70.4 grants a
 * مؤطرة *create/edit an exam sitting* in her §4.4c scope, and she does that on
 * `/teacher/schedules` — the one node for everything that appears on the calendar
 * (R56). A second authoring form here would be a second implementation of §4.6's
 * sitting.
 */
export function TeacherExamsPage(): ReactNode {
  const { accessToken } = useSession();
  const [exams, setExams] = useState<Exam[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [query, setQuery] = useState('');
  const [openExam, setOpenExam] = useState<Exam | null>(null);
  /** «إنشاء نسخة في بناء الاختبارات» (R136) — see `exam-grades.tsx`'s
   *  identical action for the full reasoning; this is the same call. */
  const [copying, setCopying] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setExams((await listExams(accessToken)).data);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (openExam) {
    return (
      // **The title stays the page's own**, as it does on `/admin/exam-grades`:
      // the exam is named once, by the sheet's summary block. It used to become
      // the heading, so the exam appeared twice three lines apart.
      <TeacherLayout title={t('teacher.nav.exams')} lede={t('admin.grades.lede').replace('{scale}', '20')}>
        <p>
          <Button variant="secondary" onClick={() => setOpenExam(null)}>
            {t('teacher.exams.backToList')}
          </Button>{' '}
          <Button
            variant="secondary"
            disabled={copying}
            onClick={() => {
              setCopying(true);
              setCopyFailed(false);
              copyAssessment(openExam.id, accessToken)
                .then(({ id }) => {
                  window.location.href = `/teacher/assessments?exam=${encodeURIComponent(id)}`;
                })
                .catch(() => {
                  setCopying(false);
                  setCopyFailed(true);
                });
            }}
          >
            {t('admin.grades.reuseAsDraft')}
          </Button>
        </p>
        {copyFailed ? <Feedback tone="warn">{t('admin.grades.reuseAsDraftFailed')}</Feedback> : null}
        <GradeSheetView examId={openExam.id} />
      </TeacherLayout>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = exams.filter((e) => needle === '' || e.title.toLowerCase().includes(needle));

  const columns: Column<Exam>[] = [
    { key: 'title', header: t('admin.grades.exam'), cell: (e) => e.title },
    { key: 'date', header: t('admin.grades.colDate'), cell: (e) => formatDate(e.date) },
    { key: 'level', header: t('admin.nav.levels'), cell: (e) => e.level_name ?? '—' },
    {
      key: 'subject',
      header: t('admin.schedules.subject'),
      secondary: true,
      cell: (e) => e.subject_name ?? '—',
    },
    {
      key: 'audience',
      header: t('admin.grades.colAudience'),
      secondary: true,
      // R136 (H1) — all five R125 arms; see `exam-grades.tsx`'s identical
      // column for the full reasoning.
      cell: (e) =>
        examAudienceLabel(e, {
          session: t('admin.grades.audienceSession'),
          student: t('admin.grades.audienceStudent'),
          wholeLevel: t('admin.grades.wholeLevel'),
        }),
    },
    {
      key: 'mode',
      header: t('assessments.mode'),
      secondary: true,
      cell: (e) => t(e.mode === 'online' ? 'assessments.modeOnline' : 'assessments.modePhysical'),
    },
  ];

  const actions: RowAction<Exam>[] = [
    { label: t('admin.grades.open'), onSelect: (e) => setOpenExam(e) },
  ];

  return (
    <TeacherLayout title={t('teacher.nav.exams')} lede={t('teacher.exams.lede')}>
      <DataTable
        caption={t('admin.grades.caption')}
        columns={columns}
        rows={visible}
        rowKey={(e) => e.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={needle !== ''}
        onClearFilters={() => setQuery('')}
        toolbar={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('admin.grades.searchPlaceholder')}
          />
        }
      />
    </TeacherLayout>
  );
}
