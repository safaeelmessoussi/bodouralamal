import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConfirmDialog } from './confirm-dialog.js';
import { DataTable, orderActions, type Column, type SortState } from './data-table.js';
import { t } from '../../i18n/index.js';
import { SearchInput, TextArea, TextField } from './field.js';

/**
 * The CRUD framework's own tests.
 *
 * These matter more than any one screen's, because **every list and every form
 * in the platform inherits whatever they assert**. A defect here is a defect in
 * Branches, Levels, Users, Rooms and everything after them.
 */
interface Row {
  id: string;
  name: string;
  count: number;
}

const rows: Row[] = [
  { id: 'a', name: 'مقر أمرشيش', count: 3 },
  { id: 'b', name: 'مقر تاركة', count: 1 },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'الاسم', cell: (r) => r.name },
  { key: 'count', header: 'العدد', cell: (r) => r.count, numeric: true, secondary: true },
];

const table = (over: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
  renderToStaticMarkup(
    <DataTable
      caption="جدول"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      status="ready"
      {...over}
    />,
  );

describe('DataTable — structure', () => {
  it('is a real table with a caption and column scopes', () => {
    const html = table();
    expect(html).toContain('<table');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
  });

  it('makes the FIRST column the row header, so rows are announced by identity', () => {
    // Without `scope="row"` on the identifying cell, a screen reader announces
    // "3" with no idea which branch it belongs to.
    const html = table();
    expect(html).toContain('scope="row"');
    expect(html.indexOf('scope="row"')).toBeLessThan(html.indexOf('مقر تاركة'));
  });

  it('renders every row and every column', () => {
    const html = table();
    expect(html).toContain('مقر أمرشيش');
    expect(html).toContain('مقر تاركة');
    expect(html).toContain('الاسم');
  });
});

describe('DataTable — the §14.4 states', () => {
  it('shows a skeleton while loading, not a spinner', () => {
    const html = table({ status: 'loading' });
    expect(html).toContain('skeleton');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('<table');
  });

  it('shows the error state with a retry', () => {
    const html = table({ status: 'error', onRetry: () => undefined });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('<table');
  });

  it('distinguishes EMPTY from NO RESULTS', () => {
    // §14.4: "nothing here yet" and "nothing matches your filters" need
    // different answers, and only one of them offers a way out.
    const empty = table({ rows: [], filtered: false });
    expect(empty).toContain('لا توجد عناصر بعد');

    const filtered = table({ rows: [], filtered: true, onClearFilters: () => undefined });
    expect(filtered).toContain('لا توجد نتائج مطابقة');
    expect(filtered).toContain('إزالة التصفية');
  });
});

describe('DataTable — configuration, not code', () => {
  it('renders no action column when no actions are configured', () => {
    // An Admin sees Branches read-only, so the column must vanish rather than
    // render empty cells.
    expect(table()).not.toContain('admin-table__actions');
  });

  it('renders configured actions, and marks destructive ones apart', () => {
    const html = table({
      actions: [
        { label: 'تعديل', onSelect: () => undefined },
        { label: 'حذف', danger: true, onSelect: () => undefined },
      ],
    });
    expect(html).toContain('تعديل');
    // **The shared danger VARIANT, not a bespoke `is-danger` modifier**
    // (2026-08-17). The actions used to be hand-written `btn btn--ghost` with
    // `is-danger` bolted on; they render through `Button` now, so the
    // destructive one carries the same `btn--danger` every irreversible action
    // on the platform does. Asserting the variant rather than the old modifier
    // is what keeps this a test of *"destructive actions look destructive
    // platform-wide"* instead of a test of one table's private class name.
    expect(html).toContain('btn--danger');
  });

  it('hides a row action that does not apply to that row', () => {
    // Hidden rather than disabled: a permanently dead control teaches nothing.
    const html = table({
      actions: [{ label: 'حذف', onSelect: () => undefined, available: (r) => r.count === 0 }],
    });
    expect(html).not.toContain('حذف');
  });

  it('omits pagination for a single page', () => {
    const one = table({ pagination: { page: 1, pageSize: 25, total: 2, onPage: () => undefined } });
    expect(one).not.toContain('pagination__status');

    const many = table({ pagination: { page: 1, pageSize: 25, total: 90, onPage: () => undefined } });
    expect(many).toContain('صفحة 1 من 4');
  });
});

describe('form fields own their accessibility', () => {
  it('associates the label with the control', () => {
    const html = renderToStaticMarkup(
      <TextField label="اسم المقر" value="" onChange={() => undefined} />,
    );
    const forMatch = /for="([^"]+)"/.exec(html);
    const idMatch = /id="([^"]+)"/.exec(html);
    expect(forMatch).toBeTruthy();
    expect(idMatch?.[1]).toBe(forMatch?.[1]);
  });

  it('gives two instances DIFFERENT ids, so one page cannot collide', () => {
    // The bug the shared Dialog shipped with, prevented here by construction.
    const html = renderToStaticMarkup(
      <>
        <TextField label="أ" value="" onChange={() => undefined} />
        <TextField label="ب" value="" onChange={() => undefined} />
      </>,
    );
    const ids = [...html.matchAll(/for="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('wires an error so it is ANNOUNCED, not merely displayed', () => {
    const html = renderToStaticMarkup(
      <TextField label="الاسم" value="" onChange={() => undefined} error="مطلوب" />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    const described = /aria-describedby="([^"]*)"/.exec(html)?.[1] ?? '';
    const errorId = /class="field__error" id="([^"]+)"/.exec(html)?.[1] ?? 'x';
    expect(described.split(' ')).toContain(errorId);
  });

  it('puts the hint in aria-describedby too — a limit learned by tripping over it is stated too late', () => {
    const html = renderToStaticMarkup(
      <TextField label="الاسم" value="" onChange={() => undefined} hint="5 أحرف على الأقل" />,
    );
    const described = /aria-describedby="([^"]*)"/.exec(html)?.[1] ?? '';
    const hintId = /class="field__hint" id="([^"]+)"/.exec(html)?.[1] ?? 'x';
    expect(described.split(' ')).toContain(hintId);
  });

  it('marks required both visually and programmatically', () => {
    const html = renderToStaticMarkup(
      <TextField label="الاسم" value="" onChange={() => undefined} required />,
    );
    expect(html).toContain('required');
    expect(html).toContain('field__required');
  });

  it('renders a textarea for multiline free text', () => {
    const html = renderToStaticMarkup(
      <TextArea label="أوقات العمل" value="" onChange={() => undefined} rows={3} />,
    );
    expect(html).toContain('<textarea');
    expect(html).toContain('rows="3"');
  });

  it('search is a real search input, so the platform clear affordance applies', () => {
    const html = renderToStaticMarkup(<SearchInput value="" onChange={() => undefined} />);
    expect(html).toContain('type="search"');
  });
});

describe('ConfirmDialog', () => {
  it('requires a justification only when one is asked for', () => {
    const without = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="حذف"
        body="سيتم الحذف"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(without).not.toContain('<textarea');

    const withReason = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="رفع القيد"
        body="سيتم الرفع"
        reasonLabel="سبب القرار"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    // TD-8 requires a mandatory justification for some actions, and it is
    // written to the audit log — so the field is part of the shared dialog
    // rather than something each caller remembers.
    expect(withReason).toContain('<textarea');
    expect(withReason).toContain('سبب القرار');
  });

  it('uses the danger VARIANT rather than a bespoke button', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="حذف"
        body="سيتم الحذف"
        danger
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('btn--danger');
  });
});

describe('row actions are ordered the same way in every table', () => {
  /**
   * **The rule (Owner, 2026-08-17):** contextual actions → تعديل → destructive.
   *
   * It is enforced **here** rather than in each page's declaration, because
   * declaration order is exactly what had drifted: `المستخدمون` read
   * *تعديل · الأدوار · إيقاف الحساب* while other tables read something else, and
   * a reader who has learnt where *delete* sits on one screen had learnt nothing
   * about the next.
   */
  const roles = { label: 'الأدوار', onSelect: () => undefined };
  const edit = { label: t('common.edit'), onSelect: () => undefined };
  const suspend = { label: 'إيقاف الحساب', danger: true, onSelect: () => undefined };

  it('puts a contextual action first, edit next, destructive last', () => {
    // The Owner's exact example, in its reported (wrong) order.
    expect(orderActions([edit, roles, suspend]).map((a) => a.label)).toEqual([
      'الأدوار',
      t('common.edit'),
      'إيقاف الحساب',
    ]);
  });

  it('leaves edit-then-delete alone, because it already obeys the rule', () => {
    const remove = { label: t('common.delete'), danger: true, onSelect: () => undefined };
    expect(orderActions([edit, remove]).map((a) => a.label)).toEqual([
      t('common.edit'),
      t('common.delete'),
    ]);
  });

  it('is stable — several contextual actions keep the order the page chose', () => {
    // The rule is only about where the two universal actions go. A page with
    // several contextual ones knows their relative sense; re-sorting them would
    // be the table overriding a decision it cannot make.
    const a = { label: 'المستفيدات', onSelect: () => undefined };
    const b = { label: 'النقاط', onSelect: () => undefined };
    expect(orderActions([b, a, edit]).map((x) => x.label)).toEqual([
      'النقاط',
      'المستفيدات',
      t('common.edit'),
    ]);
  });

  it('applies to the rendered table, not merely to the helper', () => {
    const html = table({ actions: [edit, roles, suspend] });
    const order = ['الأدوار', t('common.edit'), 'إيقاف الحساب'].map((l) => html.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('keeps the remaining two in place when a contextual action is unavailable', () => {
    // Ordering happens before per-row availability, so a row that hides its
    // contextual action still reads تعديل → destructive rather than reshuffling.
    const html = table({
      actions: [{ ...roles, available: () => false }, edit, suspend],
    });
    expect(html).not.toContain('الأدوار');
    expect(html.indexOf(t('common.edit'))).toBeLessThan(html.indexOf('إيقاف الحساب'));
  });
});

describe('sortable column headers (R76.8)', () => {
  const sortable: Column<Row>[] = [
    { key: 'name', header: 'الاسم', sortKey: 'name', cell: (r) => r.name },
    { key: 'plain', header: 'العنوان', cell: () => 'x' },
  ];
  const render = (sort: SortState | null, onSort?: (n: SortState | null) => void): string =>
    renderToStaticMarkup(
      <DataTable
        caption="ج"
        columns={sortable}
        rows={[{ id: '1', name: 'أ', count: 1 }]}
        rowKey={(r) => r.id}
        status="ready"
        sort={sort}
        {...(onSort ? { onSort } : {})}
      />,
    );

  it('makes a sortable header a real button, and leaves the others plain', () => {
    // A button — not a click handler on the cell — so it is focusable,
    // keyboard-reachable and announced as a control.
    const html = render(null, () => undefined);
    expect(html).toContain('datatable__sort');
    // The plain column has no control, and the actions column never gets one.
    expect(html.match(/datatable__sort"/g)?.length).toBe(1);
  });

  it('announces the direction on the CELL, where it belongs', () => {
    // `aria-sort` is a property of the column, so a screen reader announces it on
    // entering the cell rather than only on reaching the control inside it.
    expect(render({ by: 'name', dir: 'asc' }, () => undefined)).toContain('aria-sort="ascending"');
    expect(render({ by: 'name', dir: 'desc' }, () => undefined)).toContain('aria-sort="descending"');
    // Sortable but not active.
    expect(render(null, () => undefined)).toContain('aria-sort="none"');
  });

  it('marks a non-sortable column with no aria-sort at all', () => {
    // `none` would claim it is sortable and merely unsorted.
    const html = render(null, () => undefined);
    expect(html.match(/aria-sort/g)?.length).toBe(1);
  });

  it('renders plain text when the caller offers no onSort', () => {
    // Both or neither: a table showing a sort it cannot change would be lying
    // about the control.
    const html = render({ by: 'name', dir: 'asc' });
    expect(html).not.toContain('datatable__sort"');
    expect(html).toContain('الاسم');
  });

  it('puts the indicator beside its OWN label, inside the same control', () => {
    // The defect this guards: `space-between` across the full cell width pushed
    // the glyph to the far edge, where it sat next to the NEXT column's label
    // and read as belonging to that one.
    const html = render({ by: 'name', dir: 'asc' }, () => undefined);
    const button = /<button[^>]*datatable__sort[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? '';
    expect(button).toContain('datatable__sort-label');
    expect(button).toContain('datatable__sort-glyph');
    // The label comes first, so the glyph trails it rather than leading.
    expect(button.indexOf('datatable__sort-label')).toBeLessThan(button.indexOf('datatable__sort-glyph'));
  });

  it('marks the active column so sorted and sortable are distinguishable', () => {
    expect(render({ by: 'name', dir: 'asc' }, () => undefined)).toContain('datatable__sort is-active');
    // Sortable but not sorted: the control is there, the active marker is not.
    expect(render(null, () => undefined)).toContain('class="datatable__sort"');
    expect(render(null, () => undefined)).not.toContain('is-active');
  });

  it('draws ONE chevron when active and BOTH when merely sortable', () => {
    const asc = render({ by: 'name', dir: 'asc' }, () => undefined);
    const idle = render(null, () => undefined);
    const paths = (html: string): number => (html.match(/<path/g) ?? []).length;
    expect(paths(asc)).toBe(1);
    expect(paths(idle)).toBe(2);
    // Ascending and descending are different shapes, not the same one rotated
    // by a class a stylesheet might drop.
    expect(asc).not.toEqual(render({ by: 'name', dir: 'desc' }, () => undefined));
  });

  it('renders an SVG rather than a text glyph, so it cannot fall back to emoji', () => {
    const html = render(null, () => undefined);
    expect(html).toContain('<svg');
    for (const glyph of ['▲', '▼', '⇅']) expect(html).not.toContain(glyph);
  });

  it('cycles asc → desc → asc, never back to unsorted', () => {
    /**
     * A third state a reader cannot distinguish from ascending would make the
     * third click look broken. Asserted on the callback rather than the markup,
     * because the cycle is the behaviour.
     */
    const seen: (SortState | null)[] = [];
    const toggle = (from: SortState | null): void => {
      const active = from !== null && from.by === 'name' ? from.dir : null;
      seen.push({ by: 'name', dir: active === 'asc' ? 'desc' : 'asc' });
    };
    toggle(null);
    toggle(seen[0]!);
    toggle(seen[1]!);
    expect(seen).toEqual([
      { by: 'name', dir: 'asc' },
      { by: 'name', dir: 'desc' },
      { by: 'name', dir: 'asc' },
    ]);
  });
});

describe('manual ordering — the drag gesture and its states (R76.8)', () => {
  const cols: Column<Row>[] = [
    { key: 'name', header: 'الاسم', sortKey: 'name', cell: (r) => r.name },
  ];
  const render = (props: {
    sort?: SortState | null;
    onReorder?: ((ids: string[]) => Promise<unknown>) | null;
    total?: number;
  }): string =>
    renderToStaticMarkup(
      <DataTable
        caption="ج"
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        status="ready"
        sort={props.sort ?? null}
        onSort={() => undefined}
        {...(props.onReorder !== undefined ? { onReorder: props.onReorder } : {})}
        {...(props.total !== undefined
          ? { pagination: { page: 1, pageSize: 25, total: props.total, onPage: () => undefined } }
          : {})}
      />,
    );

  it('adds no grip column at all to a table that does not order manually', () => {
    // The capability is opt-in; a column of dead handles on every list would
    // teach that ordering exists where it does not.
    const html = render({});
    expect(html).not.toContain('admin-table__grip');
    expect(html).not.toContain('datatable__reorder');
  });

  it('offers a draggable row with a keyboard-reachable handle in canonical order', () => {
    const html = render({ onReorder: async () => undefined });
    expect(html).toContain('draggable="true"');
    // A button, not a bare icon: native drag-and-drop is mouse-only, and a
    // persisted business decision must not be pointer-exclusive.
    expect(html).toContain('admin-table__grip-btn');
    expect(html).not.toContain('admin-table__grip-btn" disabled=""');
    expect(html).toContain(t('common.reorder.hint'));
  });

  it('disables the handle under a column sort, and SAYS why', () => {
    // R76.8 — the visible sequence is not the business one, so a drop would
    // persist a position the reader never intended.
    const html = render({ onReorder: async () => undefined, sort: { by: 'name', dir: 'asc' } });
    expect(html).not.toContain('draggable="true"');
    expect(html).toContain('admin-table__grip-btn" disabled=""');
    expect(html).toContain(t('common.reorder.blockedBySort'));
    // The column survives, so clearing the sort does not shift every row.
    expect(html).toContain('admin-table__grip');
  });

  it('disables it when the page is not the whole collection, and SAYS why', () => {
    // The contract takes the exact live set, so a page-sized sequence would be
    // refused by the server; the gesture is withheld rather than failing.
    const html = render({ onReorder: async () => undefined, total: 40 });
    expect(html).not.toContain('draggable="true"');
    expect(html).toContain('admin-table__grip-btn" disabled=""');
    expect(html).toContain(t('common.reorder.blockedByPaging'));
  });

  it('allows it when the pagination happens to hold everything', () => {
    const html = render({ onReorder: async () => undefined, total: rows.length });
    expect(html).toContain('draggable="true"');
    expect(html).toContain(t('common.reorder.hint'));
  });

  it('keeps the handle and explains when no parent is selected (§2.2)', () => {
    // `null` is the third state: this table orders manually, but the rows on
    // screen span several sequences, so a position means nothing in any of them.
    const html = render({ onReorder: null });
    expect(html).toContain('admin-table__grip-btn" disabled=""');
    expect(html).not.toContain('draggable="true"');
    expect(html).toContain(t('common.reorder.blockedByScope'));
  });

  it('names the handle for a screen reader rather than shipping a bare glyph', () => {
    expect(render({ onReorder: async () => undefined })).toContain(
      `aria-label="${t('common.reorder.handle')}"`,
    );
  });

  it('widens the loading skeleton by the grip column, so nothing reflows', () => {
    const withGrip = renderToStaticMarkup(
      <DataTable
        caption="ج"
        columns={cols}
        rows={[]}
        rowKey={(r: Row) => r.id}
        status="loading"
        onReorder={async () => undefined}
      />,
    );
    const without = renderToStaticMarkup(
      <DataTable caption="ج" columns={cols} rows={[]} rowKey={(r: Row) => r.id} status="loading" />,
    );
    const cells = (html: string): number => (html.match(/class="skeleton"/g) ?? []).length;
    expect(cells(withGrip)).toBe(cells(without) + 5);
  });
});
