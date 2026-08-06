import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listBranches, type Branch } from '../../adapters/branches-admin.js';
import {
  createLevel,
  deleteLevel,
  listCategories,
  listLevels,
  updateLevel,
  type Category,
  type CreateLevelInput,
  type GenderRestriction,
  type Level,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { NumberField, SelectField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

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
  const { me, accessToken } = useSession();
  const canWrite = (me?.roles ?? []).includes('super_admin');

  const [rows, setRows] = useState<Level[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [status, setStatus] = useState<TableStatus>('loading');
  const [editing, setEditing] = useState<Level | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Level | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await listLevels(accessToken, categoryFilter || undefined));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      // The two selectors the create form needs. Failing to load them must not
      // blank the table — the list is still readable without them, and only
      // creation is unavailable.
      const [cats, brs] = await Promise.all([
        listCategories(accessToken).catch(() => []),
        listBranches(accessToken, 1)
          .then((p) => p.data)
          .catch(() => []),
      ]);
      setCategories(cats);
      setBranches(brs);
    })();
  }, [accessToken]);

  const columns: Column<Level>[] = [
    { key: 'name', header: t('admin.levels.colName'), cell: (r) => r.name },
    {
      key: 'category',
      header: t('admin.levels.colCategory'),
      cell: (r) => r.category_name,
    },
    {
      key: 'gender',
      header: t('admin.levels.colGender'),
      // Announced as a word, never as a colour or an icon alone (§14.4).
      cell: (r) => t(`admin.levels.gender.${r.gender_restriction}`),
    },
    {
      key: 'groups',
      header: t('admin.levels.colGroups'),
      numeric: true,
      secondary: true,
      cell: (r) => r.group_count as ReactNode,
    },
    {
      key: 'subjects',
      header: t('admin.levels.colSubjects'),
      numeric: true,
      // **The count IS the way in.** The screen that assigns Subjects to a Level
      // existed and was reachable only through a row-action menu labelled
      // «المواد» — so an administrator told *this level teaches no subjects* had
      // no obvious next click, and the number they were reading was the exact
      // thing they needed to change. A zero here is the most actionable cell on
      // the page, and it now behaves like it.
      cell: (r) => (
        <a href={`/admin/levels/${r.id}/subjects`}>
          {r.subject_count === 0 ? t('admin.levels.noSubjectsYet') : r.subject_count}
        </a>
      ),
    },
    {
      key: 'students',
      header: t('admin.levels.colStudents'),
      numeric: true,
      cell: (r) => r.enrollment_count as ReactNode,
    },
  ];

  const actions: RowAction<Level>[] = [
    // Available to an Admin as well: managing which Subjects a Level teaches and
    // organising its groups is the operational work reading this screen exists
    // for. The next screen gates its own write controls.
    {
      label: t('admin.levels.manageSubjects'),
      onSelect: (r) => {
        window.location.href = `/admin/levels/${r.id}/subjects`;
      },
    },
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
            display_order: input.display_order ?? null,
          },
          accessToken,
        );
        setNotice(t('common.saved'));
      } else {
        const created = await createLevel(input, accessToken);
        // TD-4.6b created a group this administrator did not explicitly ask
        // for. Saying so is the difference between a system that did something
        // helpful and one that did something unexplained.
        setNotice(
          t('admin.levels.createdWithGroup')
            .replace('{group}', created.first_group.name)
            .replace('{branch}', branches.find((b) => b.id === input.branch_id)?.name ?? ''),
        );
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
      // reference the Level.
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(t(blocked ? 'admin.levels.deleteBlocked' : 'common.deleteFailed'));
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
          <Button variant="primary" onClick={() => setEditing('new')}>
            {t('admin.levels.create')}
          </Button>
        ) : null
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
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
          branches={branches}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void save(input, editing === 'new' ? null : editing)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
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
        onCancel={() => setDeleting(null)}
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
  branches,
  busy,
  onSave,
  onCancel,
}: {
  level: Level | null;
  categories: Category[];
  branches: Branch[];
  busy: boolean;
  onSave: (input: CreateLevelInput) => void;
  onCancel: () => void;
}): ReactNode {
  const [form, setForm] = useState({
    name: level?.name ?? '',
    categoryId: level?.category_id ?? categories[0]?.id ?? '',
    gender: (level?.gender_restriction ?? 'any') as GenderRestriction,
    branchId: branches[0]?.id ?? '',
    order:
      level?.display_order !== null && level?.display_order !== undefined
        ? String(level.display_order)
        : '',
  });
  const [touched, setTouched] = useState(false);

  const errors = {
    name: form.name.trim() === '' ? t('common.required') : null,
    category: !level && form.categoryId === '' ? t('common.required') : null,
    branch: !level && form.branchId === '' ? t('admin.levels.branchRequired') : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t(level ? 'admin.levels.editTitle' : 'admin.levels.create')}
    >
      <div className="form">
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

        {level ? null : (
          <SelectField
            label={t('admin.levels.firstGroupBranch')}
            value={form.branchId}
            onChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
            required
            error={touched ? errors.branch : null}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            // The one field on this form that is not a property of the thing
            // being created. Saying why, on the form, is cheaper than an
            // administrator wondering what a Level has to do with a branch.
            hint={t('admin.levels.firstGroupHint')}
          />
        )}

        <NumberField
          label={t('admin.levels.colOrder')}
          value={form.order}
          onChange={(v) => setForm((f) => ({ ...f, order: v }))}
          min={0}
          hint={t('admin.levels.orderHint')}
        />

        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSave({
                name: form.name.trim(),
                category_id: form.categoryId,
                gender_restriction: form.gender,
                branch_id: form.branchId,
                display_order: form.order.trim() === '' ? null : Number(form.order),
              });
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
