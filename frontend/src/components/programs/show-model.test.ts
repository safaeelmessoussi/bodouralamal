import { describe, expect, it } from 'vitest';

import type { PublicProgramCategory, PublicProgramLevel } from '../../adapters/programs.js';
import { buildJourney } from './journey-model.js';
import { SHOW_START, advance, enterCategory, walkSequence } from './show-model.js';

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

describe('the show walks one tap at a time (R186)', () => {
  it('from a Category: its steps, a milestone when another Category follows, on to the last, then the graduation, the question, and back', () => {
    const slides = walkSequence(journey, 'c');
    expect(
      slides.map((s) => (s.kind === 'level' ? s.level.id : `milestone:${s.category.id}`)),
    ).toEqual([
      'c1',
      'c2',
      'c3',
      'milestone:c',
      // 'p' has only a preparatory programme: no step and, being last, no milestone.
    ]);
    expect(slides[0]).toMatchObject({ kind: 'level', firstOfCategory: true });
    expect(slides[1]).toMatchObject({ kind: 'level', firstOfCategory: false });
    let state = enterCategory(journey, 'c');
    expect(state).toEqual({ kind: 'walk', start: 'c', at: 0 });
    for (const at of [1, 2, 3]) {
      state = advance(journey, state);
      expect(state).toEqual({ kind: 'walk', start: 'c', at });
    }
    state = advance(journey, state);
    expect(state).toEqual({ kind: 'graduation' });
    state = advance(journey, state);
    expect(state).toEqual({ kind: 'question' });
    expect(advance(journey, state)).toEqual(SHOW_START);
  });

  it('the last Category gets no milestone slide: its end IS the graduation', () => {
    const two = buildJourney([
      category('a', [level('a1')]),
      category('b', [level('b1'), level('b2')]),
    ]);
    expect(walkSequence(two, 'a').map((s) => s.kind)).toEqual([
      'level',
      'milestone',
      'level',
      'level',
    ]);
    expect(walkSequence(two, 'b').map((s) => s.kind)).toEqual(['level', 'level']);
    expect(advance(two, { kind: 'walk', start: 'b', at: 1 })).toEqual({ kind: 'graduation' });
  });

  it('a road with no step from the chosen Category goes straight to the graduation; an unknown one to the start', () => {
    expect(enterCategory(journey, 'p')).toEqual({ kind: 'graduation' });
    expect(enterCategory(journey, 'nope')).toEqual(SHOW_START);
    expect(advance(journey, { kind: 'walk', start: 'nope', at: 0 })).toEqual(SHOW_START);
    expect(advance(journey, SHOW_START)).toEqual(SHOW_START);
  });
});
