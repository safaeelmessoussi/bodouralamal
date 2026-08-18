/**
 * **The manual-ordering rules, as pure functions** (R76.8).
 *
 * They live outside `DataTable` for one reason: this project's component tests
 * render with `renderToStaticMarkup` — no jsdom, no layout engine and no events
 * — so a rule expressed only inside a drag handler is a rule no test can reach.
 * Extracted here, each one is directly testable, and the component keeps only
 * the parts that genuinely need React.
 */

/** Why manual ordering is unavailable, or `null` when it is available. */
export type ReorderBlock = 'sorted' | 'paged' | 'scope';

/**
 * Whether a table may be reordered right now, and if not, why.
 *
 * **Two conditions, both structural** (R76.8):
 *
 * * **`sorted`** — the table is under a temporary column sort, so the visible
 *   sequence is not the business one. Dropping a row into it would persist a
 *   position the reader never intended, and *"the order you see is not the order
 *   you would save"* is not something a drop gesture can say.
 * * **`paged`** — the visible rows are not the whole collection. The reorder
 *   contract takes the **exact live set** (R76.4), so a page-sized sequence is
 *   refused by the server; offering the gesture would be offering a request that
 *   cannot succeed.
 * * **`scope`** — the collection's order is scoped to a parent (§2.2: a
 *   Category's Levels, a Level's groups) and no parent is selected. The rows on
 *   screen then span several sequences, and a position in the mixed list means
 *   nothing in any of them.
 *
 * All three are reported so the table can **say which state it is in** rather
 * than quietly rendering an inert handle. `scope` is checked first because it is
 * the one the reader must resolve before either of the others can even apply.
 */
export function reorderBlock(
  sorted: boolean,
  visible: number,
  total: number | undefined,
  scoped = true,
): ReorderBlock | null {
  if (!scoped) return 'scope';
  if (sorted) return 'sorted';
  // `undefined` total means an unpaginated collection — every row is present by
  // construction, which is the case for the taxonomy screens.
  if (total !== undefined && total > visible) return 'paged';
  return null;
}

/**
 * Moves the item at `from` to `to`, returning a new array.
 *
 * This is the **only** place a position is computed. R76.4 puts the arithmetic
 * on the server precisely so no client invents `display_order` values; what a
 * client may compute is the *sequence*, which is this.
 */
export function moveTo<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * Whether an optimistic draft has been confirmed by the rows that came back.
 *
 * The draft is held **until the server's answer agrees with it**, not until the
 * request resolves: clearing on resolve would flash the old order for however
 * long the page's refetch takes, which reads as the drop having failed.
 */
export function draftSettled(draft: readonly string[], incoming: readonly string[]): boolean {
  return draft.length === incoming.length && draft.every((id, i) => id === incoming[i]);
}
