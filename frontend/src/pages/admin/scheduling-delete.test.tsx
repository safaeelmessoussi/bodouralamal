import { describe, expect, it } from 'vitest';

import SCHEDULING from './scheduling.tsx?raw';

/**
 * **Deleting a scheduling item must never leave the confirm dialog open with
 * no explanation** (Owner-reported defect, 2026-09-14).
 *
 * `confirmDelete`'s catch block used to call `setNotice(...)` on every
 * failure and nothing else — no `setDeleting(null)`, no `blocked` state. The
 * dialog stayed open showing the SAME "are you sure you want to delete
 * {title}?" prompt with its حذف button still live, while the actual
 * explanation appeared as an unrelated notice elsewhere on the page. To a
 * reader, that reads as "the dialog never closed" — and clicking حذف again
 * (the only visible next step) repeated the same refused request.
 *
 * `scheduling.tsx`'s two sibling admin screens — `groups.tsx`, notably —
 * already migrated to the shared `classifyDeletion`/`deletionNotice`
 * contract (`lib/deletion-outcome.ts`) months earlier; this page was the one
 * screen that never did. Asserted against the source, matching this
 * directory's `enrolment-period.test.ts` precedent: the property under test
 * is wiring (does the catch path close the dialog and use the shared
 * classifier), which a render test cannot see without a live session, four
 * network reads and a real `<dialog>` — and even then would not prove the
 * absence of the old bespoke path.
 */
const source = SCHEDULING.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the delete confirmation dialog never hangs open unexplained', () => {
  it('uses the shared deletion classifier, not a bespoke ad-hoc catch', () => {
    expect(source).toContain('classifyDeletion');
    expect(source).toContain('deletionNotice');
  });

  it('keeps the exam-evidence refusal — but IN the dialog, not as a floating notice', () => {
    // STUDENT_EVIDENCE_EXISTS still needs its own sentence (the two counts
    // the generic classifier cannot know); it must reach the dialog's own
    // `blocked` slot, the same rule AZ.1 every other blocked deletion follows.
    expect(source).toContain('STUDENT_EVIDENCE_EXISTS');
    expect(source).toContain('setDeleteBlocked(');
    expect(source).toMatch(/deleteBlocked \? \{ blocked: deleteBlocked \} : \{\}/);
  });

  it('closes the dialog for every OTHER outcome — nothing is left open unexplained', () => {
    // Every path out of the catch block other than the evidence guard must
    // reach setDeleting(null); the old code never did.
    expect(source).toMatch(/const outcome = classifyDeletion\(error\);\s*setDeleting\(null\);/);
  });

  it('clears a stale blocked reason before a DIFFERENT item is confirmed', () => {
    // Reopening the dialog on a new row must not paint over it with the
    // previous row's refusal.
    expect(source).toMatch(/setDeleteBlocked\(null\);\s*setDeleting\(r\);/);
  });
});
