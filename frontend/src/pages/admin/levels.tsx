import { useCallback, useEffect, useState, type ReactNode } from 'react';

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
import { useActiveRole } from '../../contexts/active-role.js';
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
      // R66 — branches are no longer loaded here: creating a Level asks for
      // one no more, because a Level belongs to a Category and to no Branch.
      setCategories(await listCategories(accessToken).catch(() => []));
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
      // The fourth field `LevelFormDialog` collects, and the second gap the
      // R64 table sweep found: §2.2 orders Levels by it, so a screen that
      // hides it cannot answer *why is this Level listed here*.
      key: 'order',
      header: t('admin.levels.colOrder'),
      numeric: true,
      secondary: true,
      cell: (r) => (r.display_order ?? '—') as ReactNode,
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
      /**
       * **The count IS the way in** — the link stays, because an administrator
       * told *this Level teaches no subjects* should be able to act on the very
       * number they are reading.
       *
       * **But it renders a NUMBER, not a sentence.** It used to print
       * «لا مواد — أسنِدي» when the count was zero, in a column declared
       * `numeric` — which is `text-align: end` with `tabular-nums`, styling
       * meant for digits. Three things broke at once: a fourteen-character
       * phrase sat in a column sized for single digits; the column stopped
       * being scannable, because comparing Levels at a glance is exactly what a
       * count column is for and one row was prose; and it duplicated the row
       * action «مواد المستوى», which is where a reader looks for an action and
       * which carries a proper label.
       *
       * The imperative also broke `badge.tsx`'s stated rule the other way
       * about: **state is carried in words, never in colour alone** — but a
       * data cell is not where those words belong. `0` is unambiguous, and the
       * accessible name below is what stops it being an unlabelled link
       * (WCAG 2.4.4).
       */
      cell: (r) => (
        <a
          href={`/admin/level-subjects?level=${r.id}`}
          aria-label={t('admin.levels.subjectsLinkLabel')
            .replace('{n}', String(r.subject_count))
            .replace('{level}', r.name)}
        >
          {r.subject_count}
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
            display_order: input.display_order ?? null,
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
          <Button variant="add" onClick={() => setEditing('new')}>
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
  const [form, setForm] = useState({
    name: level?.name ?? '',
    categoryId: level?.category_id ?? categories[0]?.id ?? '',
    gender: (level?.gender_restriction ?? 'any') as GenderRestriction,
    order:
      level?.display_order !== null && level?.display_order !== undefined
        ? String(level.display_order)
        : '',
  });
  const [touched, setTouched] = useState(false);

  const errors = {
    name: form.name.trim() === '' ? t('common.required') : null,
    category: !level && form.categoryId === '' ? t('common.required') : null,
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

        {/* **No branch (Revision 66).** It was here because creating a Level
            also created its المجموعة 1, and the form had to say so — the one
            field that was not a property of the thing being created. A Level
            belongs to a Category and to no Branch; a branch is chosen when the
            Level is actually subdivided, on the group. */}

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
