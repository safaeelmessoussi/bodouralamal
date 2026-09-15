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
