import { useEffect, useState, type ReactNode } from 'react';

import { listExams, type Exam } from '../../adapters/exams.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import type { Crumb } from '../../components/portal/breadcrumb.js';
import { GradeSheetView } from '../../components/grading/grade-sheet.js';
import { SelectField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * `/admin/exam-grades?exam=` — **the grade sheet** (§4.6, SRS Revision 70.1).
 *
 * §14.1 listed grading at `/teacher/exams` while R56/R58 put exam *scheduling*
 * on `/admin/schedules`, so an Admin had **no node from which to enter a
 * grade**. R70.1 gave it this one, with the id as `?exam=` — the
 * `/resources?level=` precedent §14.1 already sets and R69 applied twice, since
 * a second path segment would be a node §14.1 does not list.
 *
 * **The page is a frame; the sheet is `GradeSheetView`**, which the teacher
 * portal renders too. One screen, two ways in (R70.1).
 */
export function ExamGradesPage({ examId }: { examId: string | null }): ReactNode {
  const { accessToken } = useSession();
  const [exams, setExams] = useState<Exam[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        // The same role-scoped list the scheduling screen reads: an Admin sees
        // their branches' exams, a Super Admin every one. No second contract.
        setExams((await listExams(accessToken)).data);
      } catch {
        setExams([]);
      }
    })();
  }, [accessToken]);

  const current = exams.find((e) => e.id === examId) ?? null;

  const trail: Crumb[] = current
    ? [
        { label: t('admin.nav.schedules'), href: '/admin/schedules' },
        { label: current.title },
      ]
    : [];

  return (
    <AdminLayout
      breadcrumb={trail}
      title={current ? current.title : t('admin.nav.examGrades')}
      lede={t('admin.grades.lede')}
    >
      <SelectField
        label={t('admin.grades.exam')}
        value={examId ?? ''}
        onChange={(next) => {
          if (next === '') return;
          window.location.href = `/admin/exam-grades?exam=${next}`;
        }}
        placeholder={t('common.choose')}
        options={exams.map((e) => ({ value: e.id, label: `${e.title} — ${e.date}` }))}
      />

      {examId === null ? (
        <p className="state">{t('admin.grades.pickExam')}</p>
      ) : (
        <GradeSheetView examId={examId} />
      )}
    </AdminLayout>
  );
}
