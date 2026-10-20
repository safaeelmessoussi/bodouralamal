import type { PublicProgramCategory, PublicProgramLevel } from '../../adapters/programs.js';
import { t } from '../../i18n/index.js';
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
  return byAge(categories.filter((category) => category.levels.length > 0), (c) => c.min_age);
}

function byAge<T>(rows: readonly T[], age: (row: T) => number | null): T[] {
  const everyAged = rows.length > 0 && rows.every((row) => age(row) !== null);
  if (!everyAged) return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => age(a.row)! - age(b.row)! || a.index - b.index)
    .map((entry) => entry.row);
}

/**
 * **R233 — a Category's tracks are stages of their own.** «اليافعات» walks
 * «صغار» and «كبار» apart, each from its own first step, so each is a stage
 * («اليافعات — صغار»), with its ages derived the way the server derives a
 * Category's (its first stated start, its last Level's end). A Category with
 * one line stays one stage, under its own id.
 */
interface StageSource {
  id: string;
  name: string;
  source: PublicProgramCategory;
  levels: PublicProgramLevel[];
  minAge: number | null;
  maxAge: number | null;
}

function stagesOf(source: PublicProgramCategory): StageSource[] {
  // «صغار» before «كبار» where no age orders them.
  const rank = (track: string | null): number => (track === 'younger' ? 0 : track === null ? 1 : 2);
  const tracks = [...new Set(source.levels.map((level) => level.track ?? null))].sort((a, b) => rank(a) - rank(b));
  if (tracks.length <= 1) {
    return [{ id: source.id, name: source.name, source, levels: source.levels, minAge: source.min_age, maxAge: source.max_age }];
  }
  return tracks.map((track) => {
    const levels = source.levels.filter((level) => (level.track ?? null) === track);
    return {
      id: `${source.id}:${track ?? 'none'}`,
      name: track
        ? t('programs.journey.trackTitle').replace('{category}', source.name).replace('{track}', t(`programs.journey.track.${track}`))
        : source.name,
      source,
      levels,
      minAge: levels.find((level) => level.min_age !== null)?.min_age ?? null,
      maxAge: levels.at(-1)?.max_age ?? null,
    };
  });
}

export function buildJourney(categories: readonly PublicProgramCategory[]): Journey {
  const walkable = categories.filter((category) => category.levels.length > 0);
  const ordered = byAge(walkable.flatMap(stagesOf), (stage) => stage.minAge);
  const out: JourneyCategory[] = [];
  const steps: JourneyStep[] = [];
  ordered.forEach((stage, index) => {
    const { source } = stage;
    const ordinary = stage.levels.filter((level) => level.journey_role !== 'preparatory');
    const category: JourneyCategory = {
      id: stage.id,
      name: stage.name,
      description: source.description,
      minAge: stage.minAge,
      maxAge: stage.maxAge,
      sharedSubjects: programmeSubjects(source.subjects),
      seasonalSubjects: seasonalSubjects(source.subjects),
      adult: source.holds_own_login === true,
      steps: [],
      preparatory: stage.levels.filter((level) => level.journey_role === 'preparatory'),
      position: index + 1,
      // R233 — a way in where the first step takes newcomers.
      directEntry: index > 0 && ordinary[0]?.accepts_newcomers !== false,
      last: index === ordered.length - 1,
    };
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
