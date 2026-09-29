import type { PublicProgramCategory, PublicProgramLevel } from '../../adapters/programs.js';

/**
 * **«برامجنا التعليمية» as a journey** (SRS Revision 180) — the one model both
 * the walked illustration and the «عرض جميع البرامج» text view read, built
 * from `GET /programs` and nothing else. Nothing here names a Category, a
 * Level or an age: a Category added, removed or reordered on «الفئات», a
 * Level moved or re-aged on «المستويات», reaches both views unchanged.
 *
 * The journey climbs: from the first step of the youngest Category, step by
 * step through that Category, to its graduation, on to the next Category's
 * first step, and so on to the summit. Two ways in exist beside it (§5):
 *
 * - **a direct entry** into a Category other than the first — a learner who
 *   did not walk the previous Category joins at its FIRST step, and never at
 *   a later one; drawn as prints arriving from outside the road;
 * - **a preparatory programme** (§6; `journey_role = preparatory`, a column,
 *   never a name) — such as a literacy programme — which leads INTO the
 *   Category's first step and is not required of a learner who enters there.
 */
export interface JourneyStep {
  kind: 'step';
  level: PublicProgramLevel;
  category: JourneyCategory;
  /** 1-based position among the Category's ordinary steps. */
  position: number;
  /** The last step of its Category — the graduation follows it. */
  last: boolean;
}

export interface JourneyCategory {
  id: string;
  name: string;
  description: string | null;
  /** R180 §4 — derived by the server from the first and last Level. */
  minAge: number | null;
  maxAge: number | null;
  /** In the Category's own order (§2.2), ordinary steps only. */
  steps: JourneyStep[];
  /** §6 — the programmes that lead into the first step. */
  preparatory: PublicProgramLevel[];
  /** 1-based position on the journey. */
  position: number;
  /** §5 — a learner may join here without the previous Category. */
  directEntry: boolean;
}

export interface Journey {
  categories: JourneyCategory[];
  /** Every ordinary step in walking order, across Categories. */
  steps: JourneyStep[];
}

/**
 * **Journey order.** Youngest first: by the derived start age when every
 * Category with Levels states one; otherwise the Super Admin's own order on
 * «الفئات», which is what the API already returns. A Category without Levels
 * is not on the road at all (nothing to walk) and is listed only in the text
 * view's count of Categories.
 */
export function journeyOrder(categories: readonly PublicProgramCategory[]): PublicProgramCategory[] {
  const walkable = categories.filter((category) => category.levels.length > 0);
  const everyAged = walkable.length > 0 && walkable.every((category) => category.min_age !== null);
  if (!everyAged) return walkable;
  return walkable
    .map((category, index) => ({ category, index }))
    .sort((a, b) => a.category.min_age! - b.category.min_age! || a.index - b.index)
    .map((row) => row.category);
}

export function buildJourney(categories: readonly PublicProgramCategory[]): Journey {
  const ordered = journeyOrder(categories);
  const out: JourneyCategory[] = [];
  const steps: JourneyStep[] = [];
  ordered.forEach((source, index) => {
    const category: JourneyCategory = {
      id: source.id,
      name: source.name,
      description: source.description,
      minAge: source.min_age,
      maxAge: source.max_age,
      steps: [],
      preparatory: source.levels.filter((level) => level.journey_role === 'preparatory'),
      position: index + 1,
      directEntry: index > 0,
    };
    const ordinary = source.levels.filter((level) => level.journey_role !== 'preparatory');
    category.steps = ordinary.map((level, at) => ({
      kind: 'step',
      level,
      category,
      position: at + 1,
      last: at === ordinary.length - 1,
    }));
    out.push(category);
    steps.push(...category.steps);
  });
  return { categories: out, steps };
}

/**
 * The age words, from what the Level or the Category states: «من 6 إلى 12
 * سنة», «من 18 سنة» (no end — the Owner's answer for المرأة), «حتى 12 سنة»,
 * or nothing. The wording is the catalogue's (`admin.taxonomy.age*`), shared
 * with the registration forms so the two never disagree.
 */
export function ageWords(
  range: { minAge: number | null; maxAge: number | null },
  t: (key: string) => string,
): string | null {
  if (range.minAge !== null && range.maxAge !== null) {
    return t('admin.taxonomy.ageBetween')
      .replace('{min}', String(range.minAge))
      .replace('{max}', String(range.maxAge));
  }
  if (range.minAge !== null) return t('admin.taxonomy.ageFrom').replace('{min}', String(range.minAge));
  if (range.maxAge !== null) return t('admin.taxonomy.ageUpTo').replace('{max}', String(range.maxAge));
  return null;
}

/** A Level's own range, in the same words. */
export function levelAgeWords(level: PublicProgramLevel, t: (key: string) => string): string | null {
  return ageWords({ minAge: level.min_age, maxAge: level.max_age }, t);
}
