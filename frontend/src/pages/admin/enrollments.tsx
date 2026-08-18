import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { SortState } from '../../components/ui/data-table.js';

import { listAdministrativeGroups, type AdministrativeGroup } from '../../adapters/administrative-groups.js';
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
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { LevelSelect, levelLabel } from '../../components/scope/level-select.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
} from '../../components/ui/data-table.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { SearchInput, SelectField } from '../../components/ui/field.js';
import { MultiSelectField } from '../../components/ui/multi-select.js';
import { SearchableSelect } from '../../components/ui/searchable-select.js';
import { useSession } from '../../contexts/session.js';
import { isDirty } from '../../lib/form-dirty.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

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
export function EnrollmentsPage(): ReactNode {
  const { accessToken } = useSession();

  const [rows, setRows] = useState<EnrollmentRowView[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filterLevel, setFilterLevel] = useState<string | null>(null);
  // `null` is BR-19's order, which the server keeps when nothing is asked.
  const [sort, setSort] = useState<SortState | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<EnrollmentRowView | null>(null);
  const [ending, setEnding] = useState<EnrollmentRowView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [list, levelList] = await Promise.all([
        listEnrollments(accessToken, filterLevel ? { level_id: filterLevel } : {}, sort),
        listLevels(accessToken),
      ]);
      setRows(list);
      setLevels(levelList);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [accessToken, filterLevel, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        // The server returns only the branches this caller may act on, so the
        // form cannot offer one the placement would refuse.
        setBranches((await listBranches(accessToken)).data);
      } catch {
        setBranches([]);
      }
    })();
  }, [accessToken]);

  /** Client-side narrowing by name; the Level narrows server-side already. */
  const visible = rows.filter((r) => {
    const needle = query.trim().toLowerCase();
    return needle === '' || r.student_name.toLowerCase().includes(needle);
  });

  const columns: Column<EnrollmentRowView>[] = [
    {
      key: 'student',
      header: t('admin.enrollments.student'),
      sortKey: 'student',
      cell: (r) => r.student_name,
    },
    {
      key: 'level',
      header: t('admin.nav.levels'),
      sortKey: 'level',
      // The shared label — `{Category} — {Level}` — so a Level reads the same
      // here as in every selector (§4.4b).
      cell: (r) =>
        levelLabel({ id: r.level_id, name: r.level_name, category_name: r.category_name }),
    },
    {
      key: 'group',
      header: t('admin.nav.groups'),
      cell: (r) =>
        r.administrative_group_name ?? (
          // R66 — a Level nobody has subdivided is ordinary, and an enrolment
          // without a group is a placement, not a gap.
          <span className="muted">{t('admin.enrollments.noGroup')}</span>
        ),
    },
    { key: 'branch', header: t('admin.enrollments.branch'), secondary: true, cell: (r) => r.branch_name },
    {
      key: 'circles',
      header: t('admin.enrollments.circles'),
      // Read-only here. Circle membership is INDEPENDENT of the group (§4.4c —
      // "nothing aligns them and nothing should try to"); it is shown so
      // مستفيدة → مستوى → مجموعة → مادة → حلقة reads in one place, and it is
      // managed on حلقات المواد and offered at placement time.
      cell: (r) =>
        r.circles.length === 0 ? (
          <span className="muted">{t('admin.enrollments.noCircles')}</span>
        ) : (
          <ul className="admin-list admin-list--plain">
            {r.circles.map((c) => (
              <li key={`${c.subject_name}-${c.circle_name}`}>
                {c.subject_name} — {c.circle_name}
              </li>
            ))}
          </ul>
        ),
    },
  ];

  const actions: RowAction<EnrollmentRowView>[] = [
    { label: t('common.edit'), onSelect: (r) => setEditing(r) },
    // Destructive, so it carries the shared danger treatment — the enrolment is
    // soft-deleted into Trash (R59), which the confirmation states in full.
    { label: t('admin.enrollments.end'), danger: true, onSelect: (r) => setEnding(r) },
  ];

  return (
    <AdminLayout
      title={t('admin.nav.enrollments')}
      lede={t('admin.enrollments.lede')}
      actions={
        <Button variant="add" onClick={() => setComposing(true)}>
          {t('admin.enrollments.add')}
        </Button>
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <DataTable
        caption={t('admin.enrollments.caption')}
        columns={columns}
        rows={visible}
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

      {composing ? (
        <EnrolDialog
          levels={levels}
          branches={branches}
          token={accessToken}
          onCancel={() => setComposing(false)}
          onDone={(message) => {
            setComposing(false);
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
  branches,
  token,
  onCancel,
  onDone,
}: {
  levels: Level[];
  branches: Branch[];
  token: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const [matches, setMatches] = useState<UserSummary[]>([]);
  const [studentId, setStudentId] = useState('');
  const [levelId, setLevelId] = useState<string | null>(null);
  /**
   * **The Levels THIS beneficiary may enter**, resolved server-side once she is
   * chosen (R27 + BR-21). Before that the dialog offers the full list it was
   * handed, so the field is never empty for want of an answer to a question the
   * reader has not been asked yet.
   */
  const [eligibleLevels, setEligibleLevels] = useState<Level[] | null>(null);
  const [branchId, setBranchId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  /** The Level's circles, across its Subjects — offered, never required. */
  const [circles, setCircles] = useState<TeachingGroupRow[]>([]);
  const [circleIds, setCircleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
  useEffect(() => {
    void (async () => {
      try {
        setMatches((await searchUsers(token, { beneficiaries_only: 'true' })).data);
      } catch {
        setMatches([]);
      }
    })();
  }, [token]);

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
  useEffect(() => {
    const group = groups.find((g) => g.id === groupId);
    if (group) setBranchId(group.branch_id);
  }, [groupId, groups]);

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
    if (!studentId || !levelId || !branchId) return;
    setBusy(true);
    setNotice(null);
    try {
      await enrol(
        {
          student_id: studentId,
          level_id: levelId,
          branch_id: branchId,
          // `null` is the placement, not the absence of one (R66).
          administrative_group_id: groupId === '' ? null : groupId,
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
    { studentId, levelId, branchId, groupId, circleIds: [...circleIds].sort() },
    { studentId: '', levelId: null, branchId: '', groupId: '', circleIds: [] },
  );

  return (
    <FormDialog
      open
      title={t('admin.enrollments.add')}
      notice={notice}
      busy={busy}
      dirty={dirty}
      disabled={!studentId || !levelId || !branchId}
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
      {/* **The beneficiary is asked FIRST, and is independent.** The form's
          question is *who am I enrolling*, and every other field answers *where
          and how*. Narrowing this list by a chosen Level was tried and reversed:
          a woman already enrolled elsewhere is still a beneficiary. */}
      <SearchableSelect
        label={t('admin.enrollments.student')}
        options={matches.map((m) => ({ value: m.id, label: m.name_arabic }))}
        value={studentId}
        onChange={setStudentId}
        hint={t('admin.enrollments.searchHint')}
        required
      />

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

      <SelectField
        label={t('admin.enrollments.branch')}
        value={branchId}
        onChange={setBranchId}
        placeholder={t('common.choose')}
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
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

function refusal(error: unknown): string {
  if (!(error instanceof ApiError)) return t('common.saveFailed');
  if (error.status === 409) return t('admin.enrollments.already');
  if (error.status === 404) return t('admin.enrollments.outOfScope');
  return t('common.saveFailed');
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
  const [branchId, setBranchId] = useState(row.branch_id);
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
          row.circles.some(
            (x) => x.subject_name === c.subject_name && x.circle_name === c.name,
          ),
        )
        .map((c) => c.id);
      setCircleIds(held);
      setPristineCircleIds(held);
    })();
  }, [row.level_id, row.circles, token]);

  // A group states its own branch (§7), so choosing one answers the branch.
  useEffect(() => {
    const group = groups.find((g) => g.id === groupId);
    if (group) setBranchId(group.branch_id);
  }, [groupId, groups]);

  const changesGroup = (groupId === '' ? null : groupId) !== row.administrative_group_id;
  const dirty = isDirty(
    { groupId, branchId, circleIds: [...circleIds].sort() },
    {
      groupId: row.administrative_group_id ?? '',
      branchId: row.branch_id,
      circleIds: [...pristineCircleIds].sort(),
    },
  );

  async function submit(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const group = groups.find((g) => g.id === groupId);
      await updateEnrollment(
        row.id,
        {
          administrative_group_id: groupId === '' ? null : groupId,
          // The group's branch wins where there is one; otherwise the chosen
          // branch, which is the whole point of R66's column.
          branch_id: group ? group.branch_id : branchId,
        },
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

      {/* **Editable only for a Level-only enrolment.** With a group chosen the
          branch is the group's (§7), and offering it as a second answer is how
          the two come to disagree. Disabled rather than hidden, so the reader can
          see which branch she is at and why it is not theirs to change here
          (§14.2 — an inapplicable control still teaches). */}
      <SelectField
        label={t('admin.enrollments.branch')}
        value={branchId}
        onChange={setBranchId}
        disabled={groupId !== ''}
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
        hint={
          groupId !== ''
            ? t('admin.enrollments.branchFromGroup')
            : t('admin.enrollments.branchHint')
        }
      />

      {circles.length === 0 ? (
        <p className="field__hint">{t('admin.enrollments.circlesNone')}</p>
      ) : (
        <MultiSelectField
          label={t('admin.enrollments.circlesOptional')}
          options={circles.map((c) => ({ value: c.id, label: `${c.subject_name} — ${c.name}` }))}
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
