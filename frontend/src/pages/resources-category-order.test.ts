import { describe, expect, it } from 'vitest';

import RESOURCES from './resources.tsx?raw';
import PRODUCTION_SEED from '../../../backend/prisma/seed/production.ts?raw';

/**
 * **The library's category progression must name categories that exist.**
 *
 * ## The defect this exists for
 *
 * `resources.tsx` sorts categories by a hard-coded progression — adult → teen →
 * child — with anything unrecognised sorted last. It listed `الكبار /
 * اليافعون / الطفل`, the sex-neutral forms R27's migration introduced, while
 * the §15.1 seed creates `المرأة / اليافعات / الطفل`.
 *
 * So **two of the three never matched a real row**, both ranked equal-last with
 * every other unrecognised category, and the ordering the constant exists to
 * impose was silently absent. Nothing failed, because **`categoryRank` had no
 * test at all** — a constant that matches nothing produces no error, only a
 * quietly wrong order.
 *
 * ## Why this is asserted against the SEED rather than against three literals
 *
 * Pinning the three names would pin today's answer and drift the same way the
 * original did. The property is *the page's progression names the categories
 * the platform actually creates*, so both halves are read from source and
 * compared. If somebody changes either one alone, this fails.
 */
const seededCategories = (): string[] => {
  const block = /const CATEGORIES = \[([\s\S]*?)\n\] as const;/.exec(PRODUCTION_SEED)?.[1];
  expect(block, 'the production seed must declare CATEGORIES').toBeDefined();
  return [...block!.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]!);
};

const pageOrder = (): string[] => {
  const list = /const CATEGORY_ORDER = \[([^\]]*)\]/.exec(RESOURCES)?.[1];
  expect(list, 'the library must declare CATEGORY_ORDER').toBeDefined();
  return [...list!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
};

describe('the library orders the categories the platform actually seeds', () => {
  it('names exactly the seeded categories, in the association progression', () => {
    // Same set, and the seed's own `displayOrder` is the progression, so the
    // two lists must agree element for element.
    expect(pageOrder()).toEqual(seededCategories());
  });

  it('leaves no entry that matches no seeded category', () => {
    // The failure mode directly: an entry nothing can match ranks equal-last
    // with the genuinely unrecognised, which is the ordering silently absent.
    const seeded = new Set(seededCategories());
    expect(pageOrder().filter((name) => !seeded.has(name))).toEqual([]);
  });
});
