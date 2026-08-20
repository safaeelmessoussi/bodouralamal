import type { ReactNode } from 'react';

import { QuranWorkspace } from '../../components/quran/quran-workspace.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { Button } from '../../components/ui/button.js';
import { t } from '../../i18n/index.js';

/**
 * `/teacher/quran?student=` — **إدخال الحفظ** (§4.5, BR-13; M4a, R73.1).
 *
 * §14.1 listed this at `/teacher/students/{id}/quran`, whose path carried an id
 * **no menu could supply** — the third occurrence of the defect R69 fixed for
 * `مواد المستوى` and R70.1 for grade entry. R73.1 gave it a node with the
 * student as `?student=`, the `/resources?level=` precedent.
 *
 * **The screen itself is `QuranWorkspace`**, shared with the back office
 * (2026-08-20). The two portals ask one operational question and differ only in
 * what `/quran-students` answers for the caller's own token — which is decided
 * server-side, not here. This file is the chrome and the deep link, nothing
 * more.
 *
 * **The menu entry is conditional on real teaching authority** (R87 §M): it
 * appears only when `teaches_quran` is true, which is derived from staffing a
 * schedule whose Subject carries R73's marker — never from the Teacher role,
 * never from an R88 declared capability, and never from a Subject's Arabic name.
 */
export function TeacherQuranPage({ studentId }: { studentId: string | null }): ReactNode {
  return (
    <TeacherLayout
      // **The title stays the page's own**, whichever مستفيدة is open — the rule
      // `نقاط الامتحانات` follows. Her name is stated in the block below, once.
      title={t('teacher.nav.quran')}
      lede={t('teacher.quran.lede')}
      actions={
        studentId ? (
          <Button variant="secondary" onClick={() => (window.location.href = '/teacher/quran')}>
            {t('quran.backToStudents')}
          </Button>
        ) : null
      }
    >
      <QuranWorkspace
        studentId={studentId}
        hrefFor={(id) => (id ? `/teacher/quran?student=${id}` : '/teacher/quran')}
      />
    </TeacherLayout>
  );
}
