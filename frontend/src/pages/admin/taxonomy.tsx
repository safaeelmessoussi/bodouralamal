import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listSubjects, type SubjectRef } from '../../adapters/reference-data.js';
import {
  createCategory,
  createSubject,
  deleteCategory,
  deleteSubject,
  listCategories,
  updateCategory,
  updateSubject,
  type Category,
  type TaxonomyInput,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { NumberField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/categories` (الفئات) and `/admin/subjects` (المواد) — **two navigation
 * nodes, one implementation** (§5.6, §14.1 as amended by Revision 55).
 *
 * ## Why one component rather than two pages
 *
 * A Category and a Subject are the same *kind* of record — a name and an
 * optional display order, Super-Admin-writable, refused deletion while anything
 * references them. They were one screen with two tables until the Document Owner
 * separated them; **separating the navigation must not separate the code**, or
 * the two would drift exactly as every other duplicated CRUD on this project
 * has. So the entity is a parameter and the screen is written once.
 *
 * What genuinely differs is declared in `KINDS` below and nowhere else: the
 * Category table carries a Levels count (what makes its deletion refusable and
 * therefore worth showing before the attempt), and the Category form carries the
 * Revision 27 warning.
 *
 * **Categories must never encode sex** (Revision 27). They are generic
 * educational stages — طفل، يافع، بالغ — and who a Level admits lives on the
 * Level's own `gender_restriction`, where a query can read it. The form says so
 * rather than relying on whoever types the name to remember.
 *
 * **Writing is Super Admin; an Admin reads** (TD-2, R26). The controls are hidden
 * for an Admin rather than shown disabled — §14.2 gates by role and a dead
 * control teaches nothing — and the server enforces the matrix regardless.
 */
export type TaxonomyKind = 'category' | 'subject';

/** A row either table can hold. `level_count` exists only on a Category, which
 *  is why the column that reads it is declared per kind. */
type Row = Category | SubjectRef;

interface KindSpec {
  navKey: string;
  ledeKey: string;
  createKey: string;
  editKey: string;
  deleteTitleKey: string;
  deleteBodyKey: string;
  blockedKey: string;
  /** Revision 27's warning, on Categories only. */
  formHintKey?: string;
  list: (token: string | null) => Promise<Row[]>;
  create: (input: TaxonomyInput, token: string | null) => Promise<unknown>;
  update: (
    id: string,
    version: number,
    input: TaxonomyInput,
    token: string | null,
  ) => Promise<unknown>;
  remove: (id: string, token: string | null) => Promise<void>;
  extraColumns: Column<Row>[];
}

const KINDS: Record<TaxonomyKind, KindSpec> = {
  category: {
    navKey: 'admin.nav.categories',
    ledeKey: 'admin.taxonomy.categoriesLede',
    createKey: 'admin.taxonomy.createCategory',
    editKey: 'admin.taxonomy.editCategory',
    deleteTitleKey: 'admin.taxonomy.deleteCategoryTitle',
    deleteBodyKey: 'admin.taxonomy.deleteCategoryBody',
    blockedKey: 'admin.taxonomy.categoryBlocked',
    formHintKey: 'admin.taxonomy.categoryNameHint',
    list: (token) => listCategories(token),
    create: createCategory,
    update: updateCategory,
    remove: deleteCategory,
    extraColumns: [
      {
        key: 'levels',
        header: 'admin.taxonomy.colLevels',
        numeric: true,
        // Shown because it is what makes deletion refusable (TD-5): an
        // administrator learns the constraint from the table, before the click.
        cell: (r) => ((r as Category).level_count ?? 0) as ReactNode,
      },
    ],
  },
  subject: {
    navKey: 'admin.nav.subjects',
    ledeKey: 'admin.taxonomy.subjectsLede',
    createKey: 'admin.taxonomy.createSubject',
    editKey: 'admin.taxonomy.editSubject',
    deleteTitleKey: 'admin.taxonomy.deleteSubjectTitle',
    deleteBodyKey: 'admin.taxonomy.deleteSubjectBody',
    blockedKey: 'admin.taxonomy.subjectBlocked',
    // `GET /admin/subjects` is the same endpoint every selector reads. It
    // publishes `version` precisely so this screen could reuse it rather than
    // add a second read over the same table.
    list: (token) => listSubjects(token),
    create: createSubject,
    update: updateSubject,
    remove: deleteSubject,
    extraColumns: [],
  },
};

export function TaxonomyPage({ kind }: { kind: TaxonomyKind }): ReactNode {
  const spec = KINDS[kind];
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const canWrite = (activeRoles).includes('super_admin');

  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await spec.list(accessToken));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, spec]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(input: TaxonomyInput, existing: Row | null): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (existing) await spec.update(existing.id, existing.version, input, accessToken);
      else await spec.create(input, accessToken);
      setEditing(null);
      await load();
      setNotice(t(existing ? 'common.saved' : 'common.created'));
    } catch (error) {
      // A stale `version` is the interesting failure (TD-15): someone else
      // edited this row. Reloading is the only correct response — never a
      // silent overwrite.
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

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await spec.remove(id, accessToken);
      await load();
      setNotice(t('common.deleted'));
    } catch (error) {
      // TD-5 refuses while anything still references it. Saying which kind of
      // reference blocks it is more useful than "failed" — the administrator's
      // next action differs completely.
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(t(blocked ? spec.blockedKey : 'common.deleteFailed'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const columns: Column<Row>[] = [
    { key: 'name', header: t('admin.taxonomy.colName'), cell: (r) => r.name },
    ...spec.extraColumns.map((c) => ({ ...c, header: t(c.header) })),
    {
      key: 'order',
      header: t('admin.taxonomy.colOrder'),
      numeric: true,
      secondary: true,
      cell: (r) => (r.display_order ?? '—') as ReactNode,
    },
  ];

  const actions: RowAction<Row>[] = canWrite
    ? [
        { label: t('common.edit'), onSelect: (r) => setEditing(r) },
        { label: t('common.delete'), danger: true, onSelect: (r) => setDeleting(r) },
      ]
    : [];

  return (
    <AdminLayout
      title={t(spec.navKey)}
      lede={t(spec.ledeKey)}
      actions={
        canWrite ? (
          <Button variant="add" onClick={() => setEditing('new')}>
            {t(spec.createKey)}
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
        caption={t(spec.navKey)}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
      />

      {editing ? (
        <TaxonomyFormDialog
          title={t(editing === 'new' ? spec.createKey : spec.editKey)}
          {...(spec.formHintKey ? { hint: t(spec.formHintKey) } : {})}
          initial={editing === 'new' ? null : editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void save(input, editing === 'new' ? null : editing)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t(spec.deleteTitleKey)}
        body={t(spec.deleteBodyKey).replace('{name}', deleting?.name ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void remove(deleting!.id)}
        onCancel={() => setDeleting(null)}
      />
    </AdminLayout>
  );
}

/**
 * The form both vocabularies share.
 *
 * A Category and a Subject carry the same two fields, so this is one component
 * configured twice rather than two components that will drift apart — the same
 * rule that produced `DataTable` instead of a `BranchTable`.
 */
function TaxonomyFormDialog({
  title,
  hint,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  title: string;
  hint?: string;
  initial: { name: string; display_order: number | null } | null;
  busy: boolean;
  onSave: (input: TaxonomyInput) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState(initial?.name ?? '');
  const [order, setOrder] = useState(
    initial?.display_order !== null && initial?.display_order !== undefined
      ? String(initial.display_order)
      : '',
  );
  const [touched, setTouched] = useState(false);
  const error = name.trim() === '' ? t('common.required') : null;

  return (
    <Dialog open onClose={onCancel} title={title}>
      <div className="form">
        <TextField
          label={t('admin.taxonomy.colName')}
          value={name}
          onChange={setName}
          required
          error={touched ? error : null}
          {...(hint !== undefined ? { hint } : {})}
        />
        <NumberField
          label={t('admin.taxonomy.colOrder')}
          value={order}
          onChange={setOrder}
          min={0}
          hint={t('admin.taxonomy.orderHint')}
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
              if (error) return;
              onSave({
                name: name.trim(),
                display_order: order.trim() === '' ? null : Number(order),
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
