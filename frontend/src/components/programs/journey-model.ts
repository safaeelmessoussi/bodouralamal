import type { PublicProgramCategory, PublicProgramLevel } from '../../adapters/programs.js';
import { ageRangeWords, counted } from '../../lib/arabic-years.js';

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
 *   a later one; said in a note beside that step, with an arrow to it;
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
  /** R182 §1 — the Subjects every step shares, said once under the name;
   *  R183 §1 — the programme's own, the seasonal courses apart. */
  sharedSubjects: PublicProgramCategory['subjects'];
  seasonalSubjects: PublicProgramCategory['subjects'];
  /** R182 §5 — an adult Category (its beneficiaries hold the login). */
  adult: boolean;
  /** In the Category's own order (§2.2), ordinary steps only. */
  steps: JourneyStep[];
  /** §6 — the programmes that lead into the first step. */
  preparatory: PublicProgramLevel[];
  /** 1-based position on the journey (the order only — never shown as a
   *  number: R184 §2, nothing the Super Admin did not enter is written). */
  position: number;
  /** §5 — a learner may join here without the previous Category. */
  directEntry: boolean;
  /** R185 §3 — the last on the road: the attire stands at its graduation. */
  last: boolean;
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
export function journeyOrder(
  categories: readonly PublicProgramCategory[],
): PublicProgramCategory[] {
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
      sharedSubjects: programmeSubjects(source.subjects),
      seasonalSubjects: seasonalSubjects(source.subjects),
      adult: source.holds_own_login === true,
      steps: [],
      preparatory: source.levels.filter((level) => level.journey_role === 'preparatory'),
      position: index + 1,
      directEntry: index > 0,
      last: index === ordered.length - 1,
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

/*
 * R184 §2 — no audience words. «للفتيات فقط» / «للنساء فقط» / «للبنات
 * والبنين» were composed here from the Levels' restriction (R181 §7, R182
 * §5); the Owner keeps that in the Category's own description, entered on
 * «الفئات», and the page writes nothing the Super Admin did not enter.
 */

/**
 * R183 §1 — a seasonal course (`seasonal`, a column on the Subject) is not
 * the programme: the page lists it apart, under «دورات موسمية», and never
 * counts it among a Level's or a Category's Subjects nor in the «حفظ وتفسير»
 * label. The split is the same for a Category's shared Subjects and a
 * Level's own.
 */
export function programmeSubjects<S extends { seasonal: boolean }>(subjects: readonly S[]): S[] {
  return subjects.filter((subject) => !subject.seasonal);
}
export function seasonalSubjects<S extends { seasonal: boolean }>(subjects: readonly S[]): S[] {
  return subjects.filter((subject) => subject.seasonal);
}

/**
 * R182 §3 — the by-Surah Subjects of a Level, as one word each: «حفظ القرآن»
 * and «تفسير القرآن» read «حفظ وتفسير» — the word «القرآن» dropped, joined
 * with «و». Nothing by Surah → the generic «مقرر الحفظ».
 */
export function surahSubjectsLabel(level: PublicProgramLevel, t: (key: string) => string): string {
  const words = programmeSubjects(level.subjects)
    .filter((subject) => subject.works_by_surah)
    .map((subject) => subject.name.replace(/\s*القرآن\s*/g, ' ').trim())
    .filter((word) => word !== '');
  return words.length > 0 ? words.join(' و') : t('programs.journey.memorisationFallback');
}

/**
 * R181 §6 — how much, as the Owner counts it: in Hizb where the Level states
 * a count («5 أحزاب», «10 أحزاب», with Arabic's own plural forms), else as
 * how many Surahs the list holds, else nothing.
 */
export function memorisationAmount(
  level: PublicProgramLevel,
  t: (key: string) => string,
): string | null {
  const hizb = level.memorisation_hizb;
  if (hizb !== null) {
    return hizb === 1
      ? t('programs.journey.hizbOne')
      : hizb === 2
        ? t('programs.journey.hizbTwo')
        : hizb >= 3 && hizb <= 10
          ? t('programs.journey.hizbFew').replace('{n}', String(hizb))
          : t('programs.journey.hizbMany').replace('{n}', String(hizb));
  }
  if (level.surahs.length > 0)
    return counted('programs.journey.surahAmount', level.surahs.length);
  return null;
}

/** «حفظ وتفسير: 10 أحزاب» — or nothing when the Level has neither. */
export function memorisationWords(
  level: PublicProgramLevel,
  t: (key: string) => string,
): string | null {
  const amount = memorisationAmount(level, t);
  if (amount === null) return null;
  return `${surahSubjectsLabel(level, t)}: ${amount}`;
}

/**
 * The age words, from what the Level or the Category states: «من 6 إلى 12
 * سنة», «من 18 سنة» (no end — the Owner's answer for المرأة), «حتى 12 سنة»,
 * or nothing. The wording is the catalogue's (`admin.taxonomy.age*`), shared
 * with the registration forms so the two never disagree.
 */
export function ageWords(
  range: { minAge: number | null; maxAge: number | null },
  // Kept for its callers' signature; the words come from `lib/arabic-years.ts`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _t?: (key: string) => string,
): string | null {
  // R197 — the counted noun agrees with its number (`lib/arabic-years.ts`).
  return ageRangeWords(range.minAge, range.maxAge);
}

/** A Level's own range, in the same words. */
export function levelAgeWords(
  level: PublicProgramLevel,
  t: (key: string) => string,
): string | null {
  return ageWords({ minAge: level.min_age, maxAge: level.max_age }, t);
}
