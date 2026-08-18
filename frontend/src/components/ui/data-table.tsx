import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Button } from './button.js';
import { EmptyState, ErrorState, NoResultsState } from '../states.js';
import { draftSettled, moveTo, reorderBlock, type ReorderBlock } from './reorderable.js';

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
  /**
   * **The contract field this column sorts by** (R76.1) — `sort_by=<this>`.
   *
   * Its presence is what makes the header a button; a column without it stays
   * plain text, and the actions column never has one. It is the **endpoint's**
   * field name, not the column key and not a database column: the server refuses
   * anything outside its own allow-list, so a wrong value here fails loudly at
   * the API rather than sorting by something unintended.
   */
  sortKey?: string;
}

/** The active sort, as the page holds it and the server receives it. */
export interface SortState {
  by: string;
  dir: 'asc' | 'desc';
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
  /**
   * The active sort, and how to change it. **Both or neither**: a table that
   * shows a sort it cannot change would be lying about the control.
   *
   * `null` means the collection's own default order (BR-19) — which is also the
   * **canonical order**, the only state in which manual reordering is offered
   * (R76.8).
   */
  sort?: SortState | null;
  onSort?: (next: SortState | null) => void;
  /** TD-10 pagination, when the caller has more than one page. */
  pagination?: PaginationProps;
  /**
   * **Manual ordering** (R76.4) — submits the complete sequence of row keys and
   * resolves when the server has accepted it.
   *
   * Passing it is the whole opt-in: **whether the gesture is actually offered is
   * decided here**, from the sort state and the pagination, never by the caller.
   * A condition each page had to remember would be a condition some page
   * forgets, and the one it would forget is `paged` — where the server refuses
   * the request and the reader sees a drag that silently does nothing.
   *
   * The client never computes `display_order`: it sends the order, and the
   * server assigns the numbers.
   *
   * **`null` is the third state, and it is deliberate**: *this table orders
   * manually, but not right now*. Two of the five orderable collections are
   * scoped to a parent (§2.2), and until one is selected the rows on screen span
   * several sequences. Passing `undefined` there would hide the capability and
   * teach nothing; passing `null` keeps the column, disables the handle and lets
   * the status line say what to select.
   */
  onReorder?: ((ids: string[]) => Promise<unknown>) | null;
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
  sort = null,
  onSort,
  pagination,
  onReorder,
}: DataTableProps<T>): ReactNode {
  const hasActions = actions.length > 0;
  // The platform's one ordering rule — see `orderActions`.
  const ordered = orderActions(actions);

  const reorder = useReorder(rows, rowKey, onReorder ?? undefined, sort !== null, pagination?.total, onReorder !== null);
  const displayed = reorder.rows;
  const showGrip = onReorder !== undefined;

  return (
    <div className="datatable">
      {toolbar ? <div className="datatable__toolbar">{toolbar}</div> : null}

      {status === 'error' ? (
        <ErrorState {...(onRetry ? { onRetry } : {})} />
      ) : status === 'loading' ? (
        <TableSkeleton columns={columns.length + (hasActions ? 1 : 0) + (showGrip ? 1 : 0)} />
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
                {showGrip ? (
                  <th scope="col" className="admin-table__grip-head">
                    <span className="visually-hidden">{t('common.reorder.column')}</span>
                  </th>
                ) : null}
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cellClass(column)}
                    /**
                     * **`aria-sort` on the header, not on the button** — it is a
                     * property of the column, and a screen reader announces it
                     * when the reader enters the cell rather than only when they
                     * reach the control inside it.
                     */
                    aria-sort={
                      column.sortKey && sort?.by === column.sortKey
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : column.sortKey
                          ? 'none'
                          : undefined
                    }
                  >
                    {renderHeader(column, sort, onSort)}
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
              {displayed.map((row, rowIndex) => {
                // Ordered before filtering, so a row whose contextual action is
                // unavailable still shows the remaining two in the same places.
                const available = ordered.filter((a) => (a.available ? a.available(row) : true));
                const id = rowKey(row);
                return (
                  <tr
                    key={id}
                    draggable={reorder.enabled}
                    onDragStart={reorder.onDragStart(id)}
                    onDragOver={reorder.onDragOver(rowIndex)}
                    onDrop={reorder.onDrop}
                    onDragEnd={reorder.onDragEnd}
                    className={reorder.draggingId === id ? 'is-dragging' : undefined}
                  >
                    {showGrip ? (
                      <td className="admin-table__grip">
                        {/* **The handle is a button, and the keyboard path is
                            the same control.** Native drag-and-drop is
                            mouse-only; a grip that only responded to a pointer
                            would put a persisted business decision out of reach
                            of a keyboard user. ↑/↓ move the row, which is also
                            the only way to reorder on a touch screen. */}
                        <button
                          type="button"
                          className="admin-table__grip-btn"
                          disabled={!reorder.enabled}
                          aria-label={t('common.reorder.handle')}
                          onKeyDown={reorder.onHandleKey(rowIndex)}
                        >
                          <span aria-hidden="true">⠿</span>
                        </button>
                      </td>
                    ) : null}
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

      {showGrip && status === 'ready' && rows.length > 0 ? (
        <ReorderStatus block={reorder.block} busy={reorder.busy} error={reorder.error} />
      ) : null}

      {pagination && status === 'ready' && rows.length > 0 ? (
        <Pagination {...pagination} />
      ) : null}
    </div>
  );
}

/**
 * **Everything manual ordering needs, in one hook** (R76.4, R76.8).
 *
 * ## Why the table decides, and not the page
 *
 * Availability is derived here from the sort state and the pagination the table
 * already holds. The alternative — a `canReorder` prop each page computes — is
 * the shape this codebase has already been bitten by: a behaviour every caller
 * must opt into is a behaviour that will be missing somewhere, and the case that
 * would be missed is `paged`, where the server refuses the sequence and the
 * reader sees a drag that appears to do nothing.
 *
 * ## Why the draft is held past the response
 *
 * The new order is shown immediately and kept until the **incoming rows agree
 * with it**. Releasing it when the promise resolves would flash the old order
 * for the length of the page's refetch, which reads as the drop having failed.
 * A refusal drops the draft at once — the reader must see the real order, not a
 * position the server rejected.
 *
 * A second drop is ignored while one is in flight: the contract takes the whole
 * live set, so two overlapping sequences would be two complete statements about
 * the same collection, and the loser is not a merge but a silent overwrite.
 */
function useReorder<T>(
  rows: T[],
  rowKey: (row: T) => string,
  onReorder: ((ids: string[]) => Promise<unknown>) | undefined,
  sorted: boolean,
  total: number | undefined,
  scoped: boolean,
): {
  rows: T[];
  enabled: boolean;
  block: ReorderBlock | null;
  busy: boolean;
  error: boolean;
  draggingId: string | null;
  onDragStart: (id: string) => (event: DragEvent<HTMLTableRowElement>) => void;
  onDragOver: (index: number) => (event: DragEvent<HTMLTableRowElement>) => void;
  onDrop: (event: DragEvent<HTMLTableRowElement>) => void;
  onDragEnd: () => void;
  onHandleKey: (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => void;
} {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // Read inside handlers that must not re-bind on every keystroke of state.
  const busyRef = useRef(false);
  /**
   * **The dragged row, in a ref as well as in state.**
   *
   * `dragstart` and the first `dragover` can arrive in the same task, and React
   * has not re-rendered between them — so a handler reading only the state
   * closure sees `null` and the drag does nothing. The state drives the styling;
   * this drives the logic. Found in the browser, where a synthetic sequence
   * moved no row while the keyboard path worked.
   */
  const draggingRef = useRef<string | null>(null);
  /**
   * The arrangement the pass-through has produced so far, for the same reason:
   * `drop` must read what the last `dragover` decided, and `ordered` below is a
   * render-time value that has not caught up within a single task.
   */
  const pendingRef = useRef<string[] | null>(null);

  const ids = rows.map(rowKey);
  // The dependency is the SEQUENCE, not the array: `rows.map` builds a new array
  // every render, so depending on it would re-run this forever.
  const signature = ids.join('\u0000');
  useEffect(() => {
    setDraft((current) => (current !== null && current.join('\u0000') === signature ? null : current));
  }, [signature]);

  const block = scoped && onReorder === undefined ? null : reorderBlock(sorted, rows.length, total, scoped);
  const enabled = onReorder !== undefined && block === null && !busy;

  const byId = new Map(rows.map((row) => [rowKey(row), row]));
  const ordered =
    draft === null
      ? rows
      : draft.flatMap((id) => {
          const row = byId.get(id);
          return row === undefined ? [] : [row];
        });

  function submit(next: string[]): void {
    if (onReorder === undefined || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(false);
    setDraft(next);
    void onReorder(next)
      .catch(() => {
        setError(true);
        // Drop the optimistic order: the reader must see what is actually
        // stored, not the position the server refused.
        setDraft(null);
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }

  function move(from: number, to: number): void {
    const current = ordered.map(rowKey);
    if (to < 0 || to >= current.length || from === to) return;
    submit(moveTo(current, from, to));
  }

  return {
    rows: ordered,
    enabled,
    block,
    busy,
    error,
    draggingId: dragging,
    onDragStart: (id) => (event) => {
      if (!enabled) return;
      draggingRef.current = id;
      pendingRef.current = null;
      setDragging(id);
      // Firefox starts no drag at all without data on the transfer.
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (index) => (event) => {
      const held = draggingRef.current;
      if (!enabled || held === null) return;
      // Without this the drop event never fires — the default is "reject".
      event.preventDefault();
      const current = pendingRef.current ?? ordered.map(rowKey);
      const from = current.indexOf(held);
      if (from === -1 || from === index) return;
      // The row follows the pointer as it passes, so the reader is dropping onto
      // the arrangement they can already see rather than predicting one.
      const next = moveTo(current, from, index);
      pendingRef.current = next;
      setDraft(next);
    },
    onDrop: (event) => {
      if (!enabled || draggingRef.current === null) return;
      event.preventDefault();
      draggingRef.current = null;
      setDragging(null);
      const next = pendingRef.current ?? ordered.map(rowKey);
      pendingRef.current = null;
      // The pass-through above already produced the arrangement; submit it, and
      // do nothing at all when the row came back to where it started.
      if (draftSettled(next, ids)) {
        setDraft(null);
        return;
      }
      submit(next);
    },
    onDragEnd: () => {
      draggingRef.current = null;
      pendingRef.current = null;
      setDragging(null);
      // A drag abandoned outside the table leaves the pass-through arrangement
      // on screen with nothing submitted; restore the stored order.
      if (!busyRef.current) setDraft(null);
    },
    onHandleKey: (index) => (event) => {
      if (!enabled) return;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(index, index - 1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(index, index + 1);
      }
    },
  };
}

/**
 * **The table says which state it is in** (R76.8) — never an inert handle and no
 * explanation.
 *
 * Each message names the way out rather than only the obstacle: clear the sort,
 * or show everything on one page.
 */
function ReorderStatus({
  block,
  busy,
  error,
}: {
  block: ReorderBlock | null;
  busy: boolean;
  error: boolean;
}): ReactNode {
  if (error) {
    return (
      <p className="datatable__reorder field__error" role="alert">
        {t('common.reorder.failed')}
      </p>
    );
  }
  return (
    <p className="datatable__reorder muted" aria-live="polite">
      {busy
        ? t('common.reorder.saving')
        : block === 'sorted'
          ? t('common.reorder.blockedBySort')
          : block === 'paged'
            ? t('common.reorder.blockedByPaging')
            : block === 'scope'
              ? t('common.reorder.blockedByScope')
              : t('common.reorder.hint')}
    </p>
  );
}

/**
 * A header cell's contents: the sort control where the column offers one, and
 * plain text where it does not.
 *
 * Split out so the `sortKey` narrowing survives into the toggle callback — bound
 * once, here, rather than re-asserted with `!` at each use.
 */
function renderHeader<T>(
  column: Column<T>,
  sort: SortState | null,
  onSort: ((next: SortState | null) => void) | undefined,
): ReactNode {
  const by = column.sortKey;
  if (by === undefined || onSort === undefined) return column.header;
  const active = sort !== null && sort.by === by ? sort.dir : null;
  return (
    <SortHeader
      label={column.header}
      active={active}
      // R76.8's cycle: first press ascending, second descending, third ascending
      // again — never back to "unsorted", which a reader cannot tell apart from
      // ascending and which would make the third click look broken.
      onToggle={() => onSort({ by, dir: active === 'asc' ? 'desc' : 'asc' })}
    />
  );
}

/**
 * A sortable column's heading — **a real button inside the `<th>`**.
 *
 * Not a click handler on the cell: a button is focusable, reachable by keyboard,
 * announced as a control, and carries the platform's `:focus-visible` ring for
 * free. The cell keeps `aria-sort`, which is the column's property.
 *
 * The arrow is `aria-hidden`: the direction is already announced by `aria-sort`,
 * and reading "up arrow" aloud after "ascending" is reading punctuation.
 */
function SortHeader({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: 'asc' | 'desc' | null;
  onToggle: () => void;
}): ReactNode {
  return (
    <button type="button" className="datatable__sort" onClick={onToggle}>
      {label}
      <span aria-hidden="true" className="datatable__sort-arrow">
        {active === 'asc' ? '▲' : active === 'desc' ? '▼' : '⇅'}
      </span>
    </button>
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
