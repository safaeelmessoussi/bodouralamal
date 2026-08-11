import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchCalendarBootstrap, type LevelRef } from '../../adapters/calendar.js';
import { listSubjects, type SubjectRef } from '../../adapters/reference-data.js';
import {
  addMember,
  createTeachingGroup,
  deleteTeachingGroup,
  readSubjectSplit,
  updateTeachingGroup,
  type SubjectSplit,
  type TeachingGroup,
} from '../../adapters/teaching-groups.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { Dialog } from '../../components/ui/dialog.js';
import { TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/levels/{levelId}/subjects/{subjectId}` — Subject Organisation
 * (§14.1 Academic, §4.4c, BR-22).
 *
 * **A sub-view of the Levels module, not a sidebar entry.** §14.1 lists the node
 * but its path carries two ids, so nothing can link to it from a menu — it is
 * reached by drilling in, exactly as `/admin/groups/{id}/roster` is. The module
 * registry holds *navigation*; this is one of the internal views its docstring
 * says a module owns without registering each as a node.
 *
 * **The screen's whole job is BR-22.** A student enrolled in a Level whose
 * Subject is split, but holding no group for it, has **no sessions for that
 * subject at all** — and nothing else in the platform would say so. So the
 * unassigned list is the top of the page, not a footnote, and it is never
 * paginated: a page boundary drawn through an alarm hides half of it.
 *
 * **`split: false` is rendered as its own state**, distinct from an empty
 * unassigned list. A Subject with no groups is taught to the entire Level, so
 * *the question does not apply* — showing "everyone is placed" there would be a
 * different claim, and a reassuring one about something nobody asked.
 *
 * **Authority is split (R43.3) and the screen follows it**: creating, renaming
 * and deleting a group is Super Admin, while placing a student is Admin scoped
 * by that student's own branch. The controls are gated accordingly; the server
 * enforces it regardless.
 */
export function SubjectOrganisationPage({
  levelId,
  subjectId,
}: {
  levelId: string;
  subjectId: string | null;
}): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const roles = activeRoles;
  const canManageGroups = roles.includes('super_admin');
  const canPlace = roles.some((r) => ['admin', 'super_admin'].includes(r));

  const [levels, setLevels] = useState<LevelRef[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [split, setSplit] = useState<SubjectSplit | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeachingGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TeachingGroup | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [subjectList] = await Promise.all([listSubjects(accessToken)]);
      setSubjects(subjectList);
      try {
        const bootstrap = await fetchCalendarBootstrap({ from: today, to: today });
        setLevels(bootstrap.levels);
      } catch {
        // The Level name falls back to its id; the page still works.
      }
    })();
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!subjectId) return;
    setError(false);
    try {
      setSplit(await readSubjectSplit(levelId, subjectId, accessToken));
    } catch {
      setError(true);
    }
  }, [levelId, subjectId, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const levelName = levels.find((l) => l.id === levelId)?.name ?? levelId;

  function go(nextSubject: string): void {
    window.location.href = `/admin/levels/${levelId}/subjects/${nextSubject}`;
  }

  async function save(name: string): Promise<void> {
    if (!subjectId) return;
    setBusy(true);
    setNotice(null);
    try {
      if (editing && editing !== 'new') {
        await updateTeachingGroup(editing.id, editing.version, { name }, accessToken);
      } else {
        await createTeachingGroup(levelId, subjectId, { name }, accessToken);
      }
      setEditing(null);
      await load();
    } catch (error_) {
      const reason =
        error_ instanceof ApiError
          ? (error_.details?.['reason'] as string | undefined)
          : undefined;
      setNotice(
        reason === 'SUBJECT_NOT_IN_LEVEL'
          ? t('admin.subjectOrg.notInLevel')
          : t('common.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await deleteTeachingGroup(deleting.id, accessToken);
      setDeleting(null);
      await load();
      // BR-22: the release is reported, never silent. The count exists only at
      // this moment — afterwards the unassigned list has been worked through.
      setNotice(
        t('admin.subjectOrg.deleted').replace('{n}', String(result.released_students)),
      );
    } catch (error_) {
      const reason =
        error_ instanceof ApiError
          ? (error_.details?.['reason'] as string | undefined)
          : undefined;
      setNotice(
        reason === 'SCHEDULES_EXIST'
          ? t('admin.subjectOrg.refusedSchedules')
          : t('common.saveFailed'),
      );
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  async function place(groupId: string, studentId: string): Promise<void> {
    setNotice(null);
    try {
      await addMember(groupId, studentId, accessToken);
      await load();
    } catch (error_) {
      const reason =
        error_ instanceof ApiError
          ? (error_.details?.['reason'] as string | undefined)
          : undefined;
      setNotice(
        reason === 'ALREADY_IN_SUBJECT_SPLIT'
          ? t('admin.subjectOrg.alreadySplit')
          : reason === 'NOT_ENROLLED_IN_LEVEL'
            ? t('admin.subjectOrg.notEnrolled')
            : t('common.saveFailed'),
      );
    }
  }

  return (
    <AdminLayout
      title={t('admin.subjectOrg.title')}
      lede={t('admin.subjectOrg.lede').replace('{level}', levelName)}
      actions={
        canManageGroups && subjectId ? (
          <Button onClick={() => setEditing('new')}>{t('admin.subjectOrg.create')}</Button>
        ) : null
      }
    >
      {notice ? <p role="status">{notice}</p> : null}

      <label>
        <span>{t('admin.schedules.subject')}</span>
        <select value={subjectId ?? ''} onChange={(e) => go(e.target.value)}>
          <option value="">{t('common.choose')}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {!subjectId ? (
        <p className="state">{t('admin.subjectOrg.pickSubject')}</p>
      ) : error ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : !split ? (
        <p className="state">{t('common.loading')}</p>
      ) : !split.split ? (
        // NOT "everyone is placed" — a different claim entirely. A Subject with
        // no groups is taught to the whole Level, so the question does not apply.
        <p className="state">{t('admin.subjectOrg.notSplit')}</p>
      ) : (
        <>
          <section>
            <h2>{t('admin.subjectOrg.unassignedTitle')}</h2>
            <p className="lede">{t('admin.subjectOrg.unassignedLede')}</p>
            {split.unassigned.length === 0 ? (
              <p>{t('admin.subjectOrg.allPlaced')}</p>
            ) : (
              <ul>
                {split.unassigned.map((u) => (
                  <li key={u.student_id}>
                    {u.name ?? u.student_id}
                    {canPlace ? (
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) void place(e.target.value, u.student_id);
                        }}
                      >
                        <option value="">{t('admin.subjectOrg.placeIn')}</option>
                        {split.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>{t('admin.subjectOrg.groupsTitle')}</h2>
            <ul>
              {split.groups.map((g) => (
                <li key={g.id}>
                  {g.name} — {t('admin.subjectOrg.members').replace('{n}', String(g.member_count))}
                  {canManageGroups ? (
                    <>
                      <Button variant="secondary" onClick={() => setEditing(g)}>
                        {t('common.edit')}
                      </Button>
                      <Button variant="secondary" onClick={() => setDeleting(g)}>
                        {t('common.delete')}
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <NameDialog
        open={editing !== null}
        group={editing === 'new' ? null : editing}
        busy={busy}
        onSave={(name) => void save(name)}
        onCancel={() => setEditing(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.subjectOrg.deleteTitle')}
        body={t('admin.subjectOrg.deleteBody')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </AdminLayout>
  );
}

function NameDialog({
  open,
  group,
  busy,
  onSave,
  onCancel,
}: {
  open: boolean;
  group: TeachingGroup | null;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  useEffect(() => {
    setName(group?.name ?? '');
  }, [group, open]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={t(group ? 'admin.subjectOrg.editTitle' : 'admin.subjectOrg.create')}
    >
      <TextField label={t('admin.groups.colName')} value={name} onChange={setName} required />
      <div className="dialog__actions">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button disabled={name.trim() === '' || busy} onClick={() => onSave(name)}>
          {t('common.save')}
        </Button>
      </div>
    </Dialog>
  );
}
