import type { ReactNode } from 'react';

import { AdminLayout } from '../../components/admin/admin-layout.js';
import { QuranWorkspace } from '../../components/quran/quran-workspace.js';
import { Button } from '../../components/ui/button.js';
import { t } from '../../i18n/index.js';

/**
 * `/admin/quran?student=` — **إدخال الحفظ for the administration** (§C4).
 *
 * ## The capability existed; the reach did not
 *
 * `assertCanManageQuranProgress` has granted an Admin their branches'
 * beneficiaries and a Super Admin everyone **since R73**, and `POST
 * /quran-logs` has enforced exactly that — but no §14.1 node let anybody in the
 * back office use it. Rule **P** again, and the seventh instance: a complete,
 * tested, branch-scoped write capability the interface offered nowhere.
 *
 * ## It is the same screen, not an administrative variant
 *
 * `QuranWorkspace` is shared with `/teacher/quran`. The difference between what
 * an Admin and a مؤطِّرة may do is **entirely** in what `/quran-students`
 * answers for the caller's token — branch beneficiaries versus the
 * beneficiaries whose Quran she teaches. Building a second form would have
 * duplicated three dependent selectors and their validation so that two screens
 * could ask the same question (rule C).
 *
 * **Super Admin and Admin differ, and the difference is preserved** (§C25):
 * unscoped versus branch-scoped, exactly as TD-2 states it. Neither reaches
 * *users* — both reach **beneficiaries**, through a live enrolment and R79's
 * durable marker.
 */
export function AdminQuranPage({ studentId }: { studentId: string | null }): ReactNode {
  return (
    <AdminLayout
      title={t('admin.nav.quran')}
      lede={t('admin.quran.lede')}
      actions={
        studentId ? (
          <Button variant="secondary" onClick={() => (window.location.href = '/admin/quran')}>
            {t('quran.backToStudents')}
          </Button>
        ) : null
      }
    >
      <QuranWorkspace
        studentId={studentId}
        hrefFor={(id) => (id ? `/admin/quran?student=${id}` : '/admin/quran')}
      />
    </AdminLayout>
  );
}
