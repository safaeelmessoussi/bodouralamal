import { describe, expect, it } from 'vitest';

import type { PublicProgramCategory, PublicProgramLevel } from '../../adapters/programs.js';
import { buildJourney } from './journey-model.js';
import { SHOW_START, advance, enterCategory } from './show-model.js';

/** R185 §5 — the show's walk: Categories → Levels one by one → graduation → question → Categories. */
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
const category = (id: string, levels: PublicProgramLevel[]): PublicProgramCategory => ({
  id,
  name: `فئة ${id}`,
  description: null,
  min_age: null,
  max_age: null,
  subjects: [],
  holds_own_login: false,
  levels,
});
const journey = buildJourney([
  category('c', [level('c1'), level('c2'), level('c3')]),
  category('p', [level('p0', { journey_role: 'preparatory' })]),
]);

describe('the show walks one tap at a time', () => {
  it('enters a Category at its first step, then each next one, then the graduation, the question, and back', () => {
    let state = enterCategory(journey, 'c');
    expect(state).toEqual({ kind: 'level', categoryId: 'c', index: 0 });
    state = advance(journey, state);
    expect(state).toEqual({ kind: 'level', categoryId: 'c', index: 1 });
    state = advance(journey, state);
    expect(state).toEqual({ kind: 'level', categoryId: 'c', index: 2 });
    state = advance(journey, state);
    expect(state).toEqual({ kind: 'graduation', categoryId: 'c' });
    state = advance(journey, state);
    expect(state).toEqual({ kind: 'question', categoryId: 'c' });
    expect(advance(journey, state)).toEqual(SHOW_START);
  });

  it('a Category with no ordinary step goes straight to its graduation; an unknown one to the start', () => {
    expect(enterCategory(journey, 'p')).toEqual({ kind: 'graduation', categoryId: 'p' });
    expect(enterCategory(journey, 'nope')).toEqual(SHOW_START);
    expect(advance(journey, { kind: 'level', categoryId: 'nope', index: 0 })).toEqual(SHOW_START);
    expect(advance(journey, SHOW_START)).toEqual(SHOW_START);
  });
});
