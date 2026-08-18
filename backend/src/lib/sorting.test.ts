import { describe, expect, it } from 'vitest';

import { resolveSort, sortParamsFrom, type SortableFields } from './sorting.js';

/**
 * R76's sorting contract. The security property is the one worth stating twice:
 * **`sort_by` names a field in the contract, never a database column**, so an
 * unknown name has no path to the query at all.
 */
const FIELDS: SortableFields = {
  name: (dir) => [{ name: dir }],
  // A field ordering by something other than itself — the client neither names
  // nor knows about the relation traversal.
  category: (dir) => [{ category: { displayOrder: dir } }, { category: { name: dir } }],
};
const FALLBACK = [{ displayOrder: 'asc' }, { name: 'asc' }];

describe('reading the parameters', () => {
  it('reads R76’s snake_case names, like page_size beside them', () => {
    expect(sortParamsFrom({ sort_by: 'name', sort_dir: 'desc' })).toEqual({
      sortBy: 'name',
      sortDir: 'desc',
    });
  });

  it('treats blank and non-string as absent', () => {
    expect(sortParamsFrom({ sort_by: '   ', sort_dir: 5 })).toEqual({
      sortBy: undefined,
      sortDir: undefined,
    });
  });
});

describe('resolving a sort', () => {
  it('returns the collection’s own default when nothing is asked', () => {
    // R76.2: this adds a capability and moves no default. BR-19's order is what
    // an unparameterised list still receives.
    expect(resolveSort(FIELDS, {}, FALLBACK)).toEqual([
      { displayOrder: 'asc' },
      { name: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('appends a deterministic tiebreaker to every order', () => {
    // R76.3 — offset pagination with a non-unique sort puts a row on two pages
    // or on neither.
    expect(resolveSort(FIELDS, { sortBy: 'name', sortDir: 'asc' }, FALLBACK)).toEqual([
      { name: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('does not double the tiebreaker if the field already ends in id', () => {
    const ends: SortableFields = { x: (dir) => [{ x: dir }, { id: 'asc' }] };
    expect(resolveSort(ends, { sortBy: 'x' }, FALLBACK)).toEqual([{ x: 'asc' }, { id: 'asc' }]);
  });

  it('sorts ascending by default, and descending when asked', () => {
    expect(resolveSort(FIELDS, { sortBy: 'name' }, FALLBACK)[0]).toEqual({ name: 'asc' });
    expect(resolveSort(FIELDS, { sortBy: 'name', sortDir: 'desc' }, FALLBACK)[0]).toEqual({
      name: 'desc',
    });
  });

  it('carries the direction into a relation traversal', () => {
    expect(resolveSort(FIELDS, { sortBy: 'category', sortDir: 'desc' }, FALLBACK)).toEqual([
      { category: { displayOrder: 'desc' } },
      { category: { name: 'desc' } },
      { id: 'asc' },
    ]);
  });
});

describe('an unknown sort is refused, never ignored', () => {
  it('refuses a field outside the allow-list, and says what is allowed', () => {
    // Silently falling back would make a typo look like a working sort — and
    // would hide a client sending a column name it should not know.
    expect(() => resolveSort(FIELDS, { sortBy: 'password' }, FALLBACK)).toThrowError(
      /cannot sort by password/,
    );
  });

  it('refuses a database column name that is not a contract field', () => {
    // The security property, stated as a test: there is no path from the query
    // string to a column, not even a sanitised one.
    for (const injected of ['display_order', 'displayOrder', 'id; DROP TABLE', '__proto__']) {
      expect(() => resolveSort(FIELDS, { sortBy: injected }, FALLBACK)).toThrowError(
        /cannot sort by/,
      );
    }
  });

  it('refuses a direction that is neither asc nor desc', () => {
    expect(() => resolveSort(FIELDS, { sortBy: 'name', sortDir: 'sideways' }, FALLBACK)).toThrowError(
      /asc or desc/,
    );
  });

  it('refuses a direction with no field — the caller believes they are sorting', () => {
    expect(() => resolveSort(FIELDS, { sortDir: 'desc' }, FALLBACK)).toThrowError(
      /sort_dir requires sort_by/,
    );
  });
});
