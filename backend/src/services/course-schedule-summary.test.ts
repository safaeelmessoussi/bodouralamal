import { describe, expect, it } from 'vitest';

import { audienceNames, dimensionSummary } from './course-schedule.service.js';

/** R199 §9 — «الهدف» says «كل مستويات {الفئة}» for a class of every Level of it. */
const level = (levelId: string, name: string, categoryId: string, category: string) => ({
  levelId,
  level: { name, categoryId, category: { name: category } },
});
const empty = { branchScopes: [], administrativeGroupScopes: [], teachingGroupScopes: [] };

describe('dimensionSummary', () => {
  const women = new Map([['W', new Set(['w1', 'w2', 'w3'])]]);

  it('names a whole Category once, instead of its Levels', () => {
    const row = {
      ...empty,
      categoryScopes: [{ categoryId: 'W', category: { name: 'المرأة' } }],
      levelScopes: [level('w1', 'وميض الأمل', 'W', 'المرأة'), level('w2', 'نور الأمل', 'W', 'المرأة'), level('w3', 'فجر الأمل', 'W', 'المرأة')],
    };
    expect(dimensionSummary(row, women)).toBe('كل مستويات المرأة');
  });

  it('lists the Levels when only some are chosen', () => {
    const row = { ...empty, categoryScopes: [], levelScopes: [level('w1', 'وميض الأمل', 'W', 'المرأة'), level('w2', 'نور الأمل', 'W', 'المرأة')] };
    expect(dimensionSummary(row, women)).toBe('وميض الأمل، نور الأمل');
  });
});

/** R255 — the list's «المستوى» column says it the same way. */
describe('audienceNames', () => {
  const women = new Map([['W', new Set(['w1', 'w2', 'w3'])]]);
  const none = { level: null, administrativeGroup: null, teachingGroup: null, administrativeGroupScopes: [], teachingGroupScopes: [] };

  it('names a whole Category once, «كل مستويات {الفئة}», instead of its Levels', () => {
    const row = {
      ...none,
      levelScopes: [level('w1', 'وميض الأمل', 'W', 'المرأة'), level('w2', 'نور الأمل', 'W', 'المرأة'), level('w3', 'فجر الأمل', 'W', 'المرأة')],
    };
    expect(audienceNames(row, women).levels).toEqual(['كل مستويات المرأة']);
  });

  it('lists the Levels when only some are chosen', () => {
    const row = { ...none, levelScopes: [level('w1', 'وميض الأمل', 'W', 'المرأة'), level('w2', 'نور الأمل', 'W', 'المرأة')] };
    expect(audienceNames(row, women).levels).toEqual(['وميض الأمل', 'نور الأمل']);
  });
});
