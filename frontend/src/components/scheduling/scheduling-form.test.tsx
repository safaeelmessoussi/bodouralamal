import { describe, expect, it } from 'vitest';

import SOURCE from './scheduling-form.tsx?raw';

/**
 * «إضافة عنصر» — نوع العنصر looked pre-selected as «حصة دراسية» on a fresh
 * create, and saving anyway refused with «اختاري نوع العنصر» (Owner-reported,
 * 2026-09-15). The select's bound value (`selected?.id ?? ''`) is genuinely
 * `''` until a row is chosen, but with no `placeholder`, an unmatched `''`
 * makes the browser fall back to displaying the FIRST real option instead of
 * an empty one — the exact recurring defect this house's `SelectField` names
 * in its own contract (an explicit `placeholder` is the only thing that
 * renders the empty `<option>`).
 *
 * Source-pinning: the browser's own native fallback behaviour for an
 * unmatched `<select>` value is not something jsdom reproduces faithfully
 * enough to assert on with a live render — the fix is the presence of the
 * prop itself.
 */
const source = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('نوع العنصر never looks pre-selected when nothing is chosen', () => {
  it('passes an explicit placeholder to the catalogue SelectField', () => {
    const picker = source.slice(
      source.indexOf("value={selected?.id ?? ''}"),
      source.indexOf('options={offered.map'),
    );
    expect(picker).toContain("placeholder={t('scheduling.itemTypePlaceholder')}");
  });
});
