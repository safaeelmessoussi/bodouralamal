import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  assignSurah,
  fetchLevelCompletion,
  listLevelSurahs,
  listLevels,
  listQuranSurahs,
  unassignSurah,
  type Level,
  type LevelCompletionRow,
  type LevelSurahRef,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { MultiSelectField } from '../../components/ui/multi-select.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/level-surahs` — **مقرر الحفظ** (§4.5, §7, BR-11; M4c).
 *
 * ## The syllabus, and what reads it
 *
 * `LevelSurah` is the **Quran-side curriculum join** (R43), and BR-11 reads it
 * to decide completion: *"coverage 100% and, only if a final exam is configured
 * for that level, that exam passed."* Configuring a Level here is therefore
 * configuring what finishing it means.
 *
 * ## It shows its data
 *
 * Every accessible Level is listed on load with its configured Surahs — the
 * principle the `حلقات المواد` redesign established: *filters narrow visible
 * data; they must never be the precondition for it appearing.* Completion is
 * loaded per Level **when it is opened**, because it resolves coverage per
 * student per Surah and doing that for every Level on load would be a request
 * storm for data nobody has asked to see.
 *
 * ## Authorization
 *
 * **Super Admin writes; Admin reads** — R26's reference-versus-operational
 * split, the same rule `LevelSubject` follows. The controls follow the **active**
 * role (R60) and the server enforces both regardless.
 *
 * ## BR-11 is reported, never recomputed
 *
 * The percentages come from §4.5's engine through the completion read. This
 * screen computes no coverage of its own, and `complete: null` is rendered as
 * its own state: a Level with no syllabus cannot be completed **or** failed, and
 * showing 100% there would let an unconfigured Level mark everybody finished.
 */
interface Detail {
  surahs: LevelSurahRef[];
  completion: LevelCompletionRow[];
  state: 'loading' | 'ready' | 'error';
}

export function LevelSurahsPage({ levelId }: { levelId: string | null }): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  const canWrite = activeRoles.includes('super_admin');

  const [levels, setLevels] = useState<Level[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState<Set<string>>(new Set(levelId ? [levelId] : []));
  const [detail, setDetail] = useState<Record<string, Detail>>({});
  const [editing, setEditing] = useState<Level | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const loadLevel = useCallback(
    async (id: string) => {
      setDetail((d) => ({ ...d, [id]: { surahs: [], completion: [], state: 'loading' } }));
      try {
        const [surahs, completion] = await Promise.all([
          listLevelSurahs(id, accessToken),
          fetchLevelCompletion(id, accessToken),
        ]);
        setDetail((d) => ({ ...d, [id]: { surahs, completion, state: 'ready' } }));
      } catch {
        setDetail((d) => ({ ...d, [id]: { surahs: [], completion: [], state: 'error' } }));
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (levelId && detail[levelId] === undefined) void loadLevel(levelId);
  }, [levelId, detail, loadLevel]);

  function toggle(id: string): void {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        if (detail[id] === undefined) void loadLevel(id);
      }
      return next;
    });
  }

  return (
    <AdminLayout title={t('admin.nav.levelSurahs')} lede={t('admin.levelSurahs.lede')}>
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
                  <h3>{t('admin.levelSurahs.syllabus')}</h3>
                  {info.surahs.length === 0 ? (
                    // A Level with no syllabus is ordinary, not broken — and
                    // BR-11 cannot be asked of it, which the completion block
                    // below says in its own words.
                    <p className="state">{t('admin.levelSurahs.noSurahs')}</p>
                  ) : (
                    <ul className="admin-list">
                      {info.surahs.map((s) => (
                        <li key={s.surah_id}>
                          <span>
                            {s.surah_id}. {s.name_arabic} — {s.total_ayahs}{' '}
                            {t('admin.levelSurahs.ayahs')}
                          </span>
                          {canWrite ? (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    await unassignSurah(level.id, s.surah_id, accessToken);
                                    setNotice(t('admin.levelSurahs.removed'));
                                    await loadLevel(level.id);
                                  } catch {
                                    setNotice(t('common.deleteFailed'));
                                  }
                                })();
                              }}
                            >
                              {t('common.remove')}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* R26 — curriculum is Super Admin. The affordance follows the
                      ACTIVE role (R60); the server enforces it regardless. */}
                  {canWrite ? (
                    <Button variant="secondary" onClick={() => setEditing(level)}>
                      {t('admin.levelSurahs.configure')}
                    </Button>
                  ) : null}

                  <h3>{t('admin.levelSurahs.completion')}</h3>
                  {info.completion.length === 0 ? (
                    <p className="state">{t('admin.levelSurahs.noStudents')}</p>
                  ) : (
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th scope="col">{t('admin.enrollments.student')}</th>
                          <th scope="col">{t('admin.levelSurahs.covered')}</th>
                          <th scope="col">{t('admin.levelSurahs.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {info.completion.map((row) => (
                          <tr key={row.student_id}>
                            <td>{row.student_name}</td>
                            <td>
                              {row.completed_surahs}/{row.configured_surahs}
                            </td>
                            <td>
                              {row.complete === null ? (
                                // BR-11 cannot be asked without a syllabus, and
                                // saying "incomplete" would be an answer nobody
                                // is entitled to give.
                                <span className="muted">
                                  {t('admin.levelSurahs.notConfigured')}
                                </span>
                              ) : (
                                <Badge tone={row.complete ? 'ok' : 'neutral'}>
                                  {t(
                                    row.complete
                                      ? 'admin.levelSurahs.complete'
                                      : 'admin.levelSurahs.incomplete',
                                  )}
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            ) : null}
          </section>
        );
      })}

      {editing ? (
        <SyllabusDialog
          level={editing}
          current={detail[editing.id]?.surahs ?? []}
          token={accessToken}
          onCancel={() => setEditing(null)}
          onDone={(message) => {
            const id = editing.id;
            setEditing(null);
            setNotice(message);
            void loadLevel(id);
          }}
        />
      ) : null}
    </AdminLayout>
  );
}

/**
 * Choosing the Level's Surahs.
 *
 * Uses the shared multi-select, so 114 options are a searchable list rather than
 * a page of checkboxes — which is exactly the control that component was
 * extracted for.
 */
function SyllabusDialog({
  level,
  current,
  token,
  onCancel,
  onDone,
}: {
  level: Level;
  current: LevelSurahRef[];
  token: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const [selected, setSelected] = useState<string[]>(current.map((s) => String(s.surah_id)));
  const [all, setAll] = useState<LevelSurahRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The seeded lookup, not a hardcoded list: §4.5 calls that table the
  // definitive denominator, and a copy of the names here would be a second
  // source of truth for reference data.
  useEffect(() => {
    void (async () => {
      try {
        setAll(await listQuranSurahs(token));
      } catch {
        setAll([]);
      }
    })();
  }, [token]);

  return (
    <FormDialog
      open
      title={t('admin.levelSurahs.configureTitle')}
      notice={notice}
      busy={busy}
      onSubmit={() => {
        void (async () => {
          setBusy(true);
          setNotice(null);
          try {
            const before = new Set(current.map((s) => s.surah_id));
            const after = new Set(selected.map(Number));
            // Only the difference is written: re-asserting an existing row would
            // be refused as a duplicate, and re-writing every one would make an
            // audit trail of changes nobody made.
            for (const id of after) if (!before.has(id)) await assignSurah(level.id, id, token);
            for (const id of before) if (!after.has(id)) await unassignSurah(level.id, id, token);
            onDone(t('admin.levelSurahs.saved'));
          } catch (error) {
            setNotice(
              error instanceof ApiError && error.status === 403
                ? t('admin.levelSurahs.superAdminOnly')
                : t('common.saveFailed'),
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
      onCancel={onCancel}
    >
      <p className="lede">{levelLabel(level)}</p>
      <MultiSelectField
        label={t('admin.levelSurahs.syllabus')}
        options={all.map((s) => ({ value: String(s.surah_id), label: `${s.surah_id}. ${s.name_arabic}` }))}
        selected={selected}
        onChange={setSelected}
        hint={t('admin.levelSurahs.configureHint')}
      />
    </FormDialog>
  );
}


