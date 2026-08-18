import { describe, expect, it } from 'vitest';

import { assertExactSet } from './reorder.js';

/**
 * R76's reorder contract. The design point: taking **the sequence** rather than
 * per-row numbers makes duplicate and gapped `display_order` values *impossible*
 * rather than merely validated — so these tests are about the SET, which is the
 * only thing left that can be wrong.
 */
const LIVE = ['a', 'b', 'c'];

describe('a reorder must be the exact live set', () => {
  it('accepts any permutation of the whole set', () => {
    for (const order of [['a', 'b', 'c'], ['c', 'b', 'a'], ['b', 'a', 'c']]) {
      expect(() => assertExactSet(order, LIVE)).not.toThrow();
    }
  });

  it('accepts an empty sequence for an empty collection', () => {
    expect(() => assertExactSet([], [])).not.toThrow();
  });

  it('refuses a duplicate, naming it', () => {
    expect(() => assertExactSet(['a', 'a', 'b', 'c'], LIVE)).toThrowError(/lists an id twice/);
  });

  it('refuses a foreign or nonexistent id, without distinguishing them', () => {
    // §20 rule 17: the response must not confirm that an id exists somewhere the
    // caller cannot see, so both cases answer the same way.
    expect(() => assertExactSet(['a', 'b', 'c', 'zzz'], LIVE)).toThrowError(/unknown id/);
  });

  it('refuses a partial sequence, naming what is missing', () => {
    /**
     * A partial sequence cannot say where the omitted rows belong — prepend,
     * append, or leave their old numbers to interleave? Each is a different
     * answer and none is obviously right, so it is refused rather than guessed.
     */
    expect(() => assertExactSet(['a', 'b'], LIVE)).toThrowError(/omits rows/);
  });

  it('reports duplicates before missing, so the message names the real fault', () => {
    // `['a','a']` against `['a','b']` is both a duplicate and a missing row; the
    // duplicate is the mistake the caller actually made.
    expect(() => assertExactSet(['a', 'a'], ['a', 'b'])).toThrowError(/lists an id twice/);
  });

  it('is order-insensitive about validity — only the SET must match', () => {
    // Which is the whole point: the sequence carries the intent, and the set
    // carries the validity.
    expect(() => assertExactSet(['c', 'a', 'b'], LIVE)).not.toThrow();
  });
});
