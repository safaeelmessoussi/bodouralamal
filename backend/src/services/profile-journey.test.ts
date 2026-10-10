import { describe, expect, it } from 'vitest';

import { ownJourney } from './profile.service.js';

/** R214 — «مساري»: one row per Level, its status and its dates. */
const level = (name: string) => ({ name, category: { name: 'المرأة' } });
const row = (id: string, levelId: string, enrolled: string, ended: string | null) => ({
  id,
  levelId,
  enrolledAt: new Date(`${enrolled}T10:00:00Z`),
  deletedAt: ended ? new Date(`${ended}T10:00:00Z`) : null,
  level: level(levelId),
  branch: { name: 'مراكش' },
  administrativeGroup: null,
});

describe('ownJourney', () => {
  it('in progress while an enrolment is live; dropped when every one has ended; completed on its mark', () => {
    const out = ownJourney(
      [
        row('a1', 'A', '2024-09-01', '2025-06-30'),
        row('a2', 'A', '2025-09-01', null),
        row('b1', 'B', '2023-09-01', '2024-01-15'),
        row('c1', 'C', '2022-09-01', '2023-06-30'),
      ],
      [{ levelId: 'C', completedAt: new Date('2023-07-02T10:00:00Z') }],
    );
    expect(out.map((e) => [e.levelName, e.status, e.startedOn, e.endedOn])).toEqual([
      ['C', 'completed', '2022-09-01', '2023-07-02'],
      ['B', 'dropped', '2023-09-01', '2024-01-15'],
      ['A', 'in_progress', '2024-09-01', null],
    ]);
    // The latest enrolment names where she is.
    expect(out[2]!.id).toBe('a2');
  });
});
