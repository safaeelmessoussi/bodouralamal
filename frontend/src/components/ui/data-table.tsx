import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Button } from './button.js';
import { EmptyState, ErrorState, NoResultsState } from '../states.js';

/**
 * **The** table. One component for every list in the platform (constitution
 * §2.1: one component per *concept*, never one per *entity* — there is no
 * `BranchTable`, `UserTable` or `LevelTable`, and there never will be).
 *
 * It implements §14.2's list standard once — paginated table, filters row,
 * per-row actions — and all of §14.4's mandatory states, so **every CRUD screen
 * feels identical** (§2.2) because they are all literally the same component.
 *
 * **Everything is configuration** (§2.3): columns, actions, labels, empty copy.
 * Adding a second entity means passing different configuration, never editing
 * this file — which is the test §2.3 states.
 *
 * **It renders and nothing else** (§3.2). It does not fetch, does not sort
 * server data, does not know what a Branch is. The page owns the data and the
 * decisions; this owns the presentation.
 */

export interface Column<T> {
  /** Stable key — also the React key for the cell. */
  key: string;
  /** Column heading. An i18n string, resolved by the caller. */
  header: string;
  /** The cell's content. A node, so a column may render a badge or a link. */
  cell: (row: T) => ReactNode;
  /** Numeric columns get tabular figures and end alignment. */
  numeric?: boolean;
  /** Hidden below the narrow breakpoint — for columns that are context rather
   *  than identity. The first column should never set this. */
  secondary?: boolean;
}

export interface RowAction<T> {
  label: string;
  onSelect: (row: T) => void;
  /**
   * Destructive actions are styled apart, always confirm (§14.2), **and always
   * sort last** — see `orderActions`.
   */
  danger?: boolean;
  /** Per-row availability — an action that cannot apply is hidden, not disabled
   *  without explanation. */
  available?: (row: T) => boolean;
}

export type TableStatus = 'loading' | 'ready' | 'error';

export interface DataTableProps<T> {
  /** Announced as the table's accessible name. */
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  status: TableStatus;
  actions?: RowAction<T>[];
  onRetry?: () => void;
  /** True when a filter or search is active, which is what makes "no results"
   *  the right empty state rather than "nothing here yet" (§14.4). */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** Shown above the table — the search box and any filter controls. */
  toolbar?: ReactNode;
  /** TD-10 pagination, when the caller has more than one page. */
  pagination?: PaginationProps;
}

/**
 * **One order for row actions, everywhere** (Owner decision, 2026-08-17):
 *
 * ```
 * contextual actions  →  تعديل  →  destructive
 * ```
 *
 * ## Why the table sorts them and the pages do not
 *
 * The order was each page's declaration order, so `المستخدمون` read
 * *تعديل · الأدوار · إيقاف الحساب* while its neighbours read something else —
 * and a reader who has learnt where *delete* sits on one screen has learnt
 * nothing about the next. Sorting **here** makes the rule true for every table
 * that already exists and every one added later, with no caller changing.
 *
 * ## How each action is classified
 *
 * * **destructive** — `danger: true`, which the caller already sets because it
 *   drives the variant and the confirmation.
 * * **edit** — the action whose label is the platform's single shared edit label,
 *   `common.edit`. There is exactly one, by the same rule that gives the platform
 *   one Button and one Level label, and a guard asserts no page invents a second
 *   spelling of it.
 * * **contextual** — everything else, in the order the page declared it. A page
 *   with several knows their relative sense; the rule is only about where the
 *   two universal ones go.
 *
 * The sort is **stable**, so declaration order survives within each group.
 */
export function orderActions<T>(actions: readonly RowAction<T>[]): RowAction<T>[] {
  const editLabel = t('common.edit');
  const rank = (a: RowAction<T>): number => (a.danger ? 2 : a.label === editLabel ? 1 : 0);
  return [...actions].sort((a, b) => rank(a) - rank(b));
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  status,
  actions = [],
  onRetry,
  filtered = false,
  onClearFilters,
  toolbar,
  pagination,
}: DataTableProps<T>): ReactNode {
  const hasActions = actions.length > 0;
  // The platform's one ordering rule — see `orderActions`.
  const ordered = orderActions(actions);

  return (
    <div className="datatable">
      {toolbar ? <div className="datatable__toolbar">{toolbar}</div> : null}

      {status === 'error' ? (
        <ErrorState {...(onRetry ? { onRetry } : {})} />
      ) : status === 'loading' ? (
        <TableSkeleton columns={columns.length + (hasActions ? 1 : 0)} />
      ) : rows.length === 0 ? (
        filtered ? (
          <NoResultsState {...(onClearFilters ? { onClear: onClearFilters } : {})} />
        ) : (
          <EmptyState />
        )
      ) : (
        <div className="datatable__scroll">
          <table className="admin-table">
            <caption className="visually-hidden">{caption}</caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cellClass(column)}
                  >
                    {column.header}
                  </th>
                ))}
                {hasActions ? (
                  <th scope="col" className="admin-table__actions-head">
                    <span className="visually-hidden">{t('common.actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                // Ordered before filtering, so a row whose contextual action is
                // unavailable still shows the remaining two in the same places.
                const available = ordered.filter((a) => (a.available ? a.available(row) : true));
                return (
                  <tr key={rowKey(row)}>
                    {columns.map((column, index) =>
                      // The first column is the row's identity, so it is a
                      // `<th scope="row">` — a screen reader then announces it
                      // with every other cell in the row.
                      index === 0 ? (
                        <th key={column.key} scope="row" className={cellClass(column)}>
                          {column.cell(row)}
                        </th>
                      ) : (
                        <td key={column.key} className={cellClass(column)}>
                          {column.cell(row)}
                        </td>
                      ),
                    )}
                    {hasActions ? (
                      /**
                       * **The row actions render through the shared `Button`**
                       * (2026-08-17). They used to be a hand-written
                       * `btn btn--ghost` element — the one exemption the atomic
                       * guard carried — and it showed: `ghost` has no border and
                       * no background at rest, so «تعديل» and «حذف» read as
                       * ordinary text in a cell full of ordinary text. A reader
                       * had no way to tell an action from a value.
                       *
                       * They are `secondary` now — bordered, so they look like
                       * the controls they are — with `danger` for the
                       * destructive one, the same variant every irreversible
                       * action on the platform uses. `row-action` sizes them for
                       * a table row and nothing else; the palette stays the
                       * button system's, so a future change to it reaches here
                       * automatically.
                       */
                      <td className="admin-table__actions">
                        {available.map((action) => (
                          <Button
                            key={action.label}
                            variant={action.danger ? 'danger' : 'secondary'}
                            className="row-action"
                            onClick={() => action.onSelect(row)}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && status === 'ready' && rows.length > 0 ? (
        <Pagination {...pagination} />
      ) : null}
    </div>
  );
}

function cellClass<T>(column: Column<T>): string {
  return [column.numeric ? 'is-numeric' : '', column.secondary ? 'is-secondary' : '']
    .filter(Boolean)
    .join(' ');
}

/** Shaped like the table it replaces, so the page does not reflow when data
 *  lands (§14.4 — a skeleton, not a spinner). */
function TableSkeleton({ columns }: { columns: number }): ReactNode {
  return (
    <div className="datatable__skeleton" role="status" aria-live="polite">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="datatable__skeleton-row">
          {Array.from({ length: columns }, (_, cell) => (
            <span key={cell} className="skeleton" />
          ))}
        </div>
      ))}
      <span className="visually-hidden">{t('states.loading')}</span>
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}

/**
 * TD-10 pagination. Previous / position / next, matching the calendar's month
 * navigation in shape so the platform has one way of stepping through anything.
 */
export function Pagination({ page, pageSize, total, onPage }: PaginationProps): ReactNode {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  return (
    <nav className="pagination" aria-label={t('common.pagination')}>
      {/* The shared button: `btn btn--secondary` written by hand here was a
          second copy of the variant's own class list, and would have drifted
          the first time the palette changed. */}
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('common.previous')}
      </Button>
      {/* A live region, so stepping pages is announced rather than silently
          redrawing the table. */}
      <output className="pagination__status" aria-live="polite">
        {t('common.pageOf').replace('{page}', String(page)).replace('{pages}', String(pages))}
      </output>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('common.next')}
      </Button>
    </nav>
  );
}
