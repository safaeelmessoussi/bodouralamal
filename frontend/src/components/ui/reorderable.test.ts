import { describe, expect, it } from 'vitest';

import { draftSettled, moveTo, reorderBlock } from './reorderable.js';

describe('reorderBlock — when manual ordering is offered', () => {
  it('is available in canonical order with every row visible', () => {
    expect(reorderBlock(false, 5, 5)).toBeNull();
    // An unpaginated collection has no total; every row is present by
    // construction, which is the taxonomy screens' case.
    expect(reorderBlock(false, 5, undefined)).toBeNull();
  });

  it('blocks under a column sort — the visible sequence is not the business one', () => {
    expect(reorderBlock(true, 5, 5)).toBe('sorted');
    // `sorted` wins over `paged`: it is the one the reader can act on, and
    // clearing the sort is the next step either way.
    expect(reorderBlock(true, 5, 40)).toBe('sorted');
  });

  it('blocks when the page is not the whole collection', () => {
    // R76.4 takes the exact live set, so a page-sized sequence would be refused
    // by the server; offering the gesture would offer a request that cannot win.
    expect(reorderBlock(false, 25, 40)).toBe('paged');
    expect(reorderBlock(false, 25, 25)).toBeNull();
  });
});

describe('moveTo — the only place a client computes a position', () => {
  const items = ['a', 'b', 'c', 'd'];

  it('moves a row down and up', () => {
    expect(moveTo(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(items, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is a no-op for a move onto itself or out of range', () => {
    expect(moveTo(items, 1, 1)).toEqual(items);
    expect(moveTo(items, -1, 2)).toEqual(items);
    expect(moveTo(items, 0, 9)).toEqual(items);
  });

  it('never mutates its input', () => {
    const copy = [...items];
    moveTo(items, 0, 3);
    expect(items).toEqual(copy);
  });

  it('preserves the set — a reorder adds and removes nothing', () => {
    // The server refuses anything that is not the exact live set, so a move that
    // dropped or duplicated a row would turn a drag into a 400.
    expect([...moveTo(items, 0, 3)].sort()).toEqual([...items].sort());
  });
});

describe('draftSettled — when the optimistic order may be released', () => {
  it('holds until the incoming rows agree, order included', () => {
    expect(draftSettled(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(draftSettled(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(draftSettled(['a', 'b'], ['a'])).toBe(false);
  });
});
