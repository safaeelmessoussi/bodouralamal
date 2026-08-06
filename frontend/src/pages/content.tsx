import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchBranches } from '../adapters/branches.js';
import { listBranches } from '../adapters/branches-admin.js';
import { listCourseSchedules } from '../adapters/course-schedules.js';
import { kindOf, type ContentKind } from '../adapters/content.js';
import { listAcademicYears, type AcademicYearRef, type SubjectRef } from '../adapters/reference-data.js';
import { listLevelSubjects, listLevels, type Level } from '../adapters/taxonomy.js';
import { deleteContent } from '../adapters/uploads.js';
import { AdminLayout } from '../components/admin/admin-layout.js';
import { FileUploader } from '../components/content/file-uploader.js';
import { TeacherLayout } from '../components/teacher/teacher-layout.js';
import { ConfirmDialog } from '../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../components/ui/data-table.js';
import { Button } from '../components/ui/button.js';
import { Dialog } from '../components/ui/dialog.js';
import { SelectField } from '../components/ui/field.js';
import { useSession } from '../contexts/session.js';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';

/**
 * The content library management screen — `/admin/content` (§5.6) and
 * `/teacher/content` (§5.5).
 *
 * **One screen, two portals.** The capability is identical: attach a file to a
 * Subject within a Level, replace it, delete it. What differs is the chrome and
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
const GLOBAL = '__global__';

export function ContentPage({ portal }: { portal: 'admin' | 'teacher' }): ReactNode {
  const { accessToken, me } = useSession();
  const Layout = portal === 'admin' ? AdminLayout : TeacherLayout;

  const [levels, setLevels] = useState<Level[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [years, setYears] = useState<AcademicYearRef[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  const [levelId, setLevelId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [yearId, setYearId] = useState('');
  const [branchId, setBranchId] = useState('');

  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState<LibraryRow | null>(null);
  const [deleting, setDeleting] = useState<LibraryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isAdmin = (me?.roles ?? []).some((r) => r === 'admin' || r === 'super_admin');

  useEffect(() => {
    void (async () => {
      const [lv, yr] = await Promise.all([listLevels(accessToken), listAcademicYears(accessToken)]);
      setLevels(lv);
      setYears(yr);
      // The live year is the one nearly every upload belongs to; making someone
      // recall which it is would be asking the screen's own question back.
      setYearId(yr.find((y) => y.is_current)?.id ?? '');
      if (isAdmin) {
        setBranches((await listBranches(accessToken)).data.map((b) => ({ id: b.id, name: b.name })));
      } else {
        // **A Teacher's branches are derived exactly as §4.9 derives them** —
        // from the schedules they staff (§4.4c), which is the same set the
        // server will accept. Offering them the admin branch list would show
        // branches every upload would then be refused for, and Revision 30
        // forbids a teacher browsing reference data anyway; the *names* come
        // from the public branch list, which the landing page already serves to
        // anonymous visitors.
        const [mine, all] = await Promise.all([
          listCourseSchedules(accessToken),
          fetchBranches(),
        ]);
        const reachable = new Set(mine.data.map((s) => s.branch_id));
        setBranches(all.filter((b) => reachable.has(b.id)).map((b) => ({ id: b.id, name: b.name })));
      }
    })();
  }, [accessToken, isAdmin]);

  /**
   * **The Subject list is the Level's, never the platform's.**
   *
   * `EducationalContent` carries a Level *and* a Subject, and the server refuses
   * a pair that `LevelSubject` does not join (R43) — so offering every Subject
   * would let someone pick a combination that can only ever be rejected. That is
   * not hypothetical: it is what the upload did, and on a database with no
   * `LevelSubject` rows at all **every** choice failed.
   *
   * An empty list is therefore a real and informative state — *this level teaches
   * no subjects yet* — and it points at the screen that fixes it (§14.1's
   * Subject Organisation node), rather than at a failed upload.
   */
  useEffect(() => {
    if (levelId === '') {
      setSubjects([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const taught = await listLevelSubjects(levelId, accessToken);
      if (cancelled) return;
      setSubjects(taught);
      // A subject chosen under a previous level is very unlikely to be taught
      // under this one, and silently keeping it is how an impossible pair
      // reaches the server.
      setSubjectId((current) => (taught.some((s) => s.id === current) ? current : ''));
    })();
    return () => {
      cancelled = true;
    };
  }, [levelId, accessToken]);

  const load = useCallback(async () => {
    setStatus('loading');
    const params = new URLSearchParams({ page: String(page), page_size: '25' });
    if (levelId) params.set('level_id', levelId);
    if (subjectId) params.set('subject_id', subjectId);
    if (yearId) params.set('academic_year_id', yearId);
    try {
      const body = await api<{ data: LibraryRow[]; meta: { total: number } }>(
        `/library?${params.toString()}`,
        { token: accessToken },
      );
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
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, levelId, subjectId, yearId, branchId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function refilter(apply: () => void): void {
    apply();
    setPage(1);
  }

  /** The upload target — the same scope the list is showing. */
  const meta = useMemo(
    () => ({
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: yearId,
      branch_id: branchId === GLOBAL ? null : branchId === '' ? null : branchId,
    }),
    [levelId, subjectId, yearId, branchId],
  );

  /**
   * Why the upload cannot start yet, in the person's terms.
   *
   * Stated above the form rather than enforced by a button that fails on click:
   * §14.4 wants the reason visible, and "choose a level first" is a smaller
   * thing to read than a validation error after filling in a title.
   */
  const scopeProblem =
    levelId !== '' && subjects.length === 0
      ? // Actionable rather than merely refusing: the fix is an assignment on
        // another screen, and naming it is what turns a dead end into a next step.
        t('content.upload.levelTeachesNothing')
      : levelId === '' || subjectId === '' || yearId === ''
        ? t('content.upload.chooseScope')
        : !isAdmin && (branchId === '' || branchId === GLOBAL)
          ? t('content.upload.teacherNeedsBranch')
          : null;

  const columns: Column<LibraryRow>[] = [
    { key: 'title', header: t('content.col.title'), cell: (r) => r.title },
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
      header: t('content.col.branch'),
      secondary: true,
      // `null` is Global, a real scope — never "unknown" (§4.9, BR-20).
      cell: (r) => r.branch_name ?? t('content.globalScope'),
    },
    {
      key: 'size',
      header: t('content.col.size'),
      secondary: true,
      cell: (r) => formatSize(r.size_bytes),
    },
    {
      key: 'created',
      header: t('content.col.published'),
      secondary: true,
      cell: (r) => <time dateTime={r.created_at}>{r.created_at.slice(0, 10)}</time>,
    },
  ];

  const actions: RowAction<LibraryRow>[] = [
    { label: t('content.replace'), onSelect: (r) => setReplacing(r) },
    { label: t('common.delete'), onSelect: (r) => setDeleting(r), danger: true },
  ];

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
    <Layout title={t(`${portal}.nav.content`)} lede={t('content.lede')}>
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
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
            setLevelId('');
            setSubjectId('');
            setBranchId('');
          })
        }
        toolbar={
          <>
            <SelectField
              label={t('content.col.level')}
              value={levelId}
              onChange={(v) => refilter(() => setLevelId(v))}
              options={[
                { value: '', label: t('content.allLevels') },
                ...levels.map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
            <SelectField
              label={t('content.col.subject')}
              value={subjectId}
              onChange={(v) => refilter(() => setSubjectId(v))}
              disabled={levelId === ''}
              options={[
                {
                  value: '',
                  label:
                    levelId === ''
                      ? t('content.chooseLevelFirst')
                      : subjects.length === 0
                        ? t('content.levelTeachesNothing')
                        : t('content.allSubjects'),
                },
                ...subjects.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <SelectField
              label={t('content.col.year')}
              value={yearId}
              onChange={(v) => refilter(() => setYearId(v))}
              options={years.map((y) => ({ value: y.id, label: y.label }))}
            />
            <SelectField
              label={t('content.col.branch')}
              value={branchId}
              onChange={(v) => refilter(() => setBranchId(v))}
              options={[
                { value: '', label: t('content.allBranches') },
                // **Global is offered only to those who may assign it** (§4.9):
                // a Teacher choosing it would be refused by the server, and an
                // option that always fails is worse than no option.
                ...(isAdmin ? [{ value: GLOBAL, label: t('content.globalScope') }] : []),
                ...branches.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            <Button variant="primary" onClick={() => setUploading(true)}>
              {t('content.upload.action')}
            </Button>
          </>
        }
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      <Dialog open={uploading} onClose={() => setUploading(false)} title={t('content.upload.action')}>
        <FileUploader
          meta={meta}
          token={accessToken}
          submitLabel={t('content.upload.action')}
          disabledReason={scopeProblem}
          onCancel={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            setNotice(t('content.uploaded'));
            void load();
          }}
        />
      </Dialog>

      <Dialog
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        title={t('content.replaceTitle')}
      >
        {replacing ? (
          <>
            {/* TD-9: the record and every link to it survive; only the object
                changes, under a new key, with the old one quarantined. */}
            <p className="muted">{t('content.replaceExplainer')}</p>
            <FileUploader
              meta={{
                level_id: replacing.level_id,
                subject_id: replacing.subject_id,
                academic_year_id: replacing.academic_year_id,
                branch_id: replacing.branch_id,
                replaces_content_id: replacing.id,
              }}
              token={accessToken}
              initialTitle={replacing.title}
              initialDescription={replacing.description ?? ''}
              submitLabel={t('content.replace')}
              onCancel={() => setReplacing(null)}
              onUploaded={() => {
                setReplacing(null);
                setNotice(t('content.replaced'));
                void load();
              }}
            />
          </>
        ) : null}
      </Dialog>

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
