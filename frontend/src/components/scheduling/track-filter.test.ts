import { describe, expect, it } from 'vitest';

import { levelsAfterTracks, trackChoices } from './track-filter.js';

/** R235 — «المسار» chooses every Level of a track, and lets them go again. */
describe('R235 — choosing Levels by track', () => {
  const offered = ['y1', 'y2', 'o1', 'o2', 'plain'];
  const tracks = { y1: 'younger', y2: 'younger', o1: 'older', o2: 'older' } as const;

  it('offers only the tracks the Levels on offer have, chosen while all their Levels are', () => {
    expect(trackChoices(['plain'], tracks, []).tracks).toEqual([]);
    expect(trackChoices(offered, tracks, ['y1', 'y2', 'o1']).selected).toEqual(['younger']);
  });

  it('adds a track’s Levels, keeps other choices, and removes them with the track', () => {
    const withYoung = levelsAfterTracks(offered, tracks, ['plain'], ['younger']);
    expect(withYoung.sort()).toEqual(['plain', 'y1', 'y2']);
    expect(levelsAfterTracks(offered, tracks, withYoung, []).sort()).toEqual(['plain']);
    // A Level of a track chosen alone stays when another track is added.
    expect(levelsAfterTracks(offered, tracks, ['o1'], ['younger']).sort()).toEqual(['o1', 'y1', 'y2']);
  });
});
