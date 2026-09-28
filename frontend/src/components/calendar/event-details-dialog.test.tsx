import { describe, expect, it } from 'vitest';

import DIALOG_SOURCE from './event-details-dialog.tsx?raw';

/**
 * `canManage` — the public `/calendar` page must never offer the "ربط
 * اختبار" management action, regardless of which role happens to be signed
 * in while browsing it (Owner-reported, 2026-09-15). Source-pinning, like
 * `scheduling-*.test.tsx` elsewhere: the gate is a one-line boolean AND that
 * a live render would need a mocked `fetchSessionDetails` network call and
 * an `ActiveRoleProvider` to exercise meaningfully, while the wiring itself
 * — that the prop actually reaches and narrows `canLinkExam` — is exactly
 * what a plain render cannot distinguish from the previous, role-only gate.
 */
const source = DIALOG_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the public calendar cannot offer staff management actions', () => {
  it('accepts a canManage prop, defaulting to true (every existing caller is unaffected)', () => {
    expect(source).toMatch(/canManage\s*=\s*true/);
  });

  it('narrows canLinkExam by canManage, not by role alone', () => {
    expect(source).toContain('const canLinkExam = canManage && activeRoles.some');
  });

  it('threads canManage from the dialog down into OccurrenceMaterials', () => {
    expect(source).toContain(
      '<OccurrenceMaterials key={occurrence.id} occurrence={occurrence} canManage={canManage} />',
    );
  });
});

/**
 * R176 §3 (Owner-reported, 2026-09-28) — the dialog names the group and the
 * circle a class is for, on the same footing as its Category and Level, and
 * stops repeating one of them a line below as «المعنيون». Source-pinned for
 * the same reason as above: the rendering is a `dt`/`dd` pair per dimension,
 * and what matters is that each dimension has its own row.
 */
describe('the dialog names all five dimensions', () => {
  it('renders a row for the groups and one for the circles, from the plural fields', () => {
    expect(source).toContain("t('calendar.detailsGroup')");
    expect(source).toContain("t('calendar.detailsCircle')");
    expect(source).toContain('occurrence?.administrative_group_names');
    expect(source).toContain('occurrence?.teaching_group_names');
  });

  it('shows «المعنيون» only when it says something no dimension row already does', () => {
    expect(source).toContain('audienceAlreadyNamed.has(occurrence.audience_label)');
    expect(source).not.toContain('<dd>{occurrence.audience_label}</dd>');
  });
});
