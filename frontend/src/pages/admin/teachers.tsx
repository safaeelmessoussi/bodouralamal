import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { searchUsers, type UserSummary } from '../../adapters/users.js';
import {
  fetchTeachingProfile,
  type TeachingProfile,
} from '../../adapters/teaching-profile.js';
import { listSubjects } from '../../adapters/reference-data.js';
import { listCategories } from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { TeachingProfileDialog } from '../../components/admin/teaching-profile-dialog.js';
import { Badge } from '../../components/ui/badge.js';
import { DataTable, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { SearchInput, SelectField } from '../../components/ui/field.js';
import { Feedback } from '../../components/ui/feedback.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

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

  const [rows, setRows] = useState<UserSummary[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [query, setQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  /** Every listed مؤطِّرة's profile, so the table can summarise it. */
  const [profiles, setProfiles] = useState<Record<string, TeachingProfile>>({});
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [profiling, setProfiling] = useState<UserSummary | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // **The server decides who is staff**, through the filter the list already
      // has — not a predicate applied to a page of users after the fact.
      // TD-10 sets a two-character floor; a shorter query is a scan, not a
      // search, and the server refuses it — sending it would turn a deliberate
      // limit into an error message mid-typing.
      const trimmed = query.trim();
      const page = await searchUsers(accessToken, {
        role: 'teacher',
        ...(trimmed.length >= 2 ? { q: trimmed } : {}),
      });
      setRows(page.data);
      setStatus('ready');

      // One profile read per listed person. They are small, bounded by the
      // page, and the alternative — a summary column the list endpoint would
      // have to carry — puts planning data on a general-purpose contract.
      const loaded = await Promise.all(
        page.data.map((u) =>
          fetchTeachingProfile(u.id, accessToken)
            .then((p) => [u.id, p] as const)
            .catch(() => null),
        ),
      );
      setProfiles(Object.fromEntries(loaded.filter((x): x is [string, TeachingProfile] => x !== null)));
    } catch {
      setStatus('error');
    }
  }, [accessToken, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void Promise.all([listSubjects(accessToken), listCategories(accessToken)])
      .then(([s, c]) => {
        setSubjects(s.map((x) => ({ id: x.id, name: x.name })));
        setCategories(c.map((x) => ({ id: x.id, name: x.name })));
      })
      .catch(() => undefined);
  }, [accessToken]);

  /**
   * The Subject and Category filters narrow by **declared capability**, which
   * only this screen holds — so they are applied here rather than sent to a
   * list endpoint that knows nothing about planning data. That is not the
   * "client filtering a list it was handed" defect: the population came from
   * the server, and this narrows it by a fact the server did not carry.
   */
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        const profile = profiles[row.id];
        if (subjectFilter && !profile?.subjects.some((s) => s.id === subjectFilter)) return false;
        if (categoryFilter && !profile?.categories.some((c) => c.id === categoryFilter)) {
          return false;
        }
        return true;
      }),
    [rows, profiles, subjectFilter, categoryFilter],
  );

  const actions: RowAction<UserSummary>[] = [
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
        columns={[
          { key: 'name', header: t('admin.users.colName'), cell: (r: UserSummary) => r.name_arabic },
          {
            key: 'subjects',
            header: t('admin.teachers.colSubjects'),
            cell: (r: UserSummary) => chips(profiles[r.id]?.subjects ?? []),
          },
          {
            key: 'categories',
            header: t('admin.teachers.colCategories'),
            cell: (r: UserSummary) => chips(profiles[r.id]?.categories ?? []),
          },
          {
            key: 'availability',
            header: t('admin.teachers.colAvailability'),
            // A count, not the ranges: seven days of ranges in a cell is a
            // table nobody can read. The dialog holds the detail.
            cell: (r: UserSummary) => {
              const count = profiles[r.id]?.availability.length ?? 0;
              return count === 0 ? (
                <span className="muted">{t('admin.teachers.noAvailability')}</span>
              ) : (
                t('admin.teachers.ranges').replace('{n}', String(count))
              );
            },
          },
        ]}
        rows={visible}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={query.trim() !== '' || subjectFilter !== '' || categoryFilter !== ''}
        onClearFilters={() => {
          setQuery('');
          setSubjectFilter('');
          setCategoryFilter('');
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
              label={t('admin.teachers.filterSubject')}
              value={subjectFilter}
              onChange={setSubjectFilter}
              options={[
                { value: '', label: t('calendar.filters.all') },
                ...subjects.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <SelectField
              label={t('admin.teachers.filterCategory')}
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: '', label: t('calendar.filters.all') },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
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
        />
      ) : null}
    </AdminLayout>
  );
}
