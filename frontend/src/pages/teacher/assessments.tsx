import type { ReactNode } from 'react';

import { AssessmentsView } from '../admin/assessments.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { t } from '../../i18n/index.js';

/**
 * `/teacher/assessments` — **بناء الاختبارات** (§4.6, R124).
 *
 * **The builder is `AssessmentsView`, the very component `/admin/assessments`
 * renders.** R70.1's rule, applied again: one implementation, two ways in, and a
 * teaching portal that grew its own copy is the drift R69 spent a revision
 * removing elsewhere.
 *
 * **The frame is this portal's own**, and that is the whole reason this file
 * exists. The first version routed straight to the back-office page, which
 * dragged `AdminLayout` — and with it the administration sidebar — into the
 * teaching portal: a مؤطِّرة saw the back office's navigation and none of her
 * own. The browser harness caught it; no unit test could have, because both
 * frames render perfectly well on their own.
 *
 * **Authorization is the server's.** Her scope is `assertExamInTeacherScope`,
 * and this route grants nothing — a paper outside her teaching answers `404`
 * whichever portal she opens it from (rule O).
 */
export function TeacherAssessmentsPage({ examId }: { examId: string | null }): ReactNode {
  return (
    <AssessmentsView
      examId={examId}
      layout={({ title, actions, children }) => (
        <TeacherLayout title={title} lede={t('assessments.lede')} actions={actions}>
          {children}
        </TeacherLayout>
      )}
    />
  );
}
