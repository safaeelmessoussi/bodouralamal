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
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/taxonomy` — الفئات والمواد (§5.6 *"Categories & Subjects"*, §14.1).
 *
 * **Two vocabularies on one screen because they are one job.** A Category groups
 * Levels; a Subject is what a Level teaches. Neither is large, both are edited in
 * the same sitting when a curriculum is set up, and splitting them across two
 * navigation nodes would add a node §14.1 does not list (§20 rule 16).
 *
 * **Categories must never encode sex** (Revision 27). They are generic
 * educational stages — طفل، يافع، بالغ — and who a Level admits lives on the
 * Level's own `gender_restriction`, where a query can read it. The form says so
 * rather than relying on whoever types the name to remember.
 *
 * **Writing is Super Admin; an Admin reads** (TD-2 R26). The controls are hidden
 * for an Admin rather than shown disabled — §14.2 gates by role and a dead
 * control teaches nothing — and the server enforces the matrix regardless.
 *
 * **The Subjects table is fed by `GET /admin/subjects`**, the same selector every
 * form uses. That endpoint publishes `version` precisely so this screen could
 * reuse it instead of a second read over the same table.
 */
export function TaxonomyPage(): ReactNode {
  const { me, accessToken } = useSession();
  const canWrite = (me?.roles ?? []).includes('super_admin');

  const [categories, setCategories] = useState<Category[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [editingSubject, setEditingSubject] = useState<SubjectRef | 'new' | null>(null);
  const [deletingSubject, setDeletingSubject] = useState<SubjectRef | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [cats, subs] = await Promise.all([
        listCategories(accessToken),
        listSubjects(accessToken),
      ]);
      setCategories(cats);
      setSubjects(subs);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * One save path for both tables.
   *
   * The two entities have the same shape — a name and an optional order — so a
   * second copy of this would be a duplicate that drifts, not a specialisation.
   */
  async function save(
    kind: 'category' | 'subject',
    input: TaxonomyInput,
    existing: { id: string; version: number } | null,
  ): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (kind === 'category') {
        if (existing) await updateCategory(existing.id, existing.version, input, accessToken);
        else await createCategory(input, accessToken);
      } else {
        if (existing) await updateSubject(existing.id, existing.version, input, accessToken);
        else await createSubject(input, accessToken);
      }
      setEditingCategory(null);
      setEditingSubject(null);
      await load();
      setNotice(t(existing ? 'common.saved' : 'common.created'));
    } catch (error) {
      // A stale `version` is the interesting failure (TD-15): someone else
      // edited this row. Reloading is the only correct response — never a
      // silent overwrite.
      const conflict = error instanceof ApiError && error.status === 409;
      setNotice(t(conflict ? 'common.conflict' : 'common.saveFailed'));
      if (conflict) {
        setEditingCategory(null);
        setEditingSubject(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: 'category' | 'subject', id: string): Promise<void> {
    setBusy(true);
    try {
      if (kind === 'category') await deleteCategory(id, accessToken);
      else await deleteSubject(id, accessToken);
      await load();
      setNotice(t('common.deleted'));
    } catch (error) {
      // TD-5 refuses while anything still references it. Saying which kind of
      // reference blocks it is more useful than "failed" — the administrator's
      // next action differs completely.
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(
        t(
          blocked
            ? kind === 'category'
              ? 'admin.taxonomy.categoryBlocked'
              : 'admin.taxonomy.subjectBlocked'
            : 'common.deleteFailed',
        ),
      );
    } finally {
      setBusy(false);
      setDeletingCategory(null);
      setDeletingSubject(null);
    }
  }

  const categoryColumns: Column<Category>[] = [
    { key: 'name', header: t('admin.taxonomy.colName'), cell: (r) => r.name },
    {
      key: 'levels',
      header: t('admin.taxonomy.colLevels'),
      numeric: true,
      cell: (r) => r.level_count as ReactNode,
    },
    {
      key: 'order',
      header: t('admin.taxonomy.colOrder'),
      numeric: true,
      secondary: true,
      cell: (r) => (r.display_order ?? '—') as ReactNode,
    },
  ];

  const subjectColumns: Column<SubjectRef>[] = [
    { key: 'name', header: t('admin.taxonomy.colName'), cell: (r) => r.name },
    {
      key: 'order',
      header: t('admin.taxonomy.colOrder'),
      numeric: true,
      secondary: true,
      cell: (r) => (r.display_order ?? '—') as ReactNode,
    },
  ];

  const categoryActions: RowAction<Category>[] = canWrite
    ? [
        { label: t('common.edit'), onSelect: (r) => setEditingCategory(r) },
        { label: t('common.delete'), danger: true, onSelect: (r) => setDeletingCategory(r) },
      ]
    : [];

  const subjectActions: RowAction<SubjectRef>[] = canWrite
    ? [
        { label: t('common.edit'), onSelect: (r) => setEditingSubject(r) },
        { label: t('common.delete'), danger: true, onSelect: (r) => setDeletingSubject(r) },
      ]
    : [];

  return (
    <AdminLayout title={t('admin.nav.taxonomy')} lede={t('admin.taxonomy.lede')}>
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <section>
        <div className="admin-section-head">
          <h2>{t('admin.taxonomy.categoriesTitle')}</h2>
          {canWrite ? (
            <Button variant="primary" onClick={() => setEditingCategory('new')}>
              {t('admin.taxonomy.createCategory')}
            </Button>
          ) : null}
        </div>
        <p className="lede">{t('admin.taxonomy.categoriesLede')}</p>
        <DataTable
          caption={t('admin.taxonomy.categoriesTitle')}
          columns={categoryColumns}
          rows={categories}
          rowKey={(r) => r.id}
          status={status}
          actions={categoryActions}
          onRetry={() => void load()}
        />
      </section>

      <section>
        <div className="admin-section-head">
          <h2>{t('admin.taxonomy.subjectsTitle')}</h2>
          {canWrite ? (
            <Button variant="primary" onClick={() => setEditingSubject('new')}>
              {t('admin.taxonomy.createSubject')}
            </Button>
          ) : null}
        </div>
        <p className="lede">{t('admin.taxonomy.subjectsLede')}</p>
        <DataTable
          caption={t('admin.taxonomy.subjectsTitle')}
          columns={subjectColumns}
          rows={subjects}
          rowKey={(r) => r.id}
          status={status}
          actions={subjectActions}
          onRetry={() => void load()}
        />
      </section>

      {editingCategory ? (
        <TaxonomyFormDialog
          title={t(
            editingCategory === 'new'
              ? 'admin.taxonomy.createCategory'
              : 'admin.taxonomy.editCategory',
          )}
          hint={t('admin.taxonomy.categoryNameHint')}
          initial={editingCategory === 'new' ? null : editingCategory}
          busy={busy}
          onCancel={() => setEditingCategory(null)}
          onSave={(input) =>
            void save('category', input, editingCategory === 'new' ? null : editingCategory)
          }
        />
      ) : null}

      {editingSubject ? (
        <TaxonomyFormDialog
          title={t(
            editingSubject === 'new' ? 'admin.taxonomy.createSubject' : 'admin.taxonomy.editSubject',
          )}
          initial={editingSubject === 'new' ? null : editingSubject}
          busy={busy}
          onCancel={() => setEditingSubject(null)}
          onSave={(input) =>
            void save('subject', input, editingSubject === 'new' ? null : editingSubject)
          }
        />
      ) : null}

      <ConfirmDialog
        open={deletingCategory !== null}
        title={t('admin.taxonomy.deleteCategoryTitle')}
        body={t('admin.taxonomy.deleteCategoryBody').replace('{name}', deletingCategory?.name ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void remove('category', deletingCategory!.id)}
        onCancel={() => setDeletingCategory(null)}
      />

      <ConfirmDialog
        open={deletingSubject !== null}
        title={t('admin.taxonomy.deleteSubjectTitle')}
        body={t('admin.taxonomy.deleteSubjectBody').replace('{name}', deletingSubject?.name ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void remove('subject', deletingSubject!.id)}
        onCancel={() => setDeletingSubject(null)}
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
