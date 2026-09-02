import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { kindOf, type ContentKind } from '../adapters/content.js';
import { deleteContent, updateContent } from '../adapters/uploads.js';
import { AdminLayout } from '../components/admin/admin-layout.js';
import { ContentRecorderForm } from '../components/content/content-recorder-form.js';
import { ContentUploadForm } from '../components/content/content-upload-form.js';
import { TeacherLayout } from '../components/teacher/teacher-layout.js';
import { ConfirmDialog } from '../components/ui/confirm-dialog.js';
import { FormDialog } from '../components/ui/form-dialog.js';
import { SelectField, TextField } from '../components/ui/field.js';
import { VisibilityField } from '../components/scheduling/visibility-field.js';
import { isDirty } from '../lib/form-dirty.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../components/ui/data-table.js';
import { Button } from '../components/ui/button.js';
import { Dialog } from '../components/ui/dialog.js';
import { ScopeSelectors } from '../components/scope/scope-selectors.js';
import { useScopeOptions } from '../hooks/use-scope-options.js';
import { useSession } from '../contexts/session.js';
import { useActiveRole } from '../contexts/active-role.js';
import { t } from '../i18n/index.js';
import { formatDate } from '../lib/format-date.js';
import { applySort } from '../adapters/reorder.js';
import { api, ApiError } from '../lib/api.js';
import { Feedback } from '../components/ui/feedback.js';

/**
 * The content library management screen — `/admin/content` (§5.6) and
 * `/teacher/content` (§5.5).
 *
 * **One screen, two portals.** The capability is identical: attach a file to a
 * Subject within a Level, upload it, delete it. What differs is the chrome and
 * what the server will accept from the caller — a Teacher cannot choose the
 * Global scope and is confined to the branches of the schedules they staff
 * (§4.9). Building two screens would mean maintaining that difference in the
 * client, which is precisely where it must not live: the server decides, and
 * this page renders the refusal.
 *
 * **The list is `GET /library`, not a new endpoint.** TD-3.13's route is already
 * tier-aware and shows staff all three visibilities including `hidden`, which is
 * exactly the management view. A parallel admin listing would have been a second
 * expression of the §4.9 tiers — the duplication that drifts.
 *
 * **The scope is chosen before the upload, not inside it.** Level, Subject, Year
 * and Branch are the filters *and* the target: what you are looking at is what
 * you are adding to. That removes a whole class of mistake where a form's
 * defaults disagree with the list behind it.
 */
/**
 * **Editing what a content item IS** (UAT, 2026-09-02).
 *
 * A self-contained form (rule AX): every field that decides what will be saved
 * is inside it, pre-filled from the row. It carries **no file input** — TD-9's
 * replacement is a different act with a different route, and offering both here
 * would invite an administrator to re-upload a file to fix a word.
 *
 * `dirty` compares against the row as loaded, so opening and closing without a
 * change asks nothing (rule AY.1), and a value typed and undone is pristine
 * again.
 */
function ContentEditDialog({
  row,
  levels,
  subjects,
  busy,
  consentLocked,
  onCancel,
  onSave,
}: {
  row: LibraryRow;
  levels: { value: string; label: string }[];
  subjects: { value: string; label: string }[];
  busy: boolean;
  /** The server has reported that consent keeps this item private (B-01). */
  consentLocked: boolean;
  onCancel: () => void;
  onSave: (patch: {
    title: string;
    levelId: string;
    subjectId: string;
    visibility: string;
  }) => void;
}): ReactNode {
  const pristine = {
    title: row.title,
    levelId: row.level_id,
    subjectId: row.subject_id,
    visibility: row.visibility,
  };
  const [form, setForm] = useState(pristine);
  const [touched, setTouched] = useState(false);
  const error = form.title.trim() === '' ? t('common.required') : null;

  return (
    <FormDialog
      open
      title={t('content.edit.title')}
      submitLabel={t('common.save')}
      busy={busy}
      dirty={isDirty(form, pristine)}
      onCancel={onCancel}
      onSubmit={() => {
        setTouched(true);
        if (error) return;
        onSave({ ...form, title: form.title.trim() });
      }}
    >
      <p className="field__hint">{t('content.edit.fileUnchanged')}</p>

      <TextField
        label={t('content.col.title')}
        value={form.title}
        onChange={(v) => setForm((f) => ({ ...f, title: v }))}
        required
        error={touched ? error : null}
      />

      <SelectField
        label={t('content.col.level')}
        value={form.levelId}
        onChange={(v) => setForm((f) => ({ ...f, levelId: v }))}
        options={levels}
      />

      <SelectField
        label={t('content.col.subject')}
        value={form.subjectId}
        onChange={(v) => setForm((f) => ({ ...f, subjectId: v }))}
        options={subjects}
      />

      {/* The shared control, so the three tiers read identically wherever they
          are chosen — and the server still decides (rule O). */}
      {consentLocked ? (
        /**
         * **Shown as a fact, not as a disabled control** (rule AF). The server
         * refuses to publish this item, so offering a select that implies it
         * might one day be chosen here would be the same invitation again. The
         * line names the rule and what would have to change.
         */
        <p className="field">
          <span className="field__label">{t('content.col.visibility')}</span>
          <span>{t(`calendar.visibility${form.visibility === 'hidden' ? 'Hidden' : 'Private'}`)}</span>
          <span className="hint">{t('content.edit.consentLockedHint')}</span>
        </p>
      ) : (
        <VisibilityField
          value={form.visibility}
          onChange={(v) => setForm((f) => ({ ...f, visibility: v }))}
        />
      )}
    </FormDialog>
  );
}

interface LibraryRow {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  level_id: string;
  subject_id: string;
  academic_year_id: string;
  branch_id: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  level_name: string;
  subject_name: string;
  academic_year_label: string;
  branch_name: string | null;
}

/** `null` branch is the Global scope (§4.9) and needs a value a `<select>` can
 *  carry — `''` already means "no filter", so the two cannot share it. */
/**
 * The scope this screen selects on — and uploads into.
 *
 * **The filters and the upload target are deliberately the same four values**:
 * what you are looking at is what you are adding to, which removes the whole
 * class of mistake where a form's defaults disagree with the list behind it.
 */
const SCOPE_FIELDS = ['levelId', 'subjectId', 'academicYearId', 'branchId'] as const;

/** `branch_id = null` — a real scope (§4.9), and the one value a branch list can
 *  never contain. `''` already means *no filter*, so the two cannot share it. */
const GLOBAL = '__global__';

export function ContentPage({ portal }: { portal: 'admin' | 'teacher' }): ReactNode {
  const { accessToken } = useSession();
  const Layout = portal === 'admin' ? AdminLayout : TeacherLayout;

  /**
   * **One dependency graph, shared with every other screen** — not a chain
   * re-implemented here. Choosing a Level reloads the Subjects it actually
   * teaches (`LevelSubject`, R43) and clears a stale choice, so the pair this
   * page sends can never be one the server has to refuse.
   */
  const scope = useScopeOptions({
    token: accessToken,
    fields: SCOPE_FIELDS,
    /**
     * **This is a filter, so a Subject may be chosen with no Level**
     * (Owner, 2026-08-17). The control was disabled behind
     * *«اختاري المستوى أولًا»*, which asked a question the contract never
     * required: `GET /library` takes `level_id` and `subject_id` as independent
     * optionals. Choosing a Level still narrows the Subjects to the ones it
     * teaches — the narrowing is the useful half and it is kept.
     */
    mode: 'filter',
    defaultCurrentYear: true,
  });
  const { levelId, subjectId, academicYearId, branchId } = scope.value;

  const [rows, setRows] = useState<LibraryRow[]>([]);
  /** R76 — server-side: this list is paginated, so the DATABASE orders it. */
  const [sort, setSort] = useState<SortState | null>(null);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<LibraryRow | null>(null);
  const [editing, setEditing] = useState<LibraryRow | null>(null);
  /** Set when the server reports consent keeps THIS item private (see the
   *  catch below). Cleared whenever a different item is opened. */
  const [consentLocked, setConsentLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { activeRoles } = useActiveRole();

  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const isAdmin = activeRoles.some((r) => r === 'admin' || r === 'super_admin');

  const load = useCallback(async () => {
    setStatus('loading');
    const params = new URLSearchParams({ page: String(page), page_size: '25' });
    applySort(params, sort);
    if (levelId) params.set('level_id', levelId);
    if (subjectId) params.set('subject_id', subjectId);
    if (academicYearId) params.set('academic_year_id', academicYearId);
    try {
      const body = await api<{
        data: LibraryRow[];
        meta: { total: number };
        /** R75.6, server-owned since R99 — what to call a recording made here.
         *  `null` when no Subject is in view, which is also when the recorder is
         *  not offered. */
        suggested_recording_name: string | null;
      }>(`/library?${params.toString()}`, { token: accessToken });
      // **Branch is filtered here and the rest server-side, because TD-3.13
      // publishes no `branch_id` filter.** Adding one to a public endpoint for a
      // back-office convenience would widen a public contract for an internal
      // need; narrowing the page a reader already has is honest, and the note is
      // here so the asymmetry does not read as an oversight.
      const filtered =
        branchId === ''
          ? body.data
          : body.data.filter((r) =>
              branchId === GLOBAL ? r.branch_id === null : r.branch_id === branchId,
            );
      setRows(filtered);
      setTotal(body.meta.total);
      setSuggestedName(body.suggested_recording_name ?? '');
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, levelId, subjectId, academicYearId, branchId, page, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any narrowing re-queries from page 1: staying on page 3 of a smaller result
  // shows an empty table that reads as "there is no content".
  useEffect(() => {
    setPage(1);
  }, [levelId, subjectId, academicYearId, branchId]);

  function refilter(apply: () => void): void {
    apply();
    setPage(1);
  }

  /** The upload target — the same scope the list is showing. */
  const [recordingOpen, setRecordingOpen] = useState(false);

  /**
   * **What a library recording is named after — decided by the server** (R75.6,
   * moved there by R99).
   *
   * There is no occurrence here, so R75.6's *title · description · date* does
   * not apply — that rule is about a class, and this screen has none. What it
   * does have is the scope the list is showing, so the server names it after the
   * Subject in view and the association's own date, and numbers it with the same
   * shared rule. It used to be composed here, which made the numbering algorithm
   * exist twice; R99 added a producer that is not a browser at all, and a rule
   * one producer cannot reach is a rule that drifts.
   */
  const [suggestedName, setSuggestedName] = useState('');

  /**
   * **The page's filters seed an upload; they no longer decide it** (Owner UX
   * rule, 2026-08-25).
   *
   * Every field that determines what gets created now lives inside the dialog
   * and is editable there, so the page holds no upload meta, no visibility and
   * no scope hint. Holding any of them would be a second answer to *what is
   * about to be saved* — and the first answer would be the invisible one.
   */
  const uploadSeed = useMemo(
    () => ({ levelId, subjectId, academicYearId, branchId }),
    [levelId, subjectId, academicYearId, branchId],
  );

  /**
   * **The recorder still takes its scope from the page, and that is a known
   * remaining instance of the same pattern**, listed in the platform audit
   * (`docs/development/ux-architecture.md`, rule AX). It is left as it was in
   * this slice rather than converted half-way: R75's recorder has its own
   * dialog and its own submit path, and changing both flows at once would make
   * one browser regression answer for two behaviours.
   */
  const columns: Column<LibraryRow>[] = [
    { key: 'title', sortKey: 'title', header: t('content.col.title'), cell: (r) => r.title },
    {
      key: 'kind',
      header: t('content.col.kind'),
      cell: (r) => t(`content.kind.${kindOf(r.mime_type) satisfies ContentKind}`),
    },
    {
      key: 'visibility',
      header: t('content.col.visibility'),
      cell: (r) => t(`content.visibility.${r.visibility}`),
    },
    {
      key: 'branch',
      sortKey: 'branch',
      header: t('content.col.branch'),
      secondary: true,
      // `null` is Global, a real scope — never "unknown" (§4.9, BR-20).
      cell: (r) => r.branch_name ?? t('content.globalScope'),
    },
    {
      key: 'size',
      // `size_bytes`, not the humanised label: ordering «٩ ميغابايت»
      // as a STRING would put 9 MB after 10 MB.
      sortKey: 'size',
      header: t('content.col.size'),
      secondary: true,
      cell: (r) => formatSize(r.size_bytes),
    },
    {
      key: 'created',
      // A timestamp, so it orders chronologically.
      sortKey: 'published',
      header: t('content.col.published'),
      secondary: true,
      cell: (r) => <time dateTime={r.created_at}>{formatDate(r.created_at)}</time>,
    },
  ];

  const actions: RowAction<LibraryRow>[] = [
    // Rule AC — contextual, then تعديل, then the destructive one.
    { label: t('common.edit'), onSelect: (r) => { setConsentLocked(false); setEditing(r); } },
    { label: t('common.delete'), onSelect: (r) => setDeleting(r), danger: true },
  ];

  /**
   * **Correcting an item, without touching its bytes** (UAT, 2026-09-02).
   *
   * The library could upload and delete and nothing between, so fixing a typed
   * title or a Level chosen under the wrong filter meant re-uploading the same
   * file. Only the fields that actually changed are sent, so an edit never
   * restates a value nobody touched — and the server decides everything: a
   * visibility the consent rule forbids comes back as a refusal, not as a
   * control this screen quietly hides.
   */
  async function confirmEdit(patch: {
    title: string;
    levelId: string;
    subjectId: string;
    visibility: string;
  }): Promise<void> {
    if (!editing) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateContent(
        editing.id,
        {
          ...(patch.title !== editing.title ? { title: patch.title } : {}),
          ...(patch.levelId !== editing.level_id ? { level_id: patch.levelId } : {}),
          ...(patch.subjectId !== editing.subject_id ? { subject_id: patch.subjectId } : {}),
          ...(patch.visibility !== editing.visibility
            ? { visibility: patch.visibility as 'public' | 'private' | 'hidden' }
            : {}),
        },
        accessToken,
      );
      setEditing(null);
      await load();
      setNotice(t('common.saved'));
    } catch (error) {
      const reason =
        error instanceof ApiError ? (error.details?.['reason'] as string | undefined) : undefined;
      /**
       * **Every coded refusal gets its own sentence** (UAT, 2026-09-02).
       *
       * Only `CONSENT_FORCED_PRIVATE` was named, so the other three arrived as
       * «تعذّر الحفظ.» — an administrator meeting `OBJECT_MISSING` was told
       * nothing she could act on, and the platform's own generic
       * `STATE_CONFLICT` text tells her to refresh, which never helps here.
       */
      const named: Record<string, string> = {
        CONSENT_FORCED_PRIVATE: 'content.edit.consentForcedPrivate',
        OBJECT_MISSING: 'content.edit.objectMissing',
        STORAGE_MOVE_FAILED: 'content.edit.storageMoveFailed',
        CONCURRENT_MODIFICATION: 'content.edit.concurrent',
        UNKNOWN_LEVEL: 'content.edit.unknownLevel',
        UNKNOWN_SUBJECT: 'content.edit.unknownSubject',
      };
      setNotice(t(named[reason ?? ''] ?? 'common.saveFailed'));
      /**
       * **The impossible choice is withdrawn as soon as the platform knows.**
       *
       * The dialog cannot tell in advance that consent has locked an item
       * private — `consent_forced_private` is safeguarding-adjacent and is not
       * published on the anonymous `/library` read the page uses — so it offers
       * «عام» like any other item. The moment the server says otherwise, the
       * control is pinned to the effective value and explains itself, and the
       * reader's other edits stay in the form to be saved.
       */
      if (reason === 'CONSENT_FORCED_PRIVATE') setConsentLocked(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteContent(deleting.id, accessToken);
      setNotice(t('content.deleted'));
      await load();
    } catch {
      setNotice(t('content.deleteFailed'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <Layout
      title={t(`${portal}.nav.content`)}
      lede={t('content.lede')}
      actions={
        <>
          {/* **The same recorder as الجدولة**, from the library's own scope
              (§4.9 as amended by R75). A recording made here is an ordinary
              `EducationalContent` and needs no occurrence to exist first; it is
              linked to a Session later through the existing content-linking
              flow, which is the half R43 already provides. */}
          <Button variant="secondary" onClick={() => setRecordingOpen(true)}>
            {t('recorder.title')}
          </Button>
          <Button variant="add" onClick={() => setUploading(true)}>
            {t('content.upload.action')}
          </Button>
        </>
      }
    >
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
        caption={t('content.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={levelId !== '' || subjectId !== '' || branchId !== ''}
        onClearFilters={() =>
          refilter(() => {
            scope.setMany({ levelId: '', subjectId: '', branchId: '' });
          })
        }
        toolbar={
          <>
            {/* The same four selectors, with the same dependency rules, as every
                other screen in the platform — the page states WHICH it needs and
                nothing about how they relate. */}
            <ScopeSelectors
              scope={scope}
              fields={SCOPE_FIELDS}
              mode="filter"
              // **Offered only to those who may assign it** (§4.9): a Teacher
              // choosing Global would be refused by the server, and an option
              // that always fails is worse than no option.
              extraOptions={
                isAdmin ? { branchId: [{ value: GLOBAL, label: t('content.globalScope') }] } : {}
              }
            />
          </>
        }
        sort={sort}
        onSort={setSort}
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      <Dialog
        open={recordingOpen}
        onClose={() => setRecordingOpen(false)}
        title={t('recorder.title')}
      >
        {/* **Mounted only while open**, exactly as the upload dialog is, and for
            two reasons. Each opening then seeds itself from the filters as they
            are NOW rather than from a stale first render — and a form left
            mounted behind a closed dialog puts a SECOND set of scope selectors
            in the document, which is a real defect and not merely wasteful:
            anything reading the page by label finds the hidden empty ones. */}
        {recordingOpen ? (
          <ContentRecorderForm
            token={accessToken}
            mayAssignGlobal={isAdmin}
            // Seeded from the page's filters and then **owned by the form**
            // (rule AX). It was the reverse: the filters WERE the scope, and an
            // unset filter refused to open the recorder at all — a filter
            // acting as a precondition, which rule A/F forbids.
            initial={{
              levelId,
              subjectId,
              academicYearId,
              ...(branchId === '' || branchId === GLOBAL ? {} : { branchId }),
            }}
            suggestedName={suggestedName}
            onSaved={() => {
              setRecordingOpen(false);
              setNotice(t('content.uploaded'));
              void load();
            }}
            onCancel={() => setRecordingOpen(false)}
          />
        ) : null}
      </Dialog>

      <Dialog open={uploading} onClose={() => setUploading(false)} title={t('content.upload.action')}>
        {/**
          * §14.1 — offered on UPLOAD only. Replacement deliberately has no such
          * control: R53 keeps the record and changes only the object, so the
          * existing row's visibility is authoritative and a selector there
          * would quietly turn a file swap into a publication decision.
          *
          * All three tiers are offered to everyone who can reach this screen,
          * and that is derived rather than assumed: `assertUploadScope` gates
          * the Global/branch scope and nothing else, so §4.9 places no
          * per-role limit on the tier itself. §14.1's *"not editable by
          * Teachers"* is about the consent-forced state, which no new upload
          * can be in — `consent_forced_private` starts false and only BR-2 may
          * set it, never a person and never this form.
          */}
        {/* Mounted only while open, so each opening seeds itself from the
            filters as they are NOW rather than from a stale first render. */}
        {uploading ? (
          <ContentUploadForm
            token={accessToken}
            mayAssignGlobal={isAdmin}
            initial={uploadSeed}
            submitLabel={t('content.upload.action')}
            onCancel={() => setUploading(false)}
            onUploaded={() => {
              setUploading(false);
              setNotice(t('content.uploaded'));
              void load();
            }}
          />
        ) : null}
      </Dialog>

      {editing === null ? null : (
        <ContentEditDialog
          row={editing}
          levels={scope.options.levelId}
          subjects={scope.options.subjectId}
          busy={busy}
          consentLocked={consentLocked}
          onCancel={() => setEditing(null)}
          onSave={(patch) => void confirmEdit(patch)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('content.deleteTitle')}
        body={t('content.deleteBody').replace('{title}', deleting?.title ?? '')}
        confirmLabel={t('common.delete')}
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </Layout>
  );
}

/** Arabic units, matching the library cards — one size vocabulary platform-wide. */
function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} ${t('content.size.mb')}`;
  return `${Math.max(1, Math.round(bytes / 1024)).toString()} ${t('content.size.kb')}`;
}
