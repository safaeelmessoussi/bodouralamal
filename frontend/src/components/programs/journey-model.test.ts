import { describe, expect, it } from 'vitest';

import type { PublicProgramCategory, PublicProgramLevel } from '../../adapters/programs.js';
import { t } from '../../i18n/index.js';
import { ageWords, buildJourney, journeyOrder } from './journey-model.js';
import { riseFor } from './programs-journey.js';

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
  subjects: [],
  surahs: [],
  ...over,
});
const category = (id: string, levels: PublicProgramLevel[], over: Partial<PublicProgramCategory> = {}): PublicProgramCategory => ({
  id,
  name: `فئة ${id}`,
  description: null,
  min_age: null,
  max_age: null,
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
    expect(journeyOrder([category('empty', []), category('kids', [level('k1')])]).map((c) => c.id)).toEqual(['kids']);
  });
});

describe('buildJourney — steps, graduations and the ways in', () => {
  const kids = category('kids', [level('k1'), level('k2'), level('k3')], { min_age: 6, max_age: 12 });
  const women = category(
    'women',
    [level('lit', { journey_role: 'preparatory', name: 'فرصة أمل' }), level('w1'), level('w2')],
    { min_age: 18 },
  );
  const journey = buildJourney([women, kids]);

  it('walks every ordinary step in Category order, numbered within its Category, the last one marked', () => {
    expect(journey.categories.map((c) => c.id)).toEqual(['kids', 'women']);
    expect(journey.steps.map((s) => `${s.category.id}:${s.level.id}#${s.position}${s.last ? '!' : ''}`)).toEqual([
      'kids:k1#1',
      'kids:k2#2',
      'kids:k3#3!',
      'women:w1#1',
      'women:w2#2!',
    ]);
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
    const grown = buildJourney([category('kids', [level('k1'), level('k2'), level('k3'), level('k4')], { min_age: 6 })]);
    expect(grown.steps.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(grown.steps[3]!.last).toBe(true);
    const shrunk = buildJourney([category('kids', [level('k2')], { min_age: 6 })]);
    expect(shrunk.steps).toHaveLength(1);
    expect(shrunk.steps[0]!.last).toBe(true);
    expect(buildJourney([]).categories).toEqual([]);
  });
});

describe('riseFor — the climb fits the panel', () => {
  it('is a full step for a short catalogue and shrinks, never below 6 px, for a long one', () => {
    expect(riseFor(5, false)).toBe(16);
    expect(riseFor(29, false)).toBe(11);
    expect(riseFor(200, false)).toBe(6);
    expect(riseFor(5, true)).toBe(12);
    expect(riseFor(29, true)).toBe(7);
  });
});
