import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listAdministrativeGroups, type AdministrativeGroup } from '../../adapters/administrative-groups.js';
import { listBranches, type Branch } from '../../adapters/branches-admin.js';
import { enrol, listEnrollments, type EnrollmentRowView } from '../../adapters/enrollments.js';
import { listLevels, type Level } from '../../adapters/taxonomy.js';
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { LevelSelect, levelLabel } from '../../components/scope/level-select.js';
import { Button } from '../../components/ui/button.js';
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
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

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

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const id = setTimeout(() => {
      void (async () => {
        try {
          setMatches((await searchUsers(token, { q: query })).data);
        } catch {
          setMatches([]);
        }
      })();
    }, 250);
    return () => clearTimeout(id);
  }, [query, token]);

  // §14.4/R55 — every selector is dependent: the Groups offered are those of the
  // chosen Level at the chosen branch, so the form cannot express a pair the
  // server refuses.
  useEffect(() => {
    if (!levelId || !branchId) {
      setGroups([]);
      setGroupId('');
      return;
    }
    void (async () => {
      try {
        const page = await listAdministrativeGroups(token, 1, {
          level_id: levelId,
          branch_id: branchId,
        });
        setGroups(page.data);
      } catch {
        setGroups([]);
      }
    })();
  }, [levelId, branchId, token]);

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
