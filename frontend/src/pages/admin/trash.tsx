import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listTrash, purgeTrashEntry, restoreTrashEntry, type TrashEntry } from '../../adapters/trash.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { DateField, SearchInput, SelectField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

/** The entity types that reach the Trash. A closed list, so the filter offers
 *  real choices rather than whatever happens to be on the current page. */
const ENTITIES = [
  'Branch',
  'Room',
  'Category',
  'Subject',
  'Level',
  'AdministrativeGroup',
  'TeachingGroup',
  'RecurringCourseSchedule',
  'Session',
  'Event',
  'EducationalContent',
  'User',
] as const;

/**
 * `/admin/trash` — سلة المحذوفات (§7, TD-5, BR-15, Revision 52).
 *
 * **Restore is offered per entity type, never universally**, and the decision is
 * the server's. §7 states why: the TD-5 cascade removes `FamilyLink`,
 * `Enrollment`, `StudentTeachingGroup`, `CourseScheduleStaff`, `UserBranchRole`
 * and `UserIdentity` rows, and *"a User restored without their links,
 * enrollments and roles is a half-restored, silently broken account."* Clearing
 * `deleted_at` is the easy tenth of that problem and every failure of the rest is
 * silent — the row returns, the screen looks right, and the person is enrolled
 * in nothing.
 *
 * So a row that cannot be restored **says so, with the reason**, rather than
 * showing a disabled button or none at all. §14.2 hides an inapplicable action
 * because a dead control teaches nothing — but here the *absence* is the
 * surprising part, and an administrator who cannot restore their own data
 * deserves to know it is a known limitation rather than a bug.
 *
 * **There is no permanent-delete control.** BR-15's 90-day window is enforced by
 * the purge job, and a manual *delete now* would bypass a retention rule that
 * exists for legal and safeguarding reasons — a data-retention decision, not a
 * convenience.
 *
 * **The snapshot is never shown.** It is the whole row as it was, including
 * columns no screen is entitled to. This page answers *what was deleted, by
 * whom, and when*.
 */
export function TrashPage(): ReactNode {
  const { accessToken } = useSession();

  const [rows, setRows] = useState<TrashEntry[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [restoring, setRestoring] = useState<TrashEntry | null>(null);
  const [purging, setPurging] = useState<TrashEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listTrash(
        accessToken,
        {
          ...(entity ? { entity } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(query.trim() ? { q: query.trim() } : {}),
        },
        page,
      );
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, entity, from, to, query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any filter change re-queries from page 1: staying on page 3 of a narrower
   *  result shows an empty table that reads as "nothing was deleted". */
  function refilter(apply: () => void): void {
    apply();
    setPage(1);
  }

  const columns: Column<TrashEntry>[] = [
    {
      key: 'label',
      header: t('admin.trash.colRecord'),
      // The id is the fallback, not the answer: a page of UUIDs is unreadable.
      cell: (r) => r.label ?? <span className="muted">{r.target_id.slice(0, 8)}</span>,
    },
    {
      key: 'entity',
      header: t('admin.trash.colEntity'),
      cell: (r) => t(`admin.trash.entity.${r.target_entity}`),
    },
    {
      key: 'deletedAt',
      header: t('admin.trash.colDeletedAt'),
      cell: (r) => <time dateTime={r.deleted_at}>{formatDate(r.deleted_at)}</time>,
    },
    {
      key: 'deletedBy',
      header: t('admin.trash.colDeletedBy'),
      secondary: true,
      // `null` where the deletion was the system's rather than a person's.
      cell: (r) => r.deleted_by_name ?? <span className="muted">{t('admin.trash.bySystem')}</span>,
    },
    {
      key: 'purge',
      header: t('admin.trash.colPurge'),
      secondary: true,
      // BR-15's window, shown because it is the deadline for acting.
      cell: (r) => <time dateTime={r.purge_after}>{formatDate(r.purge_after)}</time>,
    },
    {
      key: 'purgeable',
      header: t('admin.trash.colPurgeable'),
      secondary: true,
      // Stated for the same reason `restorable` is: an administrator who cannot
      // destroy a record deserves the reason rather than a missing menu item.
      cell: (r) =>
        r.purgeable ? (
          t('admin.trash.canPurge')
        ) : (
          <span className="muted">
            {t(`admin.trash.purgeBlocked.${r.purge_blocked_reason ?? 'NOT_YET_SUPPORTED'}`)}
          </span>
        ),
    },
    {
      key: 'restorable',
      header: t('admin.trash.colRestorable'),
      // Stated rather than implied by a missing button: an administrator who
      // cannot restore their own data deserves to know it is a known limit.
      cell: (r) =>
        r.restorable ? (
          t('admin.trash.canRestore')
        ) : (
          <span className="muted">
            {t(`admin.trash.blocked.${r.restore_blocked_reason ?? 'NOT_YET_SUPPORTED'}`)}
          </span>
        ),
    },
  ];

  const actions: RowAction<TrashEntry>[] = [
    {
      label: t('admin.trash.restore'),
      onSelect: (r) => setRestoring(r),
      // The server's decision, rendered — never the client's guess.
      available: (r) => r.restorable,
    },
    {
      // R59.1 — irreversible, so it is the one action on this screen behind a
      // `danger` confirmation. Hiding it is a courtesy to the reader and NOT the
      // security: the endpoint refuses any caller who is not a Super Admin, and
      // this whole page already answers 403 for them.
      label: t('admin.trash.purge'),
      danger: true,
      onSelect: (r) => setPurging(r),
      available: (r) => r.purgeable,
    },
  ];

  async function confirmPurge(): Promise<void> {
    if (!purging) return;
    setBusy(true);
    setNotice(null);
    try {
      await purgeTrashEntry(purging.id, accessToken);
      await load();
      setNotice(t('admin.trash.purged'));
    } catch (error) {
      const reason =
        error instanceof ApiError ? (error.details?.['reason'] as string | undefined) : undefined;
      setNotice(
        reason === 'DEPENDENTS_EXIST'
          ? t('admin.trash.dependentsExist')
          : reason === 'NOT_DELETED'
            ? t('admin.trash.notDeleted')
            : t('admin.trash.purgeFailed'),
      );
    } finally {
      setBusy(false);
      setPurging(null);
    }
  }

  async function confirmRestore(): Promise<void> {
    if (!restoring) return;
    setBusy(true);
    setNotice(null);
    try {
      await restoreTrashEntry(restoring.id, accessToken);
      await load();
      setNotice(t('admin.trash.restored'));
    } catch (error) {
      const reason =
        error instanceof ApiError ? (error.details?.['reason'] as string | undefined) : undefined;
      setNotice(
        t(
          reason === 'PARENT_DELETED'
            ? 'admin.trash.parentDeleted'
            : reason === 'ALREADY_PURGED'
              ? 'admin.trash.alreadyPurged'
              : reason === 'NOT_DELETED'
                ? 'admin.trash.notDeleted'
                : 'admin.trash.restoreFailed',
        ),
      );
    } finally {
      setBusy(false);
      setRestoring(null);
    }
  }

  return (
    <AdminLayout title={t('admin.nav.trash')} lede={t('admin.trash.lede')}>
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
        caption={t('admin.trash.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={entity !== '' || from !== '' || to !== '' || query.trim() !== ''}
        onClearFilters={() =>
          refilter(() => {
            setEntity('');
            setFrom('');
            setTo('');
            setQuery('');
          })
        }
        toolbar={
          <>
            <SearchInput
              value={query}
              onChange={(v) => refilter(() => setQuery(v))}
              label={t('common.search')}
              placeholder={t('admin.trash.searchPlaceholder')}
            />
            <SelectField
              label={t('admin.trash.colEntity')}
              value={entity}
              onChange={(v) => refilter(() => setEntity(v))}
              options={[
                { value: '', label: t('admin.trash.allEntities') },
                ...ENTITIES.map((e) => ({ value: e, label: t(`admin.trash.entity.${e}`) })),
              ]}
            />
            <DateField
              label={t('admin.trash.from')}
              value={from}
              onChange={(v) => refilter(() => setFrom(v))}
            />
            <DateField
              label={t('admin.trash.to')}
              value={to}
              onChange={(v) => refilter(() => setTo(v))}
            />
          </>
        }
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      {/* BR-15's window is unchanged and is still the default path — the
          action above is the deliberate exception, not a replacement for it. */}
      <p className="muted">{t('admin.trash.retentionNote')}</p>

      {/* Deliberately separate from the restore dialog rather than one dialog
          with a mode: the two ask for opposite decisions, and a shared shell
          whose copy changes is how somebody confirms the wrong one. */}
      <ConfirmDialog
        open={purging !== null}
        danger
        title={t('admin.trash.purgeTitle')}
        body={t('admin.trash.purgeBody').replace(
          '{record}',
          purging?.label ?? purging?.target_id.slice(0, 8) ?? '',
        )}
        confirmLabel={t('admin.trash.purge')}
        busy={busy}
        onConfirm={() => void confirmPurge()}
        onCancel={() => setPurging(null)}
      />

      <ConfirmDialog
        open={restoring !== null}
        title={t('admin.trash.restoreTitle')}
        body={t('admin.trash.restoreBody').replace(
          '{record}',
          restoring?.label ?? restoring?.target_id.slice(0, 8) ?? '',
        )}
        confirmLabel={t('admin.trash.restore')}
        busy={busy}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setRestoring(null)}
      />
    </AdminLayout>
  );
}
