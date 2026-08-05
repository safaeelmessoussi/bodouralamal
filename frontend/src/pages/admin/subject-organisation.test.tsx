import { describe, expect, it } from 'vitest';

import type { SubjectSplit, TeachingGroup, UnassignedStudent } from '../../adapters/teaching-groups.js';

/**
 * Subject Organisation — the client half of the contract guard, plus the one
 * distinction this screen exists to preserve.
 */
const GROUP: TeachingGroup = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'فوج ١',
  level_id: '00000000-0000-4000-8000-000000000002',
  subject_id: '00000000-0000-4000-8000-000000000003',
  display_order: 1,
  member_count: 4,
  version: 0,
};

const UNASSIGNED: UnassignedStudent = {
  student_id: '00000000-0000-4000-8000-000000000004',
  name: 'طالبة',
  administrative_group_id: '00000000-0000-4000-8000-000000000005',
  branch_id: '00000000-0000-4000-8000-000000000006',
};

describe('the adapter types match the wire contract', () => {
  it('a teaching group carries exactly the documented keys', () => {
    expect(Object.keys(GROUP).sort()).toEqual([
      'display_order',
      'id',
      'level_id',
      'member_count',
      'name',
      'subject_id',
      'version',
    ]);
  });

  it('has no branch_id — a Teaching Group belongs to a Subject and a Level', () => {
    // §4.4b: a Level spans branches, so the group has no branch to scope by.
    // That absence is the structural reason R43.3 split the authority, and a
    // branch_id here would invite exactly the scope check that has no referent.
    expect(GROUP).not.toHaveProperty('branch_id');
  });

  it('an unassigned student carries what placing them requires', () => {
    // Without these the list names a problem and withholds what is needed to
    // fix it.
    expect(Object.keys(UNASSIGNED).sort()).toEqual([
      'administrative_group_id',
      'branch_id',
      'name',
      'student_id',
    ]);
  });
});

describe('split:false is not the same answer as "everyone is placed"', () => {
  it('distinguishes the two states the screen must never conflate', () => {
    // A Subject with no groups is taught to the entire Level, so nobody is
    // unassigned and the question does not apply. A SPLIT subject with an empty
    // list means everyone is placed. Both have `unassigned: []`, and only the
    // flag tells them apart — which is why the screen branches on it before it
    // ever looks at the list's length.
    const notSplit: SubjectSplit = { groups: [], split: false, unassigned: [] };
    const allPlaced: SubjectSplit = { groups: [GROUP], split: true, unassigned: [] };

    expect(notSplit.unassigned).toEqual(allPlaced.unassigned);
    expect(notSplit.split).not.toBe(allPlaced.split);
  });
});
