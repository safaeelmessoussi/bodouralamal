import { describe, expect, it } from 'vitest';

import { tracksOffered, withinTracks } from './track-filter.js';

/** R238 — «المسار» narrows the Levels and chooses none. */
describe('R238 — «المسار» as an audience choice', () => {
  const scope = {
    levelTracks: { y1: 'younger', o1: 'older' } as const,
    levelCategoryIds: { y1: 'teens', o1: 'teens', k1: 'children' },
    options: { levelId: [{ value: 'y1' }, { value: 'o1' }, { value: 'k1' }] },
  } as never;

  it('offers only the tracks the chosen Categories have', () => {
    expect(tracksOffered(scope, [])).toEqual(['younger', 'older']);
    expect(tracksOffered(scope, ['children'])).toEqual([]);
  });

  it('leaves on offer only the Levels of the chosen tracks — all of them when none is chosen', () => {
    const tracks = { y1: 'younger', o1: 'older' } as const;
    expect(['y1', 'o1', 'k1'].filter((id) => withinTracks(tracks, ['younger'], id))).toEqual(['y1']);
    expect(['y1', 'o1', 'k1'].filter((id) => withinTracks(tracks, [], id))).toEqual(['y1', 'o1', 'k1']);
  });
});
