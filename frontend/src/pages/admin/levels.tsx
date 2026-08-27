import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  createLevel,
  deleteLevel,
  listCategories,
  listLevels,
  reorderLevels,
  updateLevel,
  type Category,
  type CreateLevelInput,
  type GenderRestriction,
  type Level,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { BlockedNotice } from '../../components/ui/blocked-notice.js';
import { classifyDeletion, deletionNotice } from '../../lib/deletion-outcome.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { SelectField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { isDirty } from '../../lib/form-dirty.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

/** §4.4b / Revision 27 — the values, rendered from the contract rather than
 *  hardcoded per screen. */
const GENDER_OPTIONS: GenderRestriction[] = ['any', 'girls_only', 'boys_only'];

/**
 * `/admin/levels` — مستويات (§5.6 *"Levels"*, §14.1, §4.4b, TD-4.6b).
 *
 * **Creating a Level creates its first Administrative Group** (TD-4.6b), which
 * is why the create form asks for a Branch that the Level itself never stores: a
 * Level with no group is a Level nobody can be admitted to, so that state never
 * exists rather than existing until someone fills it in. The form says where the
 * group will go, and the screen confirms where it went.
 *
 * **A Level does not move between Categories.** The edit form omits the field
 * because a move would silently re-file every enrolled student into a different
 * educational stage; the server refuses the field outright, so a client cannot
 * believe a move succeeded.
 *
 * **Row counts are the safety rail.** `enrollment_count` tells an administrator
 * that deleting will be refused *before* they try, and `subject_count` is the
 * entry point to the Subject organisation this Level teaches.
 *
 * Writing is Super Admin; an Admin reads (TD-2 R26), and the server enforces it.
 */
export function LevelsPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const canWrite = (activeRoles).includes('super_admin');

  const [rows, setRows] = useState<Level[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [status, setStatus] = useState<TableStatus>('loading');
  const [editing, setEditing] = useState<Level | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Level | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await listLevels(accessToken, categoryFilter || undefined, sort));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, categoryFilter, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      // The two selectors the create form needs. Failing to load them must not
      // blank the table — the list is still readable without them, and only
      // creation is unavailable.
      // R66 — branches are no longer loaded here: creating a Level asks for
      // one no more, because a Level belongs to a Category and to no Branch.
      setCategories(await listCategories(accessToken).catch(() => []));
    })();
  }, [accessToken]);

  const columns: Column<Level>[] = [
    { key: 'name', header: t('admin.levels.colName'), sortKey: 'name', cell: (r) => r.name },
    {
      key: 'category',
      header: t('admin.levels.colCategory'),
      sortKey: 'category',
      cell: (r) => r.category_name,
    },
    {
      key: 'gender',
      header: t('admin.levels.colGender'),
      // Announced as a word, never as a colour or an icon alone (§14.4).
      cell: (r) => t(`admin.levels.gender.${r.gender_restriction}`),
    },
    /* **«الترتيب» is gone** (R76.8). It answered *why is this Level listed
       here*, and the answer is now the sequence itself — visible without a
       column, and changed by dragging rather than by typing a number into a
       form that then had to be saved. */
    /**
     * **«المجموعات» and «المواد» are gone from this table** (Owner decision,
     * 2026-08-17).
     *
     * Each was a count of a relationship **another page owns**:
     * `مجموعات المستويات` manages the groups and `مواد المستوى` manages the
     * Level↔Subject pairing. A number here answered *how many* while the
     * question a reader brings to those relationships is *which*, and the only
     * action either column offered — the subject count doubling as a link — was
     * already a row action with a proper label two columns over.
     *
     * So this table answers what it is for: **which Levels exist, in which
     * Category, with what admission rule and in what order** (R69.4's
     * one-responsibility-per-screen rule, applied to the columns rather than to
     * the actions).
     *
     * **`enrollment_count` stays**, and the distinction is worth stating: a
     * Level's enrolled مستفيدات are a fact *about the Level itself* — it is what
     * makes a Level real, and it is what deletion is refused on. The other two
     * were facts about pages elsewhere.
     *
     * **Nothing was removed from the backend.** `group_count` and
     * `subject_count` are still on the DTO, still tested, and still read by the
     * deletion refusals. This removes two columns, not two capabilities.
     */
    {
      key: 'students',
      header: t('admin.levels.colStudents'),
      numeric: true,
      cell: (r) => r.enrollment_count as ReactNode,
    },
    {
      /**
       * **§8 — how many circles split this Level's Subjects**, which the
       * Levels table never showed. `group_count` and `subject_count` are
       * already on the row: the screen was asking for them and rendering
       * neither, so a Level that had been fully configured looked identical to
       * one nobody had touched.
       */
      key: 'groups',
      header: t('admin.levels.colGroups'),
      numeric: true,
      secondary: true,
      cell: (r) => String(r.group_count),
    },
    {
      key: 'subjects',
      header: t('admin.levels.colSubjects'),
      numeric: true,
      secondary: true,
      cell: (r) => String(r.subject_count),
    },
    {
      // §4.9's default content tier for this Level, through its Category
      // (§15.1). It decides what an upload here proposes, so a Super Admin
      // choosing where to file material needs to see it.
      key: 'default_visibility',
      header: t('admin.levels.colDefaultVisibility'),
      secondary: true,
      cell: (r) =>
        r.default_visibility === undefined ? (
          <span className="muted">—</span>
        ) : (
          t(
            `calendar.visibility${r.default_visibility.charAt(0).toUpperCase()}${r.default_visibility.slice(1)}`,
          )
        ),
    },
  ];

  const actions: RowAction<Level>[] = [
    /**
     * **R69 — Subject assignment left this screen.** `مواد المستوى` has its own
     * node now, under الإدارة beside the other configuration. A Levels table
     * that also assigned Subjects was answering two questions, and the second
     * one had nowhere else to be asked.
     */
    ...(canWrite
      ? [
          { label: t('common.edit'), onSelect: (r: Level) => setEditing(r) },
          { label: t('common.delete'), danger: true, onSelect: (r: Level) => setDeleting(r) },
        ]
      : []),
  ];

  async function save(input: CreateLevelInput, existing: Level | null): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (existing) {
        await updateLevel(
          existing.id,
          existing.version,
          {
            name: input.name,
            gender_restriction: input.gender_restriction,
          },
          accessToken,
        );
        setNotice(t('common.saved'));
      } else {
        await createLevel(input, accessToken);
        // R66 — a Level is created alone now. It used to arrive with a
        // المجموعة 1 nobody asked for, which had to be explained; there is
        // nothing left to explain, and the notice says what to do next instead.
        setNotice(t('admin.levels.created'));
      }
      setEditing(null);
      await load();
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      setNotice(t(conflict ? 'common.conflict' : 'common.saveFailed'));
      if (conflict) {
        setEditing(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteLevel(deleting.id, accessToken);
      await load();
      setNotice(t('admin.levels.deleted'));
    } catch (error) {
      // TD-5 refuses while enrolments, groups, schedules, exams or content
      // reference the Level. The dialog stays open and names them (NEW A).
      const outcome = classifyDeletion(error);
      if (outcome.kind === 'blocked') {
        setBlocked(error);
        setBusy(false);
        return;
      }
      /**
       * **`already-gone` is a success for the reader** (2026-08-27). The row she
       * asked to remove is not there, which is what she wanted; reporting
       * *«تعذّر الحذف»* said the opposite and made Delete look unreliable on any
       * page left open while somebody else worked.
       */
      if (outcome.kind === 'already-gone') await load();
      setNotice(deletionNotice(outcome));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <AdminLayout
      title={t('admin.nav.levels')}
      lede={t('admin.levels.lede')}
      actions={
        canWrite ? (
          <Button variant="add" onClick={() => setEditing('new')}>
            {t('admin.levels.create')}
          </Button>
        ) : null
      }
    >
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
        caption={t('admin.levels.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={categoryFilter !== ''}
        onClearFilters={() => setCategoryFilter('')}
        sort={sort}
        onSort={setSort}
        {...(canWrite
          ? {
              /* §2.2 scopes `Level.display_order` to its Category, so the
                 sequence is only meaningful once one Category is selected.
                 `null` keeps the handle visible and disabled with an
                 explanation, rather than hiding a capability that exists. */
              onReorder:
                categoryFilter === ''
                  ? null
                  : async (ids: string[]) => reorderLevels(categoryFilter, ids, accessToken).then(load),
            }
          : {})}
        toolbar={
          // Narrowed SERVER-side: the endpoint takes `category_id`, so the
          // client never filters a list the server owns.
          <SelectField
            label={t('admin.levels.colCategory')}
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: '', label: t('admin.levels.allCategories') },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        }
      />

      {editing ? (
        <LevelFormDialog
          level={editing === 'new' ? null : editing}
          categories={categories}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void save(input, editing === 'new' ? null : editing)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        {...(blocked ? { blocked: <BlockedNotice error={blocked} item={t('admin.levels.thisLevel')} /> } : {})}
        title={t('admin.levels.deleteTitle')}
        body={t(
          (deleting?.enrollment_count ?? 0) > 0
            ? 'admin.levels.deleteBodyEnrolled'
            : 'admin.levels.deleteBody',
        )
          .replace('{name}', deleting?.name ?? '')
          .replace('{n}', String(deleting?.enrollment_count ?? 0))}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleting(null);
          setBlocked(null);
        }}
      />
    </AdminLayout>
  );
}

/**
 * The Level form.
 *
 * **Branch appears only when creating** — it is TD-4.6b's "where does المجموعة 1
 * go", not a property of the Level, so offering it on an edit would imply the
 * Level could be moved. **Category likewise appears only when creating**, for
 * the stronger reason recorded on the page.
 */
function LevelFormDialog({
  level,
  categories,
  busy,
  onSave,
  onCancel,
}: {
  level: Level | null;
  categories: Category[];
  busy: boolean;
  onSave: (input: CreateLevelInput) => void;
  onCancel: () => void;
}): ReactNode {
  /**
   * What the form opened with. On an ADD form the automatically applied
   * defaults — the first Category, `any` — are part of the baseline: the rule
   * is that a *user* change makes a form dirty, and initialisation is not one.
   */
  const pristine = {
    name: level?.name ?? '',
    categoryId: level?.category_id ?? categories[0]?.id ?? '',
    gender: (level?.gender_restriction ?? 'any') as GenderRestriction,
  };
  const [form, setForm] = useState(pristine);
  const [touched, setTouched] = useState(false);
  const dirty = isDirty(form, pristine);

  const errors = {
    name: form.name.trim() === '' ? t('common.required') : null,
    category: !level && form.categoryId === '' ? t('common.required') : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function submit(): void {
    setTouched(true);
    if (!valid) return;
    onSave({
      name: form.name.trim(),
      category_id: form.categoryId,
      gender_restriction: form.gender,
    });
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={submit}
      title={t(level ? 'admin.levels.editTitle' : 'admin.levels.create')}
      busy={busy}
      dirty={dirty}
    >
      <>
        <TextField
          label={t('admin.levels.colName')}
          value={form.name}
          onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          required
          error={touched ? errors.name : null}
        />

        {level ? null : (
          <SelectField
            label={t('admin.levels.colCategory')}
            value={form.categoryId}
            onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
            required
            error={touched ? errors.category : null}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            hint={t('admin.levels.categoryFixedHint')}
          />
        )}

        <SelectField
          label={t('admin.levels.colGender')}
          value={form.gender}
          onChange={(v) => setForm((f) => ({ ...f, gender: v as GenderRestriction }))}
          options={GENDER_OPTIONS.map((g) => ({ value: g, label: t(`admin.levels.gender.${g}`) }))}
          hint={t('admin.levels.genderHint')}
        />

        {/* **No branch (Revision 66).** It was here because creating a Level
            also created its المجموعة 1, and the form had to say so — the one
            field that was not a property of the thing being created. A Level
            belongs to a Category and to no Branch; a branch is chosen when the
            Level is actually subdivided, on the group. */}

        {/* **No «الترتيب» field** (R76.8): the order is the sequence of the
            rows, set by dragging one. A number here would be a second way to
            state the same fact, and the two would disagree the first time
            either was used. Omitting it on save preserves the stored position;
            a new Level arrives with NULL, which sorts last. */}

      </>
    </FormDialog>
  );
}
