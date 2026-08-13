import { useCallback, useEffect, useState, type ReactNode } from 'react';

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
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { LevelSelect, levelLabel } from '../../components/scope/level-select.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { SelectField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
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
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<EnrollmentRowView | null>(null);
  const [ending, setEnding] = useState<EnrollmentRowView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [list, levelList] = await Promise.all([
        listEnrollments(accessToken, filterLevel ? { level_id: filterLevel } : {}),
        listLevels(accessToken),
      ]);
      setRows(list);
      setLevels(levelList);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [accessToken, filterLevel]);

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

  return (
    <AdminLayout
      title={t('admin.nav.enrollments')}
      lede={t('admin.enrollments.lede')}
      actions={
        <Button variant="primary" onClick={() => setComposing(true)}>
          {t('admin.enrollments.add')}
        </Button>
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {/* A filter, not a gate: the list above is already loaded. */}
      <LevelSelect
        levels={levels}
        value={filterLevel}
        onChange={(next) => setFilterLevel(next === '' ? null : next)}
        label={t('admin.enrollments.filterLevel')}
        placeholder={t('admin.enrollments.allLevels')}
      />

      {state === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
      {state === 'error' ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : null}

      {state === 'ready' ? (
        rows.length === 0 ? (
          <p className="state" role="status">
            {t('admin.enrollments.empty')}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.enrollments.student')}</th>
                <th scope="col">{t('admin.nav.levels')}</th>
                <th scope="col">{t('admin.nav.groups')}</th>
                <th scope="col">{t('admin.enrollments.branch')}</th>
                <th scope="col">{t('admin.enrollments.circles')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.student_name}</td>
                  {/* The shared label — `{Category} — {Level}` — so a Level reads
                      the same here as in every selector (§4.4b). */}
                  <td>{levelLabel({ id: r.level_id, name: r.level_name, category_name: r.category_name })}</td>
                  <td>
                    {r.administrative_group_name ?? (
                      // R66 — a Level nobody has subdivided is ordinary, and an
                      // enrolment without a group is a placement, not a gap.
                      <span className="muted">{t('admin.enrollments.noGroup')}</span>
                    )}
                  </td>
                  <td>{r.branch_name}</td>
                  <td>
                    {/* Read-only. Circle membership is managed on حلقات المواد
                        and is INDEPENDENT of the group (§4.4c — "nothing aligns
                        them and nothing should try to"); it is shown here only
                        so مستفيدة → مستوى → مجموعة → مادة → حلقة reads in one
                        place. */}
                    {r.circles.length === 0 ? (
                      <span className="muted">{t('admin.enrollments.noCircles')}</span>
                    ) : (
                      <ul className="admin-list admin-list--plain">
                        {r.circles.map((c) => (
                          <li key={`${c.subject_name}-${c.circle_name}`}>
                            {c.subject_name} — {c.circle_name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="admin-table__actions">
                    <Button variant="secondary" onClick={() => setEditing(r)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="secondary" onClick={() => setEnding(r)}>
                      {t('admin.enrollments.end')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

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

      <ConfirmDialog
        open={ending !== null}
        title={t('admin.enrollments.endTitle')}
        body={t('admin.enrollments.endBody')}
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
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<UserSummary[]>([]);
  const [studentId, setStudentId] = useState('');
  const [levelId, setLevelId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // **The list is loaded on open; search NARROWS it.** It used to be gated on
  // two typed characters, so the dialog opened with an empty picker and no
  // affordance saying why — the very defect the `حلقات المواد` redesign was
  // about, reintroduced one screen over.
  //
  // **Everyone active is offered, and that is not an oversight.** There is no
  // structural fact distinguishing a مستفيدة from any other account: minors
  // hold no role at all (§4.3), `intended_category_id` is unset on every live
  // row, and a مؤطرة may legitimately be enrolled — one of the association's
  // accounts holds both `teacher` and `student` today. Filtering by role would
  // hide exactly the students who most need enrolling.
  useEffect(() => {
    const id = setTimeout(() => {
      void (async () => {
        try {
          setMatches((await searchUsers(token, query.trim() ? { q: query } : {})).data);
        } catch {
          setMatches([]);
        }
      })();
    }, query.trim() ? 250 : 0);
    return () => clearTimeout(id);
  }, [query, token]);

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
      onDone(t('admin.enrollments.enrolled'));
    } catch (error) {
      setNotice(refusal(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open
      title={t('admin.enrollments.add')}
      notice={notice}
      busy={busy}
      disabled={!studentId || !levelId || !branchId}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <label className="field">
        <span className="field__label">{t('admin.enrollments.student')}</span>
        <input
          className="field__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.enrollments.searchHint')}
        />
      </label>
      <SelectField
        label={t('admin.enrollments.pickStudent')}
        value={studentId}
        onChange={setStudentId}
        placeholder={t('common.choose')}
        options={matches.map((m) => ({ value: m.id, label: m.name_arabic }))}
      />

      <LevelSelect levels={levels} value={levelId} onChange={setLevelId} />

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
 * Changing a placement **within its Level**.
 *
 * **The Level is not offered, and that is the model rather than a limitation.**
 * BR-21 makes `(student, level)` unique, so an enrolment *is* that pair: moving
 * a مستفيدة to another Level means ending this enrolment and beginning another,
 * which the two other actions on this screen already express. Rewriting
 * `level_id` in place would leave her history and circle seats attached to a
 * Level she no longer studies.
 *
 * **Changing the group releases her circle seats**, which the dialog says
 * before it happens: a circle is a placement within this Level, and her
 * subdivision is about to change (§4.4c).
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setGroups((await listAdministrativeGroups(token, 1, { level_id: row.level_id })).data);
      } catch {
        setGroups([]);
      }
    })();
  }, [row.level_id, token]);

  const changesGroup = (groupId === '' ? null : groupId) !== row.administrative_group_id;

  return (
    <FormDialog
      open
      title={t('admin.enrollments.editTitle')}
      notice={notice}
      busy={busy}
      onSubmit={() => {
        void (async () => {
          setBusy(true);
          setNotice(null);
          try {
            const group = groups.find((g) => g.id === groupId);
            await updateEnrollment(
              row.id,
              {
                administrative_group_id: groupId === '' ? null : groupId,
                // A group states its own branch (§7); moving into one moves her
                // to that branch, so the two answers cannot disagree.
                ...(group ? { branch_id: group.branch_id } : {}),
              },
              token,
            );
            onDone(t('admin.enrollments.updated'));
          } catch (error) {
            setNotice(refusal(error));
          } finally {
            setBusy(false);
          }
        })();
      }}
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
      {/* The Level is deliberately absent — see the docstring. */}
      <p className="field__hint">{t('admin.enrollments.levelFixed')}</p>
    </FormDialog>
  );
}
