import { describe, expect, it } from 'vitest';

import SCHEDULES from './schedules.tsx?raw';

/**
 * **B1 (Owner-reported, 2026-09-15/2026-09-16) — تقويمي's قائمة reuses
 * الجدولة's own edit AND delete flows, both a pure frontend-reuse task.**
 *
 * `PATCH /admin/course-schedules/{id}`, Event `assertMayEdit` and Exam
 * `assertCanManage`/`assertScope` already tolerate a Teacher acting within
 * her own scope for EDIT; Revision 154 (2026-09-16) extends the identical
 * boundary to DELETE (`assertTeacherCurrentlyStaffs`/`assertMayEdit`/
 * `assertScope` again — never a wider grant), so both actions wire the SAME
 * `SchedulingDialog`/`deleteSchedulingItem`/`ConfirmDialog`/`classifyDeletion`
 * الجدولة's own قائمة already uses. Asserted against the source, matching
 * this directory's own `scheduling-delete.test.tsx` precedent: the property
 * under test is wiring, not a rendered `<dialog>`.
 */
const source = SCHEDULES.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('teacher قائمة gains تعديل AND حذف, matching الجدولة', () => {
  it('wires an edit action that opens the shared SchedulingDialog on the row', () => {
    expect(source).toMatch(/label: t\('common\.edit'\),\s*onSelect: \(r\) => setEditing\(r\)/);
  });

  it('renders SchedulingDialog in edit mode with the clicked row as item', () => {
    expect(source).toMatch(/editing \? \(\s*<SchedulingDialog\s*item=\{editing\}/);
  });

  it('wires a delete action through the shared confirm-then-classify sequence', () => {
    expect(source).toMatch(/label: t\('common\.delete'\),\s*danger: true,\s*onSelect: \(r\) => \{/);
    expect(source).toContain('await deleteSchedulingItem(deleted, accessToken);');
    expect(source).toContain('classifyDeletion(error)');
    expect(source).toContain('deletionNotice(outcome)');
  });

  it('clears a stale blocked reason before a DIFFERENT item is confirmed', () => {
    expect(source).toMatch(/setDeleteBlocked\(null\);\s*setDeleting\(r\);/);
  });

  it('offers the R82.5 notify decision after deleting an event/activity, never a class/exam', () => {
    expect(source).toMatch(
      /if \(deleted\.type === 'activity' \|\| deleted\.type === 'holiday'\) \{\s*setNotifying/,
    );
  });

  it('reloads both the catalogue and the raw rows after every save/delete', () => {
    // A saved edit or a successful delete can change staffing
    // (`teachingContexts` derives from `rows`) and the catalogue's own
    // displayed columns — both must refresh.
    const savedBlocks = source.match(/onSaved=\{\(\) => \{[\s\S]*?\}\}/g) ?? [];
    expect(savedBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of savedBlocks) {
      expect(block).toContain('void load();');
      expect(block).toContain('void loadCatalog();');
    }
    expect(source).toMatch(/await deleteSchedulingItem\(deleted, accessToken\);\s*setDeleting\(null\);\s*await load\(\);\s*await loadCatalog\(\);/);
  });
});
