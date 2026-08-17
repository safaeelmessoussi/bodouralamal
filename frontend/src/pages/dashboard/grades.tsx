import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchMyGrades, type PublishedGrade } from '../../adapters/grades.js';
import { ApplicationHeader } from '../../components/header/application-header.js';
import { SiteFooter } from '../../components/site-footer.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { Badge } from '../../components/ui/badge.js';
import { Container } from '../../components/ui/container.js';
import {
  DataTable,
  type Column,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';

/**
 * `/dashboard/student/grades` — **نقاطي**, §5.3's *My Grades & Exams*.
 *
 * ## The gap this closes
 *
 * §5.3 has always specified this screen and §14.1 has always listed the node;
 * **nothing rendered it.** A مؤطرة could publish a grade (BR-8) and the مستفيدة
 * it was about had no way to see it — the fourth instance of this project's
 * recurring pattern, a capability complete in a service with no surface reaching
 * it (R69 `مواد المستوى`, R70.1 grade entry, R72 Teacher events, R74 enrolment).
 *
 * ## Published only, and the filter is not here
 *
 * `GET /students/me/grades` selects `status = 'published'` in its **query**. This
 * screen therefore cannot show a draft even if it tried, which is the point: a
 * client-side filter over draft-and-published rows would put a مؤطرة's working
 * note one rendering bug away from a child's screen. BR-8's draft stays
 * staff-side.
 *
 * ## No pass or fail
 *
 * The table reports the mark and, where it applies, absence. It carries **no
 * verdict** — that is the Owner's decision of 2026-08-17, and it removes no
 * business logic: `Grade.passed` and BR-12's override still exist, still decide
 * retakes and progression, and are still shown on the staff sheet. What a
 * student sees of her own attainment is what she scored.
 *
 * ## No engine of its own
 *
 * It computes nothing. There is no average, no total and no ranking — §10.1/R12
 * postponed the weight-template engine and states the trap in plain words:
 * *"do not hardcode an interim average formula."* A column of marks is not an
 * average and must not grow into one here.
 *
 * ## Whose grades
 *
 * The same rule the rest of this dashboard follows and does not restate: acting
 * as a parent names the active child in `X-Active-Child-ID`; acting as a student
 * sends no header and the server uses the JWT `sub` (§4.3, R63). **There is no
 * student id in the path**, so there is nowhere for a caller to name someone
 * else — TD-12's property rather than a check.
 */
export function StudentGradesPage(): ReactNode {
  const { accessToken, status: session } = useSession();
  const { activeRole } = useActiveRole();
  const { activeChild, activeChildId } = useActiveChild();

  const [rows, setRows] = useState<PublishedGrade[]>([]);
  const [scale, setScale] = useState(20);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [requestId, setRequestId] = useState<string | undefined>(undefined);

  const asParent = activeRole === 'parent';
  const childHeader = asParent ? activeChildId : null;

  const load = useCallback(async () => {
    if (session !== 'authenticated') return;
    setStatus('loading');
    setRequestId(undefined);
    try {
      const result = await fetchMyGrades(accessToken, childHeader);
      setRows(result.rows);
      setScale(result.displayScale);
      setStatus('ready');
    } catch (error) {
      setRequestId(
        error instanceof Error && 'requestId' in error
          ? ((error as { requestId?: string }).requestId ?? undefined)
          : undefined,
      );
      setStatus('error');
    }
  }, [accessToken, childHeader, session]);

  useEffect(() => {
    void load();
  }, [load]);

  // A parent who has not chosen a child yet: the request would be refused with a
  // `400`, so it is not made. Said plainly rather than rendered as an error —
  // nothing has gone wrong, a choice is simply outstanding.
  const awaitingChild = asParent && activeChildId === null;

  const columns: Column<PublishedGrade>[] = [
    { key: 'exam', header: t('student.grades.exam'), cell: (r) => r.exam_title },
    { key: 'date', header: t('student.grades.date'), cell: (r) => formatDate(r.date) },
    {
      key: 'subject',
      header: t('student.grades.subject'),
      secondary: true,
      // A whole-Level sitting carries no Subject (R58); the Level is what it is
      // about, and naming it is more use than an em dash.
      cell: (r) => r.subject_name ?? r.level_name,
    },
    {
      key: 'mark',
      header: t('student.grades.mark').replace('{scale}', String(scale)),
      numeric: true,
      cell: (r) =>
        r.absent ? (
          // BR-7's absent-zero is a `0` in the data, and rendering it as a mark
          // would report a score for a sitting she did not attend. The word is
          // the honest cell.
          <Badge tone="neutral">{t('student.grades.absent')}</Badge>
        ) : (
          `${r.mark} / ${scale}`
        ),
    },
  ];

  return (
    <>
      <ApplicationHeader />
      <main id="main" className="section">
        <Container>
          <h1>{t('student.grades.title')}</h1>
          <p className="lede">{t('student.grades.lede').replace('{scale}', String(scale))}</p>

          {/* R62.10 — persistent, and the first thing under the heading. A
              parent looking at the wrong child's marks must find that out by
              reading the screen. */}
          {asParent ? (
            <p className="state" role="status">
              {activeChild
                ? t('studentDashboard.viewingChild').replace('{name}', activeChild.label)
                : t('studentDashboard.chooseChild')}
            </p>
          ) : null}

          {awaitingChild ? (
            <EmptyState />
          ) : status === 'loading' ? (
            <LoadingState />
          ) : status === 'error' ? (
            <ErrorState
              {...(requestId ? { requestId } : {})}
              onRetry={() => void load()}
            />
          ) : rows.length === 0 ? (
            // **Not an error, and not the same statement as "no results".**
            // Nothing published yet is the ordinary state for a مستفيدة between
            // sittings, and saying so is different from a failed load and from a
            // filtered-out list.
            <p className="state" role="status">
              {t('student.grades.empty')}
            </p>
          ) : (
            <DataTable
              caption={t('student.grades.caption')}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.exam_id}
              status="ready"
            />
          )}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
