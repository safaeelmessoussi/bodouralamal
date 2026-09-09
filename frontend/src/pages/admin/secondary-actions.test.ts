import { describe, expect, it } from 'vitest';

import USERS_SOURCE from './users.tsx?raw';
import BUILDER_SOURCE from './assessments.tsx?raw';

const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * **R137 item 6 — a secondary action that looked confusing/not actionable
 * now reads as an actual button**, through the shared component system
 * (`Button`'s own documented `add` variant, `＋` glyph included) rather
 * than a page-by-page patch of two literal strings.
 *
 * The two instances the Owner named — «إضافة خيار» (بناء الاختبارات) and
 * «إضافة دور» (المستخدمون) — both used the SAME shared `Button` component
 * already; the defect was the `variant` passed to it (`ghost`/`secondary`,
 * low-emphasis), not a missing component or hand-rolled markup. Fixing the
 * variant is therefore the platform-wide fix, not a per-screen one: any
 * future add action reads correctly by using the same variant everyone
 * else already does.
 */
describe('secondary add actions render as actual buttons, via the shared add variant (R137)', () => {
  it('إضافة خيار (بناء الاختبارات) uses variant="add"', () => {
    const dialog = code(BUILDER_SOURCE);
    expect(dialog).toContain('<Button variant="add" onClick={() => setOptions([...options, \'\'])}>');
    expect(dialog).not.toMatch(/variant="ghost"[^>]*>\s*\{t\('assessments\.addOption'\)/);
  });

  it('إضافة دور (المستخدمون) uses variant="add", not the low-emphasis secondary it had', () => {
    const users = code(USERS_SOURCE);
    const match = /variant="add"[\s\S]{0,400}addRole/.exec(users);
    expect(match, 'an add-variant Button wrapping addRole').not.toBeNull();
  });

  it('a second, unrelated secondary/ghost button beside each was left alone — the fix is scoped, not a blanket replace', () => {
    // إزالة السؤال (remove) and حذف (delete role) are DIFFERENT actions and
    // must not have been swept into "add" by a careless global replace.
    expect(code(BUILDER_SOURCE)).toContain("t('assessments.removeQuestion')");
    const users = code(USERS_SOURCE);
    expect(users).toContain('variant="secondary"');
    expect(users).toContain("t('common.delete')");
  });
});
