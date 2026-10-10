import { describe, expect, it } from 'vitest';

import { taughtWhere, type TaughtSubject } from './calendar-filters.js';

const levels = [
  { id: 'w1', name: 'المستوى 1', category_id: 'women', display_order: 1 },
  { id: 'w2', name: 'المستوى 2', category_id: 'women', display_order: 2 },
  { id: 'c1', name: 'المستوى 1', category_id: 'children', display_order: 1 },
];
const hifz: TaughtSubject = { id: 'hifz', name: 'حفظ القرآن', level_ids: ['w1', 'c1'], category_ids: [] };
const fiqh: TaughtSubject = { id: 'fiqh', name: 'الفقه', level_ids: [], category_ids: ['women'] };
const tajwid: TaughtSubject = { id: 'tajwid', name: 'التجويد', level_ids: ['w2'], category_ids: [] };

describe('R212 — «المادة» narrows with «الفئة» and «المستوى»', () => {
  it('a Level keeps the Subjects it teaches on its own and those of its whole Category', () => {
    expect([hifz, fiqh, tajwid].filter((s) => taughtWhere(s, 'w1', null, levels)).map((s) => s.id)).toEqual(['hifz', 'fiqh']);
    expect([hifz, fiqh, tajwid].filter((s) => taughtWhere(s, 'c1', null, levels)).map((s) => s.id)).toEqual(['hifz']);
  });

  it('a Category keeps the Subjects taught to it or at one of its Levels', () => {
    expect([hifz, fiqh, tajwid].filter((s) => taughtWhere(s, null, 'women', levels)).map((s) => s.id)).toEqual(['hifz', 'fiqh', 'tajwid']);
    expect([hifz, fiqh, tajwid].filter((s) => taughtWhere(s, null, 'children', levels)).map((s) => s.id)).toEqual(['hifz']);
  });

  it('nothing chosen, or a list that does not say where it is taught, narrows nothing', () => {
    expect(taughtWhere(tajwid, null, null, levels)).toBe(true);
    expect(taughtWhere({ id: 'x', name: 'مادة' }, 'c1', null, levels)).toBe(true);
  });
});
