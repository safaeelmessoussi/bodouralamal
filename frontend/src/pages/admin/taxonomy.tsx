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
import { classifyDeletion, deletionNotice } from '../../lib/deletion-outcome.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { CheckboxField, NumberField, TextArea, TextField } from '../../components/ui/field.js';
import { ageRangeLabel } from '../../lib/category-audience.js';
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
  /** NEW K — a Category carries a description and a Subject does not, so the
   *  shared form is configured rather than copied (rule C). */
  withDescription?: boolean;
  /** R73 — Subjects only; the same documented-variant pattern as
   *  `withDescription`, never a second form. */
  withQuranFlag?: boolean;
  /** R170 §6 — Categories only: who holds the login, and the age range. */
  withAudience?: boolean;
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
    withDescription: true,
    withAudience: true,
    list: listCategories,
    reorder: reorderCategories,
    create: createCategory,
    update: updateCategory,
    remove: deleteCategory,
    extraColumns: [
      {
        // §8/rule BA — the Owner's own words for what this Category is. Not
        // sortable: it is prose, and ordering by it means nothing to a reader.
        key: 'description',
        header: 'admin.taxonomy.colDescription',
        secondary: true,
        cell: (r) =>
          (r as { description: string | null }).description ?? (
            <span className="muted">{t('common.notSet')}</span>
          ),
      },
      {
        // R170 §6 — who holds the login, in WORDS; «غير محدَّد» is a real state
        // (it restricts nothing), never an empty cell.
        key: 'holds_own_login',
        header: 'admin.taxonomy.colLogin',
        cell: (r) => {
          const value = (r as Category).holds_own_login ?? null;
          return value === null ? (
            <span className="muted">{t('common.notSet')}</span>
          ) : (
            t(value ? 'admin.taxonomy.loginOwn' : 'admin.taxonomy.loginGuardian')
          );
        },
      },
      {
        // R170 §6 — informational; shown so the office and the forms say the same.
        key: 'age_range',
        header: 'admin.taxonomy.colAge',
        cell: (r) => ageRangeLabel(r as Category) ?? <span className="muted">{t('common.notSet')}</span>,
      },
      {
        key: 'levels',
        header: 'admin.taxonomy.colLevels',
        numeric: true,
        // Shown because it is what makes deletion refusable (TD-5): an
        // administrator learns the constraint from the table, before the click.
        cell: (r) => ((r as Category).level_count ?? 0) as ReactNode,
      },
      {
        /**
         * **§8 — §4.9's default content tier for this Category** (§15.1).
         *
         * It is already on the row and was rendered nowhere. It decides what
         * an upload filed under any Level of this Category proposes, so a
         * Super Admin comparing Categories could not see the one setting that
         * distinguishes them.
         */
        key: 'default_visibility',
        header: 'admin.taxonomy.colDefaultVisibility',
        cell: (r) => {
          const v = (r as Category).default_visibility;
          return (v === undefined ? (
            <span className="muted">—</span>
          ) : (
            t(`calendar.visibility${v.charAt(0).toUpperCase()}${v.slice(1)}`)
          )) as ReactNode;
        },
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
    withQuranFlag: true,
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
      {
        /**
         * **R73's marker, shown rather than only settable** (Owner-reported,
         * 2026-09-15). At most one live Subject may carry it
         * (`subject_one_quran_tracker`), so a reader comparing rows needs to
         * see which one before trying to set another.
         */
        key: 'tracks_quran_progress',
        header: 'admin.taxonomy.colTracksQuran',
        cell: (r) =>
          (r as SubjectRef).tracks_quran_progress ? (
            <span className="badge badge--ok">{t('admin.taxonomy.tracksQuranYes')}</span>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        /** SRS Revision 165 §2 — which Subjects work by Surah, shown for the
         *  same reason the marker beside it is: it changes what scheduling a
         *  class or an exam of this Subject will ask for. */
        key: 'requires_surahs',
        header: 'admin.taxonomy.colRequiresSurahs',
        cell: (r) =>
          (r as SubjectRef).requires_surahs ? (
            <span className="badge badge--ok">{t('admin.taxonomy.requiresSurahsYes')}</span>
          ) : (
            <span className="muted">—</span>
          ),
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
      const versionConflict = error instanceof ApiError && error.code === 'VERSION_CONFLICT';
      /**
       * **R73 — a different 409, and a different remedy** (Owner-reported,
       * 2026-09-15). Setting `tracks_quran_progress` while another live
       * Subject already carries it hits `subject_one_quran_tracker` and
       * comes back as the generic Prisma-P2002 mapping, `DUPLICATE` — not a
       * stale version of THIS row. Treating it as `versionConflict` would
       * close the dialog and reload as if someone else had edited this exact
       * Subject, which is the wrong story: the reader should stay on the
       * form and either uncheck the box or go turn it off the other Subject
       * first.
       */
      const quranTrackerTaken = error instanceof ApiError && error.code === 'DUPLICATE';
      setNotice(
        t(
          versionConflict
            ? 'common.conflict'
            : quranTrackerTaken
              ? 'admin.taxonomy.tracksQuranTaken'
              : 'common.saveFailed',
        ),
      );
      if (versionConflict) {
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
          {...(spec.withDescription ? { withDescription: true } : {})}
          {...(spec.withQuranFlag ? { withQuranFlag: true } : {})}
          {...(spec.withAudience ? { withAudience: true } : {})}
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
 * A Category and a Subject carry the same fields, so this is one component
 * configured twice rather than two components that will drift apart — the same
 * rule that produced `DataTable` instead of a `BranchTable`.
 *
 * **`withDescription` is a documented variant, not a second form** (rule C).
 * NEW K gave a Category a description and a Subject has none, so the difference
 * is one declared flag rather than a copy of this file with an extra field.
 */
/**
 * R170 §6 — whole years between 0 and 120, and never an inverted pair. The
 * server and the database hold the same rule; this is what says it beside the
 * field. Exported for the test.
 */
export function ageRangeError(minAge: string, maxAge: string): string | null {
  const parse = (raw: string): number | null | 'bad' => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 120 ? n : 'bad';
  };
  const min = parse(minAge);
  const max = parse(maxAge);
  if (min === 'bad' || max === 'bad') return t('admin.taxonomy.ageInvalid');
  if (min !== null && max !== null && min > max) return t('admin.taxonomy.ageInverted');
  return null;
}

function TaxonomyFormDialog({
  title,
  hint,
  initial,
  withDescription = false,
  withQuranFlag = false,
  withAudience = false,
  busy,
  onSave,
  onCancel,
}: {
  title: string;
  hint?: string;
  initial: {
    name: string;
    description?: string | null;
    display_order: number | null;
    tracks_quran_progress?: boolean;
    requires_surahs?: boolean;
    holds_own_login?: boolean | null;
    min_age?: number | null;
    max_age?: number | null;
  } | null;
  withDescription?: boolean;
  withQuranFlag?: boolean;
  withAudience?: boolean;
  busy: boolean;
  onSave: (input: TaxonomyInput) => void;
  onCancel: () => void;
}): ReactNode {
  const pristine = {
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    tracksQuranProgress: initial?.tracks_quran_progress ?? false,
    requiresSurahs: initial?.requires_surahs ?? false,
    // R170 §6 — a TICK-BOX, at the Owner's word: ticked is «حسابها الخاص»,
    // unticked is «يسجّلها وليّ الأمر». A row nobody has answered («غير محدَّد»)
    // opens unticked and is answered by the first save.
    holdsOwnLogin: initial?.holds_own_login === true,
    minAge: initial?.min_age == null ? '' : String(initial.min_age),
    maxAge: initial?.max_age == null ? '' : String(initial.max_age),
  };
  const [name, setName] = useState(pristine.name);
  const [holdsOwnLogin, setHoldsOwnLogin] = useState(pristine.holdsOwnLogin);
  const [minAge, setMinAge] = useState(pristine.minAge);
  const [maxAge, setMaxAge] = useState(pristine.maxAge);
  const [description, setDescription] = useState(pristine.description);
  const [tracksQuranProgress, setTracksQuranProgress] = useState(pristine.tracksQuranProgress);
  const [requiresSurahs, setRequiresSurahs] = useState(pristine.requiresSurahs);
  const [touched, setTouched] = useState(false);
  const error = name.trim() === '' ? t('common.required') : null;
  const ageError = withAudience ? ageRangeError(minAge, maxAge) : null;
  // Only user-modified data is dirty; a validation error is not a change.
  const dirty = isDirty(
    { name, description, tracksQuranProgress, requiresSurahs, holdsOwnLogin, minAge, maxAge },
    pristine,
  );

  function submit(): void {
    setTouched(true);
    if (error || ageError) return;
    /* **`display_order` is not sent** (R76.8). The form no longer offers it, so
       sending anything would be inventing a value: an edit would overwrite a
       position the administrator set by dragging, and a create would claim a
       place in a sequence nobody chose. Omitted, an edit preserves the stored
       position and a new row arrives with NULL — which sorts last, so it
       appears at the end and is dragged from there. */
    onSave({
      name: name.trim(),
      // **Sent only by the form that offers it.** A Subject has no description,
      // and sending `null` from there would clear a column it does not own.
      // `''` becomes `null` at the boundary: *no description* is one state.
      ...(withDescription ? { description: description.trim() || null } : {}),
      // **R73 — sent only by the form that offers it**, on the same footing as
      // `description` above: a Category has no such column, and sending it
      // regardless would be refused by the `.strict()` schema on that route.
      ...(withQuranFlag ? { tracks_quran_progress: tracksQuranProgress } : {}),
      // R165 §2 — the memorisation Subject ALWAYS works by Surah (a database
      // CHECK), so the pair is sent consistent rather than left for the server
      // to refuse: ticking the first ticks the second.
      ...(withQuranFlag ? { requires_surahs: requiresSurahs || tracksQuranProgress } : {}),
      // R170 §6 — sent only by the form that offers them. An empty age is
      // «not stated» (`null`), never zero.
      ...(withAudience
        ? {
            holds_own_login: holdsOwnLogin,
            min_age: minAge.trim() === '' ? null : Number(minAge),
            max_age: maxAge.trim() === '' ? null : Number(maxAge),
          }
        : {}),
    });
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
      {withDescription ? (
        <TextArea
          label={t('admin.taxonomy.colDescription')}
          value={description}
          onChange={setDescription}
          rows={2}
          hint={t('admin.taxonomy.descriptionHint')}
        />
      ) : null}
      {withAudience ? (
        <CheckboxField
          label={t('admin.taxonomy.holdsOwnLoginLabel')}
          checked={holdsOwnLogin}
          onChange={setHoldsOwnLogin}
          hint={t('admin.taxonomy.holdsOwnLoginHint')}
        />
      ) : null}
      {withAudience ? (
        <NumberField
          label={t('admin.taxonomy.minAgeLabel')}
          value={minAge}
          onChange={setMinAge}
          min={0}
          max={120}
          step={1}
          hint={t('admin.taxonomy.ageHint')}
        />
      ) : null}
      {withAudience ? (
        <NumberField
          label={t('admin.taxonomy.maxAgeLabel')}
          value={maxAge}
          onChange={setMaxAge}
          min={0}
          max={120}
          step={1}
          error={touched ? ageError : null}
        />
      ) : null}
      {withQuranFlag ? (
        <CheckboxField
          label={t('admin.taxonomy.tracksQuranLabel')}
          checked={tracksQuranProgress}
          onChange={setTracksQuranProgress}
          hint={t('admin.taxonomy.tracksQuranHint')}
        />
      ) : null}
      {withQuranFlag ? (
        <CheckboxField
          label={t('admin.taxonomy.requiresSurahsLabel')}
          checked={requiresSurahs || tracksQuranProgress}
          onChange={setRequiresSurahs}
          disabled={tracksQuranProgress}
          hint={t('admin.taxonomy.requiresSurahsHint')}
        />
      ) : null}
    </FormDialog>
  );
}
