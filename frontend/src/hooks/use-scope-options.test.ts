import { describe, expect, it } from 'vitest';

import { facetsOf, reconcile, type FacetFacts, type FacetOptions, type FacetValue } from './scope-facets.js';
import HOOK from './use-scope-options.ts?raw';
import SELECTORS from '../components/scope/scope-selectors.tsx?raw';
import CONTENT from '../pages/content.tsx?raw';

/** Every page, so the mode-agreement guard below sees all of them. */
const PAGES = import.meta.glob('/src/pages/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Comments are not code — the idiom the scheduling parity guard established. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **SRS Revision 198 §3 — every selector narrows every other one.** The rules
 * live in `scope-facets.ts` as pure functions, so they are tested as rules:
 * the curriculum below is two Categories, three Levels, three Subjects.
 *
 *   C1: L1 (S1, Surahs 1 and 2), L2 (S2, Surah 3) — S3 taught to C1 whole
 *   C2: L3 (S1, Surah 2)
 *   S1 is taught by Surah; S2 and S3 are not.
 */
const FACTS: FacetFacts = {
  categoryIds: ['C1', 'C2'],
  levels: [
    { id: 'L1', category_id: 'C1' },
    { id: 'L2', category_id: 'C1' },
    { id: 'L3', category_id: 'C2' },
  ],
  subjectIds: ['S1', 'S2', 'S3', 'S9'],
  levelSubjects: new Map([
    ['L1', ['S1']],
    ['L2', ['S2']],
    ['L3', ['S1']],
  ]),
  categorySubjects: new Map([['C1', ['S3']]]),
  levelSurahIds: { L1: [1, 2], L2: [3], L3: [2] },
  subjectsBySurah: new Set(['S1']),
  groups: [
    { id: 'G1', level_id: 'L1', branch_id: 'B1' },
    { id: 'G2', level_id: 'L1', branch_id: 'B2' },
    { id: 'G3', level_id: 'L3', branch_id: 'B1' },
  ],
};
const FORM: FacetOptions = { subjectsUnscoped: false, offerWholeCategory: false, sentinels: {} };
const FILTER: FacetOptions = { ...FORM, subjectsUnscoped: true };
const NONE: FacetValue = { categoryId: '', levelId: '', subjectId: '', branchId: '', surahId: '', groupId: '' };
const v = (patch: Partial<FacetValue>): FacetValue => ({ ...NONE, ...patch });

describe('R198 §3 — the lists narrow each other, whichever is chosen first', () => {
  it('with nothing chosen, a form offers every Subject some Level teaches, a filter every Subject', () => {
    expect(facetsOf(NONE, FACTS, FORM).subjectId).toEqual(['S1', 'S2', 'S3']);
    expect(facetsOf(NONE, FACTS, FILTER).subjectId).toEqual(['S1', 'S2', 'S3', 'S9']);
    expect(facetsOf(NONE, FACTS, FORM).levelId).toEqual(['L1', 'L2', 'L3']);
    expect(facetsOf(NONE, FACTS, FORM).surahId).toEqual(['1', '2', '3']);
  });

  it('a Subject chosen FIRST narrows the Levels and Categories to those that teach it', () => {
    const f = facetsOf(v({ subjectId: 'S2' }), FACTS, FORM);
    expect(f.levelId).toEqual(['L2']);
    expect(f.categoryId).toEqual(['C1']);
    // …and a Subject not taught by Surah has no Surah to offer.
    expect(f.surahId).toEqual([]);
  });

  it('a Level offers its own Subjects and its Category’s (R178 §1), and its syllabus', () => {
    const f = facetsOf(v({ levelId: 'L1', categoryId: 'C1' }), FACTS, FORM);
    expect(f.subjectId).toEqual(['S1', 'S3']);
    expect(f.surahId).toEqual(['1', '2']);
  });

  it('a Surah narrows the Levels to those whose syllabus holds it, and the Subjects to Surah ones', () => {
    const f = facetsOf(v({ surahId: '2' }), FACTS, FORM);
    expect(f.levelId).toEqual(['L1', 'L3']);
    expect(f.subjectId).toEqual(['S1']);
    expect(f.categoryId).toEqual(['C1', 'C2']);
  });

  it('a Category narrows the Levels, Subjects and Surahs — and is not itself narrowed by its Level', () => {
    const f = facetsOf(v({ categoryId: 'C2' }), FACTS, FORM);
    expect(f.levelId).toEqual(['L3']);
    expect(f.subjectId).toEqual(['S1']);
    expect(f.surahId).toEqual(['2']);
    // Another Category stays choosable with a Level chosen: that is how it changes.
    expect(facetsOf(v({ categoryId: 'C1', levelId: 'L1' }), FACTS, FORM).categoryId).toEqual(['C1', 'C2']);
  });

  it('«كل مستويات الفئة» travels in the Level slot and offers the Subjects taught to the Category whole', () => {
    const whole = { ...FORM, offerWholeCategory: true };
    expect(facetsOf(NONE, FACTS, whole).levelId).toEqual(['category:C1', 'category:C2', 'L1', 'L2', 'L3']);
    expect(facetsOf(v({ levelId: 'category:C1' }), FACTS, whole).subjectId).toEqual(['S3']);
  });

  it('groups are narrowed by Level, Branch and Category, whichever are chosen', () => {
    expect(facetsOf(NONE, FACTS, FORM).groupId).toEqual(['G1', 'G2', 'G3']);
    expect(facetsOf(v({ branchId: 'B1' }), FACTS, FORM).groupId).toEqual(['G1', 'G3']);
    expect(facetsOf(v({ levelId: 'L1', branchId: 'B2' }), FACTS, FORM).groupId).toEqual(['G2']);
    expect(facetsOf(v({ categoryId: 'C2' }), FACTS, FORM).groupId).toEqual(['G3']);
  });

  it('a declared sentinel («كل المواد», R195) constrains nothing', () => {
    const opts = { ...FORM, sentinels: { subjectId: ['*'] } };
    expect(facetsOf(v({ subjectId: '*' }), FACTS, opts).levelId).toEqual(['L1', 'L2', 'L3']);
  });
});

describe('R198 §3 — one change, and the others follow', () => {
  it('a Level sets its Category', () => {
    expect(reconcile(NONE, 'levelId', 'L3', FACTS, FORM).categoryId).toBe('C2');
    expect(reconcile(NONE, 'levelId', 'category:C1', FACTS, { ...FORM, offerWholeCategory: true }).categoryId).toBe('C1');
  });

  it('another Category clears a Level of the old one, and keeps a Subject it still teaches', () => {
    const next = reconcile(v({ categoryId: 'C1', levelId: 'L1', subjectId: 'S1' }), 'categoryId', 'C2', FACTS, FORM);
    expect(next).toMatchObject({ categoryId: 'C2', levelId: '', subjectId: 'S1' });
  });

  it('clearing the Category retracts its Level', () => {
    expect(reconcile(v({ categoryId: 'C1', levelId: 'L1' }), 'categoryId', '', FACTS, FORM).levelId).toBe('');
  });

  it('moving to a Level that does not teach the Subject clears the Subject and the Surah', () => {
    const next = reconcile(v({ categoryId: 'C1', levelId: 'L1', subjectId: 'S1', surahId: '1' }), 'levelId', 'L2', FACTS, FORM);
    expect(next).toMatchObject({ levelId: 'L2', subjectId: '', surahId: '' });
  });

  it('clearing the Level keeps a Subject that is still offered (a widened question)', () => {
    expect(reconcile(v({ categoryId: 'C1', levelId: 'L1', subjectId: 'S1' }), 'levelId', '', FACTS, FILTER).subjectId).toBe('S1');
  });

  it('a group sets its Level, Category and Branch', () => {
    expect(reconcile(NONE, 'groupId', 'G3', FACTS, FORM)).toMatchObject({ levelId: 'L3', categoryId: 'C2', branchId: 'B1' });
  });

  it('another Branch clears a group of a different premises', () => {
    expect(reconcile(v({ levelId: 'L1', categoryId: 'C1', branchId: 'B1', groupId: 'G1' }), 'branchId', 'B2', FACTS, FORM).groupId).toBe('');
  });
});

describe('the shared hook and selectors', () => {
  it('NEVER reaches for an Admin reference read — that WAS the defect (NEW D)', () => {
    /**
     * `/admin/levels`, `/admin/subjects`, `/admin/academic-years` and
     * `/admin/levels/{id}/subjects` all answer **403** for a مؤطِّرة by design
     * (R30), and this hook is shared by every screen with a scope selector —
     * so one of these calls reappearing breaks a Teacher workflow everywhere,
     * silently. The narrow read is `/me/scope-options` (R93.4's pattern).
     */
    const c = code(HOOK);
    for (const forbidden of [
      'listLevels(',
      'listSubjects(',
      'listAcademicYears(',
      'listLevelSubjects(',
      'listCategories(',
      'listBranches(',
    ]) {
      expect(c, `${forbidden} is Admin-only and must not return to the shared hook`).not.toContain(forbidden);
    }
    expect(c).toContain('fetchScopeOptions(token)');
  });

  it('derives every list during render, never from an effect (the seeded-Subject race)', () => {
    // As an effect, `options` was once memoised from an empty list in the
    // very commit `ready` flipped true, and rule 2 cleared a seeded Subject.
    expect(code(HOOK)).toContain('const facets = useMemo(() => facetsOf(');
    expect(code(HOOK)).not.toContain('setSubjects(');
  });

  it('is driven by `mode`, and defaults to the form one', () => {
    expect(code(HOOK)).toMatch(/mode\s*=\s*'form'/);
    expect(code(HOOK)).toContain("const subjectsUnscoped = mode === 'filter'");
  });

  it('every page tells the HOOK the same mode it tells the SELECTORS', () => {
    // Saying it twice and differently — `mode="filter"` on the selectors and
    // nothing on the hook — is what this guards.
    const offenders = Object.entries(PAGES)
      .filter(([, text]) => {
        const c = code(text);
        if (!/mode=["']filter["']/.test(c)) return false;
        return !/useScopeOptions\([\s\S]*?mode:\s*'filter'/.test(c);
      })
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('no selector waits for another (R198 §3 — «يُرجى اختيار المستوى أولًا» withdrawn)', () => {
    expect(code(SELECTORS)).not.toContain('chooseFirst');
    expect(code(SELECTORS)).not.toContain('REQUIRES');
  });

  it('the content library declares itself a filter, and its «بدون فرع» a sentinel', () => {
    expect(code(CONTENT)).toContain("mode: 'filter'");
    expect(code(CONTENT)).toContain('sentinels: { branchId: [GLOBAL] }');
  });

  it('reads the facts through a ref, so `set` stays referentially stable', () => {
    expect(code(HOOK)).toContain('factsRef.current');
  });
});

describe('R172 §1 — «كل مستويات الفئة» in the Level slot', () => {
  it('travels as `category:<id>`, and defaults as any of its Levels does', async () => {
    const { wholeCategoryValue, wholeCategoryOf, defaultVisibilityForLevel } = await import(
      './use-scope-options.js'
    );
    expect(wholeCategoryOf(wholeCategoryValue('c1'))).toBe('c1');
    expect(wholeCategoryOf('a-real-level-id')).toBeNull();
    const levels = [
      { id: 'l1', category_id: 'c1', default_visibility: 'private' },
      { id: 'l2', category_id: 'c2', default_visibility: 'public' },
    ] as never;
    expect(defaultVisibilityForLevel(levels, wholeCategoryValue('c1'))).toBe('private');
    expect(defaultVisibilityForLevel(levels, wholeCategoryValue('c9'))).toBeNull();
  });
});
