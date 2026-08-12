import { useEffect, useState, type ReactNode } from 'react';

import { listExams, type Exam } from '../../adapters/exams.js';
import { GradeSheetView } from '../../components/grading/grade-sheet.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { Button } from '../../components/ui/button.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * `/teacher/exams` — **الامتحانات** (§14.1, §4.6, SRS Revision 70).
 *
 * Blocked until now with *"the exam-building and marking interfaces are not
 * available yet"*. R70 unblocks the marking half; the online paper builder
 * stays out (§4.6's `mode = online` is declared and refused).
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
 */
export function TeacherExamsPage(): ReactNode {
  const { accessToken } = useSession();
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openExam, setOpenExam] = useState<Exam | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setExams((await listExams(accessToken)).data);
      } catch {
        setFailed(true);
      }
    })();
  }, [accessToken]);

  if (openExam) {
    return (
      <TeacherLayout title={openExam.title} lede={t('admin.grades.lede')}>
        <p>
          <Button variant="secondary" onClick={() => setOpenExam(null)}>
            {t('teacher.exams.backToList')}
          </Button>
        </p>
        <GradeSheetView examId={openExam.id} />
      </TeacherLayout>
    );
  }

  return (
    <TeacherLayout title={t('teacher.nav.exams')} lede={t('teacher.exams.lede')}>
      {failed ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : exams === null ? (
        <p className="state">{t('common.loading')}</p>
      ) : exams.length === 0 ? (
        // A named state, not an empty table: a teacher with no exams in scope
        // has nothing to mark, and saying so is different from a failed load.
        <p className="state" role="status">
          {t('teacher.exams.empty')}
        </p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">{t('admin.schedules.title')}</th>
              <th scope="col">{t('admin.exams.date')}</th>
              <th scope="col">{t('admin.nav.levels')}</th>
              <th scope="col">{t('admin.schedules.subject')}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {exams.map((exam) => (
              <tr key={exam.id}>
                <td>{exam.title}</td>
                <td>{exam.date}</td>
                <td>{exam.level_name}</td>
                <td>{exam.subject_name ?? '—'}</td>
                <td>
                  <Button variant="secondary" onClick={() => setOpenExam(exam)}>
                    {t('admin.grades.open')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TeacherLayout>
  );
}
