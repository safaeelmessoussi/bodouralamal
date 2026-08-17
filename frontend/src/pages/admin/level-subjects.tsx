import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listSubjects, type SubjectRef } from '../../adapters/reference-data.js';
import {
  assignSubject,
  listCategories,
  listLevelSubjects,
  listLevels,
  unassignSubject,
  type Category,
  type Level,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { Button, ButtonLink } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { SearchInput, SelectField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/level-subjects` — **مواد المستوى** (§4.4b, TD-3 extension 2026-08-05;
 * R69 gave it this node).
 *
 * ## The gate is gone (2026-08-17)
 *
 * R69 gave this screen a menu node and, because a menu entry cannot carry an id,
 * had it ask for a Level in the page — so it opened as a dropdown over
 * *"choose a level to see the subjects taught in it"* with nothing beneath. That
 * was a reasonable step and it is the wrong end state: it is the same shape
 * `نقاط الامتحانات` and `حلقات المواد` were both rebuilt out of, and the reason
 * is the same each time. **A management page shows the data it manages
 * immediately; filters narrow it.**
 *
 * Every accessible Level is now listed **with the Subjects it teaches already
 * visible**, so *"which Levels teach nothing"* — the question that made
 * `SUBJECT_NOT_IN_LEVEL` mysterious — is answered by reading the page. `?level=`
 * still opens one Level's editor and remains R69's deep link.
 *
 * ## What this screen is for, and what it deliberately is not
 *
 * **This screen is the fix for `SUBJECT_NOT_IN_LEVEL`.** The platform shipped
 * with zero `LevelSubject` rows and nothing that could create one, so every
 * attempt to create a Teaching Group was refused.
 *
 * **A Subject with no Teaching Groups is taught to the whole Level.** Assigning
 * it here is what makes it *taught*; splitting it into circles is a separate,
 * optional decision taken on `حلقات المواد`. Those are different questions and
 * the screens keep them apart (R69.5).
 *
 * **Removal is refused while Teaching Groups exist** for the pair, and the
 * refusal is reported as what it is: those circles split a Subject the Level
 * would no longer teach, leaving their members holding seats in a subject that is
 * not offered.
 *
 * Assignment is Super Admin (R43.3 — curriculum structure); an Admin reads the
 * list and may still open `حلقات المواد`, where placing students is their job.
 * The server enforces both.
 */
interface Row {
  level: Level;
  subjects: SubjectRef[];
}

export function LevelSubjectsPage({ levelId }: { levelId: string | null }): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered a
  // control the server will refuse: the affordance follows the authority.
  const canWrite = activeRoles.includes('super_admin');

  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [all, setAll] = useState<SubjectRef[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [picked, setPicked] = useState('');
  const [removing, setRemoving] = useState<{ level: Level; subject: SubjectRef } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [levels, every, categoryList] = await Promise.all([
        listLevels(accessToken),
        listSubjects(accessToken),
        listCategories(accessToken).catch(() => [] as Category[]),
      ]);
      // One `LevelSubject` read per Level, in parallel — a small join each, and
      // the whole point is that the answer is on the page rather than one
      // dropdown selection away.
      const withSubjects = await Promise.all(
        levels.map(async (level) => ({
          level,
          subjects: await listLevelSubjects(level.id, accessToken).catch(() => [] as SubjectRef[]),
        })),
      );
      setRows(withSubjects);
      setAll(every);
      setCategories(categoryList);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = levelId ? (rows.find((r) => r.level.id === levelId) ?? null) : null;

  /** Client-side narrowing of a list already loaded in full. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (categoryFilter === '' || r.level.category_id === categoryFilter) &&
        (needle === '' ||
          levelLabel(r.level).toLowerCase().includes(needle) ||
          r.subjects.some((s) => s.name.toLowerCase().includes(needle))),
    );
  }, [rows, query, categoryFilter]);

  // Offered = every live Subject minus the ones already on the open Level.
  // Narrowing the page's own already-fetched list, not filtering reference data
  // the server owns — the distinction the calendar's category→level rule draws.
  const available = open ? all.filter((s) => !open.subjects.some((a) => a.id === s.id)) : [];

  async function add(): Promise<void> {
    if (!picked || !open) return;
    setBusy(true);
    setNotice(null);
    try {
      await assignSubject(open.level.id, picked, accessToken);
      setPicked('');
      await load();
      setNotice(t('admin.levelSubjects.assigned'));
    } catch (error) {
      // A 409 here is DUPLICATE — someone assigned it in another tab. The list is
      // simply stale, so reloading is the whole remedy.
      const duplicate = error instanceof ApiError && error.status === 409;
      setNotice(t(duplicate ? 'admin.levelSubjects.alreadyAssigned' : 'common.saveFailed'));
      if (duplicate) await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!removing) return;
    setBusy(true);
    try {
      await unassignSubject(removing.level.id, removing.subject.id, accessToken);
      await load();
      setNotice(t('admin.levelSubjects.removed'));
    } catch (error) {
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(t(blocked ? 'admin.levelSubjects.removeBlocked' : 'common.deleteFailed'));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  const columns: Column<Row>[] = [
    { key: 'level', header: t('admin.levelSubjects.colLevel'), cell: (r) => levelLabel(r.level) },
    {
      key: 'subjects',
      header: t('admin.levelSubjects.colSubjects'),
      cell: (r) =>
        r.subjects.length === 0 ? (
          // Not an error — a named state. A Level that teaches nothing cannot
          // have a circle or a schedule, and saying so on this row is what stops
          // it being discovered as a refusal three screens later.
          <span className="muted">{t('admin.levelSubjects.noneYet')}</span>
        ) : (
          r.subjects.map((s) => s.name).join(' · ')
        ),
    },
    {
      key: 'count',
      header: t('admin.levelSubjects.colCount'),
      numeric: true,
      secondary: true,
      cell: (r) => r.subjects.length,
    },
  ];

  const actions: RowAction<Row>[] = [
    {
      label: t('admin.levelSubjects.manage'),
      onSelect: (r) => {
        window.location.href = `/admin/level-subjects?level=${r.level.id}`;
      },
    },
  ];

  return (
    <AdminLayout
      // **The title stays the page's own**, whichever Level is open — the same
      // rule `نقاط الامتحانات` follows. The Level is named in the block below,
      // once. It used to replace the heading, so a reader who arrived from the
      // menu found a title that did not match the item they had clicked.
      //
      // **And no breadcrumb.** The removed trail read `المستويات › مواد مستوى X`.
      // `المستويات` is a sibling node in the menu, not this page's parent, so the
      // crumb was a second access path to a screen one click away.
      title={t('admin.nav.levelSubjects')}
      lede={t('admin.levelSubjects.lede')}
      actions={
        open ? (
          <Button
            variant="secondary"
            onClick={() => (window.location.href = '/admin/level-subjects')}
          >
            {t('admin.levelSubjects.backToLevels')}
          </Button>
        ) : null
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {open ? (
        <>
          <section className="admin-notice" aria-label={t('admin.levelSubjects.colSubjects')}>
            <strong>{levelLabel(open.level)}</strong>
          </section>

          {canWrite ? (
            <section className="form">
              <SelectField
                label={t('admin.levelSubjects.addLabel')}
                value={picked}
                onChange={setPicked}
                options={[
                  { value: '', label: t('common.choose') },
                  ...available.map((s) => ({ value: s.id, label: s.name })),
                ]}
                hint={
                  available.length === 0
                    ? t('admin.levelSubjects.noneLeft')
                    : t('admin.levelSubjects.addHint')
                }
              />
              <Button variant="add" disabled={busy || picked === ''} onClick={() => void add()}>
                {t('admin.levelSubjects.add')}
              </Button>
            </section>
          ) : null}

          {open.subjects.length === 0 ? (
            <p className="state" role="status">
              {t('admin.levelSubjects.empty')}
            </p>
          ) : (
            <ul className="admin-list">
              {open.subjects.map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                  {/* R69's canonical route — not the legacy
                      `/admin/levels/{id}/subjects/{sid}` path, which still works
                      but only by bouncing through a redirect. A redirect is for
                      links already in the wild, not for the screen next door. */}
                  <ButtonLink
                    variant="secondary"
                    href={`/admin/teaching-groups?level=${open.level.id}&subject=${s.id}`}
                  >
                    {t('admin.levelSubjects.organise')}
                  </ButtonLink>
                  {canWrite ? (
                    <Button
                      variant="secondary"
                      onClick={() => setRemoving({ level: open.level, subject: s })}
                    >
                      {t('admin.levelSubjects.remove')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <DataTable
          caption={t('admin.levelSubjects.caption')}
          columns={columns}
          rows={visible}
          rowKey={(r) => r.level.id}
          status={status}
          actions={actions}
          onRetry={() => void load()}
          filtered={query.trim() !== '' || categoryFilter !== ''}
          onClearFilters={() => {
            setQuery('');
            setCategoryFilter('');
          }}
          toolbar={
            <>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={t('admin.levelSubjects.searchPlaceholder')}
              />
              <SelectField
                label={t('admin.levelSubjects.filterCategory')}
                value={categoryFilter}
                onChange={setCategoryFilter}
                placeholder={t('admin.levelSubjects.allCategories')}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </>
          }
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t('admin.levelSubjects.removeTitle')}
        body={t('admin.levelSubjects.removeBody').replace('{name}', removing?.subject.name ?? '')}
        confirmLabel={t('admin.levelSubjects.remove')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </AdminLayout>
  );
}
