import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DataTable, type Column } from './data-table.js';
import { ar } from '../../i18n/ar.js';

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  { key: 'name', header: 'الاسم الشخصي', sortKey: 'first_name', cell: (r) => r.name },
  { key: 'family', header: 'الاسم العائلي', sortKey: 'last_name', cell: (r) => r.name },
];

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node);

/**
 * **Zero rows keeps the columns** (Owner, 2026-08-30).
 *
 * The empty and no-results states used to be rendered *instead of* the table,
 * so a management page with nothing in it showed a paragraph and no columns —
 * the reader could not see what the page would hold, could not reach a sort
 * control, and on a filtered table could not tell an empty dataset from a
 * filter that had excluded everything.
 *
 * Guarded on the shared component, once, rather than on each of the twenty-odd
 * pages that render one: this is `DataTable`'s behaviour and every caller
 * inherits it. That is also why the fix belonged here and not on a page.
 */
describe('an empty DataTable still shows its header', () => {
  const empty = html(
    <DataTable
      caption="جدول"
      columns={columns}
      rows={[]}
      rowKey={(r) => r.id}
      status="ready"
      sort={{ by: 'first_name', dir: 'asc' }}
      onSort={() => {}}
    />,
  );

  it('renders a real table with both column headers', () => {
    expect(empty).toContain('<table');
    expect(empty).toContain('الاسم الشخصي');
    expect(empty).toContain('الاسم العائلي');
  });

  it('keeps the sort controls reachable', () => {
    // A header that vanishes takes its control and its `aria-sort`
    // announcement with it, so an empty view cannot be reordered before the
    // rows arrive.
    expect(empty).toContain('aria-sort');
    expect((empty.match(/<button/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('puts the message INSIDE the body, spanning every column', () => {
    const withActions = html(
      <DataTable
        caption="جدول"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        status="ready"
        actions={[{ label: 'تعديل', onSelect: () => {} }]}
      />,
    );
    // Two columns plus the actions column. A short `colSpan` would leave the
    // message under one heading instead of across the table.
    // Case-insensitive: `renderToStaticMarkup` emits the React property name,
    // and HTML attribute names are case-insensitive anyway. Asserting the exact
    // spelling would pin the renderer rather than the behaviour.
    expect(withActions.toLowerCase()).toContain('colspan="3"');
    expect(withActions).toContain('admin-table__empty-row');
  });

  it('still distinguishes «nothing here» from «nothing matches»', () => {
    // Different situations with different next actions, so a filtered empty
    // table must not claim the dataset is empty.
    expect(empty).toContain(ar.states.empty);
    const filtered = html(
      <DataTable
        caption="جدول"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        status="ready"
        filtered
      />,
    );
    expect(filtered).toContain(ar.states.noResults);
    expect(filtered).toContain('<table');
  });

  it('does NOT show the header while loading or failed — those are not empty', () => {
    // A skeleton already stands in for the table, and an error state must not
    // present columns as though the read had succeeded.
    const loading = html(
      <DataTable caption="ج" columns={columns} rows={[]} rowKey={(r) => r.id} status="loading" />,
    );
    expect(loading).not.toContain('<table');
    const failed = html(
      <DataTable caption="ج" columns={columns} rows={[]} rowKey={(r) => r.id} status="error" />,
    );
    expect(failed).not.toContain('<table');
  });
});
