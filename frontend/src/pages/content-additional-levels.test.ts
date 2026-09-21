import { describe, expect, it } from 'vitest';

import { additionalLevelsPatch } from './content.js';

/**
 * SRS Revision 169 §10 — an item's OTHER Levels. What the edit dialog SENDS is
 * pinned here: nothing when the set did not change (like every field of that
 * form), the new set when it did, and an empty set when «كل مستويات الفئة» is
 * ticked, because the two statements must never disagree.
 */
const editing = { level_id: 'home', additional_levels: [{ id: 'b' }, { id: 'a' }] };

describe('what the edit dialog sends for an item’s other Levels', () => {
  it('sends nothing when the set is unchanged — in any order', () => {
    expect(additionalLevelsPatch(editing, { levelId: 'home', wholeCategory: false, additionalLevelIds: ['a', 'b'] })).toEqual({});
  });

  it('sends the whole new set when it changed — the server REPLACES it', () => {
    expect(
      additionalLevelsPatch(editing, { levelId: 'home', wholeCategory: false, additionalLevelIds: ['a', 'c'] }),
    ).toEqual({ additional_level_ids: ['a', 'c'] });
  });

  it('never names the home Level twice, even when it has just moved onto one of them', () => {
    expect(
      additionalLevelsPatch(editing, { levelId: 'a', wholeCategory: false, additionalLevelIds: ['a', 'b'] }),
    ).toEqual({ additional_level_ids: ['b'] });
  });

  it('«كل مستويات الفئة» clears them: that statement already covers every Level', () => {
    expect(
      additionalLevelsPatch(editing, { levelId: 'home', wholeCategory: true, additionalLevelIds: ['a', 'b'] }),
    ).toEqual({ additional_level_ids: [] });
    expect(
      additionalLevelsPatch({ level_id: 'home' }, { levelId: 'home', wholeCategory: true, additionalLevelIds: [] }),
    ).toEqual({});
  });
});
