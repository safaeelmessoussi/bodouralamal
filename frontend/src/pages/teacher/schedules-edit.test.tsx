import { describe, expect, it } from 'vitest';

import SCHEDULES from './schedules.tsx?raw';

/**
 * **B1 (Owner-reported, 2026-09-15) — تقويمي's قائمة reuses الجدولة's own
 * edit dialog and server grant for تعديل, but never wires حذف.**
 *
 * `PATCH /admin/course-schedules/{id}`, Event `assertMayEdit` and Exam
 * `assertCanManage`/`assertScope` already tolerate a Teacher acting within
 * her own scope, so تعديل is a pure frontend-reuse task: the same
 * `SchedulingDialog` الجدولة's own قائمة already opens in edit mode.
 *
 * حذف is different: class deletion stays Teacher ⊘ by Revision 140 §2's own
 * text, Event deletion is Admin-only by Revision 43/72/R71.3, and Exam
 * deletion is Admin-and-above by R70.4 (no `created_by` column exists to
 * express "her own"). Wiring حذف here unmodified would 403 at the server on
 * every row and would silently attempt to reverse three separately-ratified
 * boundaries rather than ask — so this list must never gain a حذف action
 * until the Document Owner decides otherwise. Asserted against the source,
 * matching this directory's own `scheduling-delete.test.tsx` precedent: the
 * property under test is wiring, not a rendered `<dialog>`.
 */
const source = SCHEDULES.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('teacher قائمة gains تعديل, matching الجدولة, but never حذف', () => {
  it('wires an edit action that opens the shared SchedulingDialog on the row', () => {
    expect(source).toMatch(/label: t\('common\.edit'\),\s*onSelect: \(r\) => setEditing\(r\)/);
  });

  it('renders SchedulingDialog in edit mode with the clicked row as item', () => {
    expect(source).toMatch(/editing \? \(\s*<SchedulingDialog\s*item=\{editing\}/);
  });

  it('never wires a delete action — no common.delete label, no setDeleting', () => {
    expect(source).not.toContain("t('common.delete')");
    expect(source).not.toContain('setDeleting');
  });

  it('reloads both the catalogue and the raw rows after a save, on both dialogs', () => {
    // A saved edit can change staffing (teachingContexts derives from `rows`)
    // and the catalogue's own displayed columns — both must refresh.
    const savedBlocks = source.match(/onSaved=\{\(\) => \{[\s\S]*?\}\}/g) ?? [];
    expect(savedBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of savedBlocks) {
      expect(block).toContain('void load();');
      expect(block).toContain('void loadCatalog();');
    }
  });
});
