import { describe, expect, it } from 'vitest';

import type { PublicProgramCategory, PublicProgramLevel } from '../../adapters/programs.js';
import { t } from '../../i18n/index.js';
import {
  ageWords,
  buildJourney,
  journeyOrder,
  memorisationWords,
  programmeSubjects,
  seasonalSubjects,
  surahSubjectsLabel,
} from './journey-model.js';

/**
 * **SRS Revision 180 — the journey is built from the catalogue, never named
 * in code.** These pins are what «adds a Category, removes a Level, reorders,
 * re-ages» must keep true.
 */
const level = (id: string, over: Partial<PublicProgramLevel> = {}): PublicProgramLevel => ({
  id,
  name: `مستوى ${id}`,
  description: null,
  min_age: null,
  max_age: null,
  journey_role: 'step',
  memorisation_hizb: null,
  subjects: [],
  surahs: [],
  ...over,
});
const category = (
  id: string,
  levels: PublicProgramLevel[],
  over: Partial<PublicProgramCategory> = {},
): PublicProgramCategory => ({
  id,
  name: `فئة ${id}`,
  description: null,
  min_age: null,
  max_age: null,
  subjects: [],
  holds_own_login: false,
  levels,
  ...over,
});

describe('journeyOrder — youngest first', () => {
  it('orders by the derived start age when every Category with Levels states one', () => {
    const ordered = journeyOrder([
      category('women', [level('w1')], { min_age: 18 }),
      category('kids', [level('k1')], { min_age: 6, max_age: 12 }),
      category('teens', [level('t1')], { min_age: 13, max_age: 17 }),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['kids', 'teens', 'women']);
  });

  it("keeps the Super Admin's own order while any Category states no start age", () => {
    const ordered = journeyOrder([
      category('women', [level('w1')]),
      category('kids', [level('k1')], { min_age: 6 }),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['women', 'kids']);
  });

  it('leaves a Category with no Levels off the road', () => {
    expect(
      journeyOrder([category('empty', []), category('kids', [level('k1')])]).map((c) => c.id),
    ).toEqual(['kids']);
  });
});

describe('buildJourney — steps, graduations and the ways in', () => {
  const kids = category('kids', [level('k1'), level('k2'), level('k3')], {
    min_age: 6,
    max_age: 12,
  });
  const women = category(
    'women',
    [level('lit', { journey_role: 'preparatory', name: 'فرصة أمل' }), level('w1'), level('w2')],
    { min_age: 18 },
  );
  const journey = buildJourney([women, kids]);

  it('walks every ordinary step in Category order, numbered within its Category, the last one marked', () => {
    expect(journey.categories.map((c) => c.id)).toEqual(['kids', 'women']);
    expect(
      journey.steps.map((s) => `${s.category.id}:${s.level.id}#${s.position}${s.last ? '!' : ''}`),
    ).toEqual(['kids:k1#1', 'kids:k2#2', 'kids:k3#3!', 'women:w1#1', 'women:w2#2!']);
  });

  it('a preparatory programme is not a step: it leads into the first step and is listed apart', () => {
    const [, w] = journey.categories;
    expect(w!.preparatory.map((l) => l.id)).toEqual(['lit']);
    expect(w!.steps.map((s) => s.level.id)).toEqual(['w1', 'w2']);
  });

  it('every Category after the first may be entered directly — at its first step, never later', () => {
    expect(journey.categories.map((c) => c.directEntry)).toEqual([false, true]);
  });

  it('carries the derived range, open-ended where the last Level states no end', () => {
    expect(ageWords(journey.categories[0]!, t)).toBe('من 6 إلى 12 سنة');
    expect(ageWords(journey.categories[1]!, t)).toBe('من 18 سنة');
    expect(ageWords({ minAge: null, maxAge: null }, t)).toBeNull();
    expect(ageWords({ minAge: null, maxAge: 12 }, t)).toBe('حتى 12 سنة');
  });

  it('adapts when the catalogue changes: a Level added, one removed, a Category dropped', () => {
    const grown = buildJourney([
      category('kids', [level('k1'), level('k2'), level('k3'), level('k4')], { min_age: 6 }),
    ]);
    expect(grown.steps.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(grown.steps[3]!.last).toBe(true);
    const shrunk = buildJourney([category('kids', [level('k2')], { min_age: 6 })]);
    expect(shrunk.steps).toHaveLength(1);
    expect(shrunk.steps[0]!.last).toBe(true);
    expect(buildJourney([]).categories).toEqual([]);
  });
});

/** R184 §2 — the page composes no audience words: nothing of the kind is on the model. */
describe('no audience on the model', () => {
  it("a Category carries no audience — its description (the Super Admin's) says who it is for", () => {
    const journey = buildJourney([category('w', [level('a')], { holds_own_login: true })]);
    expect(journey.categories[0]).not.toHaveProperty('audience');
    expect(journey.categories[0]!.adult).toBe(true);
  });
});

/** R181 §6 / R182 §3 — «حفظ وتفسير: 10 أحزاب»: the by-Surah Subjects' names, the count in Hizb. */
describe('memorisationWords', () => {
  const bySurah = [
    { id: 's1', name: 'حفظ القرآن', works_by_surah: true, seasonal: false },
    { id: 's2', name: 'تفسير القرآن', works_by_surah: true, seasonal: false },
    { id: 's3', name: 'التربية الإسلامية', works_by_surah: false, seasonal: false },
  ];
  it('leaves a seasonal course out of the label (R183 §1)', () => {
    const withCourse = [
      ...bySurah,
      { id: 's9', name: 'دورة قصيرة', works_by_surah: true, seasonal: true },
    ];
    expect(surahSubjectsLabel(level('x', { subjects: withCourse }), t)).toBe('حفظ وتفسير');
    expect(programmeSubjects(withCourse).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(seasonalSubjects(withCourse).map((s) => s.id)).toEqual(['s9']);
    const journey = buildJourney([category('c', [level('a')], { subjects: withCourse })]);
    expect(journey.categories[0]!.sharedSubjects.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(journey.categories[0]!.seasonalSubjects.map((s) => s.id)).toEqual(['s9']);
  });
  it('names the by-Surah Subjects without «القرآن», joined by «و»', () => {
    expect(surahSubjectsLabel(level('x', { subjects: bySurah }), t)).toBe('حفظ وتفسير');
    expect(surahSubjectsLabel(level('x', { subjects: bySurah.slice(0, 1) }), t)).toBe('حفظ');
    expect(
      surahSubjectsLabel(
        level('x', {
          subjects: [{ id: 's4', name: 'التجويد', works_by_surah: true, seasonal: false }],
        }),
        t,
      ),
    ).toBe('التجويد');
    // No Subject by Surah on the Level → the generic words.
    expect(surahSubjectsLabel(level('x', { subjects: bySurah.slice(2) }), t)).toBe('مقرر الحفظ');
  });
  it('says the Hizb count as stated, in the right form', () => {
    expect(memorisationWords(level('x', { subjects: bySurah, memorisation_hizb: 5 }), t)).toBe(
      'حفظ وتفسير: 5 أحزاب',
    );
    expect(memorisationWords(level('x', { subjects: bySurah, memorisation_hizb: 10 }), t)).toBe(
      'حفظ وتفسير: 10 أحزاب',
    );
    expect(memorisationWords(level('x', { memorisation_hizb: 12 }), t)).toBe(
      'مقرر الحفظ: 12 حزبًا',
    );
    expect(memorisationWords(level('x', { memorisation_hizb: 1 }), t)).toBe('مقرر الحفظ: حزب واحد');
    expect(memorisationWords(level('x', { memorisation_hizb: 2 }), t)).toBe('مقرر الحفظ: حزبان');
  });
  it('falls back to how many Surahs the list holds, and says nothing when there are none', () => {
    expect(
      memorisationWords(
        level('x', {
          surahs: [
            { id: 1, name: 'الفاتحة' },
            { id: 2, name: 'البقرة' },
          ],
        }),
        t,
      ),
    ).toBe('مقرر الحفظ: 2 سور');
    expect(memorisationWords(level('x'), t)).toBeNull();
  });
});
