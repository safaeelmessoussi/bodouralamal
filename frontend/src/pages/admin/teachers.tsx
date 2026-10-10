import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { searchDirectory, type DirectoryEntry } from '../../adapters/users.js';
import {
  fetchTeachingProfile,
  type TeachingProfile,
} from '../../adapters/teaching-profile.js';
import { listSubjects } from '../../adapters/reference-data.js';
import { listCategories } from '../../adapters/taxonomy.js';
import { fetchBranches } from '../../adapters/branches.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { BranchScopeCell } from '../../components/admin/branch-scope-cell.js';
import { TeachingProfileDialog } from '../../components/admin/teaching-profile-dialog.js';
import { Badge } from '../../components/ui/badge.js';
import {
  DataTable,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { SearchInput, SelectField } from '../../components/ui/field.js';
import { Feedback } from '../../components/ui/feedback.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { counted } from '../../lib/arabic-years.js';

/**
 * **إدارة المؤطِّرات — the teaching side of الشؤون التعليمية** (R88).
 *
 * The section holds two parallel populations: التسجيلات places **the people
 * being taught**, and this manages **the people doing the teaching**. The
 * teaching profile was a row action on المستخدمون, which offered it for
 * guardians, minors and administrators alike — a generic account screen
 * answering a question it does not own.
 *
 * ## Who appears
 *
 * **Anybody holding the مؤطِّرة role**, asked of the server through the list's
 * existing `role` filter — never derived here from a fetched page, which would
 * be a client filtering a list it was handed (§4.4).
 *
 * **`is_beneficiary` is not an exclusion.** R79 made *beneficiary* a durable
 * fact independent of every role precisely so a مؤطِّرة may also study: filtering
 * her out would hide a real member of teaching staff. A guardian or a
 * beneficiary who does not teach simply does not hold the role.
 *
 * ## Data first (rule A)
 *
 * The table renders on arrival. The filters narrow it; none of them is a
 * precondition for it appearing.
 */
export function TeachersPage(): ReactNode {
  const { accessToken } = useSession();

  const [rows, setRows] = useState<DirectoryEntry[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  /**
   * R76 — server-side on `name`, the one column `/admin/users` owns.
   *
   * **Subjects, Categories and availability are deliberately NOT sortable.**
   * They are not on the list contract at all: each is fetched per row after
   * the page arrives (see the profile loop below), so sorting by one would
   * order the 25 rows this page happens to hold and present it as the
   * collection's order — exactly the defect R76 exists to prevent.
   */
  const [sort, setSort] = useState<SortState | null>(null);
  const [query, setQuery] = useState('');
  // R215 — «الفرع» and «هذا الفصل» (the Owner: by Subject and Category it
  // was «not logic»; what is asked is where she can teach and whether now).
  const [branchFilter, setBranchFilter] = useState('');
  const [nowFilter, setNowFilter] = useState<'' | 'yes' | 'no' | 'unknown'>('');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  /** Every listed مؤطِّرة's profile, so the table can summarise it. */
  const [profiles, setProfiles] = useState<Record<string, TeachingProfile>>({});
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [profiling, setProfiling] = useState<DirectoryEntry | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // **The server decides who is staff**, through the filter the list already
      // has — not a predicate applied to a page of users after the fact.
      // TD-10 sets a two-character floor; a shorter query is a scan, not a
      // search, and the server refuses it — sending it would turn a deliberate
      // limit into an error message mid-typing.
      const trimmed = query.trim();
      // R215 — EVERY مؤطِّرة, page after page: the filters below narrow by
      // planning data the list does not carry, so narrowing one page of 25
      // would hide whoever was on page two.
      const all: DirectoryEntry[] = [];
      for (let page = 1; ; page += 1) {
        const batch = await searchDirectory(accessToken, {
          role: 'teacher',
          ...(trimmed.length >= 2 ? { q: trimmed } : {}),
        }, page, sort);
        all.push(...batch.data);
        if (batch.data.length === 0 || page * batch.meta.page_size >= batch.meta.total) break;
      }
      setRows(all);
      setStatus('ready');

      // One profile read per listed person. They are small, bounded by the
      // page, and the alternative — a summary column the list endpoint would
      // have to carry — puts planning data on a general-purpose contract.
      const loaded = await Promise.all(
        all.map((u) =>
          fetchTeachingProfile(u.id, accessToken)
            .then((p) => [u.id, p] as const)
            .catch(() => null),
        ),
      );
      setProfiles(Object.fromEntries(loaded.filter((x): x is [string, TeachingProfile] => x !== null)));
    } catch {
      setStatus('error');
    }
  }, [accessToken, query, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void Promise.all([listSubjects(accessToken), listCategories(accessToken), fetchBranches()])
      .then(([s, c, b]) => {
        setSubjects(s.map((x) => ({ id: x.id, name: x.name })));
        setCategories(c.map((x) => ({ id: x.id, name: x.name })));
        setBranches(b.map((x) => ({ id: x.id, name: x.name })));
      })
      .catch(() => undefined);
  }, [accessToken]);

  /**
   * **R215 — «الفرع» and «هذا الفصل»** narrow by planning data only this
   * screen holds (each مؤطِّرة's profile), so they are applied here: the
   * population came from the server, and this narrows it by facts the list
   * does not carry. A branch matches where she is assigned (a role over it or
   * over every branch) or where she said she is willing to teach.
   */
  const visible = useMemo(
    () => rows.filter((row) => teacherMatches(row, profiles[row.id], branchFilter, nowFilter)),
    [rows, profiles, branchFilter, nowFilter],
  );

  const actions: RowAction<DirectoryEntry>[] = [
    { label: t('admin.teachingProfile.action'), onSelect: (r) => setProfiling(r) },
  ];

  /** Compact chips — a مؤطِّرة may declare many, and a wide table reads badly. */
  const chips = (items: { id: string; name: string }[]): ReactNode =>
    items.length === 0 ? (
      <span className="muted">—</span>
    ) : (
      <>
        {items.slice(0, 3).map((i) => (
          <Badge key={i.id} tone="neutral">
            {i.name}
          </Badge>
        ))}
        {items.length > 3 ? <span className="muted"> +{items.length - 3}</span> : null}
      </>
    );

  return (
    <AdminLayout title={t('admin.nav.teachers')} lede={t('admin.teachers.lede')}>
      {notice ? <Feedback>{notice}</Feedback> : null}

      <DataTable
        caption={t('admin.teachers.caption')}
        sort={sort}
        onSort={setSort}
        columns={[
          {
            key: 'first_name',
            header: t('admin.users.colFirstName'),
            sortKey: 'first_name',
            cell: (r: DirectoryEntry) =>
              r.first_name_arabic ?? <span className="muted">{t('common.notSet')}</span>,
          },
          {
            key: 'last_name',
            header: t('admin.users.colLastName'),
            sortKey: 'last_name',
            cell: (r: DirectoryEntry) =>
              r.last_name_arabic ?? <span className="muted">{t('common.notSet')}</span>,
          },
          {
            // §8 — **where she teaches.** The row already carried it (every role
            // assignment names its branch) and the screen was not showing it,
            // which is the recurring shape UX rule P names: a fact present and
            // unreachable. Rendered through the shared cell so the R24
            // all-branches rule is stated once, not copied here.
            key: 'branches',
            header: t('admin.users.colBranches'),
            cell: (r: DirectoryEntry) => <BranchScopeCell roles={r.roles} />,
          },
          {
            key: 'subjects',
            header: t('admin.teachers.colSubjects'),
            cell: (r: DirectoryEntry) => chips(profiles[r.id]?.subjects ?? []),
          },
          {
            key: 'categories',
            header: t('admin.teachers.colCategories'),
            cell: (r: DirectoryEntry) => chips(profiles[r.id]?.categories ?? []),
          },
          {
            // R215 — available this semester, by what she said.
            key: 'now',
            header: t('admin.teachers.colNow'),
            cell: (r: DirectoryEntry) => <NowBadge available={profiles[r.id]?.framing?.available_now ?? null} />,
          },
          {
            key: 'availability',
            header: t('admin.teachers.colAvailability'),
            // A count, not the ranges: seven days of ranges in a cell is a
            // table nobody can read. The dialog holds the detail.
            cell: (r: DirectoryEntry) => {
              const count = profiles[r.id]?.availability.length ?? 0;
              return count === 0 ? (
                <span className="muted">{t('admin.teachers.noAvailability')}</span>
              ) : (
                counted('admin.teachers.ranges', count)
              );
            },
          },
        ]}
        rows={visible}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={query.trim() !== '' || branchFilter !== '' || nowFilter !== ''}
        onClearFilters={() => {
          setQuery('');
          setBranchFilter('');
          setNowFilter('');
        }}
        toolbar={
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              label={t('common.search')}
              placeholder={t('admin.users.searchPlaceholder')}
              hint={t('admin.users.searchHint')}
            />
            <SelectField
              label={t('admin.teachers.filterBranch')}
              value={branchFilter}
              onChange={setBranchFilter}
              options={[
                { value: '', label: t('calendar.filters.all') },
                ...branches.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            <SelectField
              label={t('admin.teachers.filterNow')}
              value={nowFilter}
              onChange={(v) => setNowFilter(v as typeof nowFilter)}
              options={[
                { value: '', label: t('calendar.filters.all') },
                { value: 'yes', label: t('framing.availableNow') },
                { value: 'no', label: t('framing.unavailableNow') },
                { value: 'unknown', label: t('framing.availabilityUnknown') },
              ]}
            />
          </>
        }
      />

      {profiling ? (
        // **The R88 dialog, reused unchanged.** This page owns the navigation,
        // not a second editor.
        <TeachingProfileDialog
          userId={profiling.id}
          userName={profiling.name_arabic}
          subjects={subjects}
          categories={categories}
          token={accessToken}
          onClose={() => setProfiling(null)}
          onSaved={() => {
            setProfiling(null);
            setNotice(t('admin.teachingProfile.saved'));
            void load();
          }}
          onFramingSaved={() => void load()}
        />
      ) : null}
    </AdminLayout>
  );
}

/** R215 — does this row pass «الفرع» and «هذا الفصل»? */
export function teacherMatches(
  row: Pick<DirectoryEntry, 'roles'>,
  profile: Pick<TeachingProfile, 'framing'> | undefined,
  branchId: string,
  now: '' | 'yes' | 'no' | 'unknown',
): boolean {
  if (branchId) {
    const assigned = row.roles.some((r) => r.role === 'teacher' && (r.branch_id === null || r.branch_id === branchId));
    const framing = profile?.framing ?? null;
    const willing =
      framing !== null && framing.mode !== 'online' && (framing.all_branches || framing.branches.some((b) => b.id === branchId));
    if (!assigned && !willing) return false;
  }
  if (now) {
    const available = profile?.framing?.available_now ?? null;
    if (now === 'yes' && available !== true) return false;
    if (now === 'no' && available !== false) return false;
    if (now === 'unknown' && available !== null) return false;
  }
  return true;
}

function NowBadge({ available }: { available: boolean | null }): ReactNode {
  if (available === null) return <span className="muted">{t('framing.availabilityUnknown')}</span>;
  return <Badge tone={available ? 'ok' : 'warn'}>{t(available ? 'framing.availableNow' : 'framing.unavailableNow')}</Badge>;
}
