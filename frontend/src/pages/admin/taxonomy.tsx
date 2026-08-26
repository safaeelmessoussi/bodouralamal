import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listSubjects, reorderSubjects, type SubjectRef } from '../../adapters/reference-data.js';
import {
  createCategory,
  createSubject,
  deleteCategory,
  deleteSubject,
  listCategories,
  reorderCategories,
  updateCategory,
  updateSubject,
  type Category,
  type TaxonomyInput,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { BlockedNotice } from '../../components/ui/blocked-notice.js';
import { blockingDependencies } from '../../lib/blocked-by.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { isDirty } from '../../lib/form-dirty.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

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
  list: (token: string | null, sort: SortState | null) => Promise<Row[]>;
  /** R76.4 — the sequence, submitted to this kind's own `/order` route. */
  reorder: (ids: readonly string[], token: string | null) => Promise<unknown>;
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
    list: listCategories,
    reorder: reorderCategories,
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
    list: listSubjects,
    reorder: reorderSubjects,
    create: createSubject,
    update: updateSubject,
    remove: deleteSubject,
    extraColumns: [
      {
        key: 'levels',
        header: 'admin.taxonomy.colSubjectLevels',
        /**
         * **The dependency, named rather than counted** (Owner decision,
         * 2026-08-17).
         *
         * The Category above carries a `level_count`, and that is right for it:
         * *how many Levels* is the whole question. For a Subject it is not — the
         * reason to show the pairing is that **it is what makes deletion
         * refusable**, and the remedy is to unpair specific Levels on
         * `مواد المستوى`. A number tells an administrator they are blocked; the
         * names tell them what to do about it.
         *
         * Rendered as chips so a Subject taught at a dozen Levels stays a
         * readable cell rather than a paragraph, and each reads
         * `{Category} — {Level}` through the shared label — §4.4b makes a bare
         * Level name ambiguous, and this is precisely a list where two Categories
         * may each contribute a *فرصة أمل*.
         *
         * **The deletion rule and its authorization are unchanged.** This makes a
         * server-side constraint visible; it does not relax it.
         */
        cell: (r) => {
          const levels = (r as SubjectRef).levels ?? [];
          if (levels.length === 0) {
            // Not a gap: an unpaired Subject is ordinary — and it is the one
            // state in which deletion will actually succeed, so saying so is
            // more use than an em dash.
            return <span className="muted">{t('admin.taxonomy.noLevels')}</span>;
          }
          return (
            <ul className="chip-list">
              {levels.map((level) => (
                <li key={level.id} className="chip">
                  {levelLabel({
                    id: level.id,
                    name: level.name,
                    category_name: level.category_name,
                  })}
                </li>
              ))}
            </ul>
          );
        },
      },
    ],
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
  const [blocked, setBlocked] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  // `null` is BR-19's order, which is also the canonical order manual
  // reordering writes into (R76.8).
  const [sort, setSort] = useState<SortState | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await spec.list(accessToken, sort));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, spec, sort]);

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
      // TD-5 (NEW A) — the dialog stays open and names the dependencies rather
      // than closing onto a guessed sentence at the top of the page.
      if (blockingDependencies(error) !== null) {
        setBlocked(error);
        setBusy(false);
        return;
      }
      setNotice(t('common.deleteFailed'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  /* **No «الترتيب» column** (R76.8). The stored order is now expressed by the
     sequence of the rows and changed by dragging one; a number beside it would
     be a second way to say the same thing, and the two would disagree the first
     time either was used. The field itself is untouched in the database. */
  const columns: Column<Row>[] = [
    { key: 'name', header: t('admin.taxonomy.colName'), sortKey: 'name', cell: (r) => r.name },
    ...spec.extraColumns.map((c) => ({ ...c, header: t(c.header) })),
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
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
        caption={t(spec.navKey)}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        sort={sort}
        onSort={setSort}
        {...(canWrite
          ? { onReorder: async (ids: string[]) => spec.reorder(ids, accessToken).then(load) }
          : {})}
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
        {...(blocked ? { blocked: <BlockedNotice error={blocked} item={t('admin.levels.thisItem')} /> } : {})}
        title={t(spec.deleteTitleKey)}
        body={t(spec.deleteBodyKey).replace('{name}', deleting?.name ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void remove(deleting!.id)}
        onCancel={() => {
          setDeleting(null);
          setBlocked(null);
        }}
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
  const pristine = initial?.name ?? '';
  const [name, setName] = useState(pristine);
  const [touched, setTouched] = useState(false);
  const error = name.trim() === '' ? t('common.required') : null;
  // Only user-modified data is dirty; a validation error is not a change.
  const dirty = isDirty(name, pristine);

  function submit(): void {
    setTouched(true);
    if (error) return;
    /* **`display_order` is not sent** (R76.8). The form no longer offers it, so
       sending anything would be inventing a value: an edit would overwrite a
       position the administrator set by dragging, and a create would claim a
       place in a sequence nobody chose. Omitted, an edit preserves the stored
       position and a new row arrives with NULL — which sorts last, so it
       appears at the end and is dragged from there. */
    onSave({ name: name.trim() });
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={submit}
      title={title}
      busy={busy}
      dirty={dirty}
    >
      <TextField
        label={t('admin.taxonomy.colName')}
        value={name}
        onChange={setName}
        required
        error={touched ? error : null}
        {...(hint !== undefined ? { hint } : {})}
      />
    </FormDialog>
  );
}
