import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConfirmDialog } from './confirm-dialog.js';
import { DataTable, type Column } from './data-table.js';
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
    expect(html).toContain('is-danger');
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
