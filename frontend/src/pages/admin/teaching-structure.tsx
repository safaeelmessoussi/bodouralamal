import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listAdministrativeGroups, type AdministrativeGroup } from '../../adapters/administrative-groups.js';
import type { SubjectRef } from '../../adapters/reference-data.js';
import { listLevelSubjects, listLevels, type Level } from '../../adapters/taxonomy.js';
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
import { SubjectCircles } from '../../components/scope/subject-circles.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/teaching-groups` — **حلقات المواد**, as a management overview
 * (§14.1, §4.4c, BR-22, R43.3, R69).
 *
 * ## The principle this screen was rebuilt on
 *
 * **A management page shows the data it manages immediately.** It used to open
 * as two empty dropdowns: an administrator had to pick a Level and then a
 * Subject before the page showed anything at all — so the only way to learn what
 * existed was to guess at it one pair at a time.
 *
 * **Filters narrow visible data; they must never be the precondition for it
 * appearing.** Every accessible Level is listed on load, and expanding one
 * reveals its groups, its subjects and their circles in place.
 *
 * ## What it shows, and what it deliberately does not manage
 *
 * ```
 * المستوى  ({Category} — {Level})
 *   المجموعات   read-only; /admin/groups manages them
 *   المواد
 *     └─ الحلقات   add / rename / delete, beside the Subject they belong to
 * ```
 *
 * **Groups are read-only here on purpose.** R69.5 gave each screen one
 * responsibility, and making a Group editable in two places is exactly what R69
 * spent a revision undoing. They are shown because *"is this Level subdivided"*
 * is context you need while reading its circles — not because this screen owns
 * them.
 *
 * ## Authorization is unchanged and still the server's
 *
 * R43.3: circle **structure** is Super Admin, circle **membership** is Admin and
 * branch-scoped. The controls follow the **active** role (R60), and the server
 * enforces both regardless — this screen renders refusals rather than
 * reimplementing the rules.
 *
 * ## Loading
 *
 * Levels load eagerly; everything below a Level loads **when that Level is
 * opened**, because a split read per Subject across every Level would be a
 * request storm for data nobody has asked to see yet. `?level=` opens that
 * Level on arrival and `?subject=` scrolls to it, so R69.3's deep links keep
 * working — as focus, not as a gate.
 */
interface LevelDetail {
  groups: AdministrativeGroup[];
  subjects: SubjectRef[];
  splits: Record<string, SubjectSplit>;
  state: 'loading' | 'ready' | 'error';
}

export function TeachingStructurePage({
  levelId,
  subjectId,
}: {
  levelId: string | null;
  subjectId: string | null;
}): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role, so a Super Admin working as مؤطِّرة is not offered a
  // control the server will refuse.
  const canManageGroups = activeRoles.includes('super_admin');
  const canPlace = activeRoles.some((r) => r === 'admin' || r === 'super_admin');

  const [levels, setLevels] = useState<Level[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState<Set<string>>(new Set(levelId ? [levelId] : []));
  const [detail, setDetail] = useState<Record<string, LevelDetail>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The Subject a create/edit dialog is about, so one dialog serves the page. */
  const [editing, setEditing] = useState<
    { levelId: string; subjectId: string; group: TeachingGroup | null } | null
  >(null);
  const [deleting, setDeleting] = useState<{ levelId: string; group: TeachingGroup } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLevels(await listLevels(accessToken));
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, [accessToken]);

  /** Everything under one Level, fetched only when it is opened. */
  const loadLevel = useCallback(
    async (id: string) => {
      setDetail((d) => ({ ...d, [id]: { groups: [], subjects: [], splits: {}, state: 'loading' } }));
      try {
        const [groupPage, subjects] = await Promise.all([
          listAdministrativeGroups(accessToken, 1, { level_id: id }),
          listLevelSubjects(id, accessToken),
        ]);
        // One split per Subject, in parallel — a Level teaches a handful, and
        // serialising them would make opening a Level feel broken.
        const splits: Record<string, SubjectSplit> = {};
        await Promise.all(
          subjects.map(async (s) => {
            try {
              splits[s.id] = await readSubjectSplit(id, s.id, accessToken);
            } catch {
              // One Subject failing must not blank the whole Level.
            }
          }),
        );
        setDetail((d) => ({ ...d, [id]: { groups: groupPage.data, subjects, splits, state: 'ready' } }));
      } catch {
        setDetail((d) => ({ ...d, [id]: { groups: [], subjects: [], splits: {}, state: 'error' } }));
      }
    },
    [accessToken],
  );

  // The deep link opens its Level on arrival (R69.3) — focus, never a gate.
  useEffect(() => {
    if (levelId && detail[levelId] === undefined) void loadLevel(levelId);
  }, [levelId, detail, loadLevel]);

  function toggle(id: string): void {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (detail[id] === undefined) void loadLevel(id);
      }
      return next;
    });
  }

  async function save(name: string): Promise<void> {
    if (!editing) return;
    setBusy(true);
    setNotice(null);
    try {
      if (editing.group) {
        await updateTeachingGroup(editing.group.id, editing.group.version, { name }, accessToken);
      } else {
        await createTeachingGroup(editing.levelId, editing.subjectId, { name }, accessToken);
      }
      const level = editing.levelId;
      setEditing(null);
      await loadLevel(level);
    } catch (error) {
      const reason = error instanceof ApiError ? error.details['reason'] : undefined;
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
      const result = await deleteTeachingGroup(deleting.group.id, accessToken);
      setNotice(
        t('admin.subjectOrg.deleted').replace('{n}', String(result.released_students)),
      );
      await loadLevel(deleting.levelId);
    } catch (error) {
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(t(blocked ? 'admin.subjectOrg.refusedSchedules' : 'common.deleteFailed'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  async function place(level: string, groupId: string, studentId: string): Promise<void> {
    setNotice(null);
    try {
      await addMember(groupId, studentId, accessToken);
      await loadLevel(level);
    } catch (error) {
      const clash = error instanceof ApiError && error.status === 409;
      setNotice(t(clash ? 'admin.subjectOrg.alreadySplit' : 'common.saveFailed'));
    }
  }

  return (
    <AdminLayout title={t('admin.nav.teachingGroups')} lede={t('admin.subjectOrg.overviewLede')}>
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {state === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
      {state === 'error' ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : null}

      {state === 'ready' && levels.length === 0 ? (
        <p className="state" role="status">
          {t('admin.subjectOrg.noLevels')}
        </p>
      ) : null}

      {levels.map((level) => {
        const expanded = open.has(level.id);
        const info = detail[level.id];
        return (
          <section key={level.id} className="tree__level">
            <h2>
              {/* The whole row toggles, and it is a real button so the keyboard
                  and a screen reader get the same affordance the pointer does. */}
              <Button
                variant="ghost"
                onClick={() => toggle(level.id)}
                aria-expanded={expanded}
                className="tree__toggle"
              >
                {expanded ? '▾' : '▸'} {levelLabel(level)}
              </Button>
            </h2>

            {expanded ? (
              info === undefined || info.state === 'loading' ? (
                <p className="state">{t('common.loading')}</p>
              ) : info.state === 'error' ? (
                <p className="state" role="alert">
                  {t('common.loadFailed')}
                </p>
              ) : (
                <div className="tree__body">
                  <h3>{t('admin.nav.groups')}</h3>
                  {info.groups.length === 0 ? (
                    // R66 — an unsubdivided Level is ordinary, not a gap.
                    <p className="state">{t('admin.subjectOrg.noGroups')}</p>
                  ) : (
                    <ul className="admin-list">
                      {info.groups.map((g) => (
                        <li key={g.id}>
                          <span>{g.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Read-only here by design: `/admin/groups` owns them. */}
                  <p className="field__hint">
                    {t('admin.subjectOrg.groupsElsewhere')}{' '}
                    <a href={`/admin/groups?level=${level.id}`}>{t('admin.nav.groups')}</a>
                  </p>

                  <h3>{t('admin.nav.subjects')}</h3>
                  {info.subjects.length === 0 ? (
                    <p className="state">
                      {t('admin.levelSubjects.empty')}{' '}
                      <a href={`/admin/level-subjects?level=${level.id}`}>
                        {t('admin.nav.levelSubjects')}
                      </a>
                    </p>
                  ) : (
                    info.subjects.map((subject) => (
                      <section
                        key={subject.id}
                        className="tree__subject"
                        // `?subject=` scrolls here rather than gating the page.
                        id={`subject-${subject.id}`}
                        aria-current={subject.id === subjectId ? 'true' : undefined}
                      >
                        <h4>{subject.name}</h4>
                        {info.splits[subject.id] ? (
                          <SubjectCircles
                            split={info.splits[subject.id]!}
                            canManageGroups={canManageGroups}
                            canPlace={canPlace}
                            onCreate={() =>
                              setEditing({ levelId: level.id, subjectId: subject.id, group: null })
                            }
                            onEdit={(group) =>
                              setEditing({ levelId: level.id, subjectId: subject.id, group })
                            }
                            onDelete={(group) => setDeleting({ levelId: level.id, group })}
                            onPlace={(groupId, studentId) =>
                              void place(level.id, groupId, studentId)
                            }
                          />
                        ) : (
                          <p className="state" role="alert">
                            {t('common.loadFailed')}
                          </p>
                        )}
                      </section>
                    ))
                  )}
                </div>
              )
            ) : null}
          </section>
        );
      })}

      <CircleDialog
        open={editing !== null}
        group={editing?.group ?? null}
        notice={editing === null ? null : notice}
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

function CircleDialog({
  open,
  group,
  notice,
  busy,
  onSave,
  onCancel,
}: {
  open: boolean;
  group: TeachingGroup | null;
  notice: string | null;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  useEffect(() => {
    setName(group?.name ?? '');
  }, [group, open]);

  return (
    <FormDialog
      open={open}
      title={t(group ? 'admin.subjectOrg.editTitle' : 'admin.subjectOrg.create')}
      notice={notice}
      busy={busy}
      disabled={name.trim() === ''}
      onSubmit={() => onSave(name)}
      onCancel={onCancel}
    >
      <TextField label={t('admin.groups.colName')} value={name} onChange={setName} required />
    </FormDialog>
  );
}
