import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { SortState } from '../../components/ui/data-table.js';

import {
  listAdministrativeGroups,
  type AdministrativeGroup,
} from '../../adapters/administrative-groups.js';
import { listBranches, type Branch } from '../../adapters/branches-admin.js';
import {
  endEnrollment,
  enrol,
  listEnrollments,
  updateEnrollment,
  type EnrollmentRowView,
} from '../../adapters/enrollments.js';
import { listLevels, type Level } from '../../adapters/taxonomy.js';
import {
  addMember,
  listCircles,
  removeMember,
  type TeachingGroupRow,
} from '../../adapters/teaching-groups.js';
import { searchDirectory, type DirectoryEntry, type RoleAssignment } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { LevelSelect, levelLabel } from '../../components/scope/level-select.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction } from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import {
  listAcademicPeriods,
  type AcademicPeriodRef,
} from '../../adapters/academic-periods.js';
import { Badge } from '../../components/ui/badge.js';
import { SearchInput, SelectField } from '../../components/ui/field.js';
import { MultiSelectField } from '../../components/ui/multi-select.js';
import { useSession } from '../../contexts/session.js';
import { isDirty } from '../../lib/form-dirty.js';
import { sortRows } from '../../lib/sort-rows.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

/**
 * `/admin/enrollments` — **التسجيلات** (§7 R66, §14.1 R74).
 *
 * ## The gap this closes
 *
 * R66 made the Administrative Group optional and gave the service
 * `enrolInLevel`, but **only the approval path ever called it**: the one
 * enrolment endpoint required a group, so after approval a مستفيدة could not be
 * enrolled into a second Level or into a Level nobody had subdivided. The
 * platform held one enrolment, and a whole-Level exam resolved nobody.
 *
 * ## It is not a second roster
 *
 * `/admin/groups/{id}/roster` is the **per-group** view of these same
 * `Enrollment` rows; this is the **per-Level** one, which R66 made the primary
 * fact — a student is enrolled in a *Level*, and a Group subdivides it. Two
 * readings of one table.
 *
 * ## It shows its data
 *
 * Every enrolment the caller may see is listed on load — branch-scoped for an
 * Admin, unrestricted for a Super Admin, by the server. The Level control
 * **narrows** that list; it is never the thing that makes it appear.
 *
 * ## Authorization is the service's, unchanged
 *
 * `enrolAtPlacement` decides every placement, here and at approval alike: the
 * role gate, the branch assertion, R27's sex eligibility and BR-21's
 * one-enrolment-per-Level refusal all stay where they already were. This screen
 * renders refusals rather than reimplementing rules.
 */
/**
 * A مستفيدة and every placement she holds — the row this screen lists since
 * 2026-08-28. `enrolments` may be empty: an account with the Student role and
 * no placement is precisely who this page exists to enrol.
 */
interface StudentRow {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  /**
   * **Her role assignments, carried on the row** (2026-08-29). The enrolment
   * dialog needs her branch and used to go looking for it in a directory
   * search of its own — see `branchOfStudent`. The page already holds the
   * answer; handing it over is both correct and one request cheaper.
   */
  roles: RoleAssignment[];
  enrolments: EnrollmentRowView[];
}

/**
 * **Where a مستفيدة's branch comes from, in order** (2026-08-29).
 *
 * §4.4c: an Administrative Group carries its branch, so a group placement
 * answers it outright. R66 allows a Level-only placement, and then the branch
 * is the person's own — from her role assignment, or from a branch she is
 * already enrolled at. Returns `''` when nothing answers, and the caller must
 * SAY so rather than quietly refusing to submit.
 */
function branchOfStudent(row: StudentRow): string {
  return (
    row.roles.find((r) => r.branch_id !== null)?.branch_id ??
    row.enrolments[0]?.branch_id ??
    ''
  );
}

export function EnrollmentsPage(): ReactNode {
  const { accessToken } = useSession();

  const [rows, setRows] = useState<EnrollmentRowView[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filterLevel, setFilterLevel] = useState<string | null>(null);
  // `null` is BR-19's order, which the server keeps when nothing is asked.
  const [sort, setSort] = useState<SortState | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState<StudentRow | null>(null);
  /**
   * Every account this screen must list: the Student role (Owner) united with
   * R79.7's durable beneficiary fact, so neither rule drops anybody.
   */
  const [students, setStudents] = useState<DirectoryEntry[]>([]);
  /** Which مستفيدة's placements are open — she may hold several. */
  const [placementsOf, setPlacementsOf] = useState<StudentRow | null>(null);
  const [editing, setEditing] = useState<EnrollmentRowView | null>(null);
  const [ending, setEnding] = useState<EnrollmentRowView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      /**
       * **Both rules, united** — see `byStudent` below. The Student role is the
       * Owner's rule; `beneficiaries_only` is R79.7's durable fact, which exists
       * because role membership does not identify a beneficiary. Taking either
       * alone would drop people from the screen that places them.
       */
      const [list, levelList, byRole, byFact] = await Promise.all([
        listEnrollments(accessToken, filterLevel ? { level_id: filterLevel } : {}, sort),
        listLevels(accessToken),
        searchDirectory(accessToken, { role: 'student' }, 1, null),
        searchDirectory(accessToken, { beneficiaries_only: 'true' }, 1, null),
      ]);
      setRows(list);
      setLevels(levelList);
      const union = new Map<string, DirectoryEntry>();
      for (const person of [...byRole.data, ...byFact.data]) union.set(person.id, person);
      setStudents([...union.values()]);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [accessToken, filterLevel, sort]);

  useEffect(() => {
    void load();
  }, [load]);


  /** Client-side narrowing by name; the Level narrows server-side already. */


  /**
   * **One row per STUDENT, not per enrolment** (Owner, 2026-08-28).
   *
   * The page listed enrolments, so a مستفيدة enrolled in two Levels appeared
   * twice and one enrolled in none did not appear at all — on the screen whose
   * job is enrolling her.
   *
   * **Who counts as a student.** The Owner's rule is *every account holding the
   * Student role*. R79.7's rule is the durable `is_beneficiary` fact, and it
   * exists because **role membership does not identify a beneficiary**: a
   * مؤطِّرة may study, and §4.3's minors hold no role at all. Taking either
   * alone would drop people from the screen that places them, so this is the
   * **union** — every Student-role account appears, as the Owner requires, and
   * nobody who is already a beneficiary disappears.
   */
  const byStudent = new Map<string, StudentRow>();
  for (const person of students) {
    byStudent.set(person.id, {
      id: person.id,
      name: person.name_arabic,
      firstName: person.first_name_arabic,
      lastName: person.last_name_arabic,
      roles: person.roles,
      enrolments: [],
    });
  }
  for (const e of rows) {
    const existing = byStudent.get(e.student_id) ?? {
      id: e.student_id,
      name: e.student_name,
      // An enrolment names the student without splitting her name; the split is
      // the directory's, so a row reached only through an enrolment shows none.
      firstName: null,
      lastName: null,
      // Nor does it carry her roles — `branchOfStudent` falls through to the
      // enrolment's own branch, which such a row always has.
      roles: [],
      enrolments: [],
    };
    existing.enrolments.push(e);
    byStudent.set(e.student_id, existing);
  }
  const studentRows = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  // Search narrows the students shown; the Level filter narrows by placement,
  // and a student with no placement cannot match one (§14.4 — a filtered empty
  // state is a different answer from an empty page).
  const needleText = query.trim().toLowerCase();
  const filteredStudents = studentRows.filter(
    (r) =>
      (needleText === '' || r.name.toLowerCase().includes(needleText)) &&
      (filterLevel === null || r.enrolments.some((e) => e.level_id === filterLevel)),
  );

  /**
   * **This list is the CLIENT's, so the client orders it** (R76.2, 2026-08-30).
   *
   * The exception `sort-rows.ts` describes and not a breach of it: these rows
   * are not a page of a paginated collection. They are assembled here from the
   * union of two directory reads and the enrolments, one row per مستفيدة, so no
   * endpoint exists that could order them — the same reason الجدولة sorts here.
   *
   * The accessors read **exactly what the cells render**, fallback included, so
   * a row cannot sort by one value and display another. `null` sorts last in
   * both directions, which is what «no family name recorded» should do.
   */
  const visibleStudents = sortRows(filteredStudents, sort, {
    first_name: (r) => r.firstName ?? r.name,
    last_name: (r) => r.lastName,
  });

  const columns: Column<StudentRow>[] = [
    {
      key: 'first_name',
      header: t('admin.users.colFirstName'),
      sortKey: 'first_name',
      cell: (r) => r.firstName ?? r.name,
    },
    {
      key: 'last_name',
      header: t('admin.users.colLastName'),
      sortKey: 'last_name',
      cell: (r) => r.lastName ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'level',
      header: t('admin.nav.levels'),
      // Every Level she is enrolled in — the shared `{Category} — {Level}` label
      // (§4.4b), because a Level name alone identifies nothing.
      cell: (r) =>
        r.enrolments.length === 0 ? (
          <span className="muted">{t('admin.enrollments.notEnrolled')}</span>
        ) : (
          <ul className="admin-list admin-list--plain">
            {r.enrolments.map((e) => (
              <li key={e.id}>
                {levelLabel({ id: e.level_id, name: e.level_name, category_name: e.category_name })}
              </li>
            ))}
          </ul>
        ),
    },
    {
      /**
       * **R122 — which semester each placement is for, and whether it is
       * running.**
       *
       * The column the page most needed: before it, every enrolment read as
       * current, because a row was current until somebody deleted it. `جارٍ`
       * and `منتهٍ` are the server's derived answer from the period's dates —
       * the page computes neither, so it cannot disagree with the roster or
       * with a future retention rule.
       */
      key: 'period',
      header: t('admin.enrollments.periodColumn'),
      cell: (r) =>
        r.enrolments.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul className="admin-list admin-list--plain">
            {r.enrolments.map((e) => (
              <li key={e.id}>
                {e.academic_period_id === null ? (
                  // Honest: written before R122, its semester was never
                  // recorded and was deliberately not guessed.
                  <span className="muted">{t('admin.enrollments.periodUnrecorded')}</span>
                ) : (
                  <>
                    {e.academic_year_label}{' '}
                    {t('admin.enrollments.semester').replace(
                      '{n}',
                      String(e.academic_period_sequence),
                    )}{' '}
                    <Badge tone={e.is_current_period ? 'ok' : 'neutral'}>
                      {e.is_current_period
                        ? t('admin.enrollments.currentBadge')
                        : t('admin.enrollments.endedBadge')}
                    </Badge>
                  </>
                )}
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'group',
      header: t('admin.nav.groups'),
      cell: (r) =>
        r.enrolments.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul className="admin-list admin-list--plain">
            {r.enrolments.map((e) => (
              <li key={e.id}>
                {/* R66 — a Level nobody has subdivided is ordinary, and an
                    enrolment without a group is a placement, not a gap. */}
                {e.administrative_group_name ?? t('admin.enrollments.noGroup')}
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'branch',
      header: t('admin.enrollments.branch'),
      secondary: true,
      // **Read-only here.** Branch membership is edited on تعديل بيانات
      // المستخدم and stays there (Owner, 2026-08-28); this shows where each
      // placement sits so the row reads without opening it.
      cell: (r) => (
        <ul className="admin-list admin-list--plain">
          {[...new Set(r.enrolments.map((e) => e.branch_name))].map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ),
    },
    {
      key: 'circles',
      header: t('admin.enrollments.circles'),
      // Read-only here. Circle membership is INDEPENDENT of the group (§4.4c —
      // "nothing aligns them and nothing should try to"); it is shown so
      // مستفيدة → مستوى → مجموعة → مادة → حلقة reads in one place, and it is
      // managed on حلقات المواد and offered at placement time.
      cell: (r) => {
        const circles = r.enrolments.flatMap((e) => e.circles);
        return circles.length === 0 ? (
          <span className="muted">{t('admin.enrollments.noCircles')}</span>
        ) : (
          <ul className="admin-list admin-list--plain">
            {circles.map((c) => (
              <li key={`${c.subject_name}-${c.circle_name}`}>
                {c.subject_name} — {c.circle_name}
              </li>
            ))}
          </ul>
        );
      },
    },
  ];

  const actions: RowAction<StudentRow>[] = [
    /**
     * **تسجيل — place her in another Level** (Owner, 2026-08-28). A مستفيدة may
     * hold several placements, so this is repeatable rather than a one-off: the
     * dialog opens with her already chosen and asks only where she is going.
     */
    {
      // «تسجيل» alone: the row already says who, so repeating «مستفيدة» in
      // the action would restate the column beside it.
      label: t('admin.enrollments.enrol'),
      onSelect: (r) => setComposing(r),
    },
    /**
     * **تعديل / إنهاء act on ONE placement.** A student row may hold several,
     * and «edit» with no answer to *which one* would be a guess — so a row with
     * exactly one placement acts on it, and a row with more opens the list.
     */
    {
      label: t('common.edit'),
      onSelect: (r) => setPlacementsOf(r),
      available: (r) => r.enrolments.length > 0,
    },
  ];

  return (
    <AdminLayout
      title={t('admin.nav.enrollments')}
      lede={t('admin.enrollments.lede')}
      /* **No ＋ تسجيل مستفيدة** (Owner, 2026-08-28). Enrolling starts from the
         مستفيدة, not from an empty form that asks who she is: every account with
         the Student role is already a row here, and تسجيل on her row places
         her. A page-level Add would be a second way in that begins by asking a
         question the row has already answered. */
    >
      {notice ? <Feedback>{notice}</Feedback> : null}

      <DataTable
        caption={t('admin.enrollments.caption')}
        columns={columns}
        rows={visibleStudents}
        rowKey={(r) => r.id}
        status={state === 'ready' ? 'ready' : state}
        actions={actions}
        onRetry={() => void load()}
        sort={sort}
        onSort={setSort}
        filtered={query.trim() !== '' || filterLevel !== null}
        onClearFilters={() => {
          setQuery('');
          setFilterLevel(null);
        }}
        toolbar={
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={t('admin.enrollments.searchPlaceholder')}
            />
            {/* A filter, not a gate: the table is already loaded. */}
            <LevelSelect
              levels={levels}
              value={filterLevel}
              onChange={(next) => setFilterLevel(next === '' ? null : next)}
              label={t('admin.enrollments.filterLevel')}
              placeholder={t('admin.enrollments.allLevels')}
            />
          </>
        }
      />

      {editing ? (
        <PlacementDialog
          row={editing}
          token={accessToken}
          onCancel={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}

      {/**
       * **إنهاء التسجيل — audited 2026-08-17, and the semantics were already
       * right.**
       *
       * `unenrolStudent` → `releaseEnrollment` soft-deletes the `Enrollment`,
       * releases that enrolment's circle seats, writes the R59 Trash entry and
       * leaves the audit trail. **It is not and must not become a hard delete**,
       * and nothing about it changed in this pass.
       *
       * What was missing was that the copy did not distinguish **moving a
       * placement** from **ending the enrolment**, and did not say what survives.
       * Both are recoverable-looking actions with very different consequences,
       * and the earlier single sentence — *"she leaves the level and its circles;
       * the record appears in Trash"* — was accurate and told a reader nothing
       * about her grades or her Quran log.
       */}
      <ConfirmDialog
        open={ending !== null}
        title={t('admin.enrollments.endTitle')}
        body={t('admin.enrollments.endBody')}
        details={
          // A definition list, because these are two answers to two questions —
          // run together in a paragraph they read as one long warning and get
          // skimmed, which is the opposite of the intent.
          <dl className="detail-list">
            <dt>{t('admin.enrollments.endKeptTitle')}</dt>
            <dd>{t('admin.enrollments.endKept')}</dd>
            <dt>{t('admin.enrollments.endRemovedTitle')}</dt>
            <dd>{t('admin.enrollments.endRemoved')}</dd>
            {/* The third question this dialog is opened with, and the one the
                earlier copy left unanswered: *and then what*. Ending is now the
                ONLY route to another Level or Branch (the edit dialog no longer
                offers them), so the confirmation has to name the route it is
                half of, or it reads as a dead end. */}
            <dt>{t('admin.enrollments.endNextTitle')}</dt>
            <dd>{t('admin.enrollments.endNext')}</dd>
          </dl>
        }
        confirmLabel={t('admin.enrollments.end')}
        danger
        busy={busy}
        onConfirm={() => {
          void (async () => {
            if (!ending) return;
            setBusy(true);
            try {
              await endEnrollment(ending.id, accessToken);
              setNotice(t('admin.enrollments.ended'));
              await load();
            } catch (error) {
              setNotice(refusal(error));
            } finally {
              setBusy(false);
              setEnding(null);
            }
          })();
        }}
        onCancel={() => setEnding(null)}
      />

      {placementsOf ? (
        <Dialog
          open
          onClose={() => setPlacementsOf(null)}
          title={t('admin.enrollments.placementsTitle').replace('{name}', placementsOf.name)}
        >
          {/* Each placement is edited or ended on its own, because they are
              separate facts: ending one Level does not touch another. */}
          <ul className="admin-list">
            {placementsOf.enrolments.map((e) => (
              <li key={e.id}>
                <span className="admin-list__label">
                  {levelLabel({
                    id: e.level_id,
                    name: e.level_name,
                    category_name: e.category_name,
                  })}
                </span>
                <span className="muted">
                  {e.administrative_group_name ?? t('admin.enrollments.noGroup')}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPlacementsOf(null);
                    setEditing(e);
                  }}
                >
                  {t('common.edit')}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setPlacementsOf(null);
                    setEnding(e);
                  }}
                >
                  {t('admin.enrollments.end')}
                </Button>
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}

      {composing ? (
        <EnrolDialog
          levels={levels}
          token={accessToken}
          student={composing}
          onCancel={() => setComposing(null)}
          onDone={(message) => {
            setComposing(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}
    </AdminLayout>
  );
}

function EnrolDialog({
  levels,
  token,
  student,
  onCancel,
  onDone,
}: {
  levels: Level[];
  token: string | null;
  /**
   * **The row that opened the dialog, whole** (2026-08-29). It used to receive
   * only an id and then re-fetch the person — from a directory search narrowed
   * to `beneficiaries_only`, which is a *different question* from the one the
   * page asked to build its rows. When the two disagreed the lookup found
   * nothing, and the branch that lookup existed to supply came back `''`.
   */
  student: StudentRow;
  onCancel: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const [studentId] = useState(student.id);
  const [levelId, setLevelId] = useState<string | null>(null);
  /**
   * **The Levels THIS beneficiary may enter**, resolved server-side once she is
   * chosen (R27 + BR-21). Before that the dialog offers the full list it was
   * handed, so the field is never empty for want of an answer to a question the
   * reader has not been asked yet.
   */
  const [eligibleLevels, setEligibleLevels] = useState<Level[] | null>(null);
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  /**
   * **R122 — which semester the placement is for.**
   *
   * Defaults to the period covering today, because that is what an
   * administrator enrolling somebody now almost always means; she may choose
   * another. The form refuses to submit without one: an enrolment with no
   * period is the open-ended row R122 exists to remove.
   */
  const [periods, setPeriods] = useState<AcademicPeriodRef[]>([]);
  const [periodId, setPeriodId] = useState('');
  /** The Level's circles, across its Subjects — offered, never required. */
  const [circles, setCircles] = useState<TeachingGroupRow[]>([]);
  const [circleIds, setCircleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // R122 — the semesters, and a default of the one running today.
  useEffect(() => {
    let cancelled = false;
    void listAcademicPeriods(token)
      .then((rows) => {
        if (cancelled) return;
        setPeriods(rows);
        setPeriodId((chosen) => chosen || (rows.find((p) => p.is_current)?.id ?? ''));
      })
      .catch(() => {
        // A page-level condition, reported where the submit refuses (rule AH):
        // an empty list means no semester has been recorded yet.
        if (!cancelled) setPeriods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * **The branch is DERIVED, never asked for** (Owner, 2026-08-28).
   *
   * A المقر dropdown was added here and is withdrawn: branch membership is
   * managed on تعديل بيانات المستخدم and this form must not offer a second
   * place to decide it. The answer is already contained in what the reader
   * chooses — **an Administrative Group carries its branch** (§4.4c) — and for
   * a Level-only placement (R66) it is the مستفيدة's own branch, from her role
   * assignment.
   */
  const derivedBranchId = groups.find((g) => g.id === groupId)?.branch_id ?? branchOfStudent(student);


  // **The list is loaded once, on open; search NARROWS it in the control.** It
  // used to be gated on two typed characters, so the dialog opened with an empty
  // picker and no affordance saying why — the defect the `حلقات المواد` redesign
  // was about, reintroduced one screen over. The debounce that fetched per
  // keystroke went with it: `SearchableSelect` filters the loaded list, so there
  // is no request to debounce.
  //
  // **Everyone active is offered, and that is not an oversight.** There is no
  // structural fact distinguishing a مستفيدة from any other account: minors
  // hold no role at all (§4.3), `intended_category_id` is unset on every live
  // row, and a مؤطرة may legitimately be enrolled — one of the association's
  // accounts holds both `teacher` and `student` today. Filtering by ROLE would
  // hide exactly the students who most need enrolling, and that stays true.
  //
  /**
   * **The beneficiary is the FIRST and INDEPENDENT selector.**
   *
   * The question this form asks is *who am I enrolling*, and a woman already
   * enrolled in one Level is still a beneficiary — narrowing this list by a
   * chosen Level was tried and reversed the same day. **The dependency runs the
   * other way**, beneficiary → Levels, below.
   *
   * **It offers مستفيدات, not every active account** (R79.7). That was
   * impossible until R79: no role identifies a beneficiary — a minor holds none
   * at all (§4.3) and a مؤطرة may study — and an enrolment cannot, because it
   * would make enrolment the precondition for being enrollable. The durable fact
   * answers it, and the SERVER answers it: this list is what it is handed.
   */
  /**
   * **WHO → WHERE.** Choosing the beneficiary narrows the Levels, because that
   * is the direction the domain runs: R27 asks whether *she* may enter a
   * restricted Level, and BR-21 excludes only the one Level she already holds.
   * Every other Level stays on offer — one beneficiary, many enrolments, one
   * per Level.
   */
  useEffect(() => {
    if (studentId === '') {
      setEligibleLevels(null);
      return;
    }
    void (async () => {
      try {
        setEligibleLevels(await listLevels(token, undefined, null, studentId));
      } catch {
        // The server is still the authority; leaving the full list rather than
        // an empty one keeps the form usable and lets the refusal speak.
        setEligibleLevels(null);
      }
    })();
  }, [token, studentId]);

  const offeredLevels = eligibleLevels ?? levels;

  /**
   * A Level chosen before the beneficiary may not survive her — she may already
   * be enrolled in it, or it may be restricted. Reconciled rather than left to
   * reach the server as a pair it must refuse.
   */
  useEffect(() => {
    if (levelId !== null && !offeredLevels.some((l) => l.id === levelId)) setLevelId(null);
  }, [offeredLevels, levelId]);

  // §14.4/R55 — every selector is dependent: the Groups offered are those of the
  // chosen Level at the chosen branch, so the form cannot express a pair the
  // server refuses.
  // **The Level alone is enough.** This required a branch too, so choosing a
  // Level showed nothing until a second field was answered — and the groups of
  // a Level already carry their branch, so demanding it first asked for
  // something the answer contains.
  useEffect(() => {
    if (!levelId) {
      setGroups([]);
      setGroupId('');
      return;
    }
    void (async () => {
      try {
        setGroups((await listAdministrativeGroups(token, 1, { level_id: levelId })).data);
      } catch {
        setGroups([]);
      }
    })();
  }, [levelId, token]);

  // A group states its own branch (§7), so choosing one answers the branch
  // rather than having to agree with a separate answer.
  // The group's branch is read straight from the chosen group by
  // `derivedBranchId` above — an effect mirroring it into state would be a
  // second copy of one fact, and the copy is what drifts.

  /**
   * **The Level's circles, keyed by Level ALONE — not by the group.**
   *
   * A circle is `(Subject, Level)` and carries **no branch** and **no relation to
   * an Administrative Group** (§4.4c, R43.3). So the Level is the whole key, and
   * the group selected above is irrelevant here: reloading this list when the
   * group changed would imply a dependency the model does not have, which is
   * exactly the artificial relationship the Owner ruled out.
   *
   * The chosen circles are cleared when the Level changes, because a seat in
   * another Level's circle is a pair the server refuses — a stale id left in
   * state is how an impossible pair reaches it.
   */
  useEffect(() => {
    setCircleIds([]);
    if (!levelId) {
      setCircles([]);
      return;
    }
    void (async () => {
      try {
        // `page_size` is the endpoint's own; one Level's circles across its
        // Subjects are a handful, so one page is the whole answer.
        setCircles((await listCircles(token, 1, { level_id: levelId })).data);
      } catch {
        setCircles([]);
      }
    })();
  }, [levelId, token]);

  /**
   * **Two existing server calls, in order — never one new one.**
   *
   * The enrolment is created first because a circle seat *requires* it:
   * `addMember` resolves the student's branch through `Enrollment.branch_id`
   * (R66) and refuses `NOT_ENROLLED_IN_LEVEL` outright. So the order is not a
   * convenience, it is the dependency.
   *
   * **Every rule stays server-side.** `enrolAtPlacement` still applies the role
   * gate, the branch assertion, R27's sex eligibility and BR-21's
   * one-enrolment-per-Level refusal; `addMember` still applies R43.3's
   * branch-scoped membership check and still refuses a second seat in the same
   * Subject with a `409`. This function orchestrates; it decides nothing.
   *
   * **A failed seat does not undo the enrolment**, and that is deliberate rather
   * than a missing transaction. The two are independent relationships (§4.4c —
   * *"nothing aligns them and nothing should try to"*), and an enrolment is
   * valuable on its own: rolling it back because one circle was full would
   * discard the placement the administrator definitely wanted in order to
   * protect one they merely also wanted. The outcome is reported by name and the
   * seats can be added from `حلقات المواد`.
   */
  async function submit(): Promise<void> {
    /**
     * **A refusal the reader can see** (2026-08-29). This was
     * `if (!studentId || !levelId || !derivedBranchId) return;` — and the same
     * three conditions also disabled حفظ, so when the branch could not be
     * derived the button was simply dead: no request, no message, nothing to
     * act on. **A form never declines in silence** (rule AH); of the three,
     * only the Level is a control she can see, so the other two must explain
     * themselves in words.
     */
    if (!levelId) {
      setNotice(t('admin.enrollments.levelRequired'));
      return;
    }
    if (!derivedBranchId) {
      setNotice(t('admin.enrollments.branchUnknown'));
      return;
    }
    // R122 — refused in words, never in silence (rule AH). With no period the
    // enrolment could not end on its own, which is the defect this closes.
    if (!periodId) {
      setNotice(t('admin.enrollments.periodRequired'));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await enrol(
        {
          student_id: studentId,
          level_id: levelId,
          branch_id: derivedBranchId,
          // `null` is the placement, not the absence of one (R66).
          administrative_group_id: groupId === '' ? null : groupId,
          academic_period_id: periodId,
        },
        token,
      );

      let placed = 0;
      let refused = 0;
      for (const circleId of circleIds) {
        try {
          await addMember(circleId, studentId, token);
          placed += 1;
        } catch {
          refused += 1;
        }
      }

      onDone(
        refused > 0
          ? t('admin.enrollments.enrolledCirclesPartly')
          : placed > 0
            ? t('admin.enrollments.enrolledWithCircles').replace('{n}', String(placed))
            : t('admin.enrollments.enrolled'),
      );
    } catch (error) {
      setNotice(refusal(error));
    } finally {
      setBusy(false);
    }
  }

  // A create form opens blank, so anything entered is unsaved work.
  const dirty = isDirty(
    { levelId, groupId, circleIds: [...circleIds].sort() },
    /**
     * **What the form opened with, not a blank slate** (2026-08-28).
     *
     * The baseline was every field empty — including `studentId`, which this
     * dialog now receives **pre-chosen from her row**. So it was dirty the
     * instant it opened, and closing تسجيل without touching anything asked to
     * discard nothing. The student is no longer part of the comparison at all:
     * it is not a field the reader can change here.
     */
    { levelId: null, groupId: '', circleIds: [] },
  );

  return (
    <FormDialog
      open
      title={t('admin.enrollments.add')}
      notice={notice}
      busy={busy}
      dirty={dirty}
      /* Only the Level gates the button, because the Level is the one required
         answer the reader can actually give here. A missing branch is not her
         omission and must be said out loud, not enforced by a dead control. */
      disabled={!levelId}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      {/* **One control, not a hand-rolled search box above a select.**
          This was a raw `<input className="field__input">` — no label
          association, no hint slot, no error wiring — feeding a separate
          `SelectField`, so choosing a مستفيدة meant operating two controls that
          looked like two questions. `SearchableSelect` is the platform's one
          answer to *one choice from many*: it opens with its options present and
          the search narrows them.

          **Everyone active is offered, and that is not an oversight.** There is
          no structural fact distinguishing a مستفيدة from any other account:
          minors hold no role at all (§4.3), `intended_category_id` is unset on
          every live row, and a مؤطرة may legitimately be enrolled — one of the
          association's accounts holds both `teacher` and `student` today.
          Filtering by role would hide exactly the students who need enrolling. */}
      {/* **The beneficiary is no longer asked for** (Owner, 2026-08-28): this
          dialog opens from her row, so the question it asks is only *where*.
          Her name comes from that row — the dialog does not go looking for a
          person the caller already handed it. */}
      <p className="field__hint">
        {t('admin.enrollments.enrolling').replace('{name}', student.name)}
      </p>

      {/* Narrowed by HER: restricted Levels she cannot enter, and the one she is
          already enrolled in, are not offered (R27, BR-21). */}
      <LevelSelect levels={offeredLevels} value={levelId} onChange={setLevelId} />
      {studentId !== '' && eligibleLevels !== null ? (
        <p className="field__hint">
          {eligibleLevels.length === 0
            ? t('admin.enrollments.noLevelsForStudent')
            : t('admin.enrollments.levelsForStudent')}
        </p>
      ) : null}

      {/* **R122 — the semester this placement is for.** Above the group
          because it is the more consequential answer: it is what makes the
          enrolment end on its own instead of running forever. */}
      <SelectField
        label={t('admin.enrollments.periodLabel')}
        value={periodId}
        onChange={setPeriodId}
        required
        options={periods.map((p) => ({
          value: p.id,
          label: `${p.academic_year_label} — ${t('admin.enrollments.semester').replace('{n}', String(p.sequence))}`,
        }))}
        hint={
          periods.length === 0
            ? t('admin.enrollments.periodNone')
            : t('admin.enrollments.periodHint')
        }
      />

      <SelectField
        label={t('admin.nav.groups')}
        value={groupId}
        onChange={setGroupId}
        // R66 — no group IS a placement. The empty option is the Level itself,
        // not an unanswered question.
        placeholder={t('admin.enrollments.levelOnly')}
        options={groups.map((g) => ({ value: g.id, label: g.name }))}
        hint={t('admin.enrollments.groupHint')}
      />

      {/* **The circles, in the same form, as a SEPARATE question.**
          §14.1's placement workflow now offers every placement concept in one
          place — but they remain independent relationships, and the control says
          so: a مستفيدة may sit in a group *and* in a Quran circle *and* in a
          Tajweed circle, and none of the three implies the others (§4.4c).

          The option label is `{Subject} — {circle}`, because a circle's name is
          unique only within its Subject and the Subject is what a reader is
          actually choosing between. The shared multi-select, so 20 circles are a
          searchable list rather than 20 checkboxes. */}
      {levelId === null ? (
        <p className="field__hint">{t('admin.enrollments.circlesPickLevel')}</p>
      ) : circles.length === 0 ? (
        // Not a gap: a Level whose Subjects are taught whole has no circles, and
        // that is the ordinary case (§4.4c — an unsplit Subject is `entire_level`).
        <p className="field__hint">{t('admin.enrollments.circlesNone')}</p>
      ) : (
        <MultiSelectField
          label={t('admin.enrollments.circlesOptional')}
          options={circles.map((c) => ({
            value: c.id,
            label: `${c.subject_name} — ${c.name}`,
          }))}
          selected={circleIds}
          onChange={setCircleIds}
          hint={t('admin.enrollments.circlesHint')}
        />
      )}
    </FormDialog>
  );
}

/**
 * **A server refusal, in the reader's words** (extended 2026-08-29).
 *
 * This branched on the status alone, so every 400 — including the two the
 * enrolment service takes trouble to explain — arrived as a bare *«تعذّر
 * الحفظ»*. The service reports **why** in `details.reason` (§TD-3.8 carries it
 * through untouched); reading it is the difference between «that didn't work»
 * and «this Level is for girls».
 *
 * The fallback still says the generic sentence, but **appends the server's own
 * `code`**, so an unmapped refusal is something a person can quote rather than
 * a dead end.
 */
function refusal(error: unknown): string {
  if (!(error instanceof ApiError)) return t('common.saveFailed');
  const reason = error.details['reason'];
  if (reason === 'GENDER_RESTRICTION') return t('admin.enrollments.genderRestricted');
  if (reason === 'ALREADY_ENROLLED_IN_LEVEL') return t('admin.enrollments.alreadyInGroup');
  if (error.status === 409) return t('admin.enrollments.already');
  if (error.status === 404) return t('admin.enrollments.outOfScope');
  return error.code === null
    ? t('common.saveFailed')
    : t('common.saveFailedCode').replace('{code}', error.code);
}

/**
 * Changing a placement **within its Level** — group, branch and circles.
 *
 * ## What the model allows, and what this now offers (audited 2026-08-17)
 *
 * The dialog offered only the group, while `updateEnrollmentPlacement` has
 * accepted `{ administrativeGroupId, branchId }` all along — so **the branch was
 * a capability the service supported and the interface withheld**, the same shape
 * of gap R69, R70.1, R72 and R74 each closed once. Circles were managed on
 * `حلقات المواد` only, which meant the one screen that shows a مستفيدة's whole
 * placement could change none of it.
 *
 * | Field | Editable | Why |
 * |---|---|---|
 * | Administrative Group | **yes** | an optional subdivision of the Level (R66) |
 * | Branch | **yes** | `Enrollment.branch_id` is the enrolment's own column (R66) |
 * | Circles | **yes** | independent placements under `(Subject, Level)` (§4.4c) |
 * | **Level** | **no — and that is the model** | see below |
 *
 * ## The Level is deliberately absent
 *
 * BR-21 makes `(student, level)` unique, so an enrolment **is** that pair: moving
 * a مستفيدة to another Level means **ending this enrolment and beginning
 * another**, which the two other actions on this screen already express.
 * Rewriting `level_id` in place would leave her grades, her history and her
 * circle seats attached to a Level she no longer studies — so the invariant is
 * preserved by *not offering the control*, and the dialog says so rather than
 * leaving the absence to look like an oversight.
 *
 * ## Branch and group cannot disagree
 *
 * A group states its own branch (§7). So choosing a group **sets** the branch and
 * locks the control — two answers to one question is how they drift apart — while
 * a Level-only enrolment may set its branch freely, because there is no group to
 * take it from. That is R66 read forwards: the branch moved *onto the enrolment*
 * precisely so an ungrouped student has one.
 *
 * ## Circles are changed by their own calls, and are not coupled to the group
 *
 * Adding and removing seats goes through `addMember` / `removeMember` — the
 * endpoints `حلقات المواد` uses — and only the **difference** is written, so a
 * seat nobody touched is not removed and re-added. **Changing the group releases
 * her circle seats server-side**, which the dialog warns about before it happens:
 * a circle is a placement within this Level and her subdivision is about to
 * change. The two remain independent relationships — nothing here reads a group
 * to decide a circle (§4.4c: *"nothing aligns them and nothing should try to"*).
 */
function PlacementDialog({
  row,
  token,
  onCancel,
  onDone,
}: {
  row: EnrollmentRowView;
  token: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const [groupId, setGroupId] = useState(row.administrative_group_id ?? '');
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [circles, setCircles] = useState<TeachingGroupRow[]>([]);
  /** Her current seats, as the ids the circle endpoints take. */
  const [circleIds, setCircleIds] = useState<string[]>([]);
  const [pristineCircleIds, setPristineCircleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [groupPage, branchPage, circlePage] = await Promise.all([
        listAdministrativeGroups(token, 1, { level_id: row.level_id }).catch(() => null),
        // Only the branches this caller may act on, so the form cannot offer one
        // the placement would refuse.
        listBranches(token).catch(() => null),
        // Keyed on the LEVEL alone — a circle is `(Subject, Level)` and has no
        // branch and no relation to a group (§4.4c, R43.3).
        listCircles(token, 1, { level_id: row.level_id }).catch(() => null),
      ]);
      setGroups(groupPage?.data ?? []);
      setBranches(branchPage?.data ?? []);
      const all = circlePage?.data ?? [];
      setCircles(all);
      // Her seats, matched from the row's own read: `EnrollmentRowView.circles`
      // carries names rather than ids, so the ids come from the circle list.
      const held = all
        .filter((c) =>
          row.circles.some((x) => x.subject_name === c.subject_name && x.circle_name === c.name),
        )
        .map((c) => c.id);
      setCircleIds(held);
      setPristineCircleIds(held);
    })();
  }, [row.level_id, row.circles, token]);

  const changesGroup = (groupId === '' ? null : groupId) !== row.administrative_group_id;
  const dirty = isDirty(
    { groupId, circleIds: [...circleIds].sort() },
    {
      groupId: row.administrative_group_id ?? '',
      circleIds: [...pristineCircleIds].sort(),
    },
  );

  async function submit(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      // Only the subdivision: the route refuses `level_id` and `branch_id`
      // outright, and sending either would be a `400` rather than a move.
      await updateEnrollment(
        row.id,
        { administrative_group_id: groupId === '' ? null : groupId },
        token,
      );

      /**
       * **Only the difference is written**, and removals go first.
       *
       * Re-asserting a seat she already holds would be refused as a duplicate,
       * and re-writing every one would put changes nobody made into the audit
       * trail. Removals precede additions so that moving her between two circles
       * of the SAME Subject cannot momentarily hold both — which the server
       * refuses with a `409`, correctly.
       */
      const before = new Set(pristineCircleIds);
      const after = new Set(circleIds);
      let failed = 0;
      for (const id of before) {
        if (!after.has(id)) {
          try {
            await removeMember(id, row.student_id, token);
          } catch {
            failed += 1;
          }
        }
      }
      for (const id of after) {
        if (!before.has(id)) {
          try {
            await addMember(id, row.student_id, token);
          } catch {
            failed += 1;
          }
        }
      }

      onDone(
        failed > 0 ? t('admin.enrollments.updatedCirclesPartly') : t('admin.enrollments.updated'),
      );
    } catch (error) {
      setNotice(refusal(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open
      title={t('admin.enrollments.editTitle')}
      notice={notice}
      busy={busy}
      dirty={dirty}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <p className="lede">
        {row.student_name} — {row.category_name} — {row.level_name}
      </p>

      <SelectField
        label={t('admin.nav.groups')}
        value={groupId}
        onChange={setGroupId}
        placeholder={t('admin.enrollments.levelOnly')}
        options={groups.map((g) => ({ value: g.id, label: g.name }))}
        hint={
          changesGroup && row.circles.length > 0
            ? t('admin.enrollments.seatsWarning')
            : t('admin.enrollments.groupHint')
        }
      />

      {/* **The Level and the Branch are CONTEXT, not controls** (2026-08-18).
          An enrolment IS `beneficiary + Level + Branch`; changing either is a
          different enrolment, which إنهاء التسجيل and تسجيل مستفيدة already
          express. Shown rather than hidden, because a reader needs to know which
          enrolment they are editing — and the copy names the way to move her. */}
      {/* The identity line above already names the beneficiary, her Category and
          her Level; the branch joins it here so all three read together. */}
      <p className="muted">
        {t('admin.enrollments.branch')}:{' '}
        {branches.find((b) => b.id === row.branch_id)?.name ?? row.branch_id}
      </p>
      <p className="field__hint">{t('admin.enrollments.identityFixed')}</p>

      {circles.length === 0 ? (
        <p className="field__hint">{t('admin.enrollments.circlesNone')}</p>
      ) : (
        <MultiSelectField
          label={t('admin.enrollments.circlesOptional')}
          options={circles.map((c) => ({
            value: c.id,
            label: `${c.subject_name} — ${c.name}`,
          }))}
          selected={circleIds}
          onChange={setCircleIds}
          hint={t('admin.enrollments.circlesHint')}
        />
      )}

      {/* The Level is deliberately absent — see the docstring. */}
      <p className="field__hint">{t('admin.enrollments.levelFixed')}</p>
    </FormDialog>
  );
}
